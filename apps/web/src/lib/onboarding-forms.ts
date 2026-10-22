/**
 * Shapes for the onboarding FORM system: templates, cases and campaigns.
 *
 * Kept apart from lib/onboarding.ts, which covers the older pre-hire invite flow. The two
 * coexist: an invite emails a candidate a token link, a case is the form itself and is what
 * both a candidate and an existing employee actually fill in.
 *
 * These mirror apps/api/src/onboarding-template.ts and apps/api/src/onboarding-case.ts. Anything the
 * builder can offer is served by GET /onboarding-templates/meta rather than duplicated here,
 * so a field type added on the server cannot go missing in the UI.
 */

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

export type FieldType =
  | "text" | "textarea" | "email" | "phone" | "date" | "number"
  | "select" | "multiselect" | "checkbox" | "address" | "file";

export interface TemplateField {
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
  pattern?: string;
  mapsTo?: string;
  proofCategory?: string;
}

export interface DocumentRequirement {
  category: string;
  required?: boolean;
  help?: string;
  employmentTypes?: string[];
}

export interface AssetsSectionConfig {
  mode: "ACKNOWLEDGE" | "DECLARE" | "BOTH";
  requireSerialConfirmation?: boolean;
  requirePhoto?: boolean;
  allowedCategories?: string[];
  issueCustodyForm?: boolean;
}

export interface TemplateSection {
  key: string;
  kind: SectionKind;
  title: string;
  description?: string;
  optional?: boolean;
  employmentTypes?: string[];
  fields?: TemplateField[];
  documents?: DocumentRequirement[];
  minRows?: number;
  maxRows?: number;
  assets?: AssetsSectionConfig;
  policyIds?: string[];
  declarationText?: string;
}

export interface OnboardingTemplate {
  id: string;
  name: string;
  description?: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isDefault: boolean;
  presetKey: string | null;
  version: number;
  dueDays: number;
  reminderOffsets: number[];
  escalateAfterDays: number;
  appliesTo: { employmentTypes: string[]; departmentIds: string[] };
  sections: TemplateSection[];
  summary: { sections: number; fields: number; documents: number; mapped: number };
  createdAt: string;
  updatedAt: string;
}

/** GET /onboarding-templates/meta, the builder's palette. */
export interface BuilderMeta {
  sectionKinds: { value: SectionKind; label: string; help: string; repeating?: boolean }[];
  fieldTypes: { value: FieldType; label: string; help: string }[];
  patterns: { key: string; label: string; regex: string; hint: string }[];
  mappablePaths: { path: string; label: string; tier: "ROUTINE" | "IDENTITY" | "FINANCIAL" }[];
  documentCategories: { value: string; label: string; group: string; kyc?: boolean; help?: string }[];
  assetCategories: string[];
  employmentTypes: { value: string; label: string }[];
  presets: { presetKey: string; name: string; description?: string; sections: number; fields: number }[];
}

/* ── Cases ──────────────────────────────────────────────────────────────────────────── */

export type CaseStatus =
  | "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED"
  | "CHANGES_REQUESTED" | "APPROVED" | "EXPIRED" | "CANCELLED";

export type SectionStatus = "EMPTY" | "PARTIAL" | "COMPLETE" | "APPROVED" | "CHANGES_REQUESTED";

export interface SectionState {
  status: SectionStatus;
  values: Record<string, unknown>;
  rows?: Record<string, unknown>[];
  note?: string;
  reviewedAt?: string | null;
}

export interface SectionCheck {
  key: string;
  title: string;
  optional: boolean;
  status: SectionStatus;
  errors: string[];
  filled: number;
  requiredTotal: number;
}

export interface CaseDocument {
  sectionKey: string;
  category: string;
  documentId: string;
  uploadedAt?: string;
  document?: { id: string; originalName: string; categoryLabel: string; verified?: boolean; extraction?: unknown };
}

export interface AcknowledgedAsset {
  assetId: string;
  received: boolean;
  serial?: string;
  serialConfirmed?: boolean;
  discrepancy?: boolean;
  condition?: string;
  note?: string;
}

export interface DeclaredAsset {
  id: string;
  category: string;
  name: string;
  serial?: string;
  condition?: string;
  receivedOn?: string | null;
  note?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

export interface OnboardingCase {
  id: string;
  status: CaseStatus;
  dueAt: string | null;
  employeeId: string | null;
  campaignId: string | null;
  templateName: string;
  templateSnapshot: TemplateSection[];
  sections: Record<string, SectionState>;
  documents: CaseDocument[];
  assets: { acknowledged: AcknowledgedAsset[]; declared: DeclaredAsset[] };
  acknowledgments: { policyId: string; acceptedAt: string }[];
  declaration: { fullName: string; acceptedAt: string } | null;
  submittedAt: string | null;
  checks: SectionCheck[];
  progress: { done: number; total: number; percent: number };
  submit: {
    ok: boolean;
    blocking: { key: string; title: string; errors: string[] }[];
    warnings: { key: string; title: string; errors: string[] }[];
  };
}

/** A row in HR's review queue. */
export interface CaseListItem {
  id: string;
  status: CaseStatus;
  dueAt: string | null;
  overdue: boolean;
  campaignId: string | null;
  templateName: string;
  submittedAt: string | null;
  createdAt: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  departmentId: string | null;
  sectionsDone: number;
  sectionsTotal: number;
  pendingReview: number;
}

export interface CaseDiff {
  path: string;
  label: string;
  from: unknown;
  to: unknown;
}

export interface CaseDetail extends OnboardingCase {
  employee: { id: string; name: string; code: string; employmentType: string; departmentId: string | null } | null;
  diff: CaseDiff[];
  issuedAssets: { id: string; name: string; category: string; serial?: string; status: string }[];
  overdue: boolean;
}

/* ── Campaigns ──────────────────────────────────────────────────────────────────────── */

export type AudienceMode = "ALL" | "DEPARTMENT" | "EMPLOYMENT_TYPE" | "INCOMPLETE" | "SELECTED";

export interface Audience {
  mode: AudienceMode;
  departmentIds?: string[];
  employmentTypes?: string[];
  employeeIds?: string[];
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  message?: string;
  templateId: string;
  templateName: string;
  audience: Audience;
  status: "DRAFT" | "LAUNCHING" | "RUNNING" | "CLOSED" | "CANCELLED";
  dueAt: string | null;
  launchedAt?: string | null;
  skipped?: { id: string; name: string; reason: string }[];
  stats: {
    total: number; notStarted: number; inProgress: number;
    submitted: number; approved: number; overdue: number;
    cancelled: number; expired: number;
  };
  createdAt: string;
}

export interface AudiencePreview {
  audience: Audience;
  included: { id: string; name: string; code: string; email: string; department: string | null; employmentType: string }[];
  skipped: { id: string; name: string; code: string; reason: string }[];
  counts: { included: number; skipped: number };
}

/* ── Display helpers ────────────────────────────────────────────────────────────────── */

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Awaiting review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

export const CASE_STATUS_VARIANT: Record<CaseStatus, "green" | "amber" | "red" | "blue" | "grey" | "violet"> = {
  NOT_STARTED: "grey",
  IN_PROGRESS: "blue",
  SUBMITTED: "amber",
  CHANGES_REQUESTED: "red",
  APPROVED: "green",
  EXPIRED: "red",
  CANCELLED: "grey",
};

export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
  EMPTY: "Not started",
  PARTIAL: "In progress",
  COMPLETE: "Ready",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Needs changes",
};

export const SECTION_STATUS_VARIANT: Record<SectionStatus, "green" | "amber" | "red" | "blue" | "grey"> = {
  EMPTY: "grey",
  PARTIAL: "blue",
  COMPLETE: "amber",
  APPROVED: "green",
  CHANGES_REQUESTED: "red",
};

/** Repeating sections hold `rows`; everything else holds `values`. */
export const isRepeatingKind = (kind: SectionKind) =>
  kind === "EMPLOYMENT_HISTORY" || kind === "EDUCATION" || kind === "DEPENDENTS";

/** "in 3 days" / "tomorrow" / "2 days ago". Empty when there is no deadline. */
export function dueLabel(dueAt?: string | null): string {
  if (!dueAt) return "";
  const days = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86400000);
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

export function formatDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
