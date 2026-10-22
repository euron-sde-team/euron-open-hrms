/**
 * Shared integration fixtures: a clean database with two workspaces, the API running
 * in-process on a random port, and small HTTP helpers.
 *
 *   Acme       admin, a lead with two reports (one an intern), a part-timer and a plain
 *              employee, all joined TODAY (the leave-rule tests depend on new joiners).
 *              Everyone holds the EMPLOYEE role; a manager's powers come from the
 *              reporting line, exactly as in production.
 *   Globex     admin + one employee, the "other tenant" for isolation checks
 *
 * Leave types are the four the legacy suite was written against, inserted directly,
 * so leave arithmetic is deterministic and independent of the starter packs.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { repos, systemRepos, TABLES, COLLECTIONS } from "../../src/repositories/base.repository";
import { db } from "../../src/db/kysely";
import { hashPassword } from "../../src/middleware/auth";
import { hashPw } from "../../src/middleware/platform-auth";
import { defaultSalaryBreakdown } from "../../src/domain/employment";
import { todayStr } from "../../src/core/util";
import { ensureContent } from "../../src/demo/seed-content";
import { resetDataKeyCache } from "../../src/security/pii";
import { createApp } from "../../src/app";

export const PASSWORD = "Fixture-Passw0rd!";
export const OPERATOR_EMAIL = "operator@fixtures.example.com";

export const ACCOUNTS = {
  acmeAdmin: "admin@acme.example.com",
  lead: "arjun.mehta@acme.example.com",
  emp: "rohan.das@acme.example.com",
  plain: "nisha.verma@acme.example.com",
  globexAdmin: "admin@globex.example.com",
  globexEmp: "kenji.tanaka@globex.example.com",
};

export async function truncateAll() {
  const tables = [...COLLECTIONS.map((c) => `"${TABLES[c].table}"`), '"jobs"', '"org_data_keys"'].join(", ");
  await db.executeQuery({ sql: `TRUNCATE ${tables} RESTART IDENTITY CASCADE`, parameters: [] } as any);
  resetDataKeyCache();
}

export const activeUser = () => ({ status: "ACTIVE", emailVerifiedAt: new Date().toISOString(), credentialsChangedAt: new Date(0).toISOString() });

async function workspace(name: string, slug: string, country: string, office: { lat: number; lng: number }, departments: string[]) {
  const org = await systemRepos().organizations.insert({ name, slug, address: `${name}, Example City`, status: "ACTIVE", signupSource: "TEST", country });
  const r = repos({ orgId: org.id });
  await r.offices.insert({ name: `${name} Office`, address: `${name}, Example City`, lat: office.lat, lng: office.lng, radiusMeters: 300 });
  const depts: Record<string, any> = {};
  for (const d of departments) depts[d] = await r.departments.insert({ name: d, description: "" });
  for (const lt of [
    { name: "Casual Leave", maxPerYear: 12, paid: true },
    { name: "Sick Leave", maxPerYear: 12, paid: true },
    { name: "Earned Leave", maxPerYear: 15, paid: true, carryForwardCap: 30 },
    { name: "Loss of Pay", maxPerYear: 0, paid: false },
  ]) await r.leaveTypes.insert(lt);
  return { org, r, depts };
}

async function person(r: any, org: any, dept: any, email: string, p: { firstName: string; lastName: string; type: string; designation: string; basic: number }) {
  const emp = await r.employees.insert({
    departmentId: dept.id,
    code: `${org.slug.slice(0, 3).toUpperCase()}-${1000 + (await r.employees.count())}`,
    firstName: p.firstName,
    lastName: p.lastName,
    email,
    phone: "",
    employmentType: p.type,
    designation: p.designation,
    managerId: null,
    joiningDate: todayStr(),
    status: "ACTIVE",
    salary: defaultSalaryBreakdown(p.type, p.basic),
    bank: { account: "", ifsc: "" },
  });
  await r.users.insert({ email, name: `${p.firstName} ${p.lastName}`, role: "EMPLOYEE", employeeId: emp.id, passwordHash: hashPassword(PASSWORD), ...activeUser() });
  return emp;
}

/** Wipe everything and seed the two fixture workspaces plus an operator. */
export async function seedFixtures() {
  await truncateAll();
  const passwordHash = hashPassword(PASSWORD);

  const acme = await workspace("Acme", "acme", "IN", { lat: 12.9716, lng: 77.5946 }, ["Engineering", "Product", "Growth", "Operations"]);
  await acme.r.users.insert({ email: ACCOUNTS.acmeAdmin, name: "Acme Admin", role: "ADMIN", employeeId: null, passwordHash, ...activeUser() });
  const lead = await person(acme.r, acme.org, acme.depts.Engineering, ACCOUNTS.lead, { firstName: "Arjun", lastName: "Mehta", type: "FULL_TIME", designation: "Engineering Manager", basic: 120000 });
  const emp = await person(acme.r, acme.org, acme.depts.Engineering, ACCOUNTS.emp, { firstName: "Rohan", lastName: "Das", type: "FULL_TIME", designation: "Backend Engineer", basic: 60000 });
  const parttime = await person(acme.r, acme.org, acme.depts.Growth, "dev.malhotra@acme.example.com", { firstName: "Dev", lastName: "Malhotra", type: "PART_TIME", designation: "Growth Associate", basic: 25000 });
  const intern = await person(acme.r, acme.org, acme.depts.Engineering, "kiran.joshi@acme.example.com", { firstName: "Kiran", lastName: "Joshi", type: "INTERN", designation: "Engineering Intern", basic: 15000 });
  const plain = await person(acme.r, acme.org, acme.depts.Product, ACCOUNTS.plain, { firstName: "Nisha", lastName: "Verma", type: "FULL_TIME", designation: "Product Manager", basic: 90000 });
  for (const e of [emp, intern]) await acme.r.employees.update(e.id, { reportsTo: lead.id });
  await acme.r.employees.update(parttime.id, { reportsTo: plain.id });

  const globex = await workspace("Globex", "globex", "US", { lat: 37.7749, lng: -122.4194 }, ["Research", "Operations"]);
  await globex.r.users.insert({ email: ACCOUNTS.globexAdmin, name: "Globex Admin", role: "ADMIN", employeeId: null, passwordHash, ...activeUser() });
  await person(globex.r, globex.org, globex.depts.Research, ACCOUNTS.globexEmp, { firstName: "Kenji", lastName: "Tanaka", type: "FULL_TIME", designation: "Research Scientist", basic: 9000 });

  await ensureContent(systemRepos(), { vendorPasswordHash: passwordHash });
  await systemRepos().platformAdmins.insert({ email: OPERATOR_EMAIL, name: "Fixture Operator", role: "OPERATOR", status: "ACTIVE", passwordHash: hashPw(PASSWORD) });
  return { acme: acme.org, globex: globex.org, ids: { lead: lead.id, emp: emp.id, plain: plain.id, intern: intern.id } };
}

// ── In-process server + HTTP helpers ────────────────────────────────────────

export type Res = { status: number; data: any; headers: http.IncomingHttpHeaders; body: string };

export async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export function client(base: string) {
  function call(method: string, p: string, token?: string | null, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Res> {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const headers: Record<string, string | number> = { Connection: "close", ...extraHeaders };
      if (token) headers.Authorization = "Bearer " + token;
      if (payload) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(payload);
      }
      const req = http.request(base + p, { method, headers, agent: false }, (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let data = null;
          try { data = JSON.parse(buf); } catch { /* not JSON */ }
          resolve({ status: res.statusCode || 0, data, headers: res.headers, body: buf });
        });
      });
      req.on("error", reject);
      req.setTimeout(20000, () => req.destroy(new Error("timeout")));
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** multipart/form-data POST with one optional file part named "file" (type defaults to octet-stream). */
  function upload(p: string, token: string | null, fields: Record<string, string>, file?: { name: string; buffer: Buffer; type?: string }): Promise<Res> {
    return new Promise((resolve, reject) => {
      const boundary = "----hrmsSuite" + Date.now() + Math.random().toString(16).slice(2);
      const parts: Buffer[] = [];
      for (const [k, v] of Object.entries(fields || {})) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      if (file) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`));
        parts.push(file.buffer, Buffer.from("\r\n"));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      const payload = Buffer.concat(parts);
      const headers: Record<string, string | number> = { Connection: "close", "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": payload.length };
      if (token) headers.Authorization = "Bearer " + token;
      const req = http.request(base + p, { method: "POST", headers, agent: false }, (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let data = null;
          try { data = JSON.parse(buf); } catch { /* not JSON */ }
          resolve({ status: res.statusCode || 0, data, headers: res.headers, body: buf });
        });
      });
      req.on("error", reject);
      req.setTimeout(30000, () => req.destroy(new Error("timeout")));
      req.write(payload);
      req.end();
    });
  }

  async function login(email: string, password = PASSWORD): Promise<string> {
    const r = await call("POST", "/api/auth/login", null, { email, password });
    if (r.status !== 200 || !r.data?.token) throw new Error(`login failed for ${email} (${r.status}: ${r.body.slice(0, 200)})`);
    return r.data.token;
  }

  async function operatorLogin(email = OPERATOR_EMAIL, password = PASSWORD): Promise<string> {
    const r = await call("POST", "/api/platform/auth/login", null, { email, password });
    if (r.status !== 200 || !r.data?.token) throw new Error(`operator login failed (${r.status}: ${r.body.slice(0, 200)})`);
    return r.data.token;
  }

  return { call, upload, login, operatorLogin };
}

/** The list shapes the API returns: plain arrays or { employees | requests | items }. */
export const arr = (d: any): any[] =>
  Array.isArray(d) ? d : d && Array.isArray(d.employees) ? d.employees : d && Array.isArray(d.requests) ? d.requests : d && Array.isArray(d.items) ? d.items : [];

// ── Sent mail: the outbox (MAIL_MODE=outbox) or Mailpit (smtp, and ses relayed) ──

const MAIL_MODE = (process.env.MAIL_MODE || "outbox").toLowerCase();
const MAILPIT = (process.env.MAILPIT_URL || "").replace(/\/$/, "");
const FROM_MAILPIT = MAIL_MODE !== "outbox" && !!MAILPIT;

/** True when the tests can read back what was sent: from disk, or from Mailpit. */
export const MAIL_READABLE = MAIL_MODE === "outbox" || FROM_MAILPIT;

const outboxDir = () => path.join(process.env.DATA_DIR || "", "outbox");

export type Mail = { file: string; to: string; subject: string; text: string };

const decodeQuotedPrintable = (s: string) =>
  Buffer.from(
    s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))),
    "latin1"
  ).toString("utf8");

function headerOf(head: string, name: string): string {
  const m = head.replace(/\r?\n[ \t]+/g, " ").match(new RegExp(`^${name}:\\s*(.*)$`, "im"));
  return m ? m[1].trim() : "";
}

/** Decode every leaf part of a MIME message into one searchable string. */
function decodeMime(raw: string): string {
  const split = raw.search(/\r?\n\r?\n/);
  const head = split < 0 ? raw : raw.slice(0, split);
  const body = split < 0 ? "" : raw.slice(split).replace(/^\r?\n\r?\n/, "");
  const type = headerOf(head, "Content-Type");
  const boundary = type.match(/boundary="?([^";]+)"?/i)?.[1];
  if (/^multipart\//i.test(type) && boundary) {
    return body
      .split(`--${boundary}`)
      .slice(1)
      .filter((p) => !p.startsWith("--"))
      .map((p) => decodeMime(p.replace(/^\r?\n/, "")))
      .join("\n");
  }
  const cte = headerOf(head, "Content-Transfer-Encoding").toLowerCase();
  if (cte === "base64") {
    if (!/^text\//i.test(type || "text/plain")) return "";
    return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  }
  if (cte === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

function parseRaw(file: string, raw: string): Mail {
  const split = raw.search(/\r?\n\r?\n/);
  const head = raw.slice(0, split < 0 ? raw.length : split);
  return { file, to: headerOf(head, "To"), subject: headerOf(head, "Subject"), text: decodeMime(raw) };
}

async function mailpitIds(): Promise<string[]> {
  const r = await fetch(`${MAILPIT}/api/v1/messages?limit=1000`);
  const d = (await r.json()) as { messages: { ID: string }[] };
  return d.messages.map((m) => m.ID);
}

/** What has been sent so far: pass to `mailSince` to see only what is sent after. */
export async function outboxMark(): Promise<Set<string>> {
  if (FROM_MAILPIT) return new Set(await mailpitIds());
  const d = outboxDir();
  return new Set(fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".eml")) : []);
}

/**
 * Every message sent since `mark`, decoded. Mailpit receives SES mail through the
 * emulator's relay a moment after the API call returns, so it is polled until the
 * count stops changing.
 */
export async function mailSince(mark: Set<string>): Promise<Mail[]> {
  if (FROM_MAILPIT) {
    let ids: string[] = [];
    for (let i = 0, stable = 0; i < 25 && stable < 2; i++) {
      const next = (await mailpitIds()).filter((id) => !mark.has(id));
      stable = next.length > 0 && next.length === ids.length ? stable + 1 : 0;
      ids = next;
      await new Promise((res) => setTimeout(res, 200));
    }
    const out: Mail[] = [];
    for (const id of ids.reverse()) out.push(parseRaw(id, await (await fetch(`${MAILPIT}/api/v1/message/${id}/raw`)).text()));
    return out;
  }
  const d = outboxDir();
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".eml") && !mark.has(f))
    .sort()
    .map((file) => parseRaw(file, fs.readFileSync(path.join(d, file), "utf8")));
}
