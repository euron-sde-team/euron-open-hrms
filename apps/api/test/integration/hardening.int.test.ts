/**
 * Regression tests for the API hardening pass, one group per defect:
 *
 *   body         a request with no JSON body gets the endpoint's normal answer, not a 500
 *   scope        letters respect a department-scoped HR user's scope
 *   audit        audit rows are attributed through the hot userId column, not `by`
 *   csv          the leave export defangs spreadsheet formulas
 *   ai tokens    only the real plans are accepted
 *   names        a person without a last name never renders as "undefined"
 *   separation   a login whose employee record is gone gets a 404, not a 500
 *   performance  a rating of 0 saves; appraisal lists honour scope like /pips
 *   employees    resend uses the login address rules; bulk edits validate addresses;
 *                EXITED is only reachable through the exit flow
 *   campaigns    cancelling a campaign stamps cancelledAt on the cases it cancels
 */
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos, systemRepos } from "../../src/repositories/base.repository";
import { hashPassword } from "../../src/middleware/auth";
import { createApp } from "../../src/app";
import { ACCOUNTS, PASSWORD, activeUser, arr, client, seedFixtures, startServer, type Res } from "./fixtures";

let server: { base: string; close: () => Promise<void> };
let bare: { base: string; close: () => Promise<void> };
let api: ReturnType<typeof client>;
let bareApi: ReturnType<typeof client>;
let fx: Awaited<ReturnType<typeof seedFixtures>>;
let r: ReturnType<typeof repos>;
let hr = "";
let emp = "";
let scopedHr = "";
let productDeptId = "";
let adminUserId = "";

const SCOPED_HR_EMAIL = "scoped.hr@acme.example.com";

/**
 * The real app without its JSON body parser.
 *
 * Express 4's parser happens to default req.body to {}, which hid every controller that
 * read req.body.x unguarded; Express 5, and any request that never reaches the parser,
 * leaves it undefined. Running the real routers without it is that case exactly.
 */
async function startBareServer() {
  const app: any = createApp();
  app._router.stack = app._router.stack.filter((layer: any) => layer.name !== "jsonParser");
  const s = app.listen(0, "127.0.0.1");
  await new Promise<void>((res) => s.once("listening", () => res()));
  return {
    base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`,
    close: () => new Promise<void>((res) => s.close(() => res())),
  };
}

/** A login for an employee record with no last name at all (single-name people). */
async function singleNamePerson(firstName: string, deptId: string) {
  return r.employees.insert({
    departmentId: deptId, code: `ACM-${firstName.toUpperCase()}`, firstName,
    email: `${firstName.toLowerCase()}@acme.example.com`, personalEmail: "", phone: "",
    employmentType: "FULL_TIME", designation: "Analyst", joiningDate: "2026-01-01", status: "ACTIVE",
    salary: { basic: 50000, hra: 20000, allowances: 5000, deductions: 0 }, bank: { account: "", ifsc: "" },
  });
}

beforeAll(async () => {
  fx = await seedFixtures();
  r = repos({ orgId: fx.acme.id });
  const depts = await r.departments.all();
  productDeptId = depts.find((d: any) => d.name === "Product")!.id;
  // HR, but only for the Product department (Nisha). Everyone else is out of scope.
  await r.users.insert({
    email: SCOPED_HR_EMAIL, name: "Scoped HR", role: "HR", employeeId: null,
    passwordHash: hashPassword(PASSWORD), ...activeUser(),
    scope: { scopeType: "DEPARTMENT", scopeIds: [productDeptId] },
  });
  adminUserId = (await systemRepos().users.where({ email: ACCOUNTS.acmeAdmin }).one())!.id;
  server = await startServer();
  bare = await startBareServer();
  api = client(server.base);
  bareApi = client(bare.base);
  hr = await api.login(ACCOUNTS.acmeAdmin);
  emp = await api.login(ACCOUNTS.emp);
  scopedHr = await api.login(SCOPED_HR_EMAIL);
});
afterAll(async () => {
  await server.close();
  await bare.close();
});

const call = (m: string, p: string, token: string | null = hr, body?: unknown): Promise<Res> => api.call(m, p, token, body);

describe("A request with no JSON body", () => {
  // Each one answered 500 when req.body was undefined. With no body the answer must be
  // the one an empty object gets: the endpoint's own validation error or lookup miss.
  const cases: [string, string, () => string | null, number][] = [
    ["POST", "/api/auth/login", () => null, 400],
    ["POST", "/api/org/offices", () => hr, 400],
    ["POST", "/api/onboarding-templates", () => hr, 400],
    ["POST", "/api/separation", () => hr, 404],
    ["POST", "/api/performance/cycles", () => hr, 400],
    ["POST", "/api/announcements", () => hr, 400],
    ["POST", "/api/ai-tokens/grant", () => hr, 404],
  ];
  for (const [method, path, token, expected] of cases) {
    it(`${method} ${path} answers ${expected}, the same as an empty object`, async () => {
      const none = await bareApi.call(method, path, token());
      const empty = await call(method, path, token(), {});
      expect(none.status, none.body.slice(0, 200)).toBe(expected);
      expect(empty.status).toBe(expected);
      expect(none.data?.error).toBe(empty.data?.error);
    });
  }

  it("POST /api/users/:id/status with no status is refused, never a silent re-enable", async () => {
    const target = (await systemRepos().users.where({ email: ACCOUNTS.plain }).one())!;
    const none = await bareApi.call("POST", `/api/users/${target.id}/status`, hr);
    expect(none.status, none.body.slice(0, 200)).toBe(400);
    const typo = await call("POST", `/api/users/${target.id}/status`, hr, { status: "ENABLED" });
    expect(typo.status).toBe(400);
  });
});

describe("Letters respect the caller's department scope", () => {
  it("a Product-scoped HR user cannot issue an offer letter for Engineering", async () => {
    const res = await call("POST", `/api/letters/offer/${fx.ids.lead}`, scopedHr, { email: false });
    expect(res.status, res.body.slice(0, 200)).toBe(403);
    expect(res.data.error).toBe("Outside your assigned scope");
  });

  for (const kind of ["confirmation", "probation-extension", "relieving", "appraisal"]) {
    it(`nor a ${kind} letter`, async () => {
      const res = await call("POST", `/api/letters/${kind}/${fx.ids.emp}`, scopedHr, { email: false });
      expect(res.status, res.body.slice(0, 200)).toBe(403);
    });
  }

  it("and nothing was filed for the out-of-scope people", async () => {
    const docs = (await r.documents.all()).filter((d: any) => d.employeeId === fx.ids.lead || d.employeeId === fx.ids.emp);
    expect(docs).toHaveLength(0);
  });

  it("but still can for someone in their department", async () => {
    const res = await call("POST", `/api/letters/confirmation/${fx.ids.plain}`, scopedHr, { email: false });
    expect(res.status, res.body.slice(0, 200)).toBe(201);
  });
});

describe("Audit attribution", () => {
  it("EMPLOYEE_CONFIRMED is attributed through userId", async () => {
    const res = await call("POST", `/api/letters/confirmation/${fx.ids.intern}`, hr, { email: false, confirm: true });
    expect(res.status, res.body.slice(0, 200)).toBe(201);
    const rows = (await r.auditLog.all()).filter((a: any) => a.action === "EMPLOYEE_CONFIRMED");
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(adminUserId);
    expect(rows[0].by).toBeUndefined();
  });
});

describe("Leave CSV export", () => {
  it("prefixes a formula-looking reason with a single quote", async () => {
    const types = await call("GET", "/api/leave/types", emp);
    const list = Array.isArray(types.data) ? types.data : types.data.types;
    const casual = list.find((t: any) => t.name === "Casual Leave");
    const applied = await call("POST", "/api/leave/requests", emp, { leaveTypeId: casual.id, from: "2026-12-01", to: "2026-12-01", reason: "=1+2" });
    expect(applied.status, applied.body.slice(0, 200)).toBe(201);
    const csv = await call("GET", "/api/leave/requests/export.csv", hr);
    expect(csv.status).toBe(200);
    expect(csv.body).toContain(",'=1+2");
    expect(csv.body).not.toMatch(/,=1\+2/);
  });
});

describe("AI token plans", () => {
  it("refuses an inherited key such as toString", async () => {
    const res = await call("POST", "/api/ai-tokens/grant", hr, { employeeId: fx.ids.emp, plan: "toString" });
    expect(res.status, res.body.slice(0, 200)).toBe(400);
  });

  it("still accepts a real plan", async () => {
    const res = await call("POST", "/api/ai-tokens/grant", hr, { employeeId: fx.ids.emp, plan: "PRO" });
    expect(res.status).toBe(200);
    expect(res.data.plan).toBe("PRO");
    expect(res.data.dailyLimit).toBe(500000);
  });
});

describe("Names without a last name", () => {
  it("a relieving letter title does not say undefined", async () => {
    const solo = await singleNamePerson("Madhu", productDeptId);
    const res = await call("POST", `/api/letters/relieving/${solo.id}`, hr, { email: false });
    expect(res.status, res.body.slice(0, 200)).toBe(201);
    const doc = await r.documents.byId(res.data.documentId);
    expect(doc!.title).toBe("Relieving Letter - Madhu");
  });
});

describe("Separation for a login whose employee record is gone", () => {
  it("resign answers 404, not 500", async () => {
    const email = "ghost@acme.example.com";
    await r.users.insert({ email, name: "Ghost", role: "EMPLOYEE", employeeId: crypto.randomUUID(), passwordHash: hashPassword(PASSWORD), ...activeUser() });
    const ghost = await api.login(email);
    const res = await call("POST", "/api/separation/resign", ghost, { reason: "Moving on" });
    expect(res.status, res.body.slice(0, 200)).toBe(404);
    expect(res.data.error).toBe("Employee not found");
  });
});

describe("Performance", () => {
  let appraisals: any[] = [];
  beforeAll(async () => {
    const cycle = await call("POST", "/api/performance/cycles", hr, { name: "H2 2026" });
    expect(cycle.status).toBe(201);
    appraisals = (await r.appraisals.all()).filter((a: any) => a.cycleId === cycle.data.id);
  });

  it("a manager rating of 0 is saved", async () => {
    const a = appraisals.find((x) => x.employeeId === fx.ids.emp);
    const res = await call("POST", `/api/performance/appraisals/${a.id}/review`, hr, { managerRating: 0, managerComments: "Below expectations" });
    expect(res.status, res.body.slice(0, 200)).toBe(200);
    expect(res.data.managerRating).toBe(0);
  });

  it("a rating outside 0 to 5 is refused", async () => {
    const a = appraisals.find((x) => x.employeeId === fx.ids.lead);
    expect((await call("POST", `/api/performance/appraisals/${a.id}/review`, hr, { managerRating: 9 })).status).toBe(400);
    expect((await call("POST", `/api/performance/appraisals/${a.id}/review`, hr, { managerRating: -1 })).status).toBe(400);
  });

  it("a scoped HR user lists only the appraisals in scope", async () => {
    const res = await call("GET", "/api/performance/appraisals", scopedHr);
    expect(res.status).toBe(200);
    const list = arr(res.data);
    expect(list.length).toBeGreaterThan(0);
    const allowed = new Set((await r.employees.all()).filter((e: any) => e.departmentId === productDeptId).map((e: any) => e.id));
    expect(list.every((a: any) => allowed.has(a.employeeId))).toBe(true);
    expect(list.length).toBeLessThan(appraisals.length);
  });

  it("and the cycle counts only those", async () => {
    const res = await call("GET", "/api/performance/cycles", scopedHr);
    const cycle = arr(res.data).find((c: any) => c.name === "H2 2026");
    const inScope = arr((await call("GET", "/api/performance/appraisals", scopedHr)).data).filter((a: any) => a.cycleId === cycle.id);
    expect(cycle.appraisals).toBe(inScope.length);
    // Org-wide HR still sees the whole cycle.
    const full = arr((await call("GET", "/api/performance/cycles", hr)).data).find((c: any) => c.name === "H2 2026");
    expect(full.appraisals).toBe(appraisals.length);
    expect(cycle.appraisals).toBeLessThan(full.appraisals);
  });
});

describe("Employees", () => {
  it("resending credentials creates the login on the official address", async () => {
    const e = await r.employees.insert({
      departmentId: productDeptId, code: "ACM-RESEND", firstName: "Isha", lastName: "Rao",
      email: "isha.personal@example.com", personalEmail: "isha.personal@example.com", officialEmail: "isha.rao@acme.example.com",
      phone: "", employmentType: "FULL_TIME", designation: "Analyst", joiningDate: "2026-01-01", status: "ACTIVE",
    });
    const res = await call("POST", `/api/employees/${e.id}/resend-invite`, hr);
    expect(res.status, res.body.slice(0, 200)).toBe(200);
    const login = await r.users.where({ employeeId: e.id }).one();
    expect(login!.email).toBe("isha.rao@acme.example.com");
  });

  it("bulk update refuses an invalid or already-used address, per row", async () => {
    const res = await call("POST", "/api/employees/bulk-update", hr, {
      updates: [
        { id: fx.ids.emp, personalEmail: "not-an-email" },
        { id: fx.ids.intern, officialEmail: ACCOUNTS.lead },
        { id: fx.ids.plain, designation: "Senior Product Manager" },
      ],
    });
    expect(res.status, res.body.slice(0, 200)).toBe(200);
    expect(res.data.savedCount).toBe(1);
    expect(res.data.failed.map((f: any) => f.id).sort()).toEqual([fx.ids.emp, fx.ids.intern].sort());
    expect((await r.employees.byId(fx.ids.emp))!.personalEmail).not.toBe("not-an-email");
    expect((await r.employees.byId(fx.ids.intern))!.officialEmail).not.toBe(ACCOUNTS.lead);
  });

  it("PUT refuses status EXITED and points to the exit flow", async () => {
    const res = await call("PUT", `/api/employees/${fx.ids.emp}`, hr, { status: "EXITED" });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/separation/i);
    expect((await r.employees.byId(fx.ids.emp))!.status).toBe("ACTIVE");
  });

  it("bulk update refuses status EXITED too", async () => {
    const res = await call("POST", "/api/employees/bulk-update", hr, { updates: [{ id: fx.ids.emp, status: "EXITED" }] });
    expect(res.status).toBe(200);
    expect(res.data.savedCount).toBe(0);
    expect(res.data.failed[0].error).toMatch(/separation/i);
    expect((await r.employees.byId(fx.ids.emp))!.status).toBe("ACTIVE");
  });

  it("other status edits are unchanged", async () => {
    const res = await call("PUT", `/api/employees/${fx.ids.plain}`, hr, { status: "ON_LEAVE" });
    expect(res.status, res.body.slice(0, 200)).toBe(200);
    await call("PUT", `/api/employees/${fx.ids.plain}`, hr, { status: "ACTIVE" });
  });
});

describe("Cancelling an onboarding campaign", () => {
  it("stamps cancelledAt on the cases it cancels", async () => {
    const tpl = await call("POST", "/api/onboarding-templates", hr, { presetKey: "MINIMAL" });
    expect(tpl.status).toBe(201);
    expect((await call("POST", `/api/onboarding-templates/${tpl.data.id}/status`, hr, { status: "ACTIVE" })).status).toBe(200);
    const campaign = await call("POST", "/api/onboarding-campaigns", hr, {
      name: "Records refresh", templateId: tpl.data.id, audience: { mode: "SELECTED", employeeIds: [fx.ids.plain] },
      dueAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    });
    expect(campaign.status, campaign.body.slice(0, 200)).toBe(201);
    // A launched case, inserted directly: launching runs through the job queue.
    const kase = await r.onboardingCases.insert({ campaignId: campaign.data.id, employeeId: fx.ids.plain, templateId: tpl.data.id, status: "NOT_STARTED" });
    const res = await call("POST", `/api/onboarding-campaigns/${campaign.data.id}/cancel`, hr);
    expect(res.status, res.body.slice(0, 200)).toBe(200);
    expect(res.data.casesCancelled).toBe(1);
    const after = await r.onboardingCases.byId(kase.id);
    expect(after!.status).toBe("CANCELLED");
    expect(typeof after!.cancelledAt).toBe("string");
    expect(after!.cancelledAt).toBe(res.data.cancelledAt);
  });
});
