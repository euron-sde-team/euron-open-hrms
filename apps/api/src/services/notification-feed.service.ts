/**
 * In-app notifications, per-user feed + unread badge.
 *
 * Reading and marking only: SENDING notifications lives in notification.service.ts.
 */
import type { RequestContext } from "../core/context";
import { notFound } from "../core/util";

/** The caller's own notifications, newest first, optionally unread only, capped at 200. */
export async function listFeed(ctx: RequestContext, opts: { unread?: unknown; limit?: unknown }) {
  let list = await ctx.data.notifications.forUser(ctx.user.id);
  if (opts.unread === "1") list = list.filter((n) => !n.readAt);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const limit = Math.min(Number(opts.limit) || 50, 200);
  return list.slice(0, limit);
}

/** Unread count for the nav badge (polled frequently). */
export async function unreadCount(ctx: RequestContext) {
  return { unread: (await ctx.data.notifications.unreadForUser(ctx.user.id)).length };
}

export async function markRead(ctx: RequestContext, id: string) {
  const n = await ctx.data.notifications.byId(id);
  if (!n || n.userId !== ctx.user.id) throw notFound("Notification not found");
  return ctx.data.notifications.update(n.id, { readAt: new Date() });
}

/** Mark all of the caller's notifications read; only the (small) unread subset is updated. */
export async function markAllRead(ctx: RequestContext) {
  const unread = await ctx.data.notifications.unreadForUser(ctx.user.id);
  for (const n of unread) await ctx.data.notifications.update(n.id, { readAt: new Date() });
  return { ok: true, marked: unread.length };
}
