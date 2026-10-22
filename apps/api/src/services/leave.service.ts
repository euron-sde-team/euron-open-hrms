/**
 * Leave: types, balances, requests and their decisions, plus the two opt-in company
 * guards (minimum department coverage and the leave rules).
 */
import type { RequestContext } from "../core/context";
import type { Repositories } from "../repositories";
import { bad, notFound, forbidden, daysBetweenInclusive, HttpError } from "../core/util";
import { isStaff } from "../middleware/auth";
import { notifyEmployee } from "./notification.service";
import { checkCoverage, conflictSummary } from "./coverage.service";
import { LEAVE_CATALOGUE, entitlements } from "../domain/leave-policy";
import {
  readLeaveRules, normalizeLeaveRules, leaveRuleProblems, leaveDates, monthlyAllowance,
  countsTowardMonthlyLimit, needsAdvanceNotice,
} from "../domain/leave-rules";
import { localNow, readReminderSettings } from "../jobs/reminders/clockin";
import { isManagerOf } from "../domain/manager";
import { defangCell } from "../core/csv";
import { fullName } from "../domain/person";

const year = () => new Date().getFullYear();

/**
 * Find-or-create this year's balance for an employee+leaveType, using the given
 * repositories (ctx.data or a tx). On first creation for the year, carries forward unused
 * balance from the prior year up to the leave type's carryForwardCap (0 = none).
 */
async function ensureBalance(data: Repositories, employeeId, leaveType) {
  let bal = await data.leaveBalances.forYear(employeeId, leaveType.id, year());
  if (!bal) {
    let carried = 0;
    const cap = Number(leaveType.carryForwardCap || 0);
    if (cap > 0) {
      const prev = await data.leaveBalances.forYear(employeeId, leaveType.id, year() - 1);
      if (prev) carried = Math.min(cap, Math.max(0, prev.total - prev.used));
    }
    bal = await data.leaveBalances.create({
      employeeId, leaveTypeId: leaveType.id, year: year(),
      total: Number(leaveType.maxPerYear || 0) + carried, used: 0, carriedForward: carried,
    });
  }
  return bal;
}

/** A paid, quota-bearing leave type enforces remaining balance; unpaid (e.g. LoP) never does. */
const enforces = (type) => type && type.paid && Number(type.maxPerYear || 0) > 0;

async function maps(ctx: RequestContext) {
  const emps = await ctx.data.employees.all();
  const types = await ctx.data.leaveTypes.all();
  return {
    empById: Object.fromEntries(emps.map((e) => [e.id, e])),
    typeById: Object.fromEntries(types.map((t) => [t.id, t])),
  };
}
const withNamesM = (r, m) => {
  const emp = m.empById[r.employeeId];
  const type = m.typeById[r.leaveTypeId];
  return {
    ...r,
    employeeName: emp ? fullName(emp) : "-",
    employeeCode: emp ? emp.code : "",
    leaveTypeName: type ? type.name : "-",
  };
};
async function withNames(ctx: RequestContext, r) {
  return withNamesM(r, await maps(ctx));
}

async function managesEmployee(ctx: RequestContext, employeeId) {
  if (!ctx.user.employeeId) return false;
  const e = await ctx.data.employees.byId(employeeId);
  return isManagerOf(e, ctx.user.employeeId);
}

/**
 * Who may DECIDE a leave request. Two rules:
 *  1) No self-approval, you can never decide your own request, regardless of
 *     role (an HR/Admin's own leave must be decided by someone else).
 *  2) The decider must be the applicant's reporting manager, hold leave.approve,
 *     or be Admin/HR staff (who act as the fallback approver, e.g. for the HR
 *     person's own leave or anyone with no manager).
 */
async function canDecideLeave(ctx: RequestContext, lr) {
  // Rule 1: never approve your own leave.
  if (lr.employeeId && lr.employeeId === ctx.user.employeeId) return false;
  // Manager of the applicant can always decide (hierarchy power, unscoped).
  if (await managesEmployee(ctx, lr.employeeId)) return true;
  // Rule 2: explicit approver or staff, but a scoped admin only within scope.
  if (ctx.can("leave.approve") || isStaff(ctx.user)) {
    const applicant = await ctx.data.employees.byId(lr.employeeId);
    return ctx.inScope(applicant);
  }
  return false;
}
async function teamIds(ctx: RequestContext) {
  const reports = await ctx.data.employees.find((e) => isManagerOf(e, ctx.user.employeeId));
  return reports.map((e) => e.id);
}

/** The employee a self-service read is about: the one asked for (staff only) or the caller. */
function readableEmployeeId(ctx: RequestContext, requested) {
  const employeeId = requested || ctx.user.employeeId;
  if (!employeeId) throw bad("No employee context");
  if (!isStaff(ctx.user) && employeeId !== ctx.user.employeeId) throw forbidden();
  return employeeId;
}

// ── Company leave rules (opt-in per tenant, see leave-rules.ts) ─────────────

/**
 * What the rules need to know about the org: the rules themselves, its working week
 * and holidays (to count working days), and today's date in its timezone (for
 * notice). The working week and timezone are the ones set under Settings → Reminders.
 */
async function ruleContext(data: Repositories, orgId: string) {
  const org = await data.organizations.byId(orgId);
  const rules = readLeaveRules(org);
  const { workingDays, timezone } = readReminderSettings(org);
  // Restricted holidays are optional, so they stay working days for everyone else.
  const holidays = new Set<string>(
    rules.workingDaysOnly
      ? (await data.holidays.all()).filter((h) => h.type !== "RESTRICTED").map((h) => h.date)
      : [],
  );
  return { rules, cal: { workingDays, holidays }, today: localNow(timezone).date };
}
type RuleContext = Awaited<ReturnType<typeof ruleContext>>;

/** A request's size in days: working days when the rules say so, calendar days otherwise. */
const sizeOf = (rc: RuleContext, from, to) =>
  rc.rules.workingDaysOnly ? leaveDates(from, to, rc.rules, rc.cal).length : daysBetweenInclusive(from, to);

/**
 * Problems with a request under the company's leave rules. `statuses` picks the
 * employee's other requests that count against it: pending ones too when applying,
 * so requests cannot be stacked, but only approved ones when approving.
 */
async function ruleProblems(data: Repositories, rc: RuleContext, { employee, type, from, to, excludeId = null as string | null, statuses = ["PENDING", "APPROVED"], audience, checkNotice }) {
  if (!rc.rules.monthlyLimit.enabled && !rc.rules.advanceNotice.enabled) return [];
  const typeById = new Map((await data.leaveTypes.all()).map((t) => [t.id, t]));
  const mine = await data.leaveRequests.forEmployee(employee.id, statuses);
  const others = mine
    .filter((r) => r.id !== excludeId)
    .map((r) => ({ from: r.from, to: r.to, type: typeById.get(r.leaveTypeId) }));
  return leaveRuleProblems({
    ...rc, joiningDate: employee.joiningDate, type, request: { from, to }, others, audience, checkNotice,
  });
}

/**
 * The monthly limit, re-checked at approval: requests made before the rules were
 * turned on, or before the limit was lowered, can still be pending. Notice is not
 * re-checked, since it is about when the leave was asked for. Rules HR already
 * overrode when applying on the employee's behalf are not raised again.
 */
async function approvalProblems(tx: Repositories, rc: RuleContext, lr, type) {
  if (!rc.rules.monthlyLimit.enabled) return [];
  const employee = await tx.employees.byId(lr.employeeId);
  if (!employee) return [];
  const waived = new Set(lr.ruleOverrides || []);
  const problems = await ruleProblems(tx, rc, {
    employee, type, from: lr.from, to: lr.to, excludeId: lr.id,
    statuses: ["APPROVED"], audience: "approver", checkNotice: false,
  });
  return problems.filter((p) => !waived.has(p.rule));
}

const ruleError = (problems) => new HttpError(409, problems.map((p) => p.message).join(" "), "LEAVE_RULE");

/** Record that someone overrode the company's leave rules for this request. */
async function recordOverride(data: Repositories, ctx: RequestContext, lr, problems) {
  const rules = [...new Set([...(lr.ruleOverrides || []), ...problems.map((p) => p.rule)])];
  await data.auditLog.create({
    action: "LEAVE_RULE_OVERRIDE",
    userId: ctx.user.id,
    meta: { requestId: lr.id, employeeId: lr.employeeId, rules: problems.map((p) => p.rule) },
  });
  return rules;
}

// ── Leave types ─────────────────────────────────────────────────────────────

/** Every leave type, each with whether the company's leave rules apply to it. */
export async function listLeaveTypes(ctx: RequestContext) {
  const types = await ctx.data.leaveTypes.all();
  return types.map((t) => ({
    ...t,
    countsTowardMonthlyLimit: countsTowardMonthlyLimit(t),
    needsAdvanceNotice: needsAdvanceNotice(t),
  }));
}

/** The standard Indian leave set, for reference. */
export function leaveCatalogue() {
  return LEAVE_CATALOGUE;
}

/**
 * What this person actually gets.
 *
 * Quota depends on engagement type, gender (for the gendered statutory leaves)
 * and joining date, so a flat annual number per leave type is wrong for
 * anyone who joined mid-year, is an intern, or is a freelancer. Every type is
 * returned with an `eligible` flag and a stated reason so HR can see *why* a
 * number is what it is, rather than rows silently disappearing.
 */
export async function employeeEntitlements(ctx: RequestContext, q: { employeeId?: any; year?: unknown }) {
  const employeeId = q.employeeId || ctx.user.employeeId;
  if (!employeeId) throw bad("No employee to compute entitlements for");
  if (!isStaff(ctx.user) && employeeId !== ctx.user.employeeId) throw forbidden();
  const emp = await ctx.data.employees.byId(employeeId);
  if (!emp) throw notFound("Employee not found");
  if (!ctx.inScope(emp)) throw forbidden("Outside your assigned scope");

  const y = Number(q.year) || year();
  return {
    employeeId,
    year: y,
    employmentType: emp.employmentType,
    entitlements: entitlements({
      employmentType: emp.employmentType,
      gender: emp.gender,
      joiningDate: emp.joiningDate,
      year: y,
    }),
  };
}

/**
 * Add the standard Indian leave types this org is missing. Existing types are left
 * untouched, matched on name, so running it twice is safe and never overwrites a
 * tuned quota.
 */
export async function seedStandardLeaveTypes(ctx: RequestContext) {
  const existing = await ctx.data.leaveTypes.all();
  const have = new Set(existing.map((t) => String(t.name).toLowerCase().trim()));
  const added: string[] = [];
  for (const t of LEAVE_CATALOGUE) {
    if (have.has(t.name.toLowerCase())) continue;
    await ctx.data.leaveTypes.create({
      name: t.name,
      key: t.key,
      maxPerYear: t.maxPerYear,
      paid: t.paid,
      carryForwardCap: t.carryForwardCap,
      encashable: t.encashable,
      accrualMonthly: t.accrualMonthly,
      appliesTo: t.appliesTo || "ALL",
      description: t.description,
    });
    added.push(t.name);
  }
  await ctx.data.auditLog.create({ action: "LEAVE_TYPES_SEEDED", userId: ctx.user.id, meta: { added } });
  return { added, skipped: LEAVE_CATALOGUE.length - added.length };
}

const cleanType = (b) => ({
  name: String(b.name || "").trim(),
  maxPerYear: Math.max(0, Math.min(366, Number(b.maxPerYear) || 0)),
  paid: b.paid !== false,
  carryForwardCap: Math.max(0, Math.min(366, Number(b.carryForwardCap) || 0)),
  // Whether the company's leave rules apply. Left unset, a type follows its catalogue default.
  ...(typeof b.countsTowardMonthlyLimit === "boolean" ? { countsTowardMonthlyLimit: b.countsTowardMonthlyLimit } : {}),
  ...(typeof b.needsAdvanceNotice === "boolean" ? { needsAdvanceNotice: b.needsAdvanceNotice } : {}),
});

export async function createLeaveType(ctx: RequestContext, input: Record<string, any>) {
  const t = cleanType(input);
  if (!t.name) throw bad("Leave type name is required");
  if (await ctx.data.leaveTypes.findByName(t.name)) throw bad("A leave type with that name already exists");
  return ctx.data.leaveTypes.create(t);
}

export async function updateLeaveType(ctx: RequestContext, id: string, input: Record<string, any>) {
  const existing = await ctx.data.leaveTypes.byId(id);
  if (!existing) throw notFound("Leave type not found");
  return ctx.data.leaveTypes.update(existing.id, cleanType({ ...existing, ...input }));
}

/** Blocked if requests reference it. */
export async function deleteLeaveType(ctx: RequestContext, id: string) {
  const existing = await ctx.data.leaveTypes.byId(id);
  if (!existing) throw notFound("Leave type not found");
  if (await ctx.data.leaveRequests.anyOfType(existing.id))
    throw bad("Cannot delete a leave type that has leave requests against it");
  await ctx.data.leaveTypes.remove(existing.id);
  return { ok: true };
}

// ── Minimum-coverage leave guard (opt-in per tenant + per department) ────────

/** Config: master switch + per-department policy (staff). */
export async function coverageConfig(ctx: RequestContext) {
  if (!isStaff(ctx.user)) throw forbidden("Staff access required");
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const depts = (await ctx.data.departments.all()).sort((a, b) => (a.name < b.name ? -1 : 1));
  return {
    enabled: !!(org && org.leaveCoverage && org.leaveCoverage.enabled),
    departments: depts.map((d) => {
      const p = d.coveragePolicy || {};
      return {
        id: d.id,
        name: d.name,
        policy: { enabled: !!p.enabled, minPresent: Math.max(1, Number(p.minPresent) || 1), mode: p.mode === "block" ? "block" : "warn" },
      };
    }),
  };
}

/** { enabled, departments:[{id,enabled,minPresent,mode}] } */
export async function setCoverageConfig(ctx: RequestContext, b: Record<string, any>) {
  await ctx.data.organizations.update(ctx.orgId, { leaveCoverage: { enabled: !!b.enabled } });
  if (Array.isArray(b.departments)) {
    for (const item of b.departments) {
      const d = await ctx.data.departments.byId(item.id);
      if (!d) continue;
      await ctx.data.departments.update(d.id, {
        coveragePolicy: {
          enabled: !!item.enabled,
          minPresent: Math.max(1, Math.min(999, Number(item.minPresent) || 1)),
          mode: item.mode === "block" ? "block" : "warn",
        },
      });
    }
  }
  await ctx.data.auditLog.create({ action: "LEAVE_COVERAGE_CONFIG", userId: ctx.user.id, meta: { enabled: !!b.enabled } });
  return { ok: true };
}

/** Preview the coverage impact of dates. */
export async function previewCoverage(ctx: RequestContext, q: { employeeId?: any; from?: unknown; to?: unknown }) {
  const employeeId = isStaff(ctx.user) && q.employeeId ? q.employeeId : ctx.user.employeeId;
  if (!employeeId) throw bad("No employee context");
  const from = String(q.from || ""), to = String(q.to || "");
  if (!from || !to) throw bad("from and to are required");
  // checkCoverage reads `repos` and `user` off its first argument, which the context carries.
  return checkCoverage(ctx, { employeeId, from, to });
}

// ── Company leave rules: monthly paid-leave limit, notice for long leave ─────

/** The rules as the API returns them: with the working week they count against. */
function rulesView(org) {
  const { workingDays, timezone } = readReminderSettings(org);
  return { ...readLeaveRules(org), workingDays, timezone };
}

export async function getLeaveRules(ctx: RequestContext) {
  return rulesView(await ctx.data.organizations.byId(ctx.orgId));
}

/**
 * { monthlyLimit?, advanceNotice?, workingDaysOnly? }
 * Merged over the current rules, so a client can send just the part it changes.
 */
export async function setLeaveRules(ctx: RequestContext, b: Record<string, any>) {
  const current = readLeaveRules(await ctx.data.organizations.byId(ctx.orgId));
  const rules = normalizeLeaveRules({
    monthlyLimit: { ...current.monthlyLimit, ...(b.monthlyLimit || {}) },
    advanceNotice: { ...current.advanceNotice, ...(b.advanceNotice || {}) },
    workingDaysOnly: b.workingDaysOnly === undefined ? current.workingDaysOnly : b.workingDaysOnly,
  });
  const org = await ctx.data.organizations.update(ctx.orgId, { leaveRules: rules });
  await ctx.data.auditLog.create({ action: "LEAVE_RULES_CONFIG", userId: ctx.user.id, meta: rules });
  return rulesView(org);
}

/**
 * How a request would fare before it is sent: its size in days and any rule it
 * breaks. Feeds the live warning in the apply dialog.
 */
export async function checkLeaveRules(ctx: RequestContext, q: { employeeId?: unknown; leaveTypeId?: unknown; from?: unknown; to?: unknown }) {
  const employeeId = isStaff(ctx.user) && q.employeeId ? String(q.employeeId) : ctx.user.employeeId;
  if (!employeeId) throw bad("No employee context");
  const employee = await ctx.data.employees.byId(employeeId);
  if (!employee) throw notFound("Employee not found");
  if (!ctx.inScope(employee)) throw forbidden("Outside your assigned scope");
  const type = await ctx.data.leaveTypes.byId(String(q.leaveTypeId || ""));
  if (!type) throw bad("Invalid leave type");
  const from = String(q.from || ""), to = String(q.to || "");
  if (daysBetweenInclusive(from, to) <= 0) throw bad("Invalid date range");

  const rc = await ruleContext(ctx.data, ctx.orgId);
  const days = sizeOf(rc, from, to);
  const problems = days > 0
    ? await ruleProblems(ctx.data, rc, { employee, type, from, to, audience: "applicant", checkNotice: true })
    : [];
  return { days, workingDaysOnly: rc.rules.workingDaysOnly, problems };
}

/**
 * How much of the monthly paid-leave limit is taken (approved or pending). Defaults
 * to the current month in the org's timezone. `{ enabled: false }` when the limit is off.
 */
export async function monthlyLeaveAllowance(ctx: RequestContext, q: { employeeId?: any; month?: unknown }) {
  const employeeId = readableEmployeeId(ctx, q.employeeId);
  const employee = await ctx.data.employees.byId(employeeId);
  if (!employee) throw notFound("Employee not found");
  if (!ctx.inScope(employee)) throw forbidden("Outside your assigned scope");

  const rc = await ruleContext(ctx.data, ctx.orgId);
  if (!rc.rules.monthlyLimit.enabled) return { enabled: false };
  const thisMonth = rc.today.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(String(q.month || "")) ? String(q.month) : thisMonth;

  const typeById = new Map((await ctx.data.leaveTypes.all()).map((t) => [t.id, t]));
  const live = await ctx.data.leaveRequests.forEmployee(employeeId, ["PENDING", "APPROVED"]);
  const taken = live.filter((r) => countsTowardMonthlyLimit(typeById.get(r.leaveTypeId)));
  return {
    enabled: true,
    ...monthlyAllowance({
      rules: rc.rules, cal: rc.cal, joiningDate: employee.joiningDate, month,
      onDate: month === thisMonth ? rc.today : `${month}-01`, taken,
    }),
  };
}

// ── Balances and requests ───────────────────────────────────────────────────

/** This year's balance of every leave type for one employee. */
export async function leaveBalances(ctx: RequestContext, requestedEmployeeId?: any) {
  const employeeId = readableEmployeeId(ctx, requestedEmployeeId);
  const types = await ctx.data.leaveTypes.all();
  return Promise.all(types.map(async (t) => {
    const bal = await ensureBalance(ctx.data, employeeId, t);
    return { leaveType: t.name, leaveTypeId: t.id, paid: t.paid, total: bal.total, used: bal.used, remaining: Math.max(0, bal.total - bal.used) };
  }));
}

/** Staff: all; manager (scope=team): reports'; employee: own. */
export async function listLeaveRequests(ctx: RequestContext, q: { scope?: unknown; employeeId?: unknown; status?: unknown }) {
  let list = await ctx.data.leaveRequests.all();
  if (q.scope === "team" && ctx.user.employeeId) {
    const ids = new Set(await teamIds(ctx));
    list = list.filter((r) => ids.has(r.employeeId));
  } else if (!isStaff(ctx.user)) list = list.filter((r) => r.employeeId === ctx.user.employeeId);
  else if (q.employeeId) list = list.filter((r) => r.employeeId === q.employeeId);
  const m = await maps(ctx);
  // Department/office-scoped staff only see requests from in-scope employees. For an
  // org-wide caller inScope() is always true, so nothing is filtered; for a scoped one a
  // request whose employee no longer exists is out of scope, as before.
  list = list.filter((r) => ctx.inScope(m.empById[r.employeeId]));
  if (q.status) list = list.filter((r) => r.status === q.status);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return list.map((r) => withNamesM(r, m));
}

// Shopify-style bulk action: HR / manager approve or reject many requests at once.
export async function bulkDecide(ctx: RequestContext, body: Record<string, any> | undefined) {
  const ids = (body && body.ids) || [];
  const decision = body && body.decision;
  if (!Array.isArray(ids) || !ids.length) throw bad("ids[] required");
  if (!["APPROVED", "REJECTED"].includes(decision)) throw bad("decision must be APPROVED or REJECTED");
  const input = body!;
  let affected = 0, skipped = 0;
  const decided: { employeeId: string; days: number }[] = [];
  const rc = decision === "APPROVED" ? await ruleContext(ctx.data, ctx.orgId) : null;
  await ctx.data.transaction(async (tx) => {
    for (const id of ids) {
      const lr = await tx.leaveRequests.byId(id);
      if (!lr) continue;
      if (!(await canDecideLeave(ctx, lr))) continue;
      if (lr.status !== "PENDING") continue;
      const patch: any = { status: decision, decidedBy: ctx.user.id, decidedAt: new Date().toISOString(), note: input.note || "" };
      if (decision === "APPROVED") {
        const type = await tx.leaveTypes.byId(lr.leaveTypeId);
        // Skip (leave pending) any over the company's monthly limit, unless forced. Approvals
        // earlier in this batch count, since they were written in this transaction.
        const problems = await approvalProblems(tx, rc!, lr, type);
        if (problems.length && !input.force) { skipped++; continue; }
        const bal = await ensureBalance(tx, lr.employeeId, type);
        // Skip (leave pending) any that would exceed a quota-bearing balance, unless forced.
        if (enforces(type) && bal.used + lr.days > bal.total && !input.force) { skipped++; continue; }
        if (problems.length) patch.ruleOverrides = await recordOverride(tx, ctx, lr, problems);
        await tx.leaveBalances.update(bal.id, { used: bal.used + lr.days });
      }
      await tx.leaveRequests.update(lr.id, patch);
      decided.push({ employeeId: lr.employeeId, days: lr.days });
      affected++;
    }
  });
  for (const d of decided) {
    await notifyEmployee(ctx.repos, d.employeeId, {
      type: "LEAVE", title: `Leave ${decision === "APPROVED" ? "approved" : "rejected"}`,
      body: `${d.days} day(s) ${decision === "APPROVED" ? "approved" : "rejected"}.`, link: "myleave",
    });
  }
  return { affected, skipped, decision };
}

// CSV export of leave requests (Shopify-style "Export"). Optional status filter.
export async function exportLeaveRequestsCsv(ctx: RequestContext, status?: unknown) {
  let list = await ctx.data.leaveRequests.all();
  if (!isStaff(ctx.user)) list = list.filter((r) => r.employeeId === ctx.user.employeeId);
  if (status) list = list.filter((r) => r.status === status);
  const m = await maps(ctx);
  // Separators become spaces (this export does not quote), then the formula-injection
  // defence every other CSV gets: a leave reason is free text the employee typed.
  const clean = (s) => defangCell(String(s == null ? "" : s).replace(/[",\n\r]/g, " "));
  const rows: unknown[][] = [["employee", "leave_type", "from", "to", "days", "status", "reason"]];
  list.forEach((r) => {
    const e = m.empById[r.employeeId] || {};
    const t = m.typeById[r.leaveTypeId] || {};
    rows.push([clean(`${e.firstName || ""} ${e.lastName || ""}`.trim()), clean(t.name), r.from, r.to, r.days, r.status, clean(r.reason)]);
  });
  return rows.map((r) => r.join(",")).join("\n");
}

/**
 * Apply for leave: { leaveTypeId, from, to, reason, employeeId?, force? }
 * A request that breaks the company's leave rules is refused with 409 and
 * code LEAVE_RULE. Only staff applying for someone else can override (force=true);
 * nobody can waive the rules for their own leave.
 */
export async function applyForLeave(ctx: RequestContext, input: Record<string, any>) {
  const { leaveTypeId, from, to, reason } = input;
  const employeeId = isStaff(ctx.user) && input.employeeId ? input.employeeId : ctx.user.employeeId;
  if (!employeeId) {
    throw bad(
      isStaff(ctx.user)
        ? "This is an admin-only account with no employee record. Pick an employee to apply on their behalf, or apply from an employee account."
        : "Only employees can apply for leave.",
    );
  }
  const type = await ctx.data.leaveTypes.byId(leaveTypeId);
  if (!type) throw bad("Invalid leave type");
  if (daysBetweenInclusive(from, to) <= 0) throw bad("Invalid date range");
  const employee = await ctx.data.employees.byId(employeeId);
  if (!employee) throw notFound("Employee not found");
  const onBehalf = employeeId !== ctx.user.employeeId;
  if (onBehalf && !ctx.inScope(employee)) throw forbidden("Outside your assigned scope");

  // Company leave rules (no-op unless turned on in Settings).
  const rc = await ruleContext(ctx.data, ctx.orgId);
  const days = sizeOf(rc, from, to);
  if (days <= 0) throw bad("Every day in that range is a weekly off or a holiday, so there is no leave to apply for.");
  const problems = await ruleProblems(ctx.data, rc, { employee, type, from, to, audience: "applicant", checkNotice: true });
  const overriding = problems.length > 0 && onBehalf && input.force === true;
  if (problems.length && !overriding) throw ruleError(problems);

  // Minimum-coverage guard (no-op unless enabled for this dept). A hard block
  // (mode=block) can only be overridden by a manager/staff passing force=true;
  // an employee applying for their own leave must pick different dates.
  const cov = await checkCoverage(ctx, { employeeId, from, to });
  if (cov.applicable && cov.mode === "block" && cov.conflicts.length > 0 && !input.force) {
    throw new HttpError(409, `${conflictSummary(cov)} Pick different dates or ask a manager to override.`);
  }
  const created = await ctx.data.leaveRequests.create({
    employeeId, leaveTypeId, from, to, days,
    reason: reason || "", status: "PENDING", decidedBy: null, decidedAt: null,
    ...(overriding ? { ruleOverrides: problems.map((p) => p.rule) } : {}),
  });
  if (overriding) await recordOverride(ctx.data, ctx, created, problems);
  const out = await withNames(ctx, created);
  return cov.conflicts.length ? { ...out, coverage: cov } : out;
}

/** { decision: APPROVED|REJECTED, note?, force? } (staff or the employee's manager) */
export async function decideLeave(ctx: RequestContext, id: string, input: Record<string, any>) {
  const lr = await ctx.data.leaveRequests.byId(id);
  if (!lr) throw notFound("Request not found");
  if (!(await canDecideLeave(ctx, lr))) {
    throw forbidden(
      lr.employeeId === ctx.user.employeeId
        ? "You can’t approve your own leave, it must be decided by your manager or an admin."
        : "Only the reporting manager, a leave approver or HR/Admin can decide this request.",
    );
  }
  if (lr.status !== "PENDING") throw bad("Request already decided");
  const decision = input.decision;
  if (!["APPROVED", "REJECTED"].includes(decision)) throw bad("decision must be APPROVED or REJECTED");
  // Re-check coverage at approval time (excluding this request from the tally).
  if (decision === "APPROVED") {
    const cov = await checkCoverage(ctx, { employeeId: lr.employeeId, from: lr.from, to: lr.to, excludeRequestId: lr.id });
    if (cov.applicable && cov.mode === "block" && cov.conflicts.length > 0 && !input.force) {
      throw new HttpError(409, `${conflictSummary(cov)} Pass force=true to override.`);
    }
  }
  const rc = decision === "APPROVED" ? await ruleContext(ctx.data, ctx.orgId) : null;
  const updated = await ctx.data.transaction(async (tx) => {
    const patch: any = { status: decision, decidedBy: ctx.user.id, decidedAt: new Date().toISOString(), note: input.note || "" };
    if (decision === "APPROVED") {
      const type = await tx.leaveTypes.byId(lr.leaveTypeId);
      // The company's monthly paid-leave limit (409, code LEAVE_RULE; force=true overrides).
      const problems = await approvalProblems(tx, rc!, lr, type);
      if (problems.length && !input.force) throw ruleError(problems);
      if (problems.length) patch.ruleOverrides = await recordOverride(tx, ctx, lr, problems);
      const bal = await ensureBalance(tx, lr.employeeId, type);
      // Enforce remaining balance for quota-bearing paid leave (staff may pass force=true).
      if (enforces(type) && bal.used + lr.days > bal.total && !input.force)
        throw bad(`Insufficient ${type!.name} balance: ${Math.max(0, bal.total - bal.used)} day(s) left (requested ${lr.days}). Pass force=true to override.`);
      await tx.leaveBalances.update(bal.id, { used: bal.used + lr.days });
    }
    return tx.leaveRequests.update(lr.id, patch);
  });
  await notifyEmployee(ctx.repos, lr.employeeId, {
    type: "LEAVE", title: `Leave ${decision === "APPROVED" ? "approved" : "rejected"}`,
    body: `Your ${lr.days} day(s) leave was ${decision === "APPROVED" ? "approved" : "rejected"}.`, link: "myleave",
  });
  return withNames(ctx, updated);
}

/**
 * Cancel an APPROVED leave and restore the balance (staff, a leave approver, the
 * employee's manager or the applicant). Pending requests are withdrawn instead.
 */
export async function cancelApprovedLeave(ctx: RequestContext, id: string) {
  const lr = await ctx.data.leaveRequests.byId(id);
  if (!lr) throw notFound("Request not found");
  const isOwner = lr.employeeId === ctx.user.employeeId;
  if (!isStaff(ctx.user) && !ctx.can("leave.approve") && !isOwner && !(await managesEmployee(ctx, lr.employeeId)))
    throw forbidden("Only HR, a leave approver, the manager or the applicant can cancel");
  if (lr.status !== "APPROVED") throw bad("Only approved leave can be cancelled here (use delete for pending requests)");
  const updated = await ctx.data.transaction(async (tx) => {
    const type = await tx.leaveTypes.byId(lr.leaveTypeId);
    if (type) {
      const bal = await ensureBalance(tx, lr.employeeId, type);
      await tx.leaveBalances.update(bal.id, { used: Math.max(0, bal.used - lr.days) }); // restore balance
    }
    return tx.leaveRequests.update(lr.id, { status: "CANCELLED", cancelledBy: ctx.user.id, cancelledAt: new Date().toISOString() });
  });
  await notifyEmployee(ctx.repos, lr.employeeId, { type: "LEAVE", title: "Leave cancelled", body: `${lr.days} day(s) of leave were cancelled and your balance restored.`, link: "myleave" });
  return withNames(ctx, updated);
}

/** The applicant (or staff) withdraws a pending request. */
export async function withdrawLeaveRequest(ctx: RequestContext, id: string) {
  const lr = await ctx.data.leaveRequests.byId(id);
  if (!lr) throw notFound("Request not found");
  if (!isStaff(ctx.user) && lr.employeeId !== ctx.user.employeeId) throw forbidden();
  if (lr.status !== "PENDING") throw bad("Only pending requests can be cancelled");
  await ctx.data.leaveRequests.remove(lr.id);
  return { ok: true };
}
