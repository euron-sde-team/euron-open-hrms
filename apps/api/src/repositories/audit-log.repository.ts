import { db } from "../db/kysely";
import { Repository } from "./repository";

/** Data access for `audit_log`. */
export class AuditLogRepository extends Repository {
  /**
   * Distinct action types recorded in one workspace, sorted (for the filter dropdown).
   *
   * A DISTINCT over the hot `action` column, which the generic store cannot express, so it
   * goes to SQL directly. The org filter is explicit here for the same reason: this query
   * does not pass through the scoped store that adds it everywhere else.
   */
  async distinctActions(orgId: string): Promise<string[]> {
    const rows = await db.selectFrom("audit_log").select("action").distinct()
      .where("org_id", "=", orgId).where("action", "is not", null)
      .orderBy("action").execute();
    return rows.map((r) => r.action).filter(Boolean) as string[];
  }

  /** One page of the trail, newest first, optionally narrowed to an action and a text search on it. */
  trail(opts: { page?: unknown; pageSize?: unknown; action?: string; q?: string }) {
    const where: Record<string, unknown> = {};
    if (opts.action) where.action = opts.action;
    const search = opts.q ? { q: opts.q, cols: ["action"] } : undefined;
    return this.page({
      page: opts.page,
      pageSize: opts.pageSize || 50,
      orderBy: "createdAt",
      dir: "desc",
      where,
      search,
    });
  }
}
