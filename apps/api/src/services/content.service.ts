/** Company content: the leave calendar (holidays), policies, benefits and the starter packs. */
import type { RequestContext } from "../core/context";
import { bad, notFound } from "../core/util";
import {
  INDIAN_STATES,
  generateHolidays,
  stateName,
  yearsWithVariableData,
} from "../domain/holidays";
import {
  PACKS,
  planStarterContent,
  applyStarterContent,
  normaliseOptions,
  curatedCoverage,
  curatedYears,
} from "../domain/starter-content";

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** The natural key a holiday is de-duplicated on: same date, same name (case-insensitive). */
const holidayKey = (h) => `${h.date}|${String(h.name).toLowerCase()}`;

/** A calendar year and an optional Indian state code, validated. */
function calendarTarget(rawYear: unknown, rawState: unknown) {
  const year = Number(rawYear) || new Date().getUTCFullYear();
  if (year < 2000 || year > 2100) throw bad("Year must be between 2000 and 2100");
  const state = rawState ? String(rawState).toUpperCase() : null;
  if (state && !INDIAN_STATES.some((s) => s.code === state)) throw bad(`Unknown state code "${state}"`);
  return { year, state };
}

// ── Holidays (leave calendar) ──────────────────────────────────────────────
export async function listHolidays(ctx: RequestContext, year?: unknown) {
  return ctx.data.holidays.chronological(year ? String(year) : undefined);
}

/** The state list for the calendar picker. */
export function holidayStates() {
  return { states: INDIAN_STATES, yearsWithFestivalDates: yearsWithVariableData() };
}

/**
 * Generates the calendar without saving it, so HR can review before importing.
 * `missingVariable` names the lunar festivals we hold no date for that year:
 * inventing a Diwali date would be worse than admitting we don't have one.
 */
export async function previewHolidays(ctx: RequestContext, q: { year?: unknown; state?: unknown; includeRestricted?: unknown }) {
  const { year, state } = calendarTarget(q.year, q.state);

  const result = generateHolidays(year, state, {
    includeRestricted: q.includeRestricted !== "false",
  });

  // Flag which ones the org already has, so importing twice is visibly a no-op.
  const existing = new Set((await ctx.data.holidays.all()).map(holidayKey));
  return {
    year,
    state,
    stateName: stateName(state),
    ...result,
    holidays: result.holidays.map((h) => ({
      ...h,
      alreadyAdded: existing.has(`${h.date}|${h.name.toLowerCase()}`),
    })),
  };
}

/**
 * Adds the generated calendar, skipping any that already exist.
 * Body: { year, state, includeRestricted?, replaceYear? }
 */
export async function importHolidays(ctx: RequestContext, input: Record<string, any>) {
  const { year, state } = calendarTarget(input.year, input.state);

  const { holidays, missingVariable, hasVariableData } = generateHolidays(year, state, {
    includeRestricted: input.includeRestricted !== false,
  });
  if (!holidays.length) throw bad("Nothing to import for that year and state");

  const current = await ctx.data.holidays.all();

  // Replacing a year is explicit: it removes what's there first, so a
  // corrected calendar doesn't end up merged with the wrong one.
  let removed = 0;
  if (input.replaceYear === true) {
    for (const h of current.filter((x) => String(x.date).startsWith(`${year}-`))) {
      await ctx.data.holidays.remove(h.id);
      removed++;
    }
  }

  const existing = new Set((input.replaceYear === true ? [] : current).map(holidayKey));

  let added = 0;
  let skipped = 0;
  for (const h of holidays) {
    if (existing.has(`${h.date}|${h.name.toLowerCase()}`)) { skipped++; continue; }
    await ctx.data.holidays.create({
      date: h.date,
      name: h.name,
      type: h.type,
      region: h.region,
      variable: h.variable,
      note: h.note || "",
    });
    added++;
  }

  await ctx.data.auditLog.create({
    action: "HOLIDAY_IMPORT",
    userId: ctx.user.id,
    meta: { year, state, added, skipped, removed },
  });

  return { year, state, added, skipped, removed, missingVariable, hasVariableData };
}

export async function createHoliday(ctx: RequestContext, input: { date?: string; name?: string; type?: string; region?: string }) {
  const { date, name, type, region } = input;
  if (!date || !name) throw bad("date and name are required");
  return ctx.data.holidays.create({ date, name, type: type || "PUBLIC", region: region || "" });
}

export async function updateHoliday(ctx: RequestContext, id: string, input: Record<string, any>) {
  const h = await ctx.data.holidays.byId(id);
  if (!h) throw notFound("Holiday not found");
  return ctx.data.holidays.update(h.id, pick(input, ["date", "name", "type", "region"]));
}

export async function deleteHoliday(ctx: RequestContext, id: string) {
  const h = await ctx.data.holidays.byId(id);
  if (!h) throw notFound("Holiday not found");
  await ctx.data.holidays.remove(h.id);
  return { ok: true };
}

// ── Policies ───────────────────────────────────────────────────────────────
export async function listPolicies(ctx: RequestContext) {
  return ctx.data.policies.inOrder();
}

export async function getPolicy(ctx: RequestContext, id: string) {
  const p = await ctx.data.policies.byId(id);
  if (!p) throw notFound("Policy not found");
  return p;
}

export async function createPolicy(ctx: RequestContext, input: Record<string, any>) {
  const { title, category, content } = input;
  if (!title || !content) throw bad("title and content are required");
  return ctx.data.policies.create({ title, category: category || "GENERAL", content, version: input.version || "1.0", order: await ctx.data.policies.count(), publishedAt: new Date().toISOString() });
}

export async function updatePolicy(ctx: RequestContext, id: string, input: Record<string, any>) {
  const p = await ctx.data.policies.byId(id);
  if (!p) throw notFound("Policy not found");
  return ctx.data.policies.update(p.id, pick(input, ["title", "category", "content", "version"]));
}

export async function deletePolicy(ctx: RequestContext, id: string) {
  const p = await ctx.data.policies.byId(id);
  if (!p) throw notFound("Policy not found");
  await ctx.data.policies.remove(p.id);
  return { ok: true };
}

// ── Benefits ───────────────────────────────────────────────────────────────
export async function listBenefits(ctx: RequestContext) {
  return ctx.data.benefits.inOrder();
}

export async function createBenefit(ctx: RequestContext, input: Record<string, any>) {
  const { title, category, description } = input;
  if (!title) throw bad("title is required");
  return ctx.data.benefits.create({ title, category: category || "GENERAL", description: description || "", order: await ctx.data.benefits.count() });
}

export async function updateBenefit(ctx: RequestContext, id: string, input: Record<string, any>) {
  const b = await ctx.data.benefits.byId(id);
  if (!b) throw notFound("Benefit not found");
  return ctx.data.benefits.update(b.id, pick(input, ["title", "category", "description"]));
}

export async function deleteBenefit(ctx: RequestContext, id: string) {
  const b = await ctx.data.benefits.byId(id);
  if (!b) throw notFound("Benefit not found");
  await ctx.data.benefits.remove(b.id);
  return { ok: true };
}

// ── Starter content ────────────────────────────────────────────────────────
// Lets a tenant load the cross-company defaults (leave types, holidays,
// policies, benefits, departments) at any point, not only at signup. Tenants
// created by a path that skipped provisioning would otherwise stay empty
// forever, since nothing backfills them on boot.

/**
 * The pack catalogue plus a dry-run count of what would be added,
 * so the UI can say "adds 12 departments, 0 policies" before anything is written.
 */
export async function starterCatalogue(ctx: RequestContext, q: { year?: unknown; state?: unknown; includeRestricted?: unknown }) {
  const opts = normaliseOptions(
    {
      year: q.year ? Number(q.year) : undefined,
      state: q.state ? String(q.state) : null,
      includeRestricted: q.includeRestricted !== "false",
    },
    bad
  );
  return {
    // `opts` is spread FIRST on purpose. normaliseOptions returns its own `packs`, the
    // normalised SELECTION as bare id strings, which used to be spread over the catalogue
    // below and win. The client then received `packs: ["LEAVE_TYPES", ...]` where it
    // expected `{ id, label, description }` objects, so every `p.id` was undefined: the
    // pack list rendered with blank labels and duplicate (undefined) React keys.
    ...opts,
    // The catalogue the picker renders. Must come after the spread.
    packs: PACKS,
    // The normalised selection, under a name that cannot collide with the catalogue.
    selectedPacks: opts.packs,
    states: INDIAN_STATES,
    // Only years we hold a verified gazette for may be offered.
    verifiedYears: curatedYears(),
    curatedCoverage: curatedCoverage(),
    stateName: stateName(opts.state),
    plan: await planStarterContent(ctx.repos, opts),
  };
}

/**
 * Body: { packs?: PackId[], year?, state?, includeRestricted? }
 * Idempotent, existing rows are matched on their natural key, never duplicated.
 */
export async function applyStarter(ctx: RequestContext, input: Record<string, any>) {
  const opts = normaliseOptions(input, bad);
  const results = await applyStarterContent(ctx.repos, opts);
  const added = results.reduce((n, r) => n + r.added, 0);

  await ctx.data.auditLog.create({
    action: "STARTER_CONTENT_APPLIED",
    userId: ctx.user.id,
    meta: { packs: opts.packs, year: opts.year, state: opts.state, added },
  });

  return { ...opts, added, results };
}
