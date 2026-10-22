/** Company announcements / notice board: HR posts, everyone reads. */
import type { RequestContext } from "../core/context";
import { bad, notFound } from "../core/util";
import { enqueue } from "../jobs/queue";

async function withAuthor(ctx: RequestContext, a) {
  const u = a.authorId ? await ctx.data.users.byId(a.authorId) : null;
  return { ...a, authorName: u ? u.name : "HR" };
}

/** Everyone in the org. Pinned first, then newest. */
export async function listAnnouncements(ctx: RequestContext) {
  const list = await ctx.data.announcements.pinnedFirst();
  return Promise.all(list.map((a) => withAuthor(ctx, a)));
}

export async function createAnnouncement(ctx: RequestContext, input: { title?: string; body?: string; pinned?: unknown; category?: string }) {
  const { title, body, pinned, category } = input;
  if (!title || !body) throw bad("title and body are required");
  const created = await ctx.data.announcements.create({
    title, body, category: category || "GENERAL", pinned: !!pinned, authorId: ctx.user.id,
  });
  // Fan out to everyone in the org via the background queue (off the request path).
  // `user.orgId` rather than `ctx.orgId`: enqueue() infers its option type as null-only.
  const orgId = ctx.user.orgId;
  await enqueue("announcement.broadcast", { orgId, title, body: `${title}` }, { orgId });
  return withAuthor(ctx, created);
}

export async function updateAnnouncement(ctx: RequestContext, id: string, input: Record<string, any>) {
  const a = await ctx.data.announcements.byId(id);
  if (!a) throw notFound("Announcement not found");
  const patch: any = {};
  for (const k of ["title", "body", "category"]) if (input[k] !== undefined) patch[k] = input[k];
  if (input.pinned !== undefined) patch.pinned = !!input.pinned;
  return withAuthor(ctx, await ctx.data.announcements.update(a.id, patch));
}

export async function deleteAnnouncement(ctx: RequestContext, id: string) {
  const a = await ctx.data.announcements.byId(id);
  if (!a) throw notFound("Announcement not found");
  await ctx.data.announcements.remove(a.id);
  return { ok: true };
}
