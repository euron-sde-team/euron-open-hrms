/** Saved Views, recallable filter presets, per user, per resource (Shopify-style). */
import type { RequestContext } from "../core/context";
import { bad, notFound } from "../core/util";

/** The caller's own saved views, oldest first. */
export async function listViews(ctx: RequestContext, resource?: unknown) {
  const list = await ctx.data.savedViews.forUser(ctx.user.id, resource);
  return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function createView(ctx: RequestContext, input: { resource?: unknown; name?: unknown; filters?: unknown }) {
  if (!input.resource) throw bad("resource is required");
  if (!input.name || !String(input.name).trim()) throw bad("name is required");
  return ctx.data.savedViews.create({
    userId: ctx.user.id,
    resource: String(input.resource),
    name: String(input.name).trim().slice(0, 60),
    filters: input.filters && typeof input.filters === "object" ? input.filters : {},
  });
}

/** Owner only: someone else's view reads as not found. */
export async function deleteView(ctx: RequestContext, id: string) {
  const vw = await ctx.data.savedViews.byId(id);
  if (!vw || vw.userId !== ctx.user.id) throw notFound("View not found");
  await ctx.data.savedViews.remove(vw.id);
  return { ok: true };
}
