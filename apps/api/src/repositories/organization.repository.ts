import { Repository } from "./repository";
import { db, dbAny } from "../db/kysely";
import { TABLES } from "./base.repository";

/** Data access for `organizations`. Domain-specific queries belong here. */
export class OrganizationRepository extends Repository {
  /**
   * Workspaces other than `exceptOrgId` that hold `domain` as their sending domain.
   * Only meaningful on the system (cross-workspace) store.
   */
  holdersOfEmailDomain(domain: string, exceptOrgId: string) {
    const wanted = String(domain).toLowerCase();
    return this.find((o) => o.id !== exceptOrgId && o.emailDomain && String(o.emailDomain.domain).toLowerCase() === wanted);
  }

  /** Delete every row the workspace owns: each org-scoped table, then its queued jobs. */
  async purgeWorkspaceData(orgId: string) {
    const tables = new Set(
      Object.values(TABLES).filter((m: any) => m.tenant || (m.cols || []).includes("orgId")).map((m: any) => m.table)
    );
    for (const t of tables) await dbAny.deleteFrom(t).where("org_id", "=", orgId).execute(); // dynamic table name
    await db.deleteFrom("jobs").where("org_id", "=", orgId).execute().catch(() => {});
  }

  /** Delete the organization row itself (after its data is gone). */
  async deleteWorkspaceRow(orgId: string) {
    await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  }
}
