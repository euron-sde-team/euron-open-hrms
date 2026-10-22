/** AI token access: per-employee AI usage allowance (grant + request more). */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden } from "../core/util";
import { isStaff } from "../middleware/auth";

const PLANS = { NONE: 0, STARTER: 50000, PLUS: 100000, PRO: 500000 };

async function nameMap(ctx: RequestContext) {
  const emps = await ctx.data.employees.all();
  return Object.fromEntries(emps.map((e) => [e.id, `${e.firstName} ${e.lastName || ""}`.trim()]));
}

const NEW_RECORD = (employeeId) => ({ employeeId, plan: "STARTER", dailyLimit: PLANS.STARTER, usedToday: 0, requests: [], grantedBy: null });

async function ensureRecord(ctx: RequestContext, employeeId) {
  let r = await ctx.data.aiTokens.forEmployee(employeeId);
  if (!r) r = await ctx.data.aiTokens.create(NEW_RECORD(employeeId));
  return r;
}

/** Staff: all employees' allowances; employee: own. */
export async function listAllowances(ctx: RequestContext) {
  const names = await nameMap(ctx);
  if (!isStaff(ctx.user)) {
    if (!ctx.user.employeeId) throw forbidden();
    const r = await ensureRecord(ctx, ctx.user.employeeId);
    return { ...r, employeeName: names[r.employeeId] || "-", plans: PLANS };
  }
  // Fetch ALL token records once and index by employeeId, instead of one lookup
  // (formerly a full-table scan) per employee, was O(employees × table).
  const emps = await ctx.data.employees.active();
  const existing = await ctx.data.aiTokens.all();
  const byEmp = new Map<string, any>(existing.map((t) => [t.employeeId, t]));
  const records: any[] = [];
  for (const e of emps) {
    let r: any = byEmp.get(e.id);
    if (!r) r = await ctx.data.aiTokens.create(NEW_RECORD(e.id)); // create only the missing ones
    records.push({ ...r, employeeName: names[e.id] || "-", code: e.code });
  }
  return { plans: PLANS, records };
}

/** Staff: set an employee's AI plan / daily limit. */
export async function grantAllowance(ctx: RequestContext, input: { employeeId?: string; plan?: string; dailyLimit?: unknown }) {
  if (!(await ctx.data.employees.byId(input.employeeId as string))) throw notFound("Employee not found");
  const r = await ensureRecord(ctx, input.employeeId);
  // Own keys only: `in` also matched inherited names, so plan "toString" was accepted and
  // stored with a function for its daily limit.
  if (input.plan != null && input.plan !== "" && !Object.hasOwn(PLANS, String(input.plan))) {
    throw bad(`Unknown plan "${input.plan}". Choose one of ${Object.keys(PLANS).join(", ")}.`);
  }
  const plan = input.plan ? String(input.plan) : r.plan;
  const dailyLimit = input.dailyLimit != null ? Number(input.dailyLimit) : PLANS[plan];
  return ctx.data.aiTokens.update(r.id, { plan, dailyLimit, grantedBy: ctx.user.id });
}

/** An employee requests more tokens. */
export async function requestTopUp(ctx: RequestContext, input: { requestedLimit?: unknown; reason?: string }) {
  if (!ctx.user.employeeId) throw forbidden("Employees only");
  const r = await ensureRecord(ctx, ctx.user.employeeId);
  const requests = [...(r.requests || []), { id: Date.now().toString(36), requestedLimit: Number(input.requestedLimit) || r.dailyLimit, reason: input.reason || "", status: "PENDING", at: new Date().toISOString() }];
  return ctx.data.aiTokens.update(r.id, { requests });
}

/** Staff: approve/reject a top-up request. */
export async function decideTopUp(ctx: RequestContext, id: string, input: { requestId?: string; decision?: string }) {
  const r = await ctx.data.aiTokens.byId(id);
  if (!r) throw notFound("Record not found");
  // Separation of duties: you cannot approve/reject your own top-up request.
  if (r.employeeId && r.employeeId === ctx.user.employeeId) throw forbidden("You can't decide your own AI top-up request - another admin must review it.");
  const reqId = input.requestId;
  const decision = input.decision === "APPROVED" ? "APPROVED" : "REJECTED";
  const requests = (r.requests || []).map((q) => (q.id === reqId ? { ...q, status: decision } : q));
  const patch: any = { requests };
  if (decision === "APPROVED") {
    const q = requests.find((x) => x.id === reqId);
    if (q) { patch.dailyLimit = q.requestedLimit; patch.plan = "CUSTOM"; }
  }
  return ctx.data.aiTokens.update(r.id, patch);
}
