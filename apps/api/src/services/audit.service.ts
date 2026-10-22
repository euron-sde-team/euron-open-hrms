/** Audit log viewer (staff), who did what, newest first. */
import type { RequestContext } from "../core/context";
import { forbidden } from "../core/util";

const assertCanView = (ctx: RequestContext) => {
  if (!ctx.can("audit.view")) throw forbidden("Requires the \"audit.view\" permission");
};

/** Distinct action types in this org (for the filter dropdown). */
export async function listActions(ctx: RequestContext) {
  assertCanView(ctx);
  return ctx.data.auditLog.distinctActions(ctx.orgId);
}

/**
 * Paginated org audit trail, newest first, with actor names.
 * Returns { items, total, page, pageSize, pages }.
 */
export async function listAudit(ctx: RequestContext, opts: { page?: unknown; pageSize?: unknown; action?: unknown; q?: unknown }) {
  assertCanView(ctx);
  const result = await ctx.data.auditLog.trail({
    page: opts.page,
    pageSize: opts.pageSize,
    action: opts.action ? String(opts.action) : undefined,
    q: opts.q ? String(opts.q) : undefined,
  });
  // Enrich just this page's rows with actor names.
  const users = await ctx.data.users.all();
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  return {
    ...result,
    items: result.items.map((a) => ({
      id: a.id,
      action: a.action,
      actor: a.userId && userById[a.userId] ? userById[a.userId].name : (a.userId ? "User" : "System/Operator"),
      actorId: a.userId || null,
      meta: a.meta || a.data || {},
      at: a.createdAt,
    })),
  };
}
