/**
 * Onboarding templates: the vocabulary an organisation builds its joining form from, and
 * the validator that guards it.
 *
 * Shaped after letter-templates.ts, which solves the same problem one axis over: give the
 * tenant real control over the content while keeping the parts that must stay correct out
 * of their hands. There, a letter is typed blocks and the layout is ours. Here, a form is
 * typed sections and fields, and where the answers are allowed to land is ours.
 *
 * ── Why the mapsTo allowlist exists ──────────────────────────────────────────────────
 *
 * A form builder is a write-anywhere primitive unless the destination is constrained. A
 * field carries `mapsTo`, the path on the employee record its value commits to. Without an
 * allowlist, whoever edits templates could point a self-service field at `salary.basic`,
 * `code` or `status`, and an employee would be filling in their own pay on a form the
 * company asked them to complete.
 *
 * So MAPPABLE_PATHS is a fixed list in code, never derived from the employee record and
 * never editable through the API. A field whose `mapsTo` is absent is still collected, it
 * just lives on the case and never reaches `employees`, which is how a tenant asks "what
 * size t-shirt?" without that question growing a column.
 *
 * Nothing here writes anything. Values are staged on onboarding_cases and only committed
 * by server/onboarding-case.ts once HR approves.
 */
import { bad } from "../core/util";
import { isValidCategory, docCategoryLabel } from "./documents";
import { EMPLOYMENT_TYPE_VALUES } from "./employment";

/* ── Field types ────────────────────────────────────────────────────────────────────── */

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "date"
  | "number"
  | "select"
  | "multiselect"
  | "checkbox"
  | "address"
  | "file";

export const FIELD_TYPES: { value: FieldType; label: string; help: string }[] = [
  { value: "text", label: "Text", help: "A single line. The default." },
  { value: "textarea", label: "Paragraph", help: "Multiple lines, for notes and explanations." },
  { value: "email", label: "Email", help: "Validated as an address." },
  { value: "phone", label: "Phone", help: "Rendered with a country-code picker." },
  { value: "date", label: "Date", help: "A date picker. Stored as YYYY-MM-DD." },
  { value: "number", label: "Number", help: "Digits only, with optional min and max." },
  { value: "select", label: "Dropdown", help: "One choice from a list you define." },
  { value: "multiselect", label: "Multi-select", help: "Any number of choices from a list." },
  { value: "checkbox", label: "Yes / no", help: "A single tick box." },
  { value: "address", label: "Address", help: "Multi-line address with an optional proof upload." },
  { value: "file", label: "File upload", help: "One document. Filed to the person's documents." },
];

const FIELD_TYPE_VALUES = new Set<string>(FIELD_TYPES.map((f) => f.value));

/**
 * Named validation patterns.
 *
 * Deliberately a closed set rather than free-text regex on the template. An author-supplied
 * pattern is both a footgun (a wrong one silently rejects every valid answer) and a denial
 * of service (a catastrophically backtracking regex run against user input). Adding a format
 * means adding a line here.
 */
export const PATTERNS: Record<string, { label: string; regex: string; hint: string }> = {
  PAN: { label: "PAN", regex: "^[A-Z]{5}[0-9]{4}[A-Z]$", hint: "Ten characters, e.g. ABCDE1234F." },
  AADHAAR: { label: "Aadhaar", regex: "^[0-9]{12}$", hint: "Twelve digits." },
  UAN: { label: "UAN", regex: "^[0-9]{12}$", hint: "Twelve digits." },
  ESIC: { label: "ESIC number", regex: "^[0-9]{17}$", hint: "Seventeen digits." },
  IFSC: { label: "IFSC", regex: "^[A-Z]{4}0[A-Z0-9]{6}$", hint: "Eleven characters, e.g. HDFC0001234." },
  BANK_ACCOUNT: { label: "Bank account", regex: "^[0-9]{9,18}$", hint: "Nine to eighteen digits." },
  PINCODE: { label: "PIN code", regex: "^[1-9][0-9]{5}$", hint: "Six digits." },
  GSTIN: { label: "GSTIN", regex: "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$", hint: "Fifteen characters." },
  PASSPORT_IN: { label: "Passport (India)", regex: "^[A-PR-WY][0-9]{7}$", hint: "One letter then seven digits." },
};

export const PATTERN_KEYS = Object.keys(PATTERNS);

/* ── Where a field's answer is allowed to land ──────────────────────────────────────── */

/**
 * The only employee-record paths a template field may write to.
 *
 * Read this as a policy statement, not a schema dump: it is the definition of what an
 * employee is trusted to state about themselves on a form. Everything absent from it is
 * either HR's to set (compensation, designation, department, reporting line), the system's
 * to derive (code, official email, status, joining date), or nobody's to change after the
 * fact.
 *
 * `tier` drives nothing in code today beyond the builder's grouping and a warning shown to
 * whoever picks the path. It is here because the three groups carry genuinely different
 * consequences, and that distinction is easy to lose once this is a flat list of strings.
 */
export interface MappablePath {
  path: string;
  label: string;
  /**
   * ROUTINE   - wrong data is an inconvenience (blood group, socials).
   * IDENTITY  - wrong data breaks statutory filing or letters (name, DOB, PAN).
   * FINANCIAL - wrong data sends money to the wrong place (bank account, IFSC).
   */
  tier: "ROUTINE" | "IDENTITY" | "FINANCIAL";
}

export const MAPPABLE_PATHS: MappablePath[] = [
  // Identity. Changing these reissues letters and affects PF/ESIC filing, so HR review
  // matters most here even though the employee is the only one who knows the answer.
  { path: "firstName", label: "First name", tier: "IDENTITY" },
  { path: "lastName", label: "Last name", tier: "IDENTITY" },
  { path: "dob", label: "Date of birth", tier: "IDENTITY" },
  { path: "gender", label: "Gender", tier: "IDENTITY" },
  { path: "nationality", label: "Nationality", tier: "IDENTITY" },

  // Routine personal detail.
  { path: "bloodGroup", label: "Blood group", tier: "ROUTINE" },
  { path: "maritalStatus", label: "Marital status", tier: "ROUTINE" },
  { path: "personalEmail", label: "Personal email", tier: "ROUTINE" },
  { path: "phone", label: "Phone", tier: "ROUTINE" },
  { path: "currentAddress", label: "Current address", tier: "ROUTINE" },
  { path: "permanentAddress", label: "Permanent address", tier: "ROUTINE" },
  { path: "emergencyContact.name", label: "Emergency contact name", tier: "ROUTINE" },
  { path: "emergencyContact.relation", label: "Emergency contact relation", tier: "ROUTINE" },
  { path: "emergencyContact.phone", label: "Emergency contact phone", tier: "ROUTINE" },
  { path: "socials.linkedin", label: "LinkedIn", tier: "ROUTINE" },
  { path: "socials.github", label: "GitHub", tier: "ROUTINE" },
  { path: "socials.twitter", label: "X / Twitter", tier: "ROUTINE" },
  { path: "socials.website", label: "Website", tier: "ROUTINE" },

  // Statutory identifiers. Aadhaar is stored in full, not masked: the number is needed
  // whole for PF and ESIC filing, so a masked value would be useless downstream.
  { path: "kyc.pan", label: "PAN", tier: "IDENTITY" },
  { path: "kyc.aadhaar", label: "Aadhaar", tier: "IDENTITY" },
  { path: "kyc.passport", label: "Passport number", tier: "IDENTITY" },
  { path: "kyc.drivingLicence", label: "Driving licence", tier: "IDENTITY" },
  { path: "kyc.voterId", label: "Voter ID", tier: "IDENTITY" },
  { path: "kyc.uan", label: "UAN", tier: "IDENTITY" },
  { path: "kyc.esic", label: "ESIC number", tier: "IDENTITY" },

  // Payment destination. Nothing else in this list can misdirect a salary.
  { path: "bank.name", label: "Account holder name", tier: "FINANCIAL" },
  { path: "bank.account", label: "Bank account number", tier: "FINANCIAL" },
  { path: "bank.ifsc", label: "IFSC", tier: "FINANCIAL" },
  { path: "bank.bankName", label: "Bank name", tier: "FINANCIAL" },
  { path: "bank.branch", label: "Branch", tier: "FINANCIAL" },
];

const MAPPABLE = new Map(MAPPABLE_PATHS.map((p) => [p.path, p]));

export const isMappable = (path?: string | null): boolean => !!path && MAPPABLE.has(path);
export const mappablePath = (path?: string | null): MappablePath | undefined =>
  path ? MAPPABLE.get(path) : undefined;

/* ── Sections ───────────────────────────────────────────────────────────────────────── */

export type SectionKind =
  | "FIELDS"
  | "DOCUMENTS"
  | "EMPLOYMENT_HISTORY"
  | "EDUCATION"
  | "DEPENDENTS"
  | "BANK"
  | "ASSETS"
  | "ACKNOWLEDGMENT"
  | "DECLARATION";

export const SECTION_KINDS: { value: SectionKind; label: string; help: string; repeating?: boolean }[] = [
  { value: "FIELDS", label: "Questions", help: "Any set of typed questions you define." },
  { value: "DOCUMENTS", label: "Documents", help: "Files to upload, chosen from the document catalogue." },
  { value: "EMPLOYMENT_HISTORY", label: "Previous employment", help: "One row per past employer.", repeating: true },
  { value: "EDUCATION", label: "Education", help: "One row per qualification.", repeating: true },
  { value: "DEPENDENTS", label: "Dependents & nominees", help: "Family members, with nomination shares.", repeating: true },
  { value: "BANK", label: "Bank & statutory", help: "Salary account and statutory identifiers, with proof." },
  { value: "ASSETS", label: "Assets", help: "Acknowledge issued assets, and/or declare what was received." },
  { value: "ACKNOWLEDGMENT", label: "Policy acknowledgment", help: "Policies to read and accept." },
  { value: "DECLARATION", label: "Declaration", help: "A closing declaration, signed by typing their name." },
];

const SECTION_KIND_VALUES = new Set<string>(SECTION_KINDS.map((s) => s.value));

/** Asset categories a declared row may use. Mirrors CATS in routes/assets.routes.ts. */
export const ASSET_CATEGORIES = ["LAPTOP", "MONITOR", "PHONE", "ACCESS_CARD", "HEADSET", "SIM", "OTHER"];

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: string[];
  maxLength?: number;
  min?: number;
  max?: number;
  /** Key into PATTERNS. Free-text regex is deliberately not accepted. */
  pattern?: string;
  /** Employee-record path this value commits to. Must be in MAPPABLE_PATHS. */
  mapsTo?: string;
  /** Document category required alongside this field (e.g. PAN field -> PAN card). */
  proofCategory?: string;
}

export interface DocumentRequirement {
  category: string;
  required?: boolean;
  help?: string;
  /** Only ask employment types in this list. Empty / absent = ask everyone. */
  employmentTypes?: string[];
}

export interface AssetsSectionConfig {
  mode: "ACKNOWLEDGE" | "DECLARE" | "BOTH";
  /** Acknowledge: retype the serial rather than just ticking a box. */
  requireSerialConfirmation?: boolean;
  requirePhoto?: boolean;
  /** Declare: restrict to a subset of ASSET_CATEGORIES. */
  allowedCategories?: string[];
  /** Generate and file a signed Asset Custody Form on approval. */
  issueCustodyForm?: boolean;
}

export interface Section {
  key: string;
  kind: SectionKind;
  title: string;
  description?: string;
  /** The person may skip this section entirely. */
  optional?: boolean;
  /** Only show to these employment types. Empty / absent = everyone. */
  employmentTypes?: string[];
  /** FIELDS, BANK, and the repeating kinds (one Field per column). */
  fields?: Field[];
  /** DOCUMENTS. */
  documents?: DocumentRequirement[];
  /** EMPLOYMENT_HISTORY / EDUCATION / DEPENDENTS. */
  minRows?: number;
  maxRows?: number;
  /** ASSETS. */
  assets?: AssetsSectionConfig;
  /** ACKNOWLEDGMENT: policy ids from the tenant's `policies` table. Empty = all published. */
  policyIds?: string[];
  /** DECLARATION. */
  declarationText?: string;
}

export interface OnboardingTemplateDoc {
  name: string;
  description?: string;
  isDefault?: boolean;
  presetKey?: string | null;
  version?: number;
  appliesTo?: { employmentTypes?: string[]; departmentIds?: string[] };
  /** Days from assignment to the deadline, when a campaign does not set one. */
  dueDays?: number;
  /** Days relative to the due date. Negative = before, positive = after. */
  reminderOffsets?: number[];
  /** Days past due before the reporting manager and HR are told. */
  escalateAfterDays?: number;
  sections: Section[];
}

/* ── Limits ─────────────────────────────────────────────────────────────────────────── */

const MAX_SECTIONS = 30;
const MAX_FIELDS_PER_SECTION = 60;
const MAX_OPTIONS = 100;
const MAX_DOCS_PER_SECTION = 30;
const MAX_ROWS_CAP = 30;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,48}$/;

/* ── Validation ─────────────────────────────────────────────────────────────────────── */

const str = (v: unknown) => String(v ?? "").trim();

function validateField(f: any, where: string, seen: Set<string>): Field {
  const key = str(f?.key);
  if (!KEY_RE.test(key)) {
    throw bad(`${where}: "${key || "(blank)"}" is not a usable field key. Use a letter followed by letters, digits or underscores.`);
  }
  if (seen.has(key)) throw bad(`${where}: two fields both use the key "${key}".`);
  seen.add(key);

  const label = str(f?.label);
  if (!label) throw bad(`${where}: the field "${key}" needs a label.`);
  if (label.length > 120) throw bad(`${where}: the label on "${key}" is too long.`);

  const type = str(f?.type) as FieldType;
  if (!FIELD_TYPE_VALUES.has(type)) throw bad(`${where}: "${key}" has an unknown field type "${type}".`);

  const out: Field = { key, label, type };

  if (f?.required) out.required = true;
  if (f?.help) out.help = str(f.help).slice(0, 400);
  if (f?.placeholder) out.placeholder = str(f.placeholder).slice(0, 120);

  if (type === "select" || type === "multiselect") {
    const options = (Array.isArray(f?.options) ? f.options : []).map(str).filter(Boolean);
    if (!options.length) throw bad(`${where}: "${key}" is a ${type === "select" ? "dropdown" : "multi-select"}, so it needs at least one option.`);
    if (options.length > MAX_OPTIONS) throw bad(`${where}: "${key}" has too many options.`);
    if (new Set(options).size !== options.length) throw bad(`${where}: "${key}" lists the same option twice.`);
    out.options = options;
  }

  if (f?.maxLength !== undefined) {
    const n = Number(f.maxLength);
    if (!Number.isFinite(n) || n < 1 || n > 10000) throw bad(`${where}: "${key}" has an unusable maximum length.`);
    out.maxLength = Math.floor(n);
  }
  if (type === "number") {
    if (f?.min !== undefined && Number.isFinite(Number(f.min))) out.min = Number(f.min);
    if (f?.max !== undefined && Number.isFinite(Number(f.max))) out.max = Number(f.max);
    if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
      throw bad(`${where}: "${key}" has a minimum above its maximum.`);
    }
  }

  if (f?.pattern) {
    const pattern = str(f.pattern).toUpperCase();
    if (!PATTERNS[pattern]) {
      throw bad(`${where}: "${key}" asks for the format "${pattern}", which is not one we validate. Available: ${PATTERN_KEYS.join(", ")}.`);
    }
    out.pattern = pattern;
  }

  if (f?.mapsTo) {
    const mapsTo = str(f.mapsTo);
    if (!isMappable(mapsTo)) {
      // Named explicitly rather than "invalid": the whole point of the allowlist is that
      // someone WILL try to point a form field at compensation, and the refusal should say so.
      throw bad(
        `${where}: "${key}" tries to write to "${mapsTo}", which employees are not allowed to set. ` +
        `Leave the destination blank to collect the answer without changing the employee record.`
      );
    }
    out.mapsTo = mapsTo;
  }

  if (f?.proofCategory) {
    const category = str(f.proofCategory).toUpperCase();
    if (!isValidCategory(category)) throw bad(`${where}: "${key}" asks for an unknown document type "${category}".`);
    out.proofCategory = category;
  }

  return out;
}

function validateEmploymentTypes(raw: unknown, where: string): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const list = (Array.isArray(raw) ? raw : []).map(str).filter(Boolean);
  if (!list.length) return undefined;
  const unknown = list.filter((t) => !EMPLOYMENT_TYPE_VALUES.includes(t));
  if (unknown.length) throw bad(`${where}: unknown employment type ${unknown.join(", ")}.`);
  return [...new Set(list)];
}

function validateSection(s: any, index: number, seenKeys: Set<string>): Section {
  const key = str(s?.key);
  const where = `Section ${index + 1}${key ? ` ("${key}")` : ""}`;
  if (!KEY_RE.test(key)) throw bad(`${where}: needs a key made of letters, digits or underscores.`);
  if (seenKeys.has(key)) throw bad(`Two sections both use the key "${key}".`);
  seenKeys.add(key);

  const kind = str(s?.kind) as SectionKind;
  if (!SECTION_KIND_VALUES.has(kind)) throw bad(`${where}: unknown section type "${kind}".`);

  const title = str(s?.title);
  if (!title) throw bad(`${where}: needs a title.`);

  const out: Section = { key, kind, title };
  if (s?.description) out.description = str(s.description).slice(0, 1000);
  if (s?.optional) out.optional = true;
  const types = validateEmploymentTypes(s?.employmentTypes, where);
  if (types) out.employmentTypes = types;

  const FIELD_KINDS: SectionKind[] = ["FIELDS", "BANK", "EMPLOYMENT_HISTORY", "EDUCATION", "DEPENDENTS"];

  if (FIELD_KINDS.includes(kind)) {
    const raw = Array.isArray(s?.fields) ? s.fields : [];
    if (!raw.length) throw bad(`${where}: a "${kind}" section needs at least one field.`);
    if (raw.length > MAX_FIELDS_PER_SECTION) throw bad(`${where}: too many fields in one section.`);
    const seenFields = new Set<string>();
    out.fields = raw.map((f: any) => validateField(f, where, seenFields));
  } else if (s?.fields?.length) {
    throw bad(`${where}: a "${kind}" section does not take custom fields.`);
  }

  if (["EMPLOYMENT_HISTORY", "EDUCATION", "DEPENDENTS"].includes(kind)) {
    const min = Number(s?.minRows ?? 0);
    const max = Number(s?.maxRows ?? MAX_ROWS_CAP);
    if (!Number.isFinite(min) || min < 0 || min > MAX_ROWS_CAP) throw bad(`${where}: unusable minimum row count.`);
    if (!Number.isFinite(max) || max < 1 || max > MAX_ROWS_CAP) throw bad(`${where}: unusable maximum row count.`);
    if (min > max) throw bad(`${where}: the minimum row count is above the maximum.`);
    out.minRows = Math.floor(min);
    out.maxRows = Math.floor(max);
  }

  if (kind === "DOCUMENTS") {
    const raw = Array.isArray(s?.documents) ? s.documents : [];
    if (!raw.length) throw bad(`${where}: a documents section needs at least one document.`);
    if (raw.length > MAX_DOCS_PER_SECTION) throw bad(`${where}: too many documents in one section.`);
    const seenCats = new Set<string>();
    out.documents = raw.map((d: any) => {
      const category = str(d?.category).toUpperCase();
      if (!isValidCategory(category)) throw bad(`${where}: unknown document type "${category}".`);
      if (seenCats.has(category)) throw bad(`${where}: "${docCategoryLabel(category)}" is asked for twice.`);
      seenCats.add(category);
      const req: DocumentRequirement = { category };
      if (d?.required !== false) req.required = true;
      if (d?.help) req.help = str(d.help).slice(0, 400);
      const dTypes = validateEmploymentTypes(d?.employmentTypes, where);
      if (dTypes) req.employmentTypes = dTypes;
      return req;
    });
  }

  if (kind === "ASSETS") {
    const a = s?.assets || {};
    const mode = str(a.mode).toUpperCase() || "BOTH";
    if (!["ACKNOWLEDGE", "DECLARE", "BOTH"].includes(mode)) {
      throw bad(`${where}: assets mode must be ACKNOWLEDGE, DECLARE or BOTH.`);
    }
    const cfg: AssetsSectionConfig = { mode: mode as AssetsSectionConfig["mode"] };
    if (a.requireSerialConfirmation) cfg.requireSerialConfirmation = true;
    if (a.requirePhoto) cfg.requirePhoto = true;
    if (a.issueCustodyForm) cfg.issueCustodyForm = true;
    if (Array.isArray(a.allowedCategories) && a.allowedCategories.length) {
      const cats = a.allowedCategories.map((c: any) => str(c).toUpperCase());
      const unknown = cats.filter((c: string) => !ASSET_CATEGORIES.includes(c));
      if (unknown.length) throw bad(`${where}: unknown asset category ${unknown.join(", ")}.`);
      cfg.allowedCategories = [...new Set(cats)] as string[];
    }
    // Serial confirmation and photos only mean anything against a provisioned asset.
    if (cfg.mode === "DECLARE" && cfg.requireSerialConfirmation) {
      throw bad(`${where}: serial confirmation checks a declared serial against the one on the register, so it needs ACKNOWLEDGE or BOTH.`);
    }
    out.assets = cfg;
  }

  if (kind === "ACKNOWLEDGMENT" && Array.isArray(s?.policyIds)) {
    out.policyIds = s.policyIds.map(str).filter(Boolean);
  }

  if (kind === "DECLARATION") {
    const text = str(s?.declarationText);
    if (!text) throw bad(`${where}: a declaration needs the text the person is agreeing to.`);
    if (text.length > 4000) throw bad(`${where}: the declaration text is too long.`);
    out.declarationText = text;
  }

  return out;
}

/**
 * Validate a template submitted from the builder. Throws a 400 naming the section and field,
 * so the editor can point at what is wrong rather than saying "invalid template".
 */
export function validateTemplate(body: any): OnboardingTemplateDoc {
  const name = str(body?.name);
  if (!name) throw bad("The template needs a name.");
  if (name.length > 160) throw bad("That template name is too long.");

  const sectionsIn = Array.isArray(body?.sections) ? body.sections : null;
  if (!sectionsIn || !sectionsIn.length) throw bad("A template needs at least one section.");
  if (sectionsIn.length > MAX_SECTIONS) throw bad(`A template cannot have more than ${MAX_SECTIONS} sections.`);

  const seenKeys = new Set<string>();
  const sections = sectionsIn.map((s: any, i: number) => validateSection(s, i, seenKeys));

  if (sections.filter((s) => s.kind === "DECLARATION").length > 1) {
    throw bad("A template can carry only one declaration.");
  }

  // Two fields writing to the same employee path would make the outcome depend on section
  // order, which is not something anyone editing a form expects to be deciding.
  const byPath = new Map<string, string>();
  for (const s of sections) {
    for (const f of s.fields || []) {
      if (!f.mapsTo) continue;
      const prev = byPath.get(f.mapsTo);
      if (prev) throw bad(`Both "${prev}" and "${f.key}" write to ${f.mapsTo}. Only one field may fill a given detail.`);
      byPath.set(f.mapsTo, f.key);
    }
  }

  const out: OnboardingTemplateDoc = { name, sections };
  if (body?.description) out.description = str(body.description).slice(0, 2000);
  // Always emitted, never merely omitted when false. An absent key and `false` read the
  // same to a truthiness check but not to a client rendering a toggle, and a duplicated
  // template was coming back with no `isDefault` at all.
  out.isDefault = !!body?.isDefault;
  out.presetKey = body?.presetKey ? str(body.presetKey) : null;

  const dueDays = Number(body?.dueDays ?? 7);
  if (!Number.isFinite(dueDays) || dueDays < 1 || dueDays > 365) throw bad("The deadline must be between 1 and 365 days.");
  out.dueDays = Math.floor(dueDays);

  const offsets = Array.isArray(body?.reminderOffsets) ? body.reminderOffsets : [-7, -3, -1, 1];
  const cleaned = [...new Set(offsets.map((n: any) => Math.trunc(Number(n))).filter((n: number) => Number.isFinite(n) && n >= -60 && n <= 60 && n !== 0))];
  if (cleaned.length > 10) throw bad("That is too many reminders for one template.");
  out.reminderOffsets = (cleaned as number[]).sort((a, b) => a - b);

  const escalate = Number(body?.escalateAfterDays ?? 3);
  if (!Number.isFinite(escalate) || escalate < 0 || escalate > 90) throw bad("Escalation must be between 0 and 90 days past the deadline.");
  out.escalateAfterDays = Math.floor(escalate);

  out.appliesTo = {
    employmentTypes: validateEmploymentTypes(body?.appliesTo?.employmentTypes, "Assignment rules") || [],
    departmentIds: (Array.isArray(body?.appliesTo?.departmentIds) ? body.appliesTo.departmentIds : []).map(str).filter(Boolean),
  };

  return out;
}

/* ── Resolution ─────────────────────────────────────────────────────────────────────── */

/**
 * Sections that apply to a given employment type (a template may exclude some).
 *
 * Takes the loose shape rather than a validated OnboardingTemplateDoc: callers pass stored
 * rows straight out of the repo, which carry id/status/createdAt alongside the document.
 */
export function sectionsFor(
  template: { sections?: Section[]; [k: string]: any },
  employmentType?: string | null
): Section[] {
  return (template.sections || []).filter(
    (s) => !s.employmentTypes?.length || (employmentType && s.employmentTypes.includes(employmentType))
  );
}

/**
 * Which template applies to a person. Most specific wins: a template naming both the
 * employment type and the department beats one naming only the type, which beats the
 * default. Returns null when the org has no usable template.
 */
export function pickTemplate(
  templates: { id: string; status?: string | null; [k: string]: any }[],
  person: { employmentType?: string | null; departmentId?: string | null }
) {
  const active = templates.filter((t) => t.status === "ACTIVE");
  if (!active.length) return null;

  const score = (t: any) => {
    const types: string[] = t.appliesTo?.employmentTypes || [];
    const depts: string[] = t.appliesTo?.departmentIds || [];
    if (types.length && !(person.employmentType && types.includes(person.employmentType))) return -1;
    if (depts.length && !(person.departmentId && depts.includes(person.departmentId))) return -1;
    return (types.length ? 2 : 0) + (depts.length ? 1 : 0);
  };

  const ranked = active
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || (a.t.isDefault === b.t.isDefault ? 0 : a.t.isDefault ? 1 : -1));

  return ranked[0]?.t ?? active.find((t: any) => t.isDefault) ?? null;
}

/**
 * Why no template applies to this person, or null when one does.
 *
 * The counterpart to pickTemplate, and the reason it exists separately: the invite routes
 * need to ask "would this person get a form?" BEFORE they mint a token and email it. An
 * invite whose template cannot resolve is a dead link, and the only person who ever found
 * out was the candidate, staring at a 400 days later with nobody to tell.
 *
 * The two gaps are different problems with different fixes, so they get different
 * sentences: an org with no ACTIVE form needs one published, whereas an org whose forms
 * all name some other employment type needs a rule widened or a default marked.
 */
export function templateGapReason(
  templates: { id: string; status?: string | null; [k: string]: any }[],
  person: { employmentType?: string | null; departmentId?: string | null }
): string | null {
  if (pickTemplate(templates, person)) return null;
  if (!templates.some((t) => t.status === "ACTIVE")) {
    return "This organisation has no active onboarding form. Create one under Onboarding, or apply the starter forms from Settings, then try again.";
  }
  const who = String(person.employmentType || "candidate").toLowerCase().replace(/_/g, " ");
  return `No active onboarding form applies to a ${who}. Widen a form's assignment rules under Onboarding, or mark one as the default form.`;
}
