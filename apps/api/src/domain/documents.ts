/**
 * Document classification, scoping and search.
 *
 * Two problems this solves.
 *
 * 1. Visibility was binary, PRIVATE (the owner only) or SHARED (the entire
 *    organisation). There was no way to publish a policy to Engineering
 *    without publishing it to everyone, which is the normal case for an HR
 *    document library.
 *
 * 2. There was no search at all. A tenant with a few hundred policies and a
 *    few thousand employee documents had a flat, unfiltered list.
 *
 * Scoping is deliberately additive rather than hierarchical: a document names
 * the departments it belongs to, and staff always see everything. That keeps
 * the check cheap and easy to reason about when auditing who could see what.
 */

/* ── Visibility ─────────────────────────────────────────────────────────── */

export type Visibility = "PRIVATE" | "DEPARTMENT" | "ORG";

/**
 * Normalise stored visibility.
 *
 * "SHARED" is the historical org-wide value and still exists on live rows, so
 * it maps to ORG rather than being migrated, the data is large, the mapping
 * is unambiguous, and a rename buys nothing.
 */
export function normalizeVisibility(v?: string | null): Visibility {
  const s = String(v ?? "").toUpperCase();
  if (s === "ORG" || s === "SHARED" || s === "PUBLIC") return "ORG";
  if (s === "DEPARTMENT" || s === "DEPT" || s === "DIVISION") return "DEPARTMENT";
  return "PRIVATE";
}

export const VISIBILITIES: { value: Visibility; label: string; help: string }[] = [
  { value: "PRIVATE", label: "Private", help: "Only the employee it belongs to, and HR." },
  { value: "DEPARTMENT", label: "Selected departments", help: "Everyone in the departments you choose, and HR." },
  { value: "ORG", label: "Whole organisation", help: "Every employee can read it." },
];

/* ── Categories ─────────────────────────────────────────────────────────── */

export interface DocCategory {
  value: string;
  label: string;
  group: "IDENTITY" | "EMPLOYMENT" | "FINANCE" | "COMPANY" | "OTHER";
  /** Expected of an employee during onboarding. */
  kyc?: boolean;
  /** HR should verify this before it counts as complete. */
  verifiable?: boolean;
  help?: string;
}

/**
 * Document types, with the Indian KYC set called out explicitly so onboarding
 * can show a real checklist rather than a free-text "category" box.
 */
export const DOC_CATEGORIES: DocCategory[] = [
  // ── Identity / KYC ────────────────────────────────────────────────────
  { value: "PAN", label: "PAN card", group: "IDENTITY", kyc: true, verifiable: true, help: "Permanent Account Number card. Required before the first payroll run." },
  { value: "AADHAAR", label: "Aadhaar card", group: "IDENTITY", kyc: true, verifiable: true, help: "Aadhaar card. The number is stored in full, as PF and ESIC filing need it." },
  { value: "VOTER_ID", label: "Voter ID", group: "IDENTITY", kyc: true, verifiable: true, help: "Elector's photo identity card (EPIC)." },
  { value: "PASSPORT", label: "Passport", group: "IDENTITY", kyc: true, verifiable: true, help: "Photo and address pages." },
  { value: "DRIVING_LICENCE", label: "Driving licence", group: "IDENTITY", kyc: true, verifiable: true },
  { value: "PHOTO", label: "Passport photo", group: "IDENTITY", kyc: true },
  { value: "ADDRESS_CURRENT", label: "Current address proof", group: "IDENTITY", kyc: true, verifiable: true, help: "Rental agreement, or a utility bill under three months old." },
  { value: "ADDRESS_PERMANENT", label: "Permanent address proof", group: "IDENTITY", kyc: true, verifiable: true, help: "Proof for the permanent/home address, if different from the current one." },

  // ── Employment ────────────────────────────────────────────────────────
  { value: "EDUCATION", label: "Educational certificates", group: "EMPLOYMENT", kyc: true, verifiable: true, help: "Degree, diploma and marksheets." },
  { value: "EXPERIENCE", label: "Experience letters", group: "EMPLOYMENT", kyc: true, verifiable: true, help: "From previous employers." },
  { value: "PREV_RELIEVING", label: "Previous relieving letter", group: "EMPLOYMENT", kyc: true, verifiable: true },
  { value: "PREV_PAYSLIP", label: "Previous payslips", group: "EMPLOYMENT", verifiable: true, help: "Usually the last three months, for salary verification." },
  { value: "OFFER_LETTER", label: "Offer letter", group: "EMPLOYMENT", help: "Issued by us. Filed automatically on onboarding." },
  { value: "CONTRACT", label: "Employment contract", group: "EMPLOYMENT", verifiable: true },
  { value: "NDA", label: "NDA / confidentiality", group: "EMPLOYMENT", verifiable: true },
  { value: "RELIEVING", label: "Relieving letter", group: "EMPLOYMENT", help: "Issued by us on exit. Filed automatically." },
  { value: "EXPERIENCE_ISSUED", label: "Experience certificate", group: "EMPLOYMENT", help: "Issued by us on exit." },
  { value: "APPRAISAL", label: "Appraisal / increment letter", group: "EMPLOYMENT" },

  /*
   * Categories the letter routes actually write.
   *
   * letters.routes.ts and separation.routes.ts file issued letters under the letter KIND
   * (RELIEVING_LETTER, APPRAISAL_LETTER and so on), while this catalogue only listed the
   * shorter names above, so every letter HRMS issued showed up in the Documents library
   * with no label and no grouping. Both spellings are kept: the older rows already in the
   * database keep their labels, and the kinds now resolve too.
   */
  { value: "RELIEVING_LETTER", label: "Relieving letter", group: "EMPLOYMENT", help: "Issued by us on exit. Filed automatically." },
  { value: "EXPERIENCE_LETTER", label: "Experience certificate", group: "EMPLOYMENT", help: "Issued by us on exit." },
  { value: "APPRAISAL_LETTER", label: "Appraisal / increment letter", group: "EMPLOYMENT" },
  { value: "CONFIRMATION_LETTER", label: "Confirmation of employment", group: "EMPLOYMENT", help: "Issued when probation is completed." },
  { value: "PROBATION_EXTENSION_LETTER", label: "Probation extension", group: "EMPLOYMENT" },
  { value: "TERMINATION_LETTER", label: "Termination letter", group: "EMPLOYMENT", help: "Issued by us on exit." },
  { value: "RETIREMENT_LETTER", label: "Superannuation letter", group: "EMPLOYMENT", help: "Issued by us on retirement." },
  { value: "ABSCONDING_LETTER", label: "Absence notice", group: "EMPLOYMENT", help: "Warning issued for unauthorised absence." },
  { value: "SETTLEMENT_STATEMENT", label: "Full and final settlement", group: "FINANCE", help: "Issued by us on exit." },

  // ── Finance ───────────────────────────────────────────────────────────
  { value: "BANK", label: "Bank proof", group: "FINANCE", kyc: true, verifiable: true, help: "Cancelled cheque or passbook front page." },
  { value: "PAYSLIP", label: "Payslip", group: "FINANCE", help: "Issued by us. Filed automatically each pay run." },
  { value: "FORM16", label: "Form 16", group: "FINANCE" },
  { value: "TAX_DECLARATION", label: "Tax declaration", group: "FINANCE", help: "Investment declaration for TDS." },
  { value: "REIMBURSEMENT", label: "Reimbursement receipt", group: "FINANCE" },

  // ── Company-wide ──────────────────────────────────────────────────────
  { value: "POLICY", label: "Company policy", group: "COMPANY", help: "Publish to the whole organisation or to specific departments." },
  { value: "HANDBOOK", label: "Handbook / SOP", group: "COMPANY" },
  { value: "TEMPLATE", label: "Form / template", group: "COMPANY" },
  { value: "COMPLIANCE", label: "Compliance / statutory", group: "COMPANY", help: "POSH, registrations, licences." },
  { value: "ANNOUNCEMENT", label: "Circular / notice", group: "COMPANY" },

  { value: "GENERAL", label: "General", group: "OTHER" },
  { value: "OTHER", label: "Other", group: "OTHER" },
];

const CATEGORY_BY_VALUE = new Map(DOC_CATEGORIES.map((c) => [c.value, c]));

export const KYC_CATEGORIES = DOC_CATEGORIES.filter((c) => c.kyc);

export function docCategory(value?: string | null): DocCategory | undefined {
  return value ? CATEGORY_BY_VALUE.get(String(value).toUpperCase()) : undefined;
}

export function docCategoryLabel(value?: string | null): string {
  return docCategory(value)?.label ?? (value || "General");
}

export function isValidCategory(value?: string | null): boolean {
  return !!docCategory(value);
}

/* ── Access ─────────────────────────────────────────────────────────────── */

export interface DocLike {
  employeeId?: string | null;
  visibility?: string | null;
  departmentIds?: string[] | null;
  uploadedBy?: string | null;
}

export interface ViewerLike {
  id: string;
  employeeId?: string | null;
  /** The viewer's own department, for DEPARTMENT-scoped documents. */
  departmentId?: string | null;
}

/**
 * Can this non-staff viewer read the document?
 *
 * Staff bypass this entirely (handled by the caller), they see everything in
 * their RBAC scope. This function answers only the employee-portal question.
 */
export function canRead(doc: DocLike, viewer: ViewerLike): boolean {
  const visibility = normalizeVisibility(doc.visibility);

  // Anything attached to you personally is yours to read, whatever the
  // visibility says, an employee's own payslip is PRIVATE but still theirs.
  if (doc.employeeId && viewer.employeeId && doc.employeeId === viewer.employeeId) return true;

  // A personal document belonging to someone else is never readable.
  if (doc.employeeId) return false;

  if (visibility === "ORG") return true;

  if (visibility === "DEPARTMENT") {
    const depts = Array.isArray(doc.departmentIds) ? doc.departmentIds : [];
    // A department-scoped document with no departments named would otherwise
    // be readable by nobody, which is a silent trap for whoever published it;
    // treat it as org-wide and surface the omission in the UI instead.
    if (!depts.length) return true;
    return !!viewer.departmentId && depts.includes(viewer.departmentId);
  }

  return false;
}

/* ── Search ─────────────────────────────────────────────────────────────── */

const TOKEN_SPLIT = /[\s,;]+/;

/**
 * Rank documents against a free-text query.
 *
 * Deliberately simple substring-and-token matching rather than Postgres
 * full-text: documents live in a JSONB column, tenants are small enough that
 * this runs in memory, and it means no migration and no index to keep in sync.
 * If a tenant ever outgrows it, this is the one function to replace.
 *
 * Returns null when the document does not match at all, so callers can filter
 * and sort in one pass.
 */
export function searchScore(
  doc: {
    title?: string | null;
    description?: string | null;
    category?: string | null;
    tags?: string[] | null;
    originalName?: string | null;
    employeeName?: string | null;
  },
  query: string
): number | null {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return 0;

  const title = String(doc.title ?? "").toLowerCase();
  const description = String(doc.description ?? "").toLowerCase();
  const categoryLabel = docCategoryLabel(doc.category).toLowerCase();
  const tags = (Array.isArray(doc.tags) ? doc.tags : []).map((t) => String(t).toLowerCase());
  const filename = String(doc.originalName ?? "").toLowerCase();
  const person = String(doc.employeeName ?? "").toLowerCase();

  let score = 0;

  // Whole-phrase hits rank above scattered token hits.
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 60;
  else if (title.includes(q)) score += 40;
  if (tags.includes(q)) score += 50;
  if (categoryLabel.includes(q)) score += 20;
  if (description.includes(q)) score += 12;
  if (filename.includes(q)) score += 10;
  if (person.includes(q)) score += 25;

  // Every token must appear somewhere, so "leave policy" doesn't match a
  // document that only says "leave".
  const tokens = q.split(TOKEN_SPLIT).filter(Boolean);
  if (tokens.length > 1) {
    const haystack = [title, description, categoryLabel, filename, person, ...tags].join(" ");
    if (!tokens.every((t) => haystack.includes(t))) return score > 0 ? score : null;
    score += 15;
  }

  return score > 0 ? score : null;
}

/** Normalise a tag list from user input: trimmed, de-duplicated, capped. */
export function normalizeTags(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? "").split(TOKEN_SPLIT);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const tag = String(t ?? "").trim().replace(/^#/, "").slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Which required KYC documents is an employee still missing?
 * Drives the onboarding checklist and the "documents pending" nudge.
 */
export function missingKyc(
  uploaded: { category?: string | null; verified?: boolean }[],
  opts: { requireVerified?: boolean } = {}
): DocCategory[] {
  const have = new Set(
    uploaded
      .filter((d) => (opts.requireVerified ? d.verified : true))
      .map((d) => String(d.category ?? "").toUpperCase())
  );
  // One of the government photo IDs satisfies the "photo ID" requirement, so
  // don't demand all four.
  const PHOTO_IDS = ["AADHAAR", "PASSPORT", "VOTER_ID", "DRIVING_LICENCE"];
  const hasPhotoId = PHOTO_IDS.some((c) => have.has(c));

  return KYC_CATEGORIES.filter((c) => {
    if (PHOTO_IDS.includes(c.value)) return c.value === "AADHAAR" ? !hasPhotoId : false;
    return !have.has(c.value);
  });
}
