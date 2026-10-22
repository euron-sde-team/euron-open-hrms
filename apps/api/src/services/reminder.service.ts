/** Reminders / "My Work": a personal to-do layer, per user, per organization. */
import type { RequestContext } from "../core/context";
import { bad, notFound } from "../core/util";
import { localNow } from "../jobs/reminders/clockin";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const nowIso = () => new Date().toISOString();

/**
 * "Today" for a workspace's reminders, as YYYY-MM-DD.
 *
 * A due date is a calendar day the user picked in their own zone, so comparing it with the
 * server's UTC date flipped "due today" a day early or late for anyone far from UTC. The
 * workspace's zone is the one set under Settings > Reminders; without one, UTC as before.
 */
export function reminderToday(org: any, now = new Date()): string {
  const timezone = org?.reminders?.clockIn?.timezone;
  return timezone ? localNow(timezone, now).date : now.toISOString().slice(0, 10);
}

async function today(ctx: RequestContext) {
  return reminderToday(await ctx.data.organizations.byId(ctx.orgId));
}

const mine = (ctx: RequestContext) => ctx.data.reminders.forUser(ctx.user.id);
const sortRem = (list) => list.sort((a, b) => {
  if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
  const ad = a.dueDate || "9999", bd = b.dueDate || "9999";
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : -1;
});

async function ownReminder(ctx: RequestContext, id: string) {
  const r = await ctx.data.reminders.ownedBy(id, ctx.user.id);
  if (!r) throw notFound("Reminder not found");
  return r;
}

/** My reminders, optionally only OPEN or DONE. */
export async function listReminders(ctx: RequestContext, status?: unknown) {
  let list = await mine(ctx);
  if (status === "OPEN" || status === "DONE") list = list.filter((r) => r.status === status);
  return sortRem(list);
}

/** Open + due-today counts, for the nav badge. */
export async function reminderCounts(ctx: RequestContext) {
  const t = await today(ctx);
  const open = (await mine(ctx)).filter((r) => r.status === "OPEN");
  return { open: open.length, dueToday: open.filter((r) => r.dueDate && r.dueDate <= t).length };
}

/** Open items due today or overdue. */
export async function dueToday(ctx: RequestContext) {
  const t = await today(ctx);
  return sortRem((await mine(ctx)).filter((r) => r.status === "OPEN" && r.dueDate && r.dueDate <= t));
}

export async function createReminder(ctx: RequestContext, b: Record<string, any>) {
  if (!b.title || !String(b.title).trim()) throw bad("title is required");
  return ctx.data.reminders.create({
    userId: ctx.user.id,
    title: String(b.title).trim().slice(0, 200), note: (b.note || "").slice(0, 1000),
    dueDate: b.dueDate || null, priority: PRIORITIES.includes(b.priority) ? b.priority : "MEDIUM",
    link: b.link || null, status: "OPEN", completedAt: null,
  });
}

/** Edit fields. */
export async function updateReminder(ctx: RequestContext, id: string, b: Record<string, any>) {
  const r = await ownReminder(ctx, id);
  const patch: any = {};
  if (b.title !== undefined) patch.title = String(b.title).trim().slice(0, 200);
  if (b.note !== undefined) patch.note = String(b.note).slice(0, 1000);
  if (b.dueDate !== undefined) patch.dueDate = b.dueDate || null;
  if (b.priority !== undefined && PRIORITIES.includes(b.priority)) patch.priority = b.priority;
  if (b.link !== undefined) patch.link = b.link || null;
  if (b.status === "OPEN" || b.status === "DONE") { patch.status = b.status; patch.completedAt = b.status === "DONE" ? nowIso() : null; }
  return ctx.data.reminders.update(r.id, patch);
}

/** Flip OPEN <-> DONE. */
export async function toggleReminder(ctx: RequestContext, id: string) {
  const r = await ownReminder(ctx, id);
  const status = r.status === "OPEN" ? "DONE" : "OPEN";
  return ctx.data.reminders.update(r.id, { status, completedAt: status === "DONE" ? nowIso() : null });
}

export async function deleteReminder(ctx: RequestContext, id: string) {
  const r = await ownReminder(ctx, id);
  await ctx.data.reminders.remove(r.id);
  return { ok: true };
}
