/**
 * The HTTP API end to end, in-process against a real Postgres: every staff surface
 * responds, CSV exports, write flows, RBAC, leave rules, salary-sheet uploads and pay
 * runs, multi-tenant isolation and robustness (no 5xx, unknown routes 404).
 *
 * One ordered scenario: later tests use tokens and records created by earlier ones.
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import * as XLSX from "xlsx";
import { ACCOUNTS, arr, client, seedFixtures, startServer, type Res } from "./fixtures";

let server: { base: string; close: () => Promise<void> };
let call: (method: string, p: string, token?: string | null, body?: unknown) => Promise<Res>;
let upload: ReturnType<typeof client>["upload"];
let login: ReturnType<typeof client>["login"];

beforeAll(async () => {
  await seedFixtures();
  server = await startServer();
  ({ call, upload, login } = client(server.base));
});
afterAll(() => server.close());

let group = "";
const section = (n: string) => (group = n);
const test = (name: string, fn: () => unknown) => {
  const label = group ? `${group} > ${name}` : name;
  it(label, async () => {
    await fn();
  });
};
const assert = (c: unknown, m?: string) => {
  if (!c) throw new Error(m || "assertion failed");
};

describe("HTTP API", () => {


  section("Health & auth");
  test("liveness and readiness probes", async () => {
    const up = await call("GET", "/up");
    assert(up.status === 200, `/up status ${up.status}`);
    const ready = await call("GET", "/api/ready");
    assert(ready.status === 200 && ready.data.ready === true, `/api/ready ${ready.status}`);
  });
  test("login rejects bad password", async () => { const r = await call("POST", "/api/auth/login", null, { email: ACCOUNTS.acmeAdmin, password: "nope" }); assert(r.status >= 400, "should reject"); });

  let hr: any, emp: any, sysHr: any;
  test("login admin, employee and the other workspace's admin", async () => {
    hr = await login(ACCOUNTS.acmeAdmin);
    emp = await login(ACCOUNTS.emp);
    sysHr = await login(ACCOUNTS.globexAdmin);
    assert(hr && emp && sysHr, "missing token");
    return "3 accounts authenticated";
  });
  test("/auth/me returns the user + org", async () => { const r = await call("GET", "/api/auth/me", hr); assert(r.status === 200 && r.data.user && r.data.user.role, "no user"); return r.data.user.role; });

  section("Staff surfaces (HR): all endpoints respond");
  const staffEps = [
    "/api/employees", "/api/employees/my-team", "/api/leave/types", "/api/leave/requests",
    "/api/attendance", "/api/salary/payruns", "/api/salary/payslips", "/api/salary/template",
    "/api/documents", "/api/performance/pips", "/api/performance/cycles", "/api/performance/appraisals", "/api/assets",
    "/api/perks", "/api/perks/family", "/api/wellbeing/resources", "/api/wellbeing/pulse",
    "/api/reimbursements", "/api/announcements", "/api/directory", "/api/directory/org-chart", "/api/directory/company",
    "/api/departments", "/api/reports/dashboard", "/api/reports/reporting", "/api/reports/weekly", "/api/separation",
    "/api/vendors", "/api/vendors/bills", "/api/org", "/api/org/offices", "/api/ai-tokens", "/api/worklogs", "/api/worklogs/summary",
  ];
  for (const ep of staffEps) test(`GET ${ep}`, async () => { const r = await call("GET", ep, hr); assert(r.status === 200, `status ${r.status}`); });
  test("dashboard returns headline metrics", async () => { const r = await call("GET", "/api/reports/dashboard", hr); assert(r.data && (r.data.employees !== undefined || r.data.headcount !== undefined), "no metrics"); });
  test("directory org-chart returns a tree", async () => { const r = await call("GET", "/api/directory/org-chart", hr); assert(r.status === 200 && r.data, "no chart"); });

  section("CSV exports (HR)");
  for (const ep of ["/api/reports/export/employees.csv", "/api/reports/export/payroll.csv", "/api/reports/export/attendance.csv", "/api/reports/export/reimbursements.csv"])
    test(`GET ${ep}`, async () => { const r = await call("GET", ep, hr); assert(r.status === 200, `status ${r.status}`); });

  section("Write flows (HR)");
  test("post a company announcement", async () => { const r = await call("POST", "/api/announcements", hr, { title: "Test announcement", body: "Hello team" }); assert(r.status === 200 || r.status === 201, `status ${r.status}`); });
  test("employee submits a wellbeing check-in", async () => { const r = await call("POST", "/api/wellbeing/checkin", emp, { mood: 4, stress: 2, workload: 3, anonymous: false }); assert(r.status === 200 || r.status === 201, `status ${r.status}`); });

  section("Employee self-service + RBAC");
  test("employee can view own attendance", async () => { const r = await call("GET", "/api/attendance/me", emp); assert(r.status === 200, `status ${r.status}`); });
  test("employee can view own leave balance", async () => { const r = await call("GET", "/api/leave/balance", emp); assert(r.status === 200, `status ${r.status}`); });
  test("employee can view own well-being", async () => { const r = await call("GET", "/api/wellbeing/me", emp); assert(r.status === 200, `status ${r.status}`); });
  test("employee BLOCKED from vendors (staff only)", async () => { const r = await call("GET", "/api/vendors", emp); assert(r.status === 403, `got ${r.status}`); });
  test("employee BLOCKED from creating an announcement", async () => { const r = await call("POST", "/api/announcements", emp, { title: "x", body: "y" }); assert(r.status === 403, `got ${r.status}`); });
  test("employee BLOCKED from onboarding a new employee", async () => { const r = await call("POST", "/api/employees", emp, { firstName: "x" }); assert(r.status === 403, `got ${r.status}`); });
  test("unauthenticated request -> 401", async () => { const r = await call("GET", "/api/employees", null); assert(r.status === 401, `got ${r.status}`); });

  section("Bulk actions & export (Shopify-style)");
  let leaveReqId;
  test("employee applies for leave (sets up bulk test)", async () => {
    const types = await call("GET", "/api/leave/types", emp); const tlist = Array.isArray(types.data) ? types.data : (types.data && types.data.types) || []; assert(tlist.length, "no leave types");
    const r = await call("POST", "/api/leave/requests", emp, { leaveTypeId: tlist[0].id, from: "2026-07-01", to: "2026-07-02", reason: "bulk test" });
    assert(r.status === 201, `status ${r.status}`); leaveReqId = r.data.id;
  });
  test("HR bulk-approves leave requests", async () => { const r = await call("POST", "/api/leave/requests/bulk", hr, { ids: [leaveReqId], decision: "APPROVED" }); assert(r.data.affected === 1, `affected ${r.data.affected}`); });
  // Give the days back. This test applies for the SAME two dates on every run and used to
  // leave them approved, so each run permanently consumed 2 days of the employee's Casual
  // Leave. After six runs the balance hit 12/12 and the approve above started returning
  // affected 0, which reads as a broken bulk action rather than exhausted test data.
  test("cancel the test leave so the suite stays repeatable", async () => {
    const r = await call("POST", `/api/leave/requests/${leaveReqId}/cancel`, hr, {});
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.data).slice(0, 90)}`);
    return "balance restored";
  });
  test("bulk decision validates input (400)", async () => { const r = await call("POST", "/api/leave/requests/bulk", hr, { ids: [leaveReqId], decision: "MAYBE" }); assert(r.status === 400, `got ${r.status}`); });
  test("export leave requests as CSV", async () => { const r = await call("GET", "/api/leave/requests/export.csv", hr); assert(r.status === 200, `status ${r.status}`); });
  test("employee CANNOT bulk-approve others' leave", async () => { const r = await call("POST", "/api/leave/requests/bulk", emp, { ids: [leaveReqId], decision: "APPROVED" }); assert(r.data && r.data.affected === 0, "employee approved!"); });

  section("Company leave rules (monthly paid-leave limit, notice for long leave)");
  // The employee was seeded today, so she is a new joiner: 1 paid day a month. Every request made
  // here is withdrawn or cancelled at the end and the rules are switched back off, so the
  // rest of the suite, and the next run, see the defaults.
  const ymd = (d) => d.toISOString().slice(0, 10);
  const addDays = (iso, n) => ymd(new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000));
  const weekday = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
  const RULES_ON = {
    monthlyLimit: { enabled: true, newJoinerLimit: 1, newJoinerMonths: 3, limit: 2 },
    advanceNotice: { enabled: true, minDays: 3, noticeDays: 7 },
    workingDaysOnly: true,
  };
  const ltype = {};
  const madeIds: any[] = [];
  const workDays: any[] = [];
  let empId;
  const applyLeave = (token, body) => call("POST", "/api/leave/requests", token, body);
  const checkLeave = (q) => call("GET", `/api/leave/rules/check?${new URLSearchParams(q)}`, emp);
  test("leave rules are off by default and only an admin can change them", async () => {
    const r = await call("GET", "/api/leave/rules", hr);
    assert(r.status === 200 && r.data.monthlyLimit.enabled === false && r.data.advanceNotice.enabled === false, JSON.stringify(r.data));
    const denied = await call("PUT", "/api/leave/rules", emp, RULES_ON);
    assert(denied.status === 403, `employee got ${denied.status}`);
  });
  test("admin turns the leave rules on", async () => {
    const r = await call("PUT", "/api/leave/rules", hr, RULES_ON);
    assert(r.status === 200 && r.data.monthlyLimit.enabled && r.data.advanceNotice.enabled && r.data.workingDaysOnly, JSON.stringify(r.data));
    for (const t of arr((await call("GET", "/api/leave/types", hr)).data)) ltype[t.name] = t;
    assert(ltype["Casual Leave"] && ltype["Sick Leave"] && ltype["Loss of Pay"], "seeded leave types missing");
    assert(ltype["Casual Leave"].countsTowardMonthlyLimit === true && ltype["Loss of Pay"].countsTowardMonthlyLimit === false, "rule flags missing from leave types");
    empId = (await call("GET", "/api/auth/me", emp)).data.user.employeeId;
    assert(empId, "employee has no employeeId");
  });
  test("find four working days next month", async () => {
    const now = new Date();
    const first = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 8)));
    for (let d = first; workDays.length < 4 && d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) {
      if (weekday(d) === 0 || weekday(d) === 6) continue;
      const r = await checkLeave({ leaveTypeId: ltype["Loss of Pay"].id, from: d, to: d });
      if (r.status === 200 && r.data.days === 1) workDays.push(d);
    }
    assert(workDays.length === 4, `only found ${workDays.length}`);
    return workDays.join(", ");
  });
  test("a range of only weekly offs has nothing to apply for (400)", async () => {
    let sat = workDays[0];
    while (weekday(sat) !== 6) sat = addDays(sat, 1);
    const r = await applyLeave(emp, { leaveTypeId: ltype["Casual Leave"].id, from: sat, to: addDays(sat, 1) });
    assert(r.status === 400, `status ${r.status}`);
  });
  test("a new joiner's first paid day of the month is accepted", async () => {
    const r = await applyLeave(emp, { leaveTypeId: ltype["Casual Leave"].id, from: workDays[0], to: workDays[0], reason: "leave rules test" });
    assert(r.status === 201, `status ${r.status}: ${r.data && r.data.error}`);
    madeIds.push(r.data.id);
    assert(r.data.days === 1, `days ${r.data.days}`);
  });
  test("a second paid day that month is refused (409 LEAVE_RULE)", async () => {
    const r = await applyLeave(emp, { leaveTypeId: ltype["Sick Leave"].id, from: workDays[1], to: workDays[1] });
    if (r.status === 201) madeIds.push(r.data.id);
    assert(r.status === 409 && r.data.code === "LEAVE_RULE" && /Loss of Pay/.test(r.data.error), `${r.status} ${JSON.stringify(r.data)}`);
    return r.data.error;
  });
  test("the live check reports the same problem before applying", async () => {
    const r = await checkLeave({ leaveTypeId: ltype["Casual Leave"].id, from: workDays[1], to: workDays[1] });
    assert(r.status === 200 && r.data.problems.length === 1 && r.data.problems[0].rule === "MONTHLY_LIMIT", JSON.stringify(r.data));
  });
  test("an employee cannot override the rules for their own leave", async () => {
    const r = await applyLeave(emp, { leaveTypeId: ltype["Casual Leave"].id, from: workDays[1], to: workDays[1], force: true });
    if (r.status === 201) madeIds.push(r.data.id);
    assert(r.status === 409, `status ${r.status}`);
  });
  test("the extra day can still be taken as Loss of Pay", async () => {
    const r = await applyLeave(emp, { leaveTypeId: ltype["Loss of Pay"].id, from: workDays[1], to: workDays[1] });
    assert(r.status === 201, `status ${r.status}: ${r.data && r.data.error}`);
    madeIds.push(r.data.id);
  });
  test("monthly allowance shows the paid day as used", async () => {
    const r = await call("GET", `/api/leave/rules/allowance?month=${workDays[0].slice(0, 7)}`, emp);
    assert(r.status === 200 && r.data.enabled && r.data.limit === 1 && r.data.used === 1 && r.data.remaining === 0 && r.data.newJoiner === true, JSON.stringify(r.data));
  });
  let overriddenId;
  test("HR applying on the employee's behalf can override with force", async () => {
    const body = { employeeId: empId, leaveTypeId: ltype["Casual Leave"].id, from: workDays[2], to: workDays[2] };
    const refused = await applyLeave(hr, body);
    if (refused.status === 201) madeIds.push(refused.data.id);
    assert(refused.status === 409, `without force: ${refused.status}`);
    const r = await applyLeave(hr, { ...body, force: true });
    assert(r.status === 201 && (r.data.ruleOverrides || []).includes("MONTHLY_LIMIT"), `${r.status} ${JSON.stringify(r.data)}`);
    madeIds.push(r.data.id);
    overriddenId = r.data.id;
  });
  test("approving: within the limit is fine, and an HR override is not asked again", async () => {
    const a = await call("POST", `/api/leave/requests/${madeIds[0]}/decide`, hr, { decision: "APPROVED" });
    assert(a.status === 200, `first: ${a.status} ${a.data && a.data.error}`);
    const b = await call("POST", `/api/leave/requests/${overriddenId}/decide`, hr, { decision: "APPROVED" });
    assert(b.status === 200, `overridden: ${b.status} ${b.data && b.data.error}`);
  });
  test("a request made while the limit was off needs an override to approve", async () => {
    const off = await call("PUT", "/api/leave/rules", hr, { monthlyLimit: { enabled: false } });
    assert(off.status === 200 && !off.data.monthlyLimit.enabled && off.data.advanceNotice.enabled, "partial update did not merge");
    const r = await applyLeave(emp, { leaveTypeId: ltype["Casual Leave"].id, from: workDays[3], to: workDays[3] });
    assert(r.status === 201, `apply: ${r.status} ${r.data && r.data.error}`);
    madeIds.push(r.data.id);
    await call("PUT", "/api/leave/rules", hr, { monthlyLimit: { enabled: true } });
    const blocked = await call("POST", `/api/leave/requests/${r.data.id}/decide`, hr, { decision: "APPROVED" });
    assert(blocked.status === 409 && blocked.data.code === "LEAVE_RULE" && /^Approving this/.test(blocked.data.error), `${blocked.status} ${JSON.stringify(blocked.data)}`);
    const forced = await call("POST", `/api/leave/requests/${r.data.id}/decide`, hr, { decision: "APPROVED", force: true });
    assert(forced.status === 200 && (forced.data.ruleOverrides || []).includes("MONTHLY_LIMIT"), `${forced.status} ${JSON.stringify(forced.data)}`);
  });
  test("long leave starting in 2 days is refused for short notice", async () => {
    // Loss of Pay, so the monthly limit stays out of it. 7 calendar days hold at least 3 working days.
    const start = addDays(ymd(new Date()), 2);
    const r = await applyLeave(emp, { leaveTypeId: ltype["Loss of Pay"].id, from: start, to: addDays(start, 6) });
    if (r.status === 201) madeIds.push(r.data.id);
    assert(r.status === 409 && r.data.code === "LEAVE_RULE" && /at least 7 days/.test(r.data.error), `${r.status} ${JSON.stringify(r.data)}`);
  });
  test("sick leave is exempt from the notice rule", async () => {
    const start = addDays(ymd(new Date()), 2);
    const r = await checkLeave({ leaveTypeId: ltype["Sick Leave"].id, from: start, to: addDays(start, 6) });
    assert(r.status === 200 && !r.data.problems.some((p) => p.rule === "ADVANCE_NOTICE"), JSON.stringify(r.data));
  });
  test("with carry-over on, an unused month rolls into the next", async () => {
    // The lead joined on the seed date and has no leave: this month and next add 1 day each.
    const lead = arr((await call("GET", "/api/employees", hr)).data).find((e) => e.email === ACCOUNTS.lead);
    assert(lead, "seeded manager missing");
    const q = (to) => `/api/leave/rules/check?${new URLSearchParams({ employeeId: lead.id, leaveTypeId: ltype["Casual Leave"].id, from: workDays[0], to })}`;
    const without = await call("GET", q(workDays[1]), hr);
    assert(without.data.problems.some((p) => p.rule === "MONTHLY_LIMIT"), "2 days should be over without carry-over");
    const on = await call("PUT", "/api/leave/rules", hr, { monthlyLimit: { carryOver: true } });
    assert(on.status === 200 && on.data.monthlyLimit.carryOver === true && on.data.monthlyLimit.enabled, "carry-over did not save");
    const two = await call("GET", q(workDays[1]), hr);
    // In December, next month is a new year and the running total starts again.
    const sameYear = workDays[0].slice(0, 4) === ymd(new Date()).slice(0, 4);
    if (sameYear) assert(two.data.problems.length === 0, JSON.stringify(two.data.problems));
    else assert(two.data.problems.length === 1, "carry-over should reset at the new year");
    const three = await call("GET", q(workDays[2]), hr);
    assert(three.data.problems.some((p) => p.rule === "MONTHLY_LIMIT" && /unused days carry over/.test(p.message)), JSON.stringify(three.data));
  });
  test("clean up: test leave withdrawn or cancelled, rules back off", async () => {
    const all = arr((await call("GET", "/api/leave/requests", hr)).data);
    for (const id of madeIds) {
      const cur = all.find((x) => x.id === id);
      if (cur && cur.status === "APPROVED") await call("POST", `/api/leave/requests/${id}/cancel`, hr, {});
      else if (cur && cur.status === "PENDING") await call("DELETE", `/api/leave/requests/${id}`, hr);
    }
    const r = await call("PUT", "/api/leave/rules", hr, { monthlyLimit: { enabled: false, carryOver: false }, advanceNotice: { enabled: false }, workingDaysOnly: false });
    assert(r.status === 200 && !r.data.monthlyLimit.enabled && !r.data.monthlyLimit.carryOver && !r.data.advanceNotice.enabled && !r.data.workingDaysOnly, JSON.stringify(r.data));
  });

  section("HR role: leave policies, letter templates and onboarding forms");
  // The plain employee holds only EMPLOYEE in the fixture. She gets the HR role for this section only.
  let plainUserId, plainHr;
  test("admin gives an employee the HR role", async () => {
    const plain = arr((await call("GET", "/api/users", hr)).data).find((u) => u.email === ACCOUNTS.plain);
    assert(plain, "seeded employee user missing");
    plainUserId = plain.id;
    const r = await call("PUT", `/api/users/${plainUserId}/roles`, hr, { roleKeys: ["HR"] });
    assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.data)}`);
    plainHr = await login(ACCOUNTS.plain);
  });
  test("HR can save leave rules, leave types and leave coverage", async () => {
    const rules = await call("PUT", "/api/leave/rules", plainHr, {});
    assert(rules.status === 200, `rules ${rules.status} ${JSON.stringify(rules.data)}`);
    const type = arr((await call("GET", "/api/leave/types", plainHr)).data)[0];
    const put = await call("PUT", `/api/leave/types/${type.id}`, plainHr, { name: type.name });
    assert(put.status === 200, `leave type ${put.status} ${JSON.stringify(put.data)}`);
    const cov = await call("PUT", "/api/leave/coverage", plainHr, { enabled: false });
    assert(cov.status === 200, `coverage ${cov.status} ${JSON.stringify(cov.data)}`);
  });
  test("HR can open letter templates and manage onboarding forms", async () => {
    const letters = await call("GET", "/api/letter-templates", plainHr);
    assert(letters.status === 200, `letter templates ${letters.status}`);
    // 404, not 403: the permission check let her through to "form not found".
    const forms = await call("POST", "/api/onboarding-templates/no-such-form/duplicate", plainHr, {});
    assert(forms.status === 404, `onboarding forms ${forms.status}`);
  });
  test("company settings, users and roles stay admin-only", async () => {
    assert((await call("PUT", "/api/org", plainHr, {})).status === 403, "company profile");
    assert((await call("GET", "/api/users", plainHr)).status === 403, "users");
  });
  test("taking the HR role away removes the access again", async () => {
    const r = await call("PUT", `/api/users/${plainUserId}/roles`, hr, { roleKeys: [] });
    assert(r.status === 200, `status ${r.status}`);
    const again = await login(ACCOUNTS.plain);
    assert((await call("PUT", "/api/leave/rules", again, {})).status === 403, "employee could still save leave rules");
  });

  section("Saved Views & CSV Import (Shopify-style)");
  let viewId;
  const impEmail = "import-" + Date.now() + "@acme.example.com";
  test("save an employees view", async () => { const r = await call("POST", "/api/views", hr, { resource: "employees", name: "Interns", filters: { type: "INTERN" } }); assert(r.status === 201 && r.data.id, `status ${r.status}`); viewId = r.data.id; });
  test("list saved views for resource", async () => { const r = await call("GET", "/api/views?resource=employees", hr); assert(arr(r.data).some((v) => v.id === viewId && v.filters.type === "INTERN"), "view not listed"); });
  test("save view requires a name (400)", async () => { const r = await call("POST", "/api/views", hr, { resource: "employees" }); assert(r.status === 400, `got ${r.status}`); });
  test("saved views are private to the user/org", async () => { const r = await call("GET", "/api/views?resource=employees", sysHr); assert(!arr(r.data).some((v) => v.id === viewId), "view leaked across org!"); });
  test("delete a saved view", async () => { const r = await call("DELETE", "/api/views/" + viewId, hr); assert(r.data.ok, "delete failed"); const after = await call("GET", "/api/views?resource=employees", hr); assert(!arr(after.data).some((v) => v.id === viewId), "still present"); });
  test("HR imports employees from CSV-style rows", async () => { const r = await call("POST", "/api/employees/import", hr, { rows: [{ firstName: "Imported", lastName: "Person", email: impEmail, employmentType: "FULL_TIME", designation: "Analyst" }] }); assert(r.status === 201 && r.data.imported === 1, `imported ${r.data.imported}`); });
  test("import skips duplicate emails", async () => { const r = await call("POST", "/api/employees/import", hr, { rows: [{ firstName: "Dup", email: impEmail, employmentType: "FULL_TIME" }] }); assert(r.data.imported === 0 && r.data.skipped === 1, `imported ${r.data.imported}/skipped ${r.data.skipped}`); });
  test("import rejects empty payload (400)", async () => { const r = await call("POST", "/api/employees/import", hr, { rows: [] }); assert(r.status === 400, `got ${r.status}`); });
  test("employee CANNOT import staff records (403)", async () => { const r = await call("POST", "/api/employees/import", emp, { rows: [{ firstName: "X", email: "x@y.com", employmentType: "FULL_TIME" }] }); assert(r.status === 403, `got ${r.status}`); });

  section("Reminders / My Work");
  let remId;
  test("employee creates a reminder", async () => { const r = await call("POST", "/api/reminders", emp, { title: "Submit timesheet", priority: "HIGH", dueDate: "2026-06-10" }); assert(r.status === 201 && r.data.id && r.data.status === "OPEN", `status ${r.status}`); remId = r.data.id; });
  test("reminder requires a title (400)", async () => { const r = await call("POST", "/api/reminders", emp, { note: "no title" }); assert(r.status === 400, `got ${r.status}`); });
  test("list open reminders", async () => { const r = await call("GET", "/api/reminders?status=OPEN", emp); assert(arr(r.data).some((x) => x.id === remId), "not listed"); });
  test("open count reflects the new reminder", async () => { const r = await call("GET", "/api/reminders/count", emp); assert(r.data.open >= 1, `open ${r.data.open}`); });
  test("toggle reminder to DONE", async () => { const r = await call("POST", `/api/reminders/${remId}/toggle`, emp, {}); assert(r.data.status === "DONE" && r.data.completedAt, "not completed"); });
  test("HR also has their own reminders (private)", async () => { const c = await call("POST", "/api/reminders", hr, { title: "Approve leaves" }); assert(c.status === 201, "hr create failed"); const r = await call("GET", "/api/reminders", emp); assert(!arr(r.data).some((x) => x.id === c.data.id), "reminder leaked across users!"); });
  test("cannot toggle another user's reminder (404)", async () => { const r = await call("POST", `/api/reminders/${remId}/toggle`, hr, {}); assert(r.status === 404, `got ${r.status}`); });
  test("delete a reminder", async () => { const r = await call("DELETE", "/api/reminders/" + remId, emp); assert(r.data.ok, "delete failed"); });
  test("due-today lists overdue/today open items", async () => { const c = await call("POST", "/api/reminders", emp, { title: "Overdue timesheet", dueDate: "2020-01-01" }); const r = await call("GET", "/api/reminders/today", emp); assert(arr(r.data).some((x) => x.id === c.data.id), "overdue item not in due-today"); });
  test("count surfaces dueToday", async () => { const r = await call("GET", "/api/reminders/count", emp); assert(r.data.dueToday >= 1, `dueToday ${r.data.dueToday}`); });

  section("Payroll: salary sheets, payslips and pay runs");
  // Regressions, all of which used to fail silently (a wrong payslip, never an
  // error). Generated into a far-future period so a re-run of the suite cannot
  // disturb a real month.
  
  const PERIOD = { month: 12, year: 2099 }; // December 2099, 1-based month as HR types it
  let payEmp: any = null;
  test("pick an employee with a code to run payroll against", async () => {
    const r = await call("GET", "/api/employees", hr);
    // Must have COMPENSATION, not just a code. Generating a payslip for somebody with no
    // salary on record is a deliberate 400 ("no compensation on record and no amounts
    // provided"), so picking the first coded employee made these tests depend on whoever
    // happened to sort first: onboarding staff without a salary yet would fail the suite
    // for a reason that has nothing to do with payroll.
    const coded = arr(r.data).filter((e) => e.code);
    payEmp = coded.find((e) => Number(e?.salary?.basic) > 0);
    assert(coded.length, "no employee has an employee code");
    assert(payEmp, `no employee has compensation on record (checked ${coded.length})`);
    return `${payEmp.code} (basic ${payEmp.salary.basic})`;
  });

  /**
   * A workbook shaped like the real salary masters: a second sheet FIRST, a
   * two-line title banner above the header, the misspelled and negative "Total
   * Deducton", employee and employer contributions interleaved, and a Grand
   * Total row. The old bulk endpoint read SheetNames[0] row 0 as the header
   * with a dozen aliases, so it could not read this file at all, while the
   * preview could.
   */
  function masterSheet(code, name) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Employee ID", "Employee Name", "Shift", "Rate per day", "Food Deduction"],
      [code, name, "Day", 30, 0],
    ]), "Food Deduction");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["ACME PRIVATE LIMITED"],
      ["Salary Sheet for the Month of December 2099"],
      ["Employee ID", "Name", "Month", "Year", "BASIC", "HRA", "Special Allowance", "Statutory Bonus", "LTA",
        "PF EE", "Employee ESI", "PT", "TDS", "PF ER", "Employer ESI", "Gross", "Total Deducton", "Net Pay"],
      [code, name, PERIOD.month, PERIOD.year, 20000, 10000, 5000, 1000, 2000,
        -1800, -285, -200, -1500, 1800, 1235, 38000, -3785, 34215],
      ["Grand Total", "", "", "", 20000, 10000, 5000, 1000, 2000, -1800, -285, -200, -1500, 1800, 1235, 38000, -3785, 34215],
    ]), "ACME");
    return { name: "salary-master.xlsx", buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) };
  }
  const SHEET_NET = 34215, SHEET_GROSS = 38000;

  test("preview reads the salary master (right sheet, right header row)", async () => {
    const r = await upload("/api/salary/payslips/preview", hr, {}, masterSheet(payEmp.code, `${payEmp.firstName} ${payEmp.lastName || ""}`.trim()));
    assert(r.status === 200, `status ${r.status}`);
    assert(r.data.sheet && r.data.sheet.name === "ACME", `picked sheet ${r.data.sheet && r.data.sheet.name}`);
    assert(r.data.summary.valid === 1, `valid ${r.data.summary.valid}: ${JSON.stringify(r.data.rows.map((x) => x.errors))}`);
    assert(r.data.summary.totalNet === SHEET_NET, `preview net ${r.data.summary.totalNet}`);
    return `net ${r.data.summary.totalNet}`;
  });

  test("bulk upload generates what the preview showed (all components kept)", async () => {
    const r = await upload("/api/salary/payslips/bulk", hr, {}, masterSheet(payEmp.code, `${payEmp.firstName} ${payEmp.lastName || ""}`.trim()));
    assert(r.status === 200, `status ${r.status}`);
    assert(r.data.succeeded === 1, `succeeded ${r.data.succeeded}: ${JSON.stringify(r.data.results)}`);
    // The regression: the poorer parser dropped Special Allowance / Statutory
    // Bonus / LTA, so this net came out several thousand rupees light.
    assert(r.data.results[0].net === SHEET_NET, `net ${r.data.results[0].net}, expected ${SHEET_NET}`);
    assert(r.data.netTotal === SHEET_NET, `netTotal ${r.data.netTotal}`);
    return `net ${r.data.netTotal}`;
  });

  test("the stored payslip carries every earning and deduction line", async () => {
    const r = await call("GET", `/api/salary/payslips?employeeId=${payEmp.id}&year=${PERIOD.year}`, hr);
    const slip = arr(r.data).find((p) => p.month === PERIOD.month - 1 && p.year === PERIOD.year) || (Array.isArray(r.data) ? r.data[0] : null);
    assert(slip, "payslip not found");
    assert(slip.gross === SHEET_GROSS && slip.net === SHEET_NET, `gross ${slip.gross}, net ${slip.net}`);
    assert(slip.earnings.length === 5, `earnings ${JSON.stringify(slip.earnings)}`);
    assert(slip.deductions.length === 4, `deductions ${JSON.stringify(slip.deductions)}`);
    assert(!slip.deductions.some((d) => /employer/i.test(d.label)), "employer contribution deducted from net");
    return `${slip.earnings.length} earnings / ${slip.deductions.length} deductions`;
  });

  test("preview -> commit is the reviewed file, generated", async () => {
    const file = masterSheet(payEmp.code, `${payEmp.firstName} ${payEmp.lastName || ""}`.trim());
    const p = await upload("/api/salary/payslips/preview", hr, {}, file);
    const c = await upload("/api/salary/payslips/commit", hr, {}, file);
    assert(c.status === 200, `commit status ${c.status}: ${JSON.stringify(c.data)}`);
    assert(c.data.succeeded === 1, `succeeded ${c.data.succeeded}`);
    assert(c.data.netTotal === p.data.summary.totalNet, `commit ${c.data.netTotal} vs preview ${p.data.summary.totalNet}`);
    assert(c.data.payRunId, "commit recorded no pay run");
    return `both ${c.data.netTotal}`;
  });

  test("commit refuses an all-or-nothing sheet with unmatched rows (422)", async () => {
    const r = await upload("/api/salary/payslips/commit", hr, {}, masterSheet("NO-SUCH-CODE-1", "Nobody At All"));
    assert(r.status === 422, `status ${r.status}`);
    assert(r.data.generated === 0 && r.data.errors.length === 1, JSON.stringify(r.data).slice(0, 120));
  });

  test("a run that generated nothing records NO pay run", async () => {
    const before = arr((await call("GET", "/api/salary/payruns", hr)).data).length;
    const r = await upload("/api/salary/payslips/bulk", hr, {}, masterSheet("NO-SUCH-CODE-2", "Nobody At All"));
    assert(r.status === 200, `status ${r.status}`);
    assert(r.data.succeeded === 0 && r.data.failed === 1, JSON.stringify(r.data).slice(0, 120));
    assert(r.data.payRunId === null, `payRunId ${r.data.payRunId}`);
    const after = arr((await call("GET", "/api/salary/payruns", hr)).data).length;
    assert(after === before, `pay runs went ${before} -> ${after}`);
    return `history unchanged at ${after}`;
  });

  test("a single payslip is recorded in the pay-run history", async () => {
    const before = arr((await call("GET", "/api/salary/payruns", hr)).data).length;
    const r = await call("POST", "/api/salary/payslip", hr, { employeeId: payEmp.id, month: 11, year: PERIOD.year, tax: 0 });
    assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.payRunId, "no pay run recorded for a single payslip");
    const runs = arr((await call("GET", "/api/salary/payruns", hr)).data);
    assert(runs.length === before + 1, `pay runs went ${before} -> ${runs.length}`);
    assert(runs.some((x) => x.id === r.data.payRunId && x.source === "SINGLE" && x.succeeded === 1), "run not in history");
    return `run ${r.data.payRunId}`;
  });

  test("the simple bulk template still works (legacy fallback)", async () => {
    // GET /salary/template produces a flat one-header-row sheet with no
    // "Employee ID"/"Name" column, so the salary-master parser declines it and
    // it falls through to the per-row reader it was written for, amounts fed
    // through the payroll engine as before.
    const headers = ["employeeCode", "email", "month", "year", "basic", "hra", "allowances", "incentive", "reimbursement", "bonus", "tax", "otherDeductions", "lossOfPay"];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      headers,
      [payEmp.code, payEmp.email, 10, PERIOD.year, 20000, 10000, 5000, 0, 0, 0, 1000, 0, 0],
    ]), "Payslips");
    const r = await upload("/api/salary/payslips/bulk", hr, {}, { name: "template.xlsx", buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) });
    assert(r.status === 200, `status ${r.status}`);
    assert(r.data.succeeded === 1, `succeeded ${r.data.succeeded}: ${JSON.stringify(r.data.results)}`);
    assert(r.data.results[0].period === "October 2099", `period ${r.data.results[0].period}`);
    assert(r.data.results[0].net > 0, `net ${r.data.results[0].net}`);
    return `net ${r.data.results[0].net}`;
  });

  test("re-generating a payslip keeps its emailed stamp and recomputes the amounts", async () => {
    // The regression was the re-generate patch carrying emailedAt:null, which
    // the repo merged over an existing stamp. The suite never sends mail, so the
    // stamp here is null on both sides; the merge itself is pinned down in
    // tests/payslip-input.ts, where a stamped payslip can be simulated.
    const list = () => call("GET", `/api/salary/payslips?employeeId=${payEmp.id}&year=${PERIOD.year}`, hr);
    const before = arr((await list()).data).find((p) => p.month === 10);
    assert(before, "November payslip missing");
    const again = await call("POST", "/api/salary/payslip", hr, { employeeId: payEmp.id, month: 11, year: PERIOD.year, bonus: 500 });
    assert(again.status === 201, `status ${again.status}`);
    const after = arr((await list()).data).find((p) => p.id === before.id);
    assert(after, "payslip disappeared on re-generate");
    assert(after.emailedAt === before.emailedAt, `emailedAt ${before.emailedAt} -> ${after.emailedAt}`);
    assert(after.net !== before.net, "re-generate did not recompute the payslip");
    return "stamp preserved, amounts recomputed";
  });

  test("payslip download is named payslip_<org>_<code>_<YYYY-MM>.pdf", async () => {
    const slips = arr((await call("GET", `/api/salary/payslips?employeeId=${payEmp.id}&year=${PERIOD.year}`, hr)).data);
    assert(slips.length, "no payslip to download");
    const r = await call("GET", `/api/salary/payslips/${slips[0].id}/download`, hr);
    assert(r.status === 200, `status ${r.status}`);
    const cd = r.headers["content-disposition"] || "";
    assert(/filename[^;]*payslip_.+_.+_\d{4}-\d{2}\.pdf/.test(cd), `content-disposition: ${cd}`);
    // A browser can only read that header when CORS says it may.
    assert(/content-disposition/i.test(r.headers["access-control-expose-headers"] || ""), "Content-Disposition not exposed to the browser");
    return cd;
  });

  test("employee CANNOT upload a salary sheet (403)", async () => {
    const r = await upload("/api/salary/payslips/commit", emp, {}, masterSheet(payEmp.code, "x"));
    assert(r.status === 403, `got ${r.status}`);
  });

  section("Multi-tenant isolation");
  let acmeEmpId;
  test("one workspace's admin sees different employees than another's", async () => {
    const a = await call("GET", "/api/employees", hr); const b = await call("GET", "/api/employees", sysHr);
    const al = arr(a.data), bl = arr(b.data); assert(al.length && bl.length, "empty lists");
    const aIds = new Set(al.map((e) => e.id)); const overlap = bl.filter((e) => aIds.has(e.id));
    acmeEmpId = al[0].id;
    assert(overlap.length === 0, "tenant data leaked!");
    return `${al.length} vs ${bl.length}, 0 overlap`;
  });
  test("cross-tenant employee fetch -> 404", async () => { const r = await call("GET", "/api/employees/" + acmeEmpId, sysHr); assert(r.status === 404, `got ${r.status}`); });

  section("Robustness: no endpoint returns 5xx");
  for (const ep of staffEps) test(`no 5xx: ${ep}`, async () => { const r = await call("GET", ep, hr); assert(r.status < 500, `5xx: ${r.status}`); });
  test("unknown route -> 404 not 500", async () => { const r = await call("GET", "/api/does-not-exist", hr); assert(r.status === 404, `got ${r.status}`); });
  test("bad announcement payload -> 4xx not 500", async () => { const r = await call("POST", "/api/announcements", hr, { title: "" }); assert(r.status < 500, `got ${r.status}`); });

  // ── report ──────────────────────────────────────────────────────────────────
});
