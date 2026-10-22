/**
 * Reports: the dashboard headline numbers, the reporting structure, the weekly
 * productivity digest (on screen and by email) and the downloadable CSV exports.
 */
import type { RequestContext } from "../core/context";
import { todayStr, round2, notFound, MONTHS, escapeHtml as h } from "../core/util";
import { EMAIL_RE } from "../core/validate";
import { isStaff } from "../middleware/auth";
import { sendTenantMail } from "../integrations/mail/mailer";
import { orgPayrollSettings } from "../domain/payroll/profile";
import { managerOf } from "../domain/manager";
import { scopedEmployeeIdsFor } from "./caller-scope";
import { fullName } from "../domain/person";

/** A CSV download: the file name and its rows (header first). */
export interface CsvReport {
  filename: string;
  rows: any[][];
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** Load org employees + departments as lookup maps (names, departments, managers). */
async function lookups(ctx: RequestContext) {
  const emps = await ctx.data.employees.all();
  const depts = await ctx.data.departments.all();
  const empById = Object.fromEntries(emps.map((e) => [e.id, e]));
  const deptById = Object.fromEntries(depts.map((d) => [d.id, d]));
  return {
    empById, deptById,
    empName: (id) => (empById[id] ? `${empById[id].firstName} ${empById[id].lastName || ""}`.trim() : ""),
    deptName: (id) => (id && deptById[id] ? deptById[id].name : ""),
  };
}

async function currentOrg(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  if (!org) throw notFound("Organization not found");
  return org;
}

/** Build the weekly productivity digest for the org over a 7-day window. */
async function weeklyDigest(ctx: RequestContext, from: string, to: string) {
  const lk = await lookups(ctx);
  const emps = (await ctx.data.employees.all()).filter((e) => e.status !== "EXITED");
  const logs = await ctx.data.workLogs.find((w) => w.date >= from && w.date <= to);
  const att = await ctx.data.attendance.between(from, to);
  const rows = emps.map((e) => {
    const wl = logs.filter((w) => w.employeeId === e.id);
    const hours = round2(wl.reduce((s, w) => s + (w.hours || 0), 0));
    const avg = wl.length ? round2(wl.reduce((s, w) => s + w.productivityScore, 0) / wl.length) : 0;
    const present = att.filter((a) => a.employeeId === e.id && (a.status === "PRESENT" || a.status === "REMOTE")).length;
    return { employeeId: e.id, name: fullName(e), department: lk.deptName(e.departmentId),
      daysLogged: wl.length, hours, avgProductivity: avg, daysPresent: present, manager: lk.empName(managerOf(e)) };
  });
  const active = rows.filter((r) => r.daysLogged > 0);
  return {
    from, to,
    headcount: emps.length,
    totalHours: round2(rows.reduce((s, r) => s + r.hours, 0)),
    avgProductivity: active.length ? round2(active.reduce((s, r) => s + r.avgProductivity, 0) / active.length) : 0,
    topPerformers: [...active].sort((a, b) => b.avgProductivity - a.avgProductivity).slice(0, 5),
    needsAttention: rows.filter((r) => r.daysLogged === 0 || r.avgProductivity < 4),
    activePips: await ctx.data.pips.count((p) => p.status === "ACTIVE"),
    rows,
  };
}

/** Headline numbers for the current org. */
export async function dashboard(ctx: RequestContext) {
  const today = todayStr();
  const now = new Date();
  // Independent reads run concurrently; equality filters push into SQL via hot columns
  // (attendance.date, leave_requests.status, payslips.month/year) instead of loading whole tables.
  const [allEmps, todayRecs, pendingLeaves, departments, monthPayslips, org] = await Promise.all([
    ctx.data.employees.all(),
    ctx.data.attendance.onDate(today),
    ctx.data.leaveRequests.where({ status: "PENDING" }).count(),
    ctx.data.departments.count(),
    ctx.data.payslips.inPeriod(now.getMonth(), now.getFullYear()),
    ctx.data.organizations.byId(ctx.orgId),
  ]);

  const emps = allEmps.filter((e) => e.status !== "EXITED");
  const byType = { FULL_TIME: 0, PART_TIME: 0, INTERN: 0 };
  emps.forEach((e) => (byType[e.employmentType] = (byType[e.employmentType] || 0) + 1));

  const present = todayRecs.filter((a) => a.status === "PRESENT").length;
  const remote = todayRecs.filter((a) => a.status === "REMOTE").length;

  const monthlyPayroll = round2(monthPayslips.reduce((s, p) => s + (p.net || 0), 0));
  const payrollCurrency = orgPayrollSettings(org).currency;

  return {
    employees: emps.length,
    byType,
    departments,
    pendingLeaves,
    attendanceToday: { present, remote, absent: Math.max(0, emps.filter((e) => e.status === "ACTIVE").length - present - remote), total: emps.length },
    monthlyPayrollNet: monthlyPayroll,
    payrollCurrency,
    isStaff: isStaff(ctx.user),
  };
}

/** Reporting structure (manager -> direct reports). */
export async function reportingStructure(ctx: RequestContext) {
  const emps = (await ctx.data.employees.all()).filter((e) => e.status !== "EXITED");
  const byId = Object.fromEntries(emps.map((e) => [e.id, e]));
  const depts = await ctx.data.departments.all();
  const deptById = Object.fromEntries(depts.map((d) => [d.id, d]));
  // managerOf now comes from ../manager (single canonical precedence).
  const nodes = emps.map((e) => {
    const mgrId = managerOf(e);
    const mgr = mgrId ? byId[mgrId] : null;
    const dept = e.departmentId ? deptById[e.departmentId] : null;
    return {
      id: e.id, name: fullName(e), code: e.code,
      designation: e.designation || "", department: dept ? dept.name : "-",
      employmentType: e.employmentType,
      managerId: mgrId, managerName: mgr ? fullName(mgr) : null,
      directReports: emps.filter((x) => managerOf(x) === e.id).length,
    };
  });
  return { nodes, roots: nodes.filter((n) => !n.managerId).map((n) => n.id) };
}

// ── Weekly performance & productivity reporting ────────────────────────────

/** Productivity digest for managers / HR / CXO; the window defaults to the last 7 days. */
export async function weeklyReport(ctx: RequestContext, window: { from?: string; to?: string }) {
  const to = window.to || todayStr();
  const from = window.from || daysAgo(6);
  return weeklyDigest(ctx, from, to);
}

/**
 * Generate the weekly digest and email it to the workspace's admins and HR plus its
 * configured report recipients (Settings, Organization, `reportRecipients`).
 * `extraRecipients` adds one-off addresses for this send.
 */
export async function sendWeeklyReport(ctx: RequestContext, input: { to?: string; extraRecipients?: unknown }) {
  const to = input.to || todayStr();
  const from = daysAgo(6);
  const d = await weeklyDigest(ctx, from, to);
  const org = await currentOrg(ctx);
  const configured: string[] = Array.isArray(org.reportRecipients) ? org.reportRecipients : [];
  const extra: string[] = (Array.isArray(input.extraRecipients) ? input.extraRecipients : [])
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => EMAIL_RE.test(e))
    .slice(0, 10);
  const hr = (await ctx.data.users.find((u) => u.role === "ADMIN" || u.role === "HR")).map((u) => u.email);
  const recipients = [...new Set([...configured, ...extra, ...hr].filter(Boolean))];
  const html = `<div style="font-family:Arial;max-width:640px">
    <h2 style="color:#0a66c2">${h(org.name)} - Weekly productivity report</h2>
    <p>${from} to ${to}</p>
    <table style="width:100%;background:#f3f6f8;border-radius:8px">
      <tr><td style="padding:8px 12px">Headcount</td><td style="padding:8px 12px"><b>${d.headcount}</b></td></tr>
      <tr><td style="padding:8px 12px">Hours logged</td><td style="padding:8px 12px"><b>${d.totalHours}</b></td></tr>
      <tr><td style="padding:8px 12px">Avg productivity</td><td style="padding:8px 12px"><b>${d.avgProductivity}/10</b></td></tr>
      <tr><td style="padding:8px 12px">Active PIPs</td><td style="padding:8px 12px"><b>${d.activePips}</b></td></tr>
    </table>
    <h3>Top performers</h3><ol>${d.topPerformers.map((r) => `<li>${h(r.name)} - ${r.avgProductivity}/10, ${r.hours}h</li>`).join("") || "<li>-</li>"}</ol>
    <h3>Needs attention (${d.needsAttention.length})</h3><ul>${d.needsAttention.slice(0, 10).map((r) => `<li>${h(r.name)} - ${r.daysLogged ? r.avgProductivity + "/10" : "no logs"}</li>`).join("") || "<li>-</li>"}</ul>
    <p style="color:#888;font-size:12px">Generated by ${h(org.name)} HRMS.</p></div>`;
  const sent: any[] = [];
  for (const to_ of recipients) sent.push({ to: to_, ...(await sendTenantMail(org, { to: to_, subject: `${org.name} - Weekly productivity report (${to})`, html })) });
  return { ok: true, recipients, mailMode: sent[0] ? sent[0].mode : "outbox", digest: { headcount: d.headcount, avgProductivity: d.avgProductivity, totalHours: d.totalHours } };
}

// ── Downloadable CSV reports (HR head) ─────────────────────────────────────

export async function employeesCsv(ctx: RequestContext): Promise<CsvReport> {
  const lk = await lookups(ctx);
  const emps = await ctx.data.employees.all();
  const rows: any[][] = [["Code", "Name", "Email", "Type", "Department", "Designation", "Manager", "Joining", "Status", "Basic", "HRA", "Allowances", "Phone"]];
  emps.forEach((e) => rows.push([e.code, fullName(e), e.officialEmail || e.email, e.employmentType, lk.deptName(e.departmentId), e.designation || "", lk.empName(managerOf(e)), e.joiningDate, e.status, e.salary?.basic || 0, e.salary?.hra || 0, e.salary?.allowances || 0, e.phone || ""]));
  return { filename: "employees.csv", rows };
}

/** Payslips, optionally for one year and/or month (1-based), with per-currency totals. */
export async function payrollCsv(ctx: RequestContext, filter: { year?: string; month?: string }): Promise<CsvReport> {
  const lk = await lookups(ctx);
  let list = await ctx.data.payslips.all();
  // Scoped staff export only in-scope employees' payslips.
  const inScope = await scopedEmployeeIdsFor(ctx); // null = org-wide
  if (inScope) list = list.filter((p) => inScope.has(p.employeeId));
  if (filter.year) list = list.filter((p) => p.year === Number(filter.year));
  if (filter.month) list = list.filter((p) => p.month === Number(filter.month) - 1);
  const rows: any[][] = [["Employee", "Period", "Currency", "Gross", "Deductions", "Net", "Emailed"]];
  list.forEach((p) => rows.push([lk.empName(p.employeeId), `${MONTHS[p.month]} ${p.year}`, p.currency || "INR", p.gross, p.totalDeductions, p.net, p.emailedAt ? "yes" : "no"]));
  // Totals are grouped per currency, amounts in different currencies are never
  // summed together (no FX conversion).
  const byCurrency: Record<string, { gross: number; ded: number; net: number }> = {};
  for (const p of list) {
    const c = p.currency || "INR";
    const t = (byCurrency[c] = byCurrency[c] || { gross: 0, ded: 0, net: 0 });
    t.gross += p.gross || 0;
    t.ded += p.totalDeductions || 0;
    t.net += p.net || 0;
  }
  for (const [c, t] of Object.entries(byCurrency)) {
    rows.push(["", `TOTAL (${c})`, c, round2(t.gross), round2(t.ded), round2(t.net), ""]);
  }
  return { filename: "payroll.csv", rows };
}

/** One day's attendance records (default today). */
export async function attendanceCsv(ctx: RequestContext, day?: string): Promise<CsvReport> {
  const lk = await lookups(ctx);
  const date = day || todayStr();
  const recs = await ctx.data.attendance.find((a) => a.date === date);
  const rows: any[][] = [["Date", "Employee", "Status", "Check-in", "Check-out", "Office", "Distance(m)", "Worked(min)"]];
  recs.forEach((a) => rows.push([a.date, lk.empName(a.employeeId), a.status, a.checkInAt || "", a.checkOutAt || "", a.checkInOffice || "", a.checkInDistance ?? "", a.workedMinutes || 0]));
  return { filename: `attendance_${date}.csv`, rows };
}

export async function vendorBillsCsv(ctx: RequestContext): Promise<CsvReport> {
  const bills = await ctx.data.vendorBills.all();
  const vendors = await ctx.data.vendors.all();
  const vById = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const vName = (id) => { const v = vById[id]; return v ? `${v.name} (${v.code})` : ""; };
  const rows: any[][] = [["Vendor", "Invoice", "Amount", "Tax", "Total", "Status", "Period", "Description"]];
  bills.forEach((b) => rows.push([vName(b.vendorId), b.invoiceNumber, b.amount, b.taxAmount, b.totalAmount, b.status, `${b.periodFrom || ""} - ${b.periodTo || ""}`, b.description || ""]));
  rows.push(["", "TOTAL", "", "", round2(bills.reduce((s, b) => s + b.totalAmount, 0)), "", "", ""]);
  return { filename: "vendor_bills.csv", rows };
}

export async function reimbursementsCsv(ctx: RequestContext): Promise<CsvReport> {
  const lk = await lookups(ctx);
  const list = await ctx.data.reimbursements.all();
  const rows: any[][] = [["Employee", "Category", "Amount", "Date", "Status", "Description"]];
  list.forEach((r) => rows.push([lk.empName(r.employeeId), r.category, r.amount, r.expenseDate, r.status, r.description || ""]));
  return { filename: "reimbursements.csv", rows };
}
