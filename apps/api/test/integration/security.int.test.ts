/**
 * Security behaviour through the real HTTP stack:
 *  - two-factor login, trusted challenge tokens, brute-force lockout (port of the
 *    original security smoke test)
 *  - a suspended workspace is locked out on the very next request, not at token expiry
 *  - tenant and operator tokens are not interchangeable
 *  - the CORS allowlist, malformed input, and 500s that never leak internals
 *  - personal data is ciphertext at rest and crypto-shredded when a workspace is purged
 */
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos, systemRepos } from "../../src/repositories/base.repository";
import { db } from "../../src/db/kysely";
import { hashPassword } from "../../src/middleware/auth";
import * as totp from "../../src/security/totp";
import { ACCOUNTS, client, seedFixtures, startServer, type Res } from "./fixtures";

let server: { base: string; close: () => Promise<void> };
let api: ReturnType<typeof client>;
let fx: Awaited<ReturnType<typeof seedFixtures>>;
const ALLOWED_ORIGIN = "https://app.example.com";

beforeAll(async () => {
  process.env.CORS_ORIGINS = `${ALLOWED_ORIGIN},https://console.example.com`;
  fx = await seedFixtures();
  server = await startServer();
  api = client(server.base);
});
afterAll(async () => {
  delete process.env.CORS_ORIGINS;
  await server.close();
});

const call = (m: string, p: string, token?: string | null, body?: unknown, headers?: Record<string, string>): Promise<Res> =>
  api.call(m, p, token, body, headers);

describe("Two-factor login and lockout", () => {
  const email = "mfa.smoke@acme.example.com";
  const PW = "Str0ng-Pass!";
  let userId = "";
  let token = "";
  let secret = "";

  beforeAll(async () => {
    const r = repos({ orgId: fx.acme.id });
    const u = await r.users.insert({ email, name: "MFA Smoke", role: "EMPLOYEE", employeeId: null, passwordHash: hashPassword(PW), status: "ACTIVE", emailVerifiedAt: new Date().toISOString(), credentialsChangedAt: new Date(0).toISOString() });
    userId = u.id;
  });

  it("plain login returns a session token before 2FA is enrolled", async () => {
    const lr = await call("POST", "/api/auth/login", null, { email, password: PW });
    expect(lr.status).toBe(200);
    expect(lr.data.mfaRequired).toBeFalsy();
    token = lr.data.token;
  });
  it("the password policy rejects a weak new password", async () => {
    expect((await call("POST", "/api/auth/change-password", token, { currentPassword: PW, newPassword: "weak" })).status).toBe(400);
  });
  it("enrolment returns a secret and refuses a wrong confirmation code", async () => {
    const enr = await call("POST", "/api/mfa/enroll", token, {});
    expect(enr.status).toBe(200);
    expect(enr.data.otpauth).toMatch(/^otpauth:\/\/totp\//);
    secret = enr.data.secret;
    expect((await call("POST", "/api/mfa/enroll/verify", token, { code: "000000" })).status).toBe(400);
  });
  it("a real code enables 2FA", async () => {
    expect((await call("POST", "/api/mfa/enroll/verify", token, { code: totp.generate(secret) })).status).toBe(200);
    expect((await call("GET", "/api/mfa/status", token)).data.enabled).toBe(true);
  });
  it("the password step now returns a challenge, never a session", async () => {
    const lr = await call("POST", "/api/auth/login", null, { email, password: PW });
    expect(lr.data.mfaRequired).toBe(true);
    expect(lr.data.token).toBeUndefined();
    expect((await call("POST", "/api/auth/login/mfa", null, { mfaToken: lr.data.mfaToken, code: "000000" })).status).toBe(400);
    const step2 = await call("POST", "/api/auth/login/mfa", null, { mfaToken: lr.data.mfaToken, code: totp.generate(secret) });
    expect(step2.status).toBe(200);
    expect(step2.data.token).toBeTruthy();
    // The challenge token proves the password only.
    expect((await call("GET", "/api/auth/me", lr.data.mfaToken)).status).toBe(401);
  });
  it("the second factor is brute-force protected: after 5 misses even a correct code is refused", async () => {
    const ch = await call("POST", "/api/auth/login", null, { email, password: PW });
    let last: Res | null = null;
    for (let i = 0; i < 5; i++) last = await call("POST", "/api/auth/login/mfa", null, { mfaToken: ch.data.mfaToken, code: "000000" });
    expect(last!.status).toBe(400);
    expect((await call("POST", "/api/auth/login/mfa", null, { mfaToken: ch.data.mfaToken, code: totp.generate(secret) })).status).toBe(403);
    await repos({ orgId: fx.acme.id }).users.update(userId, { failedLogins: 0, lockedUntil: null });
  });
  it("disabling 2FA needs the password and a code", async () => {
    expect((await call("POST", "/api/mfa/disable", token, { password: "wrong", code: totp.generate(secret) })).status).toBe(400);
    expect((await call("POST", "/api/mfa/disable", token, { password: PW, code: totp.generate(secret) })).status).toBe(200);
    const lr = await call("POST", "/api/auth/login", null, { email, password: PW });
    expect(lr.data.mfaRequired).toBeFalsy();
  });
  it("repeated wrong passwords lock the account, including against the right password", async () => {
    let last: Res | null = null;
    for (let i = 0; i < 5; i++) last = await call("POST", "/api/auth/login", null, { email, password: "nope" + i });
    expect(last!.status).toBe(401);
    expect((await call("POST", "/api/auth/login", null, { email, password: "nope" })).status).toBe(403);
    expect((await call("POST", "/api/auth/login", null, { email, password: PW })).status).toBe(403);
  });
});

describe("Workspace suspension takes effect immediately", () => {
  let tenant = "";
  let operator = "";
  it("a signed-in employee can work normally", async () => {
    tenant = await api.login(ACCOUNTS.emp);
    operator = await api.operatorLogin();
    expect((await call("GET", "/api/auth/me", tenant)).status).toBe(200);
  });
  it("after the operator suspends the workspace, the SAME token is refused on its next request", async () => {
    const s = await call("POST", `/api/platform/tenants/${fx.acme.id}/suspend`, operator, { reason: "test" });
    expect(s.status).toBe(200);
    const r = await call("GET", "/api/auth/me", tenant);
    expect(r.status).toBe(403);
    expect(r.data.code).toBe("WORKSPACE_SUSPENDED");
  });
  it("new logins are refused while suspended", async () => {
    expect((await call("POST", "/api/auth/login", null, { email: ACCOUNTS.emp, password: "Fixture-Passw0rd!" })).status).toBe(403);
  });
  it("another workspace is unaffected", async () => {
    const other = await api.login(ACCOUNTS.globexAdmin);
    expect((await call("GET", "/api/auth/me", other)).status).toBe(200);
  });
  it("reactivation restores the existing session", async () => {
    expect((await call("POST", `/api/platform/tenants/${fx.acme.id}/reactivate`, operator, { reason: "test" })).status).toBe(200);
    expect((await call("GET", "/api/auth/me", tenant)).status).toBe(200);
  });
});

describe("Token planes are separate", () => {
  it("a tenant token cannot call the operator API", async () => {
    const tenant = await api.login(ACCOUNTS.acmeAdmin);
    expect((await call("GET", "/api/platform/tenants", tenant)).status).toBe(401);
  });
  it("an operator token cannot call the tenant API", async () => {
    const operator = await api.operatorLogin();
    expect((await call("GET", "/api/employees", operator)).status).toBe(401);
  });
  it("a SUPPORT operator can read but not suspend", async () => {
    await systemRepos().platformAdmins.insert({ email: "support@fixtures.example.com", name: "Support", role: "SUPPORT", status: "ACTIVE", passwordHash: (await import("../../src/middleware/platform-auth")).hashPw("Fixture-Passw0rd!") });
    const support = await api.operatorLogin("support@fixtures.example.com");
    expect((await call("GET", "/api/platform/tenants", support)).status).toBe(200);
    expect((await call("POST", `/api/platform/tenants/${fx.globex.id}/suspend`, support, { reason: "x" })).status).toBe(403);
  });
});

describe("HTTP hardening", () => {
  it("an allowed origin gets CORS headers", async () => {
    // /up sits before every middleware on purpose (load-balancer probes), so use /api/ready.
    const r = await call("GET", "/api/ready", null, undefined, { Origin: ALLOWED_ORIGIN });
    expect(r.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  });
  it("an unknown origin is refused with 403, not a 500", async () => {
    const r = await call("GET", "/api/auth/me", null, undefined, { Origin: "https://evil.example.net" });
    expect(r.status).toBe(403);
    expect(r.data.code).toBe("CORS_ORIGIN_DENIED");
  });
  it("malformed JSON is a 400, not a server error", async () => {
    const r = await new Promise<Res>((resolve, reject) => {
      const req = http.request(server.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" } }, (res: any) => {
        let b = "";
        res.on("data", (c: string) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(b || "{}"), headers: res.headers, body: b }));
      });
      req.on("error", reject);
      req.end("{not json");
    });
    expect(r.status).toBe(400);
  });
  it("security headers are set", async () => {
    const r = await call("GET", "/api/ready");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["strict-transport-security"]).toBeTruthy();
  });
  it("unauthenticated requests get 401", async () => {
    expect((await call("GET", "/api/employees")).status).toBe(401);
  });
});

describe("Personal data at rest", () => {
  it("identity numbers written through the API are ciphertext in Postgres and plaintext to an authorised reader", async () => {
    const admin = await api.login(ACCOUNTS.acmeAdmin);
    const put = await call("PUT", `/api/employees/${fx.ids.emp}`, admin, { kyc: { pan: "ABCDE1234F", aadhaar: "123456789012" }, bank: { account: "000111222333", ifsc: "TEST0001234" } });
    expect(put.status).toBe(200);
    const row = await db.selectFrom("employees").select("data").where("id", "=", fx.ids.emp).executeTakeFirstOrThrow();
    const raw = JSON.stringify(row.data);
    expect(raw).not.toContain("123456789012");
    expect(raw).not.toContain("000111222333");
    expect((row.data as any).kyc.$enc).toBe("v1");
    const read = await call("GET", `/api/employees/${fx.ids.emp}`, admin);
    const emp = read.data.employee || read.data;
    expect(emp.kyc.aadhaar).toBe("123456789012");
    expect(emp.bank.account).toBe("000111222333");
  });
  it("each workspace has its own wrapped data key", async () => {
    const keys = await db.selectFrom("org_data_keys").selectAll().execute();
    expect(keys.map((k) => k.org_id)).toContain(fx.acme.id);
    for (const k of keys) expect(k.wrapped_key.length).toBeGreaterThan(40);
  });
  it("purging a workspace destroys its data key (crypto-shredding)", async () => {
    const operator = await api.operatorLogin();
    // Something sealed for Globex, so it has a key to destroy.
    await repos({ orgId: fx.globex.id }).vendors.insert({ code: "VEN-X", name: "Shred Test", status: "ACTIVE", bank: { account: "999" } });
    expect(await db.selectFrom("org_data_keys").select("org_id").where("org_id", "=", fx.globex.id).executeTakeFirst()).toBeTruthy();
    expect((await call("POST", `/api/platform/tenants/${fx.globex.id}/suspend`, operator, { reason: "purge" })).status).toBe(200);
    const del = await call("DELETE", `/api/platform/tenants/${fx.globex.id}`, operator, { confirmName: "Globex", reason: "test" });
    expect(del.status).toBe(200);
    expect(await db.selectFrom("org_data_keys").select("org_id").where("org_id", "=", fx.globex.id).executeTakeFirst()).toBeUndefined();
    expect(await systemRepos().organizations.byId(fx.globex.id)).toBeNull();
  });
});
