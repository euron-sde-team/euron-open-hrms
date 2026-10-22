/** Perks, goodies & coupon distribution + family-benefit enrolment. */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden } from "../core/util";
import { isStaff } from "../middleware/auth";

/** Build an { employeeId -> "First Last" } map for the org in one query. */
async function nameMap(ctx: RequestContext) {
  const emps = await ctx.data.employees.all();
  return Object.fromEntries(emps.map((e) => [e.id, `${e.firstName} ${e.lastName || ""}`.trim()]));
}

// ── Goodies & coupons ───────────────────────────────────────────────────────
/** Staff: all (filtered by type / employeeId); employee: own. */
export async function listPerks(ctx: RequestContext, filter: { type?: unknown; employeeId?: unknown }) {
  const names = await nameMap(ctx);
  let list = await ctx.data.perks.all();
  if (!isStaff(ctx.user)) list = list.filter((p) => p.employeeId === ctx.user.employeeId);
  else if (filter.employeeId) list = list.filter((p) => p.employeeId === filter.employeeId);
  if (filter.type) list = list.filter((p) => p.type === filter.type);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return list.map((p) => ({ ...p, employeeName: names[p.employeeId] || "-" }));
}

/**
 * Staff: distribute a goodie or coupon.
 * { type:GOODIE|COUPON, item, code, expiresAt, employeeIds:[], all:bool }
 */
export async function distributePerk(ctx: RequestContext, input: Record<string, any>) {
  const type = input.type === "COUPON" ? "COUPON" : "GOODIE";
  if (!input.item) throw bad("item is required");
  let targets = input.employeeIds || [];
  if (input.all) targets = (await ctx.data.employees.active()).map((e) => e.id);
  if (!targets.length) throw bad("Pick at least one employee (or 'all')");
  const created = await Promise.all(targets.map((eid) => ctx.data.perks.create({
    employeeId: eid, type, item: input.item,
    code: type === "COUPON" ? (input.code || `CPN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`) : "",
    status: "ALLOCATED", expiresAt: input.expiresAt || null, allocatedBy: ctx.user.id,
  })));
  return { ok: true, distributed: created.length };
}

/** An employee claims a perk. */
export async function claimPerk(ctx: RequestContext, id: string) {
  const p = await ctx.data.perks.byId(id);
  if (!p) throw notFound("Perk not found");
  if (p.employeeId !== ctx.user.employeeId && !isStaff(ctx.user)) throw forbidden();
  if (p.status === "CLAIMED") throw bad("Already claimed");
  return ctx.data.perks.update(p.id, { status: "CLAIMED", claimedAt: new Date().toISOString() });
}

// ── Family benefits ─────────────────────────────────────────────────────────
/** Staff: all; employee: own enrolment. */
export async function listFamilyBenefits(ctx: RequestContext) {
  const names = await nameMap(ctx);
  let list = await ctx.data.familyBenefits.all();
  if (!isStaff(ctx.user)) list = list.filter((f) => f.employeeId === ctx.user.employeeId);
  return list.map((f) => ({ ...f, employeeName: names[f.employeeId] || "-" }));
}

/** An employee enrols / updates dependents (staff may do it for anyone). */
export async function enrolFamilyBenefit(ctx: RequestContext, input: Record<string, any>) {
  const employeeId = isStaff(ctx.user) && input.employeeId ? input.employeeId : ctx.user.employeeId;
  if (!employeeId) throw forbidden("Employees only");
  const data = {
    plan: input.plan || "Group Health - Family Floater",
    coverAmount: Number(input.coverAmount) || 500000,
    dependents: Array.isArray(input.dependents) ? input.dependents.slice(0, 12) : [],
    status: "ENROLLED",
  };
  const existing = await ctx.data.familyBenefits.forEmployee(employeeId);
  const row = existing
    ? await ctx.data.familyBenefits.update(existing.id, data)
    : await ctx.data.familyBenefits.create({ employeeId, ...data });
  const names = await nameMap(ctx);
  return { ...row, employeeName: names[row!.employeeId] || "-" };
}
