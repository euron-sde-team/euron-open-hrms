/**
 * Default content provisioned for a brand-new tenant (self-signup or admin-created).
 *
 * The catalogue itself lives in ./starter-content, so that the same packs a new
 * tenant receives here can also be applied later to a tenant which was created
 * by a path that skipped provisioning. Deliberately NO demo employees / vendors
 * / activity (unlike the dev seed).
 */
import { repos } from "../repositories/base.repository";
import { applyStarterContent, PACK_IDS, DEPARTMENTS } from "../domain/starter-content";
import { LEAVE_CATALOGUE } from "../domain/leave-policy";

/** Kept for callers that want the shape of a new tenant's leave setup. */
const LEAVE_TYPES = LEAVE_CATALOGUE;

/**
 * @param orgId  tenant to provision
 * @param opts   country (ISO-3166 alpha-2) and, for India, the state whose gazetted
 *               holidays apply. The holiday pack is transcribed from Indian gazette
 *               notifications only, so workspaces elsewhere start with an empty calendar
 *               rather than another country's holidays; without a state an Indian
 *               workspace gets the national list.
 */
async function provisionOrgDefaults(orgId, opts: { country?: string | null; state?: string | null; year?: number } = {}) {
  const r = repos({ orgId });
  const india = String(opts.country || "IN").toUpperCase() === "IN";
  return applyStarterContent(r, {
    packs: india ? PACK_IDS : PACK_IDS.filter((p) => p !== "HOLIDAYS"),
    state: india ? opts.state ?? null : null,
    year: opts.year,
  });
}

/** Make a unique URL-safe slug for a company name, checked against existing orgs. */
async function uniqueSlug(sys, name) {
  const base = String(name || "company")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";
  const existing = new Set((await sys.organizations.all()).map((o) => o.slug));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export { provisionOrgDefaults, uniqueSlug, LEAVE_TYPES, DEPARTMENTS };
