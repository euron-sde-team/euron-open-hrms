/** Performance: PIP (improvement program) + appraisal cycles + appraisals. */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden, round2 } from "../core/util";
import { isStaff } from "../middleware/auth";
import { isManagerOf } from "../domain/manager";

async function empMap(ctx: RequestContext) {
  const emps = await ctx.data.employees.all();
  return Object.fromEntries(emps.map((e) => [e.id, e]));
}
const nameFrom = (map, id) => (map[id] ? `${map[id].firstName} ${map[id].lastName || ""}`.trim() : "-");
const managesFrom = (map, user, employeeId) => {
  if (!user.employeeId) return false;
  const e = map[employeeId];
  return isManagerOf(e, user.employeeId);
};
/** The top of the manager rating scale (the review form offers 1 to 5; 0 is allowed too). */
const MAX_RATING = 5;
const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);

// ── PIP ─────────────────────────────────────────────────────────────────────
/** Manager (scope=team): reports' PIPs; employee: own; staff: everything in their scope. */
export async function listPips(ctx: RequestContext, scope?: unknown) {
  const map = await empMap(ctx);
  let list = await ctx.data.pips.all();
  if (scope === "team" && ctx.user.employeeId) list = list.filter((p) => managesFrom(map, ctx.user, p.employeeId));
  else if (!isStaff(ctx.user)) list = list.filter((p) => p.employeeId === ctx.user.employeeId);
  else list = list.filter((p) => ctx.inScope(map[p.employeeId])); // scoped staff
  list.sort(newestFirst);
  return list.map((p) => ({ ...p, employeeName: nameFrom(map, p.employeeId) }));
}

export async function createPip(ctx: RequestContext, input: Record<string, any>) {
  const e = await ctx.data.employees.byId(input.employeeId);
  if (!e) throw notFound("Employee not found");
  if (!ctx.inScope(e)) throw forbidden("Outside your assigned scope");
  const p = await ctx.data.pips.create({
    employeeId: e.id, title: input.title || "Performance Improvement Plan",
    reason: input.reason || "", objectives: input.objectives || "",
    startDate: input.startDate || new Date().toISOString().slice(0, 10),
    endDate: input.endDate || "", status: "ACTIVE", mentorId: input.mentorId || null, checkins: [], outcome: "",
    createdBy: ctx.user.id,
  });
  return { ...p, employeeName: `${e.firstName} ${e.lastName || ""}`.trim() };
}

export async function addPipCheckin(ctx: RequestContext, id: string, input: { note?: string; rating?: unknown }) {
  const p = await ctx.data.pips.byId(id);
  if (!p) throw notFound("PIP not found");
  const checkins = [...(p.checkins || []), { date: new Date().toISOString().slice(0, 10), note: input.note || "", rating: input.rating || null }];
  return ctx.data.pips.update(p.id, { checkins });
}

export async function updatePip(ctx: RequestContext, id: string, input: Record<string, any>) {
  const p = await ctx.data.pips.byId(id);
  if (!p) throw notFound("PIP not found");
  const patch: any = {};
  for (const k of ["title", "reason", "objectives", "endDate", "outcome"]) if (input[k] !== undefined) patch[k] = input[k];
  if (input.status && ["ACTIVE", "CLEARED", "EXTENDED", "TERMINATED"].includes(input.status)) patch.status = input.status;
  return ctx.data.pips.update(p.id, patch);
}

// ── Appraisal cycles ────────────────────────────────────────────────────────
/** Every cycle, newest first, with how many appraisals it holds. */
export async function listCycles(ctx: RequestContext) {
  const list = (await ctx.data.appraisalCycles.all()).sort(newestFirst);
  let appraisals = await ctx.data.appraisals.all();
  // A cycle is org-wide, but how many appraisals it holds is not: a department-scoped HR
  // user counts only the people they may see, exactly as /pips filters for them.
  if (isStaff(ctx.user) && ctx.scope.scopeType !== "ALL") {
    const map = await empMap(ctx);
    appraisals = appraisals.filter((a) => ctx.inScope(map[a.employeeId]));
  }
  return list.map((c) => ({ ...c, appraisals: appraisals.filter((a) => a.cycleId === c.id).length }));
}

/** Open a cycle → auto-creates a PENDING_SELF appraisal for every active employee. */
export async function openCycle(ctx: RequestContext, input: { name?: string; periodLabel?: string }) {
  if (!input.name) throw bad("Cycle name is required (e.g. 'H1 2026')");
  const activeEmps = await ctx.data.employees.active();
  return ctx.data.transaction(async (tx) => {
    const c = await tx.appraisalCycles.create({ name: input.name, periodLabel: input.periodLabel || "", status: "OPEN" });
    for (const e of activeEmps) {
      await tx.appraisals.create({ cycleId: c.id, employeeId: e.id, selfReview: "", achievements: "", managerRating: null, managerComments: "", recommendedHikePct: 0, finalHikePct: 0, status: "PENDING_SELF" });
    }
    return c;
  });
}

export async function closeCycle(ctx: RequestContext, id: string) {
  const c = await ctx.data.appraisalCycles.byId(id);
  if (!c) throw notFound("Cycle not found");
  return ctx.data.appraisalCycles.update(c.id, { status: "CLOSED" });
}

// ── Appraisals ──────────────────────────────────────────────────────────────
/** Manager (scope=team): reports'; employee: own; staff: all. Optionally one cycle. */
export async function listAppraisals(ctx: RequestContext, q: { cycleId?: unknown; scope?: unknown }) {
  const map = await empMap(ctx);
  const cycles = await ctx.data.appraisalCycles.all();
  const cycleById = Object.fromEntries(cycles.map((c) => [c.id, c]));
  let list = await ctx.data.appraisals.all();
  if (q.cycleId) list = list.filter((a) => a.cycleId === q.cycleId);
  if (q.scope === "team" && ctx.user.employeeId) list = list.filter((a) => managesFrom(map, ctx.user, a.employeeId));
  else if (!isStaff(ctx.user)) list = list.filter((a) => a.employeeId === ctx.user.employeeId);
  else list = list.filter((a) => ctx.inScope(map[a.employeeId])); // scoped staff, as listPips
  return list.map((a) => ({ ...a, employeeName: nameFrom(map, a.employeeId), cycleName: (cycleById[a.cycleId] || {}).name }));
}

/** Employee submits self-review. */
export async function submitSelfReview(ctx: RequestContext, id: string, input: { selfReview?: string; achievements?: string }) {
  const a = await ctx.data.appraisals.byId(id);
  if (!a) throw notFound("Appraisal not found");
  if (a.employeeId !== ctx.user.employeeId) throw forbidden("Not your appraisal");
  return ctx.data.appraisals.update(a.id, { selfReview: input.selfReview || "", achievements: input.achievements || "", status: "PENDING_MANAGER" });
}

/** Manager / HR review: rating + recommended hike. */
export async function submitManagerReview(ctx: RequestContext, id: string, input: Record<string, any>) {
  const a = await ctx.data.appraisals.byId(id);
  if (!a) throw notFound("Appraisal not found");
  const map = await empMap(ctx);
  if (!isStaff(ctx.user) && !managesFrom(map, ctx.user, a.employeeId)) throw forbidden("Only HR or the manager can review");
  // `Number(x) || previous` threw away a deliberate 0, so the lowest rating could never be
  // saved. Absent keeps the previous rating; anything supplied must be 0 to MAX_RATING.
  let managerRating = a.managerRating;
  if (input.managerRating !== undefined && input.managerRating !== null && input.managerRating !== "") {
    managerRating = Number(input.managerRating);
    if (!Number.isFinite(managerRating) || managerRating < 0 || managerRating > MAX_RATING) {
      throw bad(`Rating must be a number from 0 to ${MAX_RATING}`);
    }
  }
  return ctx.data.appraisals.update(a.id, {
    managerRating, managerComments: input.managerComments || a.managerComments,
    recommendedHikePct: round2(input.recommendedHikePct ?? a.recommendedHikePct),
    finalHikePct: round2(input.finalHikePct ?? input.recommendedHikePct ?? a.finalHikePct),
    status: "COMPLETED",
  });
}
