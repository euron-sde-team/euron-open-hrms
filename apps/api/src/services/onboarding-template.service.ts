/**
 * Onboarding form templates: the builder's rules.
 *
 * Every write goes through validateTemplate(), which is also what the presets are checked
 * against in the tests, so a hand-built template and a shipped one are held to one standard.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound } from "../core/util";
import {
  validateTemplate,
  pickTemplate,
  sectionsFor,
  FIELD_TYPES,
  SECTION_KINDS,
  PATTERNS,
  MAPPABLE_PATHS,
  ASSET_CATEGORIES,
} from "../domain/onboarding-template";
import { PRESETS, presetByKey } from "../domain/onboarding-presets";
import { DOC_CATEGORIES } from "../domain/documents";
import { CURRENT_EMPLOYMENT_TYPES } from "../domain/employment";

const STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"];

/** Count what a template asks for, so the list can be scanned without opening each one. */
const summarise = (t: any) => {
  const sections = Array.isArray(t.sections) ? t.sections : [];
  const fields = sections.flatMap((s: any) => s.fields || []);
  return {
    sections: sections.length,
    fields: fields.length,
    documents: sections.flatMap((s: any) => s.documents || []).length,
    /** How many answers actually reach the employee record; the rest stay on the case. */
    mapped: fields.filter((f: any) => f.mapsTo).length,
  };
};

const view = (t: any) => ({ ...t, summary: summarise(t) });

async function templateOr404(ctx: RequestContext, id: string) {
  const t = await ctx.data.onboardingTemplates.byId(id);
  if (!t) throw notFound("Onboarding form not found");
  return t;
}

/**
 * The builder's palette: every section kind, field type, validation format, document
 * category and mappable destination. Served from one endpoint so the UI can never offer a
 * choice the validator will refuse.
 */
export function templateMeta() {
  return {
    sectionKinds: SECTION_KINDS,
    fieldTypes: FIELD_TYPES,
    patterns: Object.entries(PATTERNS).map(([key, p]) => ({ key, ...p })),
    mappablePaths: MAPPABLE_PATHS,
    documentCategories: DOC_CATEGORIES,
    assetCategories: ASSET_CATEGORIES,
    employmentTypes: CURRENT_EMPLOYMENT_TYPES.map((t) => ({ value: t.value, label: t.label })),
    presets: PRESETS.map((p) => ({ presetKey: p.presetKey, name: p.name, description: p.description, ...summarise(p) })),
  };
}

/** Every template, newest first; or only those in one status (stored order). */
export async function listTemplates(ctx: RequestContext, statusFilter?: any) {
  const list = await ctx.data.onboardingTemplates.all();
  if (statusFilter) {
    const status = String(statusFilter).toUpperCase();
    if (!STATUSES.includes(status)) throw bad(`status must be one of: ${STATUSES.join(", ")}`);
    return list.filter((t: any) => t.status === status).map(view);
  }
  list.sort((a: any, b: any) => (a.createdAt < b.createdAt ? 1 : -1));
  return list.map(view);
}

/**
 * Which template a given person would get. Exposed because "why did this joiner receive
 * that form" is otherwise unanswerable without reading the assignment rules by hand, and
 * because the campaign screen previews it before launching to several hundred people.
 */
export async function resolveTemplateFor(ctx: RequestContext, person: { employmentType: string | null; departmentId: string | null }) {
  const templates = await ctx.data.onboardingTemplates.all();
  const picked = pickTemplate(templates, person);
  if (!picked) return { template: null, reason: "This organisation has no active onboarding form." };
  return {
    template: view(picked),
    sections: sectionsFor(picked, person.employmentType).length,
  };
}

export async function getTemplate(ctx: RequestContext, id: string) {
  return view(await templateOr404(ctx, id));
}

/**
 * Body is a template, or { presetKey } to start from a shipped one. Created DRAFT: a form
 * becomes sendable only when somebody activates it, so a half-built one cannot be picked up
 * by a campaign launched in the meantime.
 */
export async function createTemplate(ctx: RequestContext, input: any) {
  const body = input?.presetKey ? presetByKey(String(input.presetKey)) : input;
  if (!body) throw bad(`Unknown preset "${input.presetKey}"`);

  const doc = validateTemplate(input?.presetKey ? { ...body, name: input.name || body.name } : body);
  const created = await ctx.data.onboardingTemplates.create({
    ...doc,
    status: "DRAFT",
    version: 1,
    createdBy: ctx.user.id,
  });
  await ctx.data.auditLog.create({
    action: "ONBOARDING_TEMPLATE_CREATE",
    userId: ctx.user.id,
    meta: { templateId: created.id, name: doc.name, presetKey: doc.presetKey || null },
  });
  return view(created);
}

/**
 * Editing an ACTIVE template is allowed and deliberately does NOT disturb open cases: each
 * case holds its own snapshot of the sections it was created with. Cases opened after this
 * point get the new version. `version` increments so a reviewer can tell which form a case
 * in front of them was answering.
 */
export async function updateTemplate(ctx: RequestContext, id: string, input: any) {
  const t = await templateOr404(ctx, id);
  if (t.status === "ARCHIVED") throw bad("This form is archived. Restore it before editing.");

  // Merged over the STORED document, not validated from the body alone.
  //
  // validateTemplate() rebuilds every field it owns, substituting a default for anything
  // absent, so a full-replace here meant a client that did not send a field silently reset
  // it. That is not a theoretical risk: the builder does not send `appliesTo`, so saving a
  // change to a form's questions wiped its assignment rules, and the "Short engagement" form
  // scoped to interns and freelancers quietly began applying to permanent staff too.
  const doc = validateTemplate({
    appliesTo: t.appliesTo,
    dueDays: t.dueDays,
    reminderOffsets: t.reminderOffsets,
    escalateAfterDays: t.escalateAfterDays,
    ...input,
    presetKey: t.presetKey,
  });
  const updated: any = await ctx.data.onboardingTemplates.update(t.id, {
    ...doc,
    version: Number(t.version || 1) + 1,
    updatedBy: ctx.user.id,
  });
  await ctx.data.auditLog.create({
    action: "ONBOARDING_TEMPLATE_UPDATE",
    userId: ctx.user.id,
    meta: { templateId: t.id, name: doc.name, version: updated.version },
  });
  return view(updated);
}

/**
 * Change a template's status.
 *
 * Activating enforces the single-default rule: exactly one template may be the fallback for
 * people no assignment rule matches, otherwise which form somebody receives depends on row
 * order, which is not a thing anyone should have to reason about.
 */
export async function setTemplateStatus(ctx: RequestContext, id: string, rawStatus: any) {
  const t = await templateOr404(ctx, id);

  const status = String(rawStatus || "").toUpperCase();
  if (!STATUSES.includes(status)) throw bad(`status must be one of: ${STATUSES.join(", ")}`);

  if (status === "ARCHIVED") {
    const open = await ctx.data.onboardingCases.countForTemplate(t.id, "IN_PROGRESS");
    if (open) throw bad(`${open} ${open === 1 ? "person is" : "people are"} still filling this form in. Archive it once they are done, or cancel their cases first.`);
  }

  if (status === "ACTIVE" && t.isDefault) await ctx.data.onboardingTemplates.clearDefaultsExcept(t.id);

  const updated = await ctx.data.onboardingTemplates.update(t.id, { status });
  await ctx.data.auditLog.create({
    action: "ONBOARDING_TEMPLATE_STATUS",
    userId: ctx.user.id,
    meta: { templateId: t.id, from: t.status, to: status },
  });
  return view(updated);
}

/** Make this the fallback form. */
export async function makeDefaultTemplate(ctx: RequestContext, id: string) {
  const t = await templateOr404(ctx, id);
  if (t.status !== "ACTIVE") throw bad("Activate this form before making it the default.");

  await ctx.data.onboardingTemplates.clearDefaultsExcept(t.id);
  const updated = await ctx.data.onboardingTemplates.update(t.id, { isDefault: true });
  await ctx.data.auditLog.create({ action: "ONBOARDING_TEMPLATE_DEFAULT", userId: ctx.user.id, meta: { templateId: t.id } });
  return view(updated);
}

/**
 * The safe way to change a form that is in active use: copy, edit the copy, activate it.
 * The copy is never the default and never carries the original's presetKey, so the starter
 * loader still recognises the original as already-seeded.
 */
export async function duplicateTemplate(ctx: RequestContext, id: string, name?: any) {
  const t = await templateOr404(ctx, id);

  const doc = validateTemplate({ ...t, name: name || `${t.name} (copy)`, isDefault: false, presetKey: null });
  const created = await ctx.data.onboardingTemplates.create({
    ...doc,
    presetKey: null,
    status: "DRAFT",
    version: 1,
    copiedFrom: t.id,
    createdBy: ctx.user.id,
  });
  await ctx.data.auditLog.create({
    action: "ONBOARDING_TEMPLATE_DUPLICATE",
    userId: ctx.user.id,
    meta: { templateId: created.id, copiedFrom: t.id },
  });
  return view(created);
}

/**
 * Refused once anything has been sent on this form. A case keeps its own snapshot, so
 * deleting would not corrupt one, but it would strip the reviewer of the context for a
 * decision they are being asked to make. Archive is the answer, and the error says so.
 */
export async function deleteTemplate(ctx: RequestContext, id: string) {
  const t = await templateOr404(ctx, id);

  const used = await ctx.data.onboardingCases.countForTemplate(t.id);
  if (used) throw bad(`This form has been sent to ${used} ${used === 1 ? "person" : "people"}. Archive it instead, so their submissions keep their context.`);

  await ctx.data.onboardingTemplates.remove(t.id);
  await ctx.data.auditLog.create({ action: "ONBOARDING_TEMPLATE_DELETE", userId: ctx.user.id, meta: { templateId: t.id, name: t.name } });
  return { ok: true };
}
