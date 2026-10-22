/**
 * Starter content library, the configuration every HR tenant needs on day one.
 *
 * A new company should not have to type out a leave policy, an Indian holiday
 * calendar and a department list before the product does anything useful. These
 * packs are the parts that genuinely generalise across companies; anything
 * employee-specific (leave balances, payroll profiles, wellbeing check-ins) is
 * deliberately absent, because it cannot be known ahead of a real headcount.
 *
 * Two callers, one code path:
 *   - provisionOrgDefaults() runs this at tenant creation (signup + operator).
 *   - The /starter-content endpoints run it later, to fill in a tenant that was
 *     created by a path which bypassed provisioning (seed-prod-min.ts does
 *     exactly that, which is why production tenants can be empty).
 *
 * Every pack is idempotent and matched on a natural key, so applying twice adds
 * nothing the second time and a partially-configured tenant is safe to top up.
 */
import { LEAVE_CATALOGUE } from "./leave-policy";
import { POLICIES, BENEFITS } from "../demo/seed-content";
import { INDIAN_STATES, stateName } from "./holidays";
import { curatedHolidays, curatedCoverage, curatedYears } from "./curated-holidays";
import { PRESETS } from "./onboarding-presets";

/**
 * Functions common to essentially every company, in the order they usually
 * appear on an org chart. Intentionally generic: a tenant renames or deletes
 * what does not apply, which is far less work than inventing the list.
 */
export const DEPARTMENTS = [
  "Engineering",
  "Product",
  "Design",
  "Human Resources",
  "Finance & Accounts",
  "Sales",
  "Marketing",
  "Customer Support",
  "Operations",
  "Legal & Compliance",
  "IT & Infrastructure",
  "Administration",
];

export type PackId =
  | "LEAVE_TYPES"
  | "HOLIDAYS"
  | "POLICIES"
  | "BENEFITS"
  | "DEPARTMENTS"
  | "ONBOARDING_TEMPLATE";

export interface PackMeta {
  id: PackId;
  label: string;
  description: string;
  /** Packs the caller must supply options for (holidays needs year + state). */
  needsOptions?: boolean;
}

export const PACKS: PackMeta[] = [
  {
    id: "LEAVE_TYPES",
    label: "Leave types",
    description:
      "The nine standard Indian leave types, including the statutory Maternity (182 days) and Paternity entitlements.",
  },
  {
    id: "HOLIDAYS",
    label: "Holiday calendar",
    description:
      "Public and restricted holidays transcribed from official gazette notifications. Only years and states we hold a verified gazette for are offered, nothing is computed.",
    needsOptions: true,
  },
  {
    id: "POLICIES",
    label: "Company policies",
    description:
      "Ten starter policy documents (Leave, POSH, Code of Conduct, WFH, IT, Reimbursement, Probation, Separation, Data Security, Equal Opportunity).",
  },
  {
    id: "BENEFITS",
    label: "Benefits",
    description: "Nine commonly offered benefits, to populate the employee benefits page.",
  },
  {
    id: "DEPARTMENTS",
    label: "Departments",
    description: "Twelve common departments, so employees can be assigned an org structure immediately.",
  },
  {
    id: "ONBOARDING_TEMPLATE",
    label: "Onboarding forms",
    description:
      "Two ready-to-send joining forms: the full India-standard pack (KYC, salary account, PF and ESIC, education, previous employment, nominations, assets, policy acceptance) and a shorter one for interns, freelancers and contractors. Both are editable in the form builder.",
  },
];

export const PACK_IDS = PACKS.map((p) => p.id);

export interface StarterOptions {
  packs?: PackId[];
  /** Holiday calendar year. Defaults to the current year. */
  year?: number;
  /** ISO state code from INDIAN_STATES, e.g. "KA". Null = nationwide only. */
  state?: string | null;
  includeRestricted?: boolean;
}

export interface PackResult {
  pack: PackId;
  added: number;
  skipped: number;
  /** Rows that already existed and were refreshed from the source (holidays only). */
  updated?: number;
  /** HOLIDAYS only: which gazette the rows were transcribed from. */
  sourceLabel?: string;
  sourceCitation?: string;
  /** HOLIDAYS only: true when the national gazette stood in for a missing state one. */
  national?: boolean;
  /** Set when a pack cannot be offered at all, with the reason to show the user. */
  unavailable?: string;
  note?: string;
}

/** Natural key for an already-stored row, per pack. Lowercased for stable matching. */
const existingKey = (pack: PackId, row: any): string => {
  switch (pack) {
    case "HOLIDAYS":
      return `${row.date}|${String(row.name ?? "").toLowerCase()}`;
    case "LEAVE_TYPES":
      return String(row.name ?? "").toLowerCase();
    case "POLICIES":
    case "BENEFITS":
      return String(row.title ?? "").toLowerCase();
    case "DEPARTMENTS":
      return String(row.name ?? "").toLowerCase();
    // Keyed on the preset, not the name: a tenant who renamed "India, standard joining
    // form" to "Joining form" still has that preset and must not receive a second copy.
    case "ONBOARDING_TEMPLATE":
      return String(row.presetKey ?? row.name ?? "").toLowerCase();
  }
};

/**
 * What to do when a starter item's natural key is already present on the tenant.
 *
 * The answer differs by what the row *is*, not by a single global preference:
 *
 *  - Leave types, policies, benefits and departments are the tenant's own. HR
 *    edits Casual Leave down to 10 days, rewrites the POSH policy for their
 *    company, renames a department. Re-running the loader must never undo that,
 *    so these skip. The cost is that a catalogue improvement does not reach an
 *    existing tenant, acceptable, because these are starting points, not truth.
 *
 *  - Holidays are transcribed facts from a gazette, and their natural key is
 *    `date|name`. A tenant who renamed or moved a holiday has produced a
 *    different key, so it is added rather than matched and their edit survives
 *    untouched. A match therefore means same date, same name, differing only in
 *    type/region/note, i.e. we corrected our transcription. That correction
 *    should land, so these update.
 *
 * Flip a pack here if the product decision changes; nothing else needs editing.
 */
const CONFLICT_POLICY: Record<PackId, "skip" | "update"> = {
  LEAVE_TYPES: "skip",
  POLICIES: "skip",
  BENEFITS: "skip",
  DEPARTMENTS: "skip",
  HOLIDAYS: "update",
  // Skip, for the same reason as policies, and more sharply. An onboarding form is edited
  // heavily once a tenant is running: fields removed, sections marked optional, custom
  // questions added. Re-running the loader must never silently restore our version of a
  // form the tenant has already sent to people, and updating one mid-campaign would
  // disagree with the snapshots taken on every open case.
  ONBOARDING_TEMPLATE: "skip",
};

export function resolveConflict(
  pack: PackId,
  _existing: Record<string, unknown>,
  _incoming: Record<string, unknown>
): "skip" | "update" {
  return CONFLICT_POLICY[pack];
}

/** Rows a pack wants to create, as flat records ready for the repo layer. */
function packItems(pack: PackId, opts: StarterOptions) {
  switch (pack) {
    case "LEAVE_TYPES":
      return {
        items: LEAVE_CATALOGUE.map((t) => ({
          name: t.name,
          maxPerYear: t.maxPerYear,
          paid: t.paid,
          carryForwardCap: t.carryForwardCap,
          encashable: t.encashable,
          accrualMonthly: t.accrualMonthly,
          description: t.description,
        })),
      };

    case "POLICIES":
      return {
        items: POLICIES.map(([title, category, content], i) => ({
          title,
          category,
          content,
          version: "1.0",
          order: i,
          publishedAt: new Date().toISOString(),
        })),
      };

    case "BENEFITS":
      return {
        items: BENEFITS.map(([title, category, description], i) => ({
          title,
          category,
          description,
          order: i,
        })),
      };

    case "DEPARTMENTS":
      return { items: DEPARTMENTS.map((name) => ({ name })) };

    case "ONBOARDING_TEMPLATE":
      // Seeded ACTIVE rather than DRAFT: a form nobody has published is a form HR discovers
      // is missing at the moment they try to send it. They are editable either way.
      return { items: PRESETS.map((p) => ({ status: "ACTIVE", ...p })) };

    case "HOLIDAYS": {
      const year = opts.year || new Date().getUTCFullYear();
      const state = opts.state ? String(opts.state).toUpperCase() : null;

      // Verified gazette data only. There is deliberately no computed fallback:
      // a constructed calendar cannot be told apart from a correct one once it
      // is sitting in a tenant's holiday list, and a wrong public holiday is a
      // payroll error. No source, no pack.
      const curated = curatedHolidays(year, state);
      if (!curated) {
        return {
          items: [],
          unavailable: `No verified holiday calendar for ${year}. Holidays are transcribed from official gazette notifications, and none is published for that year yet.`,
        };
      }

      const items = curated.holidays
        .filter((h) => opts.includeRestricted !== false || h.type !== "RESTRICTED")
        .map((h) => ({
          date: h.date,
          name: h.name,
          type: h.type,
          region: h.region,
          variable: false,
          note: h.note || "",
        }));

      return {
        items,
        sourceLabel: curated.label,
        sourceCitation: curated.source,
        /** True when we fell back to the national gazette for lack of a state one. */
        national: curated.state === null && state !== null,
      };
    }
  }
}

/** Repo collection backing each pack. */
const collection = (pack: PackId) =>
  ({
    LEAVE_TYPES: "leaveTypes",
    HOLIDAYS: "holidays",
    POLICIES: "policies",
    BENEFITS: "benefits",
    DEPARTMENTS: "departments",
    ONBOARDING_TEMPLATE: "onboardingTemplates",
  }[pack]);

/** Validate + normalise caller options, throwing the same way routes expect. */
export function normaliseOptions(opts: StarterOptions, bad: (m: string) => Error): Required<StarterOptions> {
  const packs = (opts.packs?.length ? opts.packs : PACK_IDS) as PackId[];
  for (const p of packs) if (!PACK_IDS.includes(p)) throw bad(`Unknown pack "${p}"`);

  const year = Number(opts.year) || new Date().getUTCFullYear();
  if (year < 2000 || year > 2100) throw bad("Year must be between 2000 and 2100");

  const state = opts.state ? String(opts.state).toUpperCase() : null;
  if (state && !INDIAN_STATES.some((s) => s.code === state)) throw bad(`Unknown state code "${state}"`);

  return { packs, year, state, includeRestricted: opts.includeRestricted !== false };
}

/**
 * Report what applying these packs would do, without writing anything, so the
 * UI can show "adds 12 departments, 0 policies (already present)" before the
 * tenant commits to it.
 */
export async function planStarterContent(repos: any, opts: StarterOptions): Promise<PackResult[]> {
  const out: PackResult[] = [];
  for (const pack of (opts.packs || PACK_IDS) as PackId[]) {
    const { items, sourceLabel, sourceCitation, national, unavailable } = packItems(pack, opts) as any;
    const current = await repos[collection(pack)].all();
    const existing = new Set(current.map((r: any) => existingKey(pack, r)));

    let added = 0;
    let skipped = 0;
    for (const item of items) {
      if (existing.has(existingKey(pack, item))) skipped++;
      else added++;
    }
    out.push({ pack, added, skipped, sourceLabel, sourceCitation, national, unavailable });
  }
  return out;
}

/**
 * Apply the packs. Safe to call repeatedly: existing rows are matched on their
 * natural key and handed to resolveConflict() rather than blindly duplicated.
 */
export async function applyStarterContent(repos: any, opts: StarterOptions): Promise<PackResult[]> {
  const out: PackResult[] = [];

  for (const pack of (opts.packs || PACK_IDS) as PackId[]) {
    const { items, sourceLabel, sourceCitation, national, unavailable } = packItems(pack, opts) as any;
    const repo = repos[collection(pack)];
    const current = await repo.all();
    const byKey = new Map<string, any>(current.map((r: any) => [existingKey(pack, r), r]));

    let added = 0;
    let skipped = 0;
    let updated = 0;
    for (const item of items) {
      const hit = byKey.get(existingKey(pack, item));
      if (!hit) {
        await repo.insert(item);
        added++;
        continue;
      }
      // An update is not a skip, reporting a corrected holiday as "skipped"
      // would hide the one case where re-running actually changes a tenant's data.
      if (resolveConflict(pack, hit, item) === "update") {
        await repo.update(hit.id, item);
        updated++;
      } else {
        skipped++;
      }
    }

    out.push({ pack, added, skipped, updated, sourceLabel, sourceCitation, national, unavailable });
  }

  return out;
}

export { stateName, INDIAN_STATES, curatedCoverage, curatedYears };
