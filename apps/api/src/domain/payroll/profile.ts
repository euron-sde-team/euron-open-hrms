/**
 * Per-org payroll profile resolution + seeding.
 *
 * An org's *effective* ruleset is its seeded `payroll_profiles` row, which is
 * initialised from the code-defined country pack and then editable by HR. This
 * module owns the read-or-seed and the override-merge so routes don't repeat it.
 */

import { round2 } from '../../core/util';
import {
  DEFAULT_COUNTRY,
  getRuleset,
  normalizeCountry,
} from './countries';
import type { CountryRuleset, PayComponent, SalaryStructure } from './types';
import { INDIA_DEFAULT_STRUCTURE } from './structure';

/** The country/currency/locale an org runs payroll under (org.data.payroll). */
export function orgPayrollSettings(org: any): {
  country: string;
  currency: string;
  locale: string;
  ctcIncludesEmployerContributions: boolean;
} {
  const p = (org && org.payroll) || {};
  const country = normalizeCountry(p.country || org?.country || DEFAULT_COUNTRY);
  const pack = getRuleset(country);
  return {
    country: pack.country,
    currency: p.currency || pack.currency,
    locale: p.locale || pack.locale,
    /*
     * Whether a quoted CTC already contains the employer's own contributions.
     *
     * Defaults to FALSE, which is what every existing breakup on record was
     * computed under. Flipping the default would silently re-interpret every
     * salary already agreed, so an organisation that quotes CTC the other way
     * opts in and the change applies from the next time a CTC is entered.
     */
    ctcIncludesEmployerContributions: p.ctcIncludesEmployerContributions === true,
  };
}

/**
 * Merge an org's stored component overrides over the canonical pack. Overrides
 * are keyed by component `key`; only known fields (rate/cap/enabled/slabs/
 * floorThreshold/ceilingThreshold/label) are applied, so a stored override can
 * never inject a new component or change a component's type/side.
 */
function mergeComponents(
  packComponents: PayComponent[],
  overrides: PayComponent[] = [],
): PayComponent[] {
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  return packComponents.map((base) => {
    const o = byKey.get(base.key);
    if (!o) return base;
    const merged: PayComponent = { ...base };
    for (const f of ['rate', 'cap', 'floorThreshold', 'ceilingThreshold', 'enabled', 'label'] as const) {
      if (o[f] !== undefined) (merged as any)[f] = o[f];
    }
    if (Array.isArray(o.slabs)) merged.slabs = o.slabs;
    return merged;
  });
}

/**
 * Resolve an org's effective ruleset, seeding the profile row on first use.
 * Returns a `CountryRuleset` ready for the engine.
 */
export async function resolveRuleset(
  repos: any,
  org: any,
): Promise<CountryRuleset> {
  const { country, currency, locale } = orgPayrollSettings(org);
  const pack = getRuleset(country);

  let profile = await repos.payrollProfiles.findOne(
    (p: any) => p.country === country,
  );

  // Seed idempotently from the code pack on first use.
  if (!profile) {
    profile = await repos.payrollProfiles.insert({
      country,
      currency,
      locale,
      version: pack.version || 1,
      components: pack.components, // canonical defaults; HR can edit later
    });
  }

  // Effective ruleset = pack defaults with org overrides applied. We always
  // start from the current pack components (so newly-added statutory items show
  // up) and layer the stored row's per-component overrides on top.
  const components = mergeComponents(
    pack.components,
    Array.isArray(profile.components) ? profile.components : [],
  );

  return {
    country: pack.country,
    label: pack.label,
    currency: profile.currency || currency,
    locale: profile.locale || locale,
    version: profile.version || pack.version || 1,
    components,
  };
}

/**
 * Apply an HR edit to an org's profile. `componentEdits` is a sparse list of
 * { key, rate?, cap?, floorThreshold?, ceilingThreshold?, enabled?, label?,
 * slabs? } overrides.
 * Returns the updated effective ruleset.
 */
export async function updateProfile(
  repos: any,
  org: any,
  body: any,
): Promise<CountryRuleset> {
  const { country } = orgPayrollSettings(org);
  const pack = getRuleset(country);
  let profile = await repos.payrollProfiles.findOne(
    (p: any) => p.country === country,
  );
  if (!profile) {
    profile = await repos.payrollProfiles.insert({
      country,
      currency: orgPayrollSettings(org).currency,
      locale: orgPayrollSettings(org).locale,
      version: pack.version || 1,
      components: pack.components,
    });
  }

  const patch: any = {};
  if (body.currency) patch.currency = String(body.currency);
  if (body.locale) patch.locale = String(body.locale);
  if (Array.isArray(body.components)) {
    // Keep only overrides for components that exist in the pack, sanitising
    // numeric fields. We store the sparse override list, not the full pack.
    const valid = new Set(pack.components.map((c) => c.key));
    patch.components = body.components
      .filter((c: any) => c && valid.has(c.key))
      .map((c: any) => {
        const o: any = { key: c.key };
        if (c.rate !== undefined) o.rate = round2(c.rate);
        if (c.cap !== undefined) o.cap = c.cap === null ? null : round2(c.cap);
        if (c.floorThreshold !== undefined)
          o.floorThreshold = c.floorThreshold === null ? null : round2(c.floorThreshold);
        // A null clears the eligibility ceiling (everyone is in the scheme).
        if (c.ceilingThreshold !== undefined)
          o.ceilingThreshold = c.ceilingThreshold === null ? null : round2(c.ceilingThreshold);
        if (c.enabled !== undefined) o.enabled = !!c.enabled;
        if (c.label !== undefined) o.label = String(c.label).slice(0, 80);
        if (Array.isArray(c.slabs)) o.slabs = c.slabs;
        return o;
      });
  }
  await repos.payrollProfiles.update(profile.id, patch);
  return resolveRuleset(repos, org);
}

/* ── Salary structures ─────────────────────────────────────────────────────── */

/**
 * An org's salary structures, seeded on first use.
 *
 * Stored on the same `payroll_profiles` row as the component overrides, for the
 * same reason: it is per-org payroll configuration, it is country-shaped, and it
 * needs no schema change to live there. Read-or-seed mirrors resolveRuleset().
 */
export async function listStructures(repos: any, org: any): Promise<SalaryStructure[]> {
  const { country } = orgPayrollSettings(org);
  const profile = await repos.payrollProfiles.findOne((p: any) => p.country === country);
  const stored = Array.isArray(profile?.salaryStructures) ? profile.salaryStructures : [];
  if (stored.length) return stored;

  // Only India ships a default breakup; elsewhere a single base salary is the
  // norm and inventing an HRA split would be wrong.
  const seeded = country === "IN" ? [INDIA_DEFAULT_STRUCTURE] : [];
  if (seeded.length && profile) {
    await repos.payrollProfiles.update(profile.id, { salaryStructures: seeded });
  }
  return seeded;
}

/** The structure to use when the caller did not name one. */
export async function defaultStructure(repos: any, org: any): Promise<SalaryStructure | null> {
  const all = await listStructures(repos, org);
  return all.find((x) => x.isDefault) || all[0] || null;
}

export async function structureById(repos: any, org: any, id?: string | null): Promise<SalaryStructure | null> {
  if (!id) return defaultStructure(repos, org);
  const all = await listStructures(repos, org);
  return all.find((x) => x.id === id) || (await defaultStructure(repos, org));
}

/** Replace the org's structures. Validated by the caller's route. */
export async function saveStructures(repos: any, org: any, structures: SalaryStructure[]) {
  const { country, currency, locale } = orgPayrollSettings(org);
  const pack = getRuleset(country);
  let profile = await repos.payrollProfiles.findOne((p: any) => p.country === country);
  if (!profile) {
    profile = await repos.payrollProfiles.insert({
      country, currency, locale, version: pack.version || 1, components: pack.components,
    });
  }
  const updated = await repos.payrollProfiles.update(profile.id, { salaryStructures: structures });
  return Array.isArray(updated.salaryStructures) ? updated.salaryStructures : [];
}
