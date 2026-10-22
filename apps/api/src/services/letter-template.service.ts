/**
 * Letter template editing.
 *
 * Organisations edit the wording of every letter HRMS issues. Templates live in
 * org.data.letterTemplates, defaults live in code, and an absent override means "use the
 * default", so resetting is a delete and there is nothing to migrate.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound } from "../core/util";
import { brandFor } from "../domain/brand";
import { TOKENS, unknownTokens } from "../domain/letter-tokens";
import { renderLetter } from "../pdf/letter-render";
import {
  LETTER_KINDS, DEFAULT_TEMPLATES, templateFor, isCustomised, letterKind,
  type LetterTemplate,
} from "../domain/letter-templates";

// Text blocks any letter may use; dynamic blocks are gated per kind (a salary table on a
// relieving letter would print compensation on a document shown to future employers).
const TEXT_BLOCKS = ["paragraph", "heading", "bullets", "note", "signature"];
const DYNAMIC_BLOCKS = ["salaryTable", "revisionTable", "settlementTable", "detailGrid", "acceptance"];

/**
 * Validate a submitted template.
 *
 * Rejects unknown block types, dynamic blocks that do not belong on this kind, and unknown
 * tokens. Unknown tokens matter most: they render as empty, so without this check a typo
 * like {{employee.firstname}} would silently produce "Dear ," on a signed appointment letter.
 */
function validateTemplate(kind: string, body: any): LetterTemplate {
  const spec = letterKind(kind);
  if (!spec) throw notFound("Unknown letter kind");

  const title = String(body?.title || "").trim();
  if (!title) throw bad("The letter needs a title");
  if (title.length > 160) throw bad("The title is too long");

  const blocksIn = Array.isArray(body?.blocks) ? body.blocks : null;
  if (!blocksIn || !blocksIn.length) throw bad("A letter needs at least one block");
  if (blocksIn.length > 60) throw bad("That is too many blocks for one letter");

  const allowed = new Set([...TEXT_BLOCKS, ...spec.allowedDynamicBlocks]);
  const badTokens = new Set<string>();
  const collect = (s: string) => unknownTokens(s).forEach((t) => badTokens.add(t));

  const blocks = blocksIn.map((b: any, i: number) => {
    const type = String(b?.type || "");
    if (!allowed.has(type)) {
      const why = DYNAMIC_BLOCKS.includes(type)
        ? `a "${type}" block cannot be used on this letter`
        : `unknown block type "${type}"`;
      throw bad(`Block ${i + 1}: ${why}`);
    }
    switch (type) {
      case "paragraph":
      case "heading":
      case "note": {
        const text = String(b.text ?? "");
        if (!text.trim()) throw bad(`Block ${i + 1}: this block needs some text`);
        if (text.length > 4000) throw bad(`Block ${i + 1}: that text is too long`);
        collect(text);
        return { type, text };
      }
      case "bullets": {
        const items = (Array.isArray(b.items) ? b.items : []).map((x: any) => String(x ?? "")).filter((x) => x.trim());
        if (!items.length) throw bad(`Block ${i + 1}: a bullet list needs at least one item`);
        if (items.length > 30) throw bad(`Block ${i + 1}: that is too many bullet points`);
        items.forEach(collect);
        return { type, items };
      }
      case "detailGrid": {
        const pairs = (Array.isArray(b.pairs) ? b.pairs : [])
          .map((p: any) => [String(p?.[0] ?? ""), String(p?.[1] ?? "")])
          .filter(([l]) => l.trim());
        if (!pairs.length) throw bad(`Block ${i + 1}: a detail grid needs at least one row`);
        pairs.forEach(([l, v]) => { collect(l); collect(v); });
        return { type, pairs };
      }
      case "salaryTable":
        return { type, annual: b.annual !== false };
      default:
        return { type };
    }
  });

  if (badTokens.size) {
    throw bad(
      `Unknown ${badTokens.size === 1 ? "token" : "tokens"}: ${[...badTokens].map((t) => `{{${t}}}`).join(", ")}. ` +
      `Use the token list beside the editor; an unknown token prints as nothing.`
    );
  }
  if (blocks.filter((b: any) => b.type === "signature").length > 1) {
    throw bad("A letter can carry only one signature block");
  }

  const recipientLines = (Array.isArray(body?.recipientLines) ? body.recipientLines : [])
    .map((l: any) => String(l ?? ""))
    .filter((l: string) => l.trim());
  recipientLines.forEach(collect);

  const DATE_SOURCES = ["issue", "joining", "effective", "lastWorkingDay"];
  const dateSource = DATE_SOURCES.includes(String(body?.dateSource)) ? String(body.dateSource) : "issue";

  return {
    title,
    marker: body?.marker ? String(body.marker).slice(0, 80) : null,
    showRecipient: !!body?.showRecipient,
    recipientLines,
    dateSource: dateSource as any,
    blocks: blocks as any,
  };
}

/** Sample subject matter, so a preview works before anyone has been hired. */
const SAMPLE_EMPLOYEE = {
  id: "sample", code: "SAMPLE-1001", firstName: "Priya", lastName: "Nair",
  designation: "Product Designer", employmentType: "FULL_TIME",
  joiningDate: "2026-09-01", probationMonths: 6,
  currentAddress: "12 MG Road, Bengaluru 560001",
  personalEmail: "priya.nair@example.com", phone: "+91 98765 43210",
  salary: { basic: 50000, hra: 20000, allowances: 10000, deductions: 3000 },
};
const SAMPLE_EXTRAS = {
  dept: { name: "Design" },
  salary: SAMPLE_EMPLOYEE.salary,
  previousSalary: { basic: 44000, hra: 17600, allowances: 8800 },
  effectiveDate: "2027-04-01",
  lastWorkingDay: "2027-06-30",
  reason: "Organisational restructuring",
  subReason: "LAYOFF",
  daysAbsent: 7,
  settlement: {
    daysWorked: 12, pendingSalary: 32000, encashableLeaveDays: 4,
    leaveEncashment: 10600, recoveries: 2500, net: 40100, unreturnedAssets: 1,
  },
};

const loadOrg = (ctx: RequestContext) => ctx.data.organizations.byId(ctx.orgId) as Promise<any>;

/** The letter kind named in the URL, or a 404. */
function kindOr404(kind: string) {
  const spec = letterKind(kind);
  if (!spec) throw notFound("Unknown letter kind");
  return spec;
}

/** Every kind with its current template. */
export async function listLetterTemplates(ctx: RequestContext) {
  const org = await loadOrg(ctx);
  return LETTER_KINDS.map((k) => ({
    ...k,
    customised: isCustomised(org, k.key),
    template: templateFor(org, k.key),
  }));
}

/** The token palette shown beside the editor. */
export function letterTokens() {
  return TOKENS;
}

export async function getLetterTemplate(ctx: RequestContext, kind: string) {
  const spec = kindOr404(kind);
  const org = await loadOrg(ctx);
  return {
    ...spec,
    customised: isCustomised(org, spec.key),
    template: templateFor(org, spec.key),
    defaultTemplate: DEFAULT_TEMPLATES[spec.key],
  };
}

/** Save this organisation's wording. */
export async function saveLetterTemplate(ctx: RequestContext, kind: string, body: any) {
  const spec = kindOr404(kind);
  const org = await loadOrg(ctx);
  const template = validateTemplate(spec.key, body);
  const next = {
    ...(org.letterTemplates || {}),
    [spec.key]: { ...template, updatedAt: new Date().toISOString(), updatedBy: ctx.user.id },
  };
  await ctx.data.organizations.update(org.id, { letterTemplates: next });
  await ctx.data.auditLog.create({ action: "LETTER_TEMPLATE_SAVE", userId: ctx.user.id, meta: { kind: spec.key } });
  return { ...spec, customised: true, template: next[spec.key] };
}

/** Go back to the built-in wording. */
export async function resetLetterTemplate(ctx: RequestContext, kind: string) {
  const spec = kindOr404(kind);
  const org = await loadOrg(ctx);
  const next = { ...(org.letterTemplates || {}) };
  delete next[spec.key];
  await ctx.data.organizations.update(org.id, { letterTemplates: next });
  await ctx.data.auditLog.create({ action: "LETTER_TEMPLATE_RESET", userId: ctx.user.id, meta: { kind: spec.key } });
  return { ...spec, customised: false, template: DEFAULT_TEMPLATES[spec.key] };
}

/**
 * Render a preview PDF.
 *
 * Body may carry an unsaved `template` so the editor previews what is on screen rather than
 * what is stored, and an optional `employeeId` to preview against a real person. Never
 * filed as a document and carries no verification code: a preview must not be mistaken for
 * an issued letter, and issuing one is what the Letters screen is for.
 */
export async function previewLetterTemplate(ctx: RequestContext, kind: string, body: any) {
  const spec = kindOr404(kind);
  const org = await loadOrg(ctx);

  const template = body?.template ? validateTemplate(spec.key, body.template) : templateFor(org, spec.key);

  let employee: any = SAMPLE_EMPLOYEE;
  let dept: any = SAMPLE_EXTRAS.dept;
  let manager: any = null;
  if (body?.employeeId) {
    const real = await ctx.data.employees.byId(body.employeeId);
    if (!real) throw notFound("Employee not found");
    if (!ctx.inScope(real)) throw bad("That employee is outside your assigned scope");
    employee = real;
    dept = real.departmentId ? await ctx.data.departments.byId(real.departmentId) : null;
    const mgrId = real.managerId || real.reportsTo;
    manager = mgrId ? await ctx.data.employees.byId(mgrId) : null;
  }

  const { buffer } = await renderLetter({
    ...SAMPLE_EXTRAS,
    kind: spec.key,
    template,
    org,
    brand: brandFor(org),
    employee,
    dept,
    manager,
    salary: employee.salary || SAMPLE_EXTRAS.salary,
    verification: null,
  });

  return { buffer, filename: `preview_${spec.key.toLowerCase()}.pdf` };
}
