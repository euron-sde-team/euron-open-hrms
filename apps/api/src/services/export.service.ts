/**
 * Tenant data export, a full JSON snapshot of one organization's data.
 * Used by tenant admins (their own org) and platform operators (any org).
 *
 * Every tenant-scoped collection is dumped through an org-scoped repo, so the
 * bundle can never include another tenant's rows. Global SaaS tables
 * (auth_tokens, platform_admins) are deliberately excluded, and per-user
 * credential fields are stripped.
 */
import { repos, systemRepos, TABLES } from "../repositories/base.repository";
import { PRODUCT_ID } from "../core/product";

// Global tables that must never appear in a per-tenant export.
const SKIP = new Set(["organizations", "authTokens", "platformAdmins"]);
// Credential / security fields stripped from exported user rows.
const REDACT_USER = ["passwordHash", "mfaSecret", "mfaPending", "failedLogins", "lockedUntil"];

/** Build a portable JSON snapshot of one org's data. */
async function exportOrg(orgId) {
  const org = await systemRepos().organizations.byId(orgId);
  if (!org) return null;
  const r = repos({ orgId });

  const collections: any = {};
  for (const [name, meta] of Object.entries(TABLES) as [string, any][]) {
    if (!meta.tenant || SKIP.has(name)) continue;
    let rows = await r[name].all();
    if (name === "users") rows = rows.map((u) => { const c = { ...u }; for (const k of REDACT_USER) delete c[k]; return c; });
    collections[name] = rows;
  }

  const counts = Object.fromEntries(Object.entries(collections).map(([k, v]: [string, any]) => [k, v.length]));
  return {
    meta: { format: `${PRODUCT_ID}-export`, version: 1, exportedAt: new Date().toISOString(), orgId, counts },
    organization: org,
    collections,
  };
}

/** Suggested download filename for an org's export. */
const exportFilename = (org) => `${(org && org.slug) || "org"}-export-${new Date().toISOString().slice(0, 10)}.json`;

export { exportOrg, exportFilename };
