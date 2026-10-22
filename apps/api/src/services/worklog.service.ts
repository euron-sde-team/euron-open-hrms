/** Daily work / productivity log: onsite / offsite / client / remote work. */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden, round2, todayStr } from "../core/util";
import { isStaff } from "../middleware/auth";
import { isManagerOf } from "../domain/manager";

const TYPES = ["ONSITE", "OFFSITE", "CLIENT", "REMOTE"];

/** Load the org's employees once as an id -> record map (for names + manager checks). */
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

export interface WorkLogFilter { scope?: unknown; employeeId?: unknown; from?: any; to?: any }

/** Staff: all; manager (scope=team): team; employee: own. Optional from/to window. */
export async function listWorkLogs(ctx: RequestContext, q: WorkLogFilter) {
  const map = await empMap(ctx);
  let list = await ctx.data.workLogs.all();
  if (q.scope === "team" && ctx.user.employeeId) list = list.filter((w) => managesFrom(map, ctx.user, w.employeeId));
  else if (!isStaff(ctx.user)) list = list.filter((w) => w.employeeId === ctx.user.employeeId);
  else if (q.employeeId) list = list.filter((w) => w.employeeId === q.employeeId);
  if (q.from) list = list.filter((w) => w.date >= q.from);
  if (q.to) list = list.filter((w) => w.date <= q.to);
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  return list.map((w) => ({ ...w, employeeName: nameFrom(map, w.employeeId) }));
}

/** Log a day's work (one row per employee per day; logging again updates it). */
export async function logWork(ctx: RequestContext, input: Record<string, any>) {
  const employeeId = isStaff(ctx.user) && input.employeeId ? input.employeeId : ctx.user.employeeId;
  if (!employeeId) throw bad("Only employees can log work");
  const date = input.date || todayStr();
  const type = TYPES.includes(input.type) ? input.type : "REMOTE";
  const existing = await ctx.data.workLogs.forDay(employeeId, date);
  const data = {
    type, client: input.client || "", hours: round2(input.hours || 0),
    productivityScore: Math.max(1, Math.min(10, Number(input.productivityScore) || 5)),
    summary: input.summary || "", tasks: input.tasks || "",
  };
  const row = existing
    ? await ctx.data.workLogs.update(existing.id, data)
    : await ctx.data.workLogs.create({ employeeId, date, ...data });
  const e = await ctx.data.employees.byId(row!.employeeId);
  return { ...row, employeeName: e ? `${e.firstName} ${e.lastName || ""}`.trim() : "-" };
}

export async function deleteWorkLog(ctx: RequestContext, id: string) {
  const w = await ctx.data.workLogs.byId(id);
  if (!w) throw notFound("Log not found");
  if (!isStaff(ctx.user) && w.employeeId !== ctx.user.employeeId) throw forbidden();
  await ctx.data.workLogs.remove(w.id);
  return { ok: true };
}

/** Per-employee productivity rollup over a date window (staff/manager). Defaults to the last 7 days. */
export async function workLogSummary(ctx: RequestContext, q: WorkLogFilter) {
  if (!isStaff(ctx.user) && !ctx.user.employeeId) throw forbidden();
  const to = q.to || todayStr();
  const from = q.from || new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const map = await empMap(ctx);
  let logs = await ctx.data.workLogs.between(from, to);
  if (q.scope === "team" && ctx.user.employeeId) logs = logs.filter((w) => managesFrom(map, ctx.user, w.employeeId));
  else if (!isStaff(ctx.user)) logs = logs.filter((w) => w.employeeId === ctx.user.employeeId);
  const byEmp: any = {};
  logs.forEach((w) => {
    const e = (byEmp[w.employeeId] = byEmp[w.employeeId] || { employeeId: w.employeeId, name: nameFrom(map, w.employeeId), days: 0, hours: 0, scoreSum: 0, byType: {} });
    e.days++; e.hours = round2(e.hours + w.hours); e.scoreSum += w.productivityScore; e.byType[w.type] = (e.byType[w.type] || 0) + 1;
  });
  const rows = Object.values(byEmp).map((e: any) => ({ ...e, avgProductivity: e.days ? round2(e.scoreSum / e.days) : 0 }));
  return { from, to, rows };
}
