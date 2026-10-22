/**
 * The org's payroll rules: the country pack (and its currency/locale), per-component
 * overrides, the CTC convention, the professional-tax state, plus the statutory
 * gratuity calculator.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden } from "../core/util";
import { resolveRuleset, updateProfile, orgPayrollSettings } from "../domain/payroll/profile";
import { PT_SCHEDULES, ptSchedule, ptComponentFor } from "../domain/payroll/professional-tax";
import { computeGratuity } from "../domain/payroll/gratuity";
import { listCountries, getRuleset, normalizeCountry, isSupportedCountry } from "../domain/payroll/countries";
import { currentOrg } from "./payroll.service";

/** Country packs available for the settings UI. */
export function payrollCountries() {
  return listCountries();
}

/**
 * PREVIEW a country's statutory ruleset without saving it. Lets the settings dialog
 * show the picked country's actual components (e.g. a no-pack country's generic
 * Social Security / Income Tax) instead of the currently-saved org ruleset.
 * Returns the base pack, not org overrides.
 */
export function previewRuleset(country: string) {
  return { ruleset: getRuleset(country) };
}

/** The org's effective statutory ruleset (seed-on-read). */
export async function payrollProfile(ctx: RequestContext) {
  const org = await currentOrg(ctx);
  const ruleset = await resolveRuleset(ctx.repos, org);
  return { settings: orgPayrollSettings(org), ruleset };
}

/**
 * Save the org's payroll rules in ONE call: optionally switch the country
 * (currency/locale follow), plus the per-component overrides (rate / cap /
 * threshold / enabled / label / slabs). Persisting the country here (not on a
 * separate "apply") makes Save the single commit point, so picking a country only
 * previews until the user saves.
 */
export async function updatePayrollProfile(ctx: RequestContext, body: Record<string, any>) {
  let org = await currentOrg(ctx);
  // Optional country switch, write org.payroll first so updateProfile resolves
  // overrides against the NEW country's pack.
  if (body.country) {
    const code = normalizeCountry(body.country);
    if (!isSupportedCountry(code)) throw bad("Unsupported payroll country");
    const pack = getRuleset(code);
    const payroll = { ...(org.payroll || {}), country: code, currency: body.currency || pack.currency, locale: body.locale || pack.locale };
    await ctx.data.organizations.update(org.id, { payroll });
    org = await currentOrg(ctx);
  }
  // How this organisation quotes CTC. Stored beside the country because it is the
  // same kind of fact: a convention every CTC on the system is read under.
  if (body.ctcIncludesEmployerContributions !== undefined) {
    await ctx.data.organizations.update(org.id, {
      payroll: { ...(org.payroll || {}), ctcIncludesEmployerContributions: body.ctcIncludesEmployerContributions === true },
    });
    org = await currentOrg(ctx);
    await ctx.data.auditLog.create({
      action: "PAYROLL_CTC_CONVENTION_SET",
      userId: ctx.user.id,
      meta: { includesEmployerContributions: body.ctcIncludesEmployerContributions === true },
    });
  }
  const ruleset = await updateProfile(ctx.repos, org, body);
  return { settings: orgPayrollSettings(org), ruleset };
}

/**
 * The PT schedule catalogue.
 *
 * Professional tax is levied per state, and several states levy none at all,
 * so the org has to pick one. Returned with the "no PT" states included and
 * flagged, because "Delhi levies none" is an answer HR needs to see, not an
 * absence from a list.
 */
export async function professionalTaxStates(ctx: RequestContext) {
  const org = await currentOrg(ctx);
  const current = (org.payroll || {}).ptState || null;
  return {
    current,
    currentSchedule: ptSchedule(current) ?? null,
    schedules: PT_SCHEDULES.map((s) => ({
      state: s.state,
      name: s.name,
      levies: !s.none,
      slabs: s.slabs ?? [],
      note: s.verifyNote,
    })),
  };
}

/** Set the org's PT state and rewrite the professional_tax component to that state's schedule. */
export async function setProfessionalTaxState(ctx: RequestContext, rawState: unknown) {
  const state = rawState ? String(rawState).toUpperCase() : null;
  if (state && !ptSchedule(state)) throw bad(`No professional tax schedule for "${state}"`);

  let org = await currentOrg(ctx);
  await ctx.data.organizations.update(org.id, {
    payroll: { ...(org.payroll || {}), ptState: state },
  });
  org = await currentOrg(ctx);

  // Push the state's slabs into the org's overrides so the engine picks them
  // up like any other configured component.
  //
  // updateProfile takes `components` as an ARRAY of sparse overrides keyed by
  // `key`, and silently drops anything it doesn't recognise, passing an
  // object here looks like it works and changes nothing. It also ignores
  // `note`, so the schedule's caveat is returned to the caller separately
  // rather than pretended into the stored profile.
  const component = ptComponentFor(state);
  const ruleset = await updateProfile(ctx.repos, org, {
    components: [{ key: "professional_tax", slabs: component.slabs, enabled: component.enabled }],
  });

  await ctx.data.auditLog.create({ action: "PT_STATE_SET", userId: ctx.user.id, meta: { state } });
  return { state, schedule: ptSchedule(state) ?? null, ruleset };
}

/**
 * Statutory gratuity for one employee. Returns the ineligibility reason too, so
 * "not yet five years" is distinguishable from "not computed".
 */
export async function gratuityFor(ctx: RequestContext, employeeId: string, query: { lastWorkingDay?: unknown; reason?: unknown }) {
  const emp = await ctx.data.employees.byId(employeeId);
  if (!emp) throw notFound("Employee not found");
  if (!ctx.inScope(emp)) throw forbidden("Outside your assigned scope");
  const salary = emp.salary || {};
  return computeGratuity({
    basic: Number(salary.basic || 0),
    da: Number(salary.da || 0),
    joiningDate: emp.joiningDate,
    lastWorkingDay: String(query.lastWorkingDay || new Date().toISOString().slice(0, 10)),
    employmentType: emp.employmentType,
    reason: query.reason ? String(query.reason) : undefined,
  });
}
