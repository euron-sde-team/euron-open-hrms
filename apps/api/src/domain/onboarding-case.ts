/**
 * The onboarding case: one person's journey through a template, and the staging area for
 * everything they submit.
 *
 * ── Why staging rather than writing straight through ────────────────────────────────
 *
 * The old flow wrote the joining form directly into `employees`. That is survivable for a
 * brand-new hire, whose record is empty anyway, and unacceptable for the existing roster:
 * those records already carry a bank account payroll pays into and a PAN that appears on
 * statutory filings. A form nobody has checked must not be able to overwrite either.
 *
 * So answers live in `case.data.sections[key].values` and go nowhere near the employee
 * record until HR approves. `commitToEmployee()` is the ONLY function here that writes to
 * `employees`, it runs once, inside a transaction, and it records exactly what it changed.
 *
 * ── Why the template is snapshotted ─────────────────────────────────────────────────
 *
 * `data.templateSnapshot` is a copy taken when the case is created. HR editing a template
 * during a live campaign must not change the questions in front of 200 people who are
 * halfway through answering them, and must not orphan answers to questions that have just
 * been deleted. Same reasoning as a subscription snapshotting its plan.
 */
import { randomUUID as uuid } from "crypto";
import { docCategoryLabel } from "./documents";
import {
  PATTERNS,
  sectionsFor,
  type OnboardingTemplateDoc,
  type Section,
  type Field,
} from "./onboarding-template";

/* ── Status ─────────────────────────────────────────────────────────────────────────── */

export const CASE_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "CHANGES_REQUESTED",
  "APPROVED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Statuses where the person can still edit. Drives the reminder sweep's candidate set. */
export const OPEN_STATUSES: CaseStatus[] = ["NOT_STARTED", "IN_PROGRESS", "CHANGES_REQUESTED"];

export const SECTION_STATUSES = ["EMPTY", "PARTIAL", "COMPLETE", "APPROVED", "CHANGES_REQUESTED"] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

export interface SectionState {
  status: SectionStatus;
  values: Record<string, any>;
  /** Repeating sections (EMPLOYMENT_HISTORY / EDUCATION / DEPENDENTS). */
  rows?: Record<string, any>[];
  updatedAt?: string;
  submittedAt?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  note?: string;
  history?: { at: string; by: string; action: string; note?: string }[];
}

/* ── Creation ───────────────────────────────────────────────────────────────────────── */

/**
 * The `data` payload for a new case. The caller inserts it; this only builds the shape, so
 * it stays testable without a database.
 */
export function buildCaseData(
  template: OnboardingTemplateDoc & { id?: string },
  person: { employmentType?: string | null; departmentId?: string | null } = {},
  seed: Record<string, any> = {}
) {
  const sections = sectionsFor(template, person.employmentType);
  const state: Record<string, SectionState> = {};
  for (const s of sections) {
    state[s.key] = { status: "EMPTY", values: {}, ...(isRepeating(s) ? { rows: [] } : {}) };
  }

  // Prefill from what the organisation already knows, so nobody retypes their own name.
  // Prefilled values still count as submitted data and are still reviewed: HR is confirming
  // the person agrees with what is on file, which for the existing roster is the point.
  for (const s of sections) {
    for (const f of s.fields || []) {
      if (!f.mapsTo) continue;
      const existing = getPath(seed, f.mapsTo);
      if (existing !== undefined && existing !== null && existing !== "") {
        state[s.key].values[f.key] = existing;
        state[s.key].status = "PARTIAL";
      }
    }
  }

  return {
    templateSnapshot: sections,
    templateName: template.name,
    templateVersion: template.version ?? 1,
    reminderOffsets: template.reminderOffsets ?? [-3, -1, 1],
    escalateAfterDays: template.escalateAfterDays ?? 3,
    sections: state,
    documents: [] as any[],
    assets: { acknowledged: [] as any[], declared: [] as any[] },
    acknowledgments: [] as any[],
    declaration: null as any,
    remindersSent: [] as string[],
    submittedAt: null as string | null,
    approvedAt: null as string | null,
    approvedBy: null as string | null,
    commit: null as any,
  };
}

export const isRepeating = (s: Section) =>
  ["EMPLOYMENT_HISTORY", "EDUCATION", "DEPENDENTS"].includes(s.kind);

/* ── Field validation (what the person typed) ───────────────────────────────────────── */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Check one answer against its field spec. Returns an error string, or null when good.
 * Deliberately mirrors the shape of validateInvite() in onboarding.routes.ts.
 */
export function validateAnswer(f: Field, raw: any): string | null {
  const empty = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && !raw.length);
  if (empty) return f.required ? `${f.label} is required` : null;

  const v = typeof raw === "string" ? raw.trim() : raw;

  switch (f.type) {
    case "email":
      if (!EMAIL_RE.test(String(v))) return `${f.label} is not a valid email address`;
      break;
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n)) return `${f.label} must be a number`;
      if (f.min !== undefined && n < f.min) return `${f.label} must be at least ${f.min}`;
      if (f.max !== undefined && n > f.max) return `${f.label} must be at most ${f.max}`;
      break;
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(String(v)))) {
        return `${f.label} must be a date`;
      }
      break;
    case "select":
      if (f.options?.length && !f.options.includes(String(v))) return `${f.label} is not one of the choices offered`;
      break;
    case "multiselect": {
      const list = Array.isArray(v) ? v.map(String) : [String(v)];
      if (f.options?.length && list.some((x) => !f.options!.includes(x))) {
        return `${f.label} contains a choice that is not offered`;
      }
      break;
    }
    case "checkbox":
      if (typeof v !== "boolean") return `${f.label} must be yes or no`;
      break;
  }

  if (typeof v === "string") {
    if (f.maxLength && v.length > f.maxLength) return `${f.label} is too long (max ${f.maxLength})`;
    if (f.pattern) {
      const p = PATTERNS[f.pattern];
      // Patterns are uppercase-normalised formats (PAN, IFSC). Test the normalised value so
      // "abcde1234f" is accepted and stored as "ABCDE1234F".
      if (p && !new RegExp(p.regex).test(v.toUpperCase())) return `${f.label}: ${p.hint}`;
    }
  }

  return null;
}

/** Normalise an answer for storage (uppercase the formatted identifiers, trim the rest). */
export function normaliseAnswer(f: Field, raw: any): any {
  if (raw === undefined || raw === null) return raw;
  if (typeof raw !== "string") return raw;
  const v = raw.trim();
  return f.pattern ? v.toUpperCase() : v;
}

/* ── Completion ─────────────────────────────────────────────────────────────────────── */

export interface SectionCheck {
  key: string;
  title: string;
  optional: boolean;
  status: SectionStatus;
  /** Problems that stop this section counting as complete. */
  errors: string[];
  filled: number;
  requiredTotal: number;
}

/**
 * Documents a section requires that have not been uploaded yet, as category codes.
 *
 * De-duplicated, because a section can ask for the same proof twice over: once as a
 * `file` field (the salary-account section's cancelled cheque) and once in its documents
 * list. Reporting it twice makes an otherwise complete form look doubly broken.
 */
function missingDocuments(s: Section, caseData: any, employmentType?: string | null): string[] {
  const have = new Set(
    (caseData.documents || [])
      .filter((d: any) => d.sectionKey === s.key)
      .map((d: any) => String(d.category).toUpperCase())
  );
  const out = new Set<string>();
  for (const d of s.documents || []) {
    if (!d.required) continue;
    if (d.employmentTypes?.length && !(employmentType && d.employmentTypes.includes(employmentType))) continue;
    if (!have.has(d.category)) out.add(d.category);
  }
  for (const f of s.fields || []) {
    if (f.type !== "file" || !f.required) continue;
    const category = String(f.proofCategory || "").toUpperCase();
    if (category && !have.has(category)) out.add(category);
  }
  return [...out];
}

/** Evaluate one section against what has been filled in. */
export function checkSection(s: Section, caseData: any, employmentType?: string | null): SectionCheck {
  const state: SectionState = caseData.sections?.[s.key] || { status: "EMPTY", values: {} };
  const errors: string[] = [];
  let filled = 0;
  let requiredTotal = 0;

  if (isRepeating(s)) {
    const rows = state.rows || [];
    const min = s.minRows ?? 0;
    if (rows.length < min) errors.push(`Add at least ${min} ${min === 1 ? "entry" : "entries"}`);
    rows.forEach((row, i) => {
      for (const f of s.fields || []) {
        const err = validateAnswer(f, row?.[f.key]);
        if (err) errors.push(`Row ${i + 1}: ${err}`);
      }
    });
    requiredTotal = Math.max(min, 1);
    filled = rows.length;
  } else {
    for (const f of s.fields || []) {
      // A file field is satisfied by an upload, which lives in caseData.documents, not in
      // `values`. Validating it here would report "required" forever, however many times
      // the person uploaded the thing. missingDocuments() is what actually answers this.
      if (f.type === "file") continue;
      if (f.required) requiredTotal++;
      const err = validateAnswer(f, state.values?.[f.key]);
      if (err) errors.push(err);
      else if (f.required) filled++;
    }
  }

  const missingDocs = missingDocuments(s, caseData, employmentType);
  for (const c of missingDocs) errors.push(`Upload the ${docCategoryLabel(c).toLowerCase()}`);
  requiredTotal += missingDocs.length;

  if (s.kind === "ACKNOWLEDGMENT") {
    const accepted = (caseData.acknowledgments || []).length;
    const expected = s.policyIds?.length || 0;
    requiredTotal += Math.max(expected, 1);
    if (expected && accepted < expected) errors.push("Accept every policy listed");
    else if (!expected && !accepted) errors.push("Accept the policies listed");
    else filled += Math.max(expected, 1);
  }

  if (s.kind === "DECLARATION") {
    requiredTotal += 1;
    if (!caseData.declaration?.fullName) errors.push("Sign the declaration by typing your full name");
    else filled += 1;
  }

  if (s.kind === "ASSETS") {
    const mode = s.assets?.mode || "BOTH";
    if (mode !== "DECLARE") {
      const pending = (caseData.assets?.acknowledged || []).filter((a: any) => a.received === undefined || a.received === null);
      if (pending.length) errors.push(`Confirm receipt of ${pending.length} item${pending.length === 1 ? "" : "s"}`);
    }
  }

  // A reviewer's verdict outranks a freshly computed status: an approved section stays
  // approved even if the template later gains a field, and one sent back stays flagged
  // until the person actually edits it.
  let status: SectionStatus;
  if (state.status === "APPROVED") status = "APPROVED";
  else if (state.status === "CHANGES_REQUESTED") status = "CHANGES_REQUESTED";
  else if (!errors.length && (filled > 0 || !requiredTotal)) status = "COMPLETE";
  else if (filled > 0 || Object.keys(state.values || {}).length) status = "PARTIAL";
  else status = "EMPTY";

  return { key: s.key, title: s.title, optional: !!s.optional, status, errors, filled, requiredTotal };
}

/** Evaluate every section on the case. */
export function checkCase(caseDoc: any, employmentType?: string | null): SectionCheck[] {
  const sections: Section[] = caseDoc?.templateSnapshot || [];
  return sections.map((s) => checkSection(s, caseDoc, employmentType));
}

/** Headline progress, for the wizard's step bar and the campaign dashboard. */
export function computeProgress(checks: SectionCheck[]) {
  const required = checks.filter((c) => !c.optional);
  const done = required.filter((c) => c.status === "COMPLETE" || c.status === "APPROVED").length;
  return {
    done,
    total: required.length,
    percent: required.length ? Math.round((done / required.length) * 100) : 100,
  };
}

/* ── Submission gate ────────────────────────────────────────────────────────────────── */

export interface SubmitVerdict {
  /** May the person press Submit at all? */
  ok: boolean;
  /** Sections that must be fixed first. Shown as errors and block the button. */
  blocking: { key: string; title: string; errors: string[] }[];
  /** Sections that are incomplete but not blocking. Shown as a warning on the way through. */
  warnings: { key: string; title: string; errors: string[] }[];
}

/**
 * Decide whether an onboarding case may be submitted for HR review.
 *
 * The policy is the template's, not this function's. A section carries `optional` and its
 * fields carry `required`, and those two flags ARE the organisation's answer to "what may
 * a person leave blank". Hardcoding a second policy here, blocking on identity and bank
 * because those feel important, would quietly overrule whoever built the form and would
 * be wrong for the next tenant: a company hiring only contractors has no PF section to
 * insist on, and one hiring only in India needs Aadhaar from everybody.
 *
 * So the rule is short:
 *
 *   - A required section that is not complete blocks. That is what "required" means.
 *   - An optional section left ENTIRELY blank is fine, and warns rather than blocks. This
 *     is the escape hatch for the person who cannot find their UAN today, and it is
 *     opened by the template author, per section, in the builder.
 *   - An optional section somebody has STARTED must still be valid. Half a previous
 *     employer, with a start date and no end date, is worse than no entry at all: it
 *     reaches HR looking like real data.
 *   - A section HR sent back blocks until it is actually edited. Without this, "Submit"
 *     bounces the identical form straight back at the reviewer, and the correction loop
 *     never terminates. Editing clears the flag (applySectionValues), so this only ever
 *     catches an unchanged resubmission.
 */
export function canSubmit(checks: SectionCheck[]): SubmitVerdict {
  const blocking: SubmitVerdict["blocking"] = [];
  const warnings: SubmitVerdict["warnings"] = [];

  for (const c of checks) {
    const entry = { key: c.key, title: c.title, errors: c.errors };

    if (c.status === "CHANGES_REQUESTED") {
      blocking.push({
        ...entry,
        errors: c.errors.length ? c.errors : ["Make the changes HR asked for, then submit again"],
      });
      continue;
    }
    if (c.status === "COMPLETE" || c.status === "APPROVED") continue;
    if (!c.errors.length) continue;

    if (c.optional && c.status === "EMPTY") warnings.push(entry);
    else blocking.push(entry);
  }

  return { ok: blocking.length === 0, blocking, warnings };
}

/* ── Editing ────────────────────────────────────────────────────────────────────────── */

export interface ApplyResult {
  state: SectionState;
  errors: string[];
}

/**
 * Stage one section's answers onto the case.
 *
 * Saves what is valid and reports what is not, rather than refusing the whole section: the
 * wizard autosaves as somebody types, so rejecting a partial section would mean losing
 * everything each time they tab out of a half-typed PAN. Completeness is judged later, by
 * checkSection, against the saved state.
 *
 * Editing a section HR sent back clears that flag. Otherwise the case could never leave
 * CHANGES_REQUESTED and canSubmit would block forever.
 */
export function applySectionValues(
  section: Section,
  state: SectionState,
  incoming: { values?: Record<string, any>; rows?: Record<string, any>[] },
  actorId: string
): ApplyResult {
  const now = new Date().toISOString();
  const errors: string[] = [];
  const next: SectionState = {
    ...state,
    values: { ...(state.values || {}) },
    rows: state.rows ? [...state.rows] : undefined,
    updatedAt: now,
  };

  const fieldsByKey = new Map((section.fields || []).map((f) => [f.key, f]));

  if (isRepeating(section)) {
    const rows = Array.isArray(incoming.rows) ? incoming.rows : [];
    const cap = section.maxRows ?? 30;
    if (rows.length > cap) errors.push(`Only ${cap} entries can be added here`);
    next.rows = rows.slice(0, cap).map((row, i) => {
      const clean: Record<string, any> = { id: row?.id || uuid() };
      for (const [k, raw] of Object.entries(row || {})) {
        if (k === "id") continue;
        const f = fieldsByKey.get(k);
        if (!f) continue; // silently drop anything the template does not ask for
        const err = validateAnswer(f, raw);
        if (err) errors.push(`Row ${i + 1}: ${err}`);
        clean[k] = normaliseAnswer(f, raw);
      }
      return clean;
    });
  } else {
    for (const [k, raw] of Object.entries(incoming.values || {})) {
      const f = fieldsByKey.get(k);
      if (!f) continue;
      const err = validateAnswer(f, raw);
      if (err) errors.push(err);
      next.values[k] = normaliseAnswer(f, raw);
    }
  }

  if (state.status === "CHANGES_REQUESTED") {
    next.status = "PARTIAL";
    next.note = "";
    next.history = [
      ...(state.history || []),
      { at: now, by: actorId, action: "EDITED_AFTER_CHANGES_REQUESTED" },
    ];
  } else if (state.status !== "APPROVED") {
    next.status = "PARTIAL";
  }

  return { state: next, errors };
}

/* ── Path helpers ───────────────────────────────────────────────────────────────────── */

/** Read a dotted path ("emergencyContact.phone") off an object. */
export function getPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

/**
 * Write a dotted path into a patch object, creating intermediate objects.
 *
 * Merging matters here: `employees.data.kyc` holds pan, aadhaar, passport and uan
 * together, so writing `kyc.pan` by assigning a fresh `{ pan }` would silently drop the
 * other three. The caller seeds `patch` with the employee's current nested objects.
 */
export function setPath(patch: any, path: string, value: any): void {
  const parts = path.split(".");
  let node = patch;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (node[k] == null || typeof node[k] !== "object") node[k] = {};
    node = node[k];
  }
  node[parts[parts.length - 1]] = value;
}

/* ── Commit ─────────────────────────────────────────────────────────────────────────── */

export interface CommitChange {
  path: string;
  label: string;
  from: any;
  to: any;
}

/**
 * Work out what approving this case would change on the employee record.
 *
 * Pure: it reads, compares and returns. Nothing is written. This is what the HR review
 * screen renders as its side-by-side diff, and what commitToEmployee() then applies, so
 * the preview and the write can never disagree about what is about to happen.
 */
export function diffAgainstEmployee(caseDoc: any, employee: any): CommitChange[] {
  const sections: Section[] = caseDoc?.templateSnapshot || [];
  const out: CommitChange[] = [];

  for (const s of sections) {
    const state: SectionState = caseDoc.sections?.[s.key] || { status: "EMPTY", values: {} };
    for (const f of s.fields || []) {
      if (!f.mapsTo) continue;
      const to = normaliseAnswer(f, state.values?.[f.key]);
      if (to === undefined || to === null || to === "") continue;
      const from = getPath(employee || {}, f.mapsTo);
      if (String(from ?? "") === String(to)) continue;
      out.push({ path: f.mapsTo, label: f.label, from: from ?? null, to });
    }
  }

  return out;
}

/** The repeating sections, mapped onto the arrays they commit into on the employee. */
const REPEATING_TARGET: Record<string, string> = {
  EMPLOYMENT_HISTORY: "employmentHistory",
  EDUCATION: "education",
  DEPENDENTS: "dependents",
};

/**
 * Build the `employees` patch for an approved case, plus the audit record of what changed.
 *
 * Split out from the write itself so it can be unit-tested without a database, and so the
 * review screen can show the exact patch that is about to be applied.
 */
export function buildEmployeePatch(caseDoc: any, employee: any) {
  const changes = diffAgainstEmployee(caseDoc, employee);
  const patch: any = {};

  // Seed the nested objects we are about to touch, so a partial write never drops a sibling.
  for (const { path } of changes) {
    const root = path.split(".")[0];
    if (path.includes(".") && patch[root] === undefined) {
      patch[root] = { ...((employee || {})[root] || {}) };
    }
  }
  for (const { path, to } of changes) setPath(patch, path, to);

  // Repeating sections replace their array wholesale: the person is restating their full
  // history, not appending to it, and appending would duplicate every row on a resubmission.
  //
  // But an untouched section must not replace anything. An optional "previous employment"
  // section that somebody never opened arrives here as `rows: []`, and replacing on that
  // would silently delete an existing employee's entire work history the first time they
  // completed a data-collection campaign. So a section only writes when it was actually
  // filled in, or when the person deliberately edited it (which is how clearing the last
  // remaining row still works).
  const sections: Section[] = caseDoc?.templateSnapshot || [];
  for (const s of sections) {
    const target = REPEATING_TARGET[s.kind];
    if (!target) continue;
    const state: SectionState | undefined = caseDoc.sections?.[s.key];
    const rows = state?.rows;
    if (!Array.isArray(rows)) continue;

    const touched = !!state?.updatedAt;
    if (!rows.length && !touched) continue;

    const before = (employee || {})[target];
    patch[target] = rows.map((row: any) => ({
      id: row.id || uuid(),
      ...row,
      verified: true,
      verifiedAt: new Date().toISOString(),
    }));
    changes.push({
      path: target,
      label: s.title,
      from: Array.isArray(before) ? before.length : 0,
      to: rows.length,
    });
  }

  return { patch, changes };
}
