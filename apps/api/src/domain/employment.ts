/**
 * Engagement types, the single source of truth for what kind of person is on
 * the books, and what that implies statutorily.
 *
 * This matters beyond a dropdown label: whether Provident Fund applies, whether
 * leave accrues, whether gratuity can ever vest and how the person is paid all
 * follow from this field. Putting the rules next to the type keeps payroll,
 * leave and onboarding from each inventing their own answer.
 *
 * Back-compatibility: PART_TIME / CONTRACT / OUTSOURCED are the original three
 * values and still exist in live data, so they remain valid on read and are
 * mapped onto their modern equivalent for rule lookups. They are hidden from
 * new onboarding UI (`legacy: true`).
 */

export type PayMode = "SALARY" | "STIPEND" | "PROFESSIONAL_FEE" | "VENDOR_INVOICE";

export interface EmploymentTypeDef {
  value: string;
  label: string;
  description: string;
  /** How the person is paid, which drives payslip vs. invoice treatment. */
  payMode: PayMode;
  /** On payroll at all? Vendors are billed through the vendor module instead. */
  onPayroll: boolean;
  /** Employees' Provident Fund (EPF) applies. */
  pf: boolean;
  /** Employees' State Insurance applies (subject to the gross wage threshold). */
  esi: boolean;
  /** State professional tax is deducted. */
  professionalTax: boolean;
  /** Can accrue gratuity (vests at 5 years of continuous service). */
  gratuityEligible: boolean;
  /** Accrues paid leave from the org's leave types. */
  accruesLeave: boolean;
  /** Default probation in months; 0 means none. */
  probationMonths: number;
  /** TDS section typically applied, for the payroll notes. */
  tdsSection: string;
  /** Hidden from new-onboarding pickers but still valid on existing records. */
  legacy?: boolean;
  /** For legacy values, the modern type whose rules they follow. */
  aliasOf?: string;
}

export const EMPLOYMENT_TYPES: EmploymentTypeDef[] = [
  {
    value: "PERMANENT",
    label: "Permanent",
    description: "Confirmed employee on the company's rolls with no end date.",
    payMode: "SALARY",
    onPayroll: true,
    pf: true,
    esi: true,
    professionalTax: true,
    gratuityEligible: true,
    accruesLeave: true,
    probationMonths: 6,
    tdsSection: "192",
  },
  {
    value: "FULL_TIME",
    label: "Full-time",
    description: "Full-time employee, typically on a fixed-term contract.",
    payMode: "SALARY",
    onPayroll: true,
    pf: true,
    esi: true,
    professionalTax: true,
    gratuityEligible: true,
    accruesLeave: true,
    probationMonths: 6,
    tdsSection: "192",
  },
  {
    value: "FREELANCER",
    label: "Freelancer",
    description:
      "Independent professional paid a fee against an invoice. No statutory deductions; TDS under 194J.",
    payMode: "PROFESSIONAL_FEE",
    onPayroll: true,
    pf: false,
    esi: false,
    professionalTax: false,
    gratuityEligible: false,
    accruesLeave: false,
    probationMonths: 0,
    tdsSection: "194J",
  },
  {
    value: "INTERN",
    label: "Intern",
    description: "Trainee on a stipend for a fixed period. Limited leave, no gratuity.",
    payMode: "STIPEND",
    onPayroll: true,
    pf: false,
    esi: false,
    professionalTax: false,
    gratuityEligible: false,
    accruesLeave: true,
    probationMonths: 0,
    tdsSection: "192",
  },
  {
    value: "TEMPORARY",
    label: "Temporary",
    description:
      "Short-term staff on the rolls for a defined period. Statutory deductions apply; service is too short for gratuity.",
    payMode: "SALARY",
    onPayroll: true,
    pf: true,
    esi: true,
    professionalTax: true,
    gratuityEligible: false,
    accruesLeave: true,
    probationMonths: 0,
    tdsSection: "192",
  },
  {
    value: "VENDOR",
    label: "Vendor / contractor",
    description:
      "Supplied by a third party or engaged as a contractor. Off payroll, paid against vendor invoices.",
    payMode: "VENDOR_INVOICE",
    onPayroll: false,
    pf: false,
    esi: false,
    professionalTax: false,
    gratuityEligible: false,
    accruesLeave: false,
    probationMonths: 0,
    tdsSection: "194C",
  },

  // ── Legacy values, retained so existing records stay valid ──────────────
  {
    value: "PART_TIME",
    label: "Part-time",
    description: "Legacy value. Treated as temporary staff for statutory purposes.",
    payMode: "SALARY",
    onPayroll: true,
    pf: true,
    esi: true,
    professionalTax: true,
    gratuityEligible: false,
    accruesLeave: true,
    probationMonths: 0,
    tdsSection: "192",
    legacy: true,
    aliasOf: "TEMPORARY",
  },
  {
    value: "CONTRACT",
    label: "Contract",
    description: "Legacy value. Treated as a freelancer for statutory purposes.",
    payMode: "PROFESSIONAL_FEE",
    onPayroll: true,
    pf: false,
    esi: false,
    professionalTax: false,
    gratuityEligible: false,
    accruesLeave: false,
    probationMonths: 0,
    tdsSection: "194J",
    legacy: true,
    aliasOf: "FREELANCER",
  },
  {
    value: "OUTSOURCED",
    label: "Outsourced",
    description: "Legacy value. Treated as a vendor-supplied contractor.",
    payMode: "VENDOR_INVOICE",
    onPayroll: false,
    pf: false,
    esi: false,
    professionalTax: false,
    gratuityEligible: false,
    accruesLeave: false,
    probationMonths: 0,
    tdsSection: "194C",
    legacy: true,
    aliasOf: "VENDOR",
  },
];

/** Every accepted value, including legacy ones. Use for write validation. */
export const EMPLOYMENT_TYPE_VALUES = EMPLOYMENT_TYPES.map((t) => t.value);

/** Only the types offered for new onboarding. Use for pickers and templates. */
export const CURRENT_EMPLOYMENT_TYPES = EMPLOYMENT_TYPES.filter((t) => !t.legacy);

const BY_VALUE = new Map(EMPLOYMENT_TYPES.map((t) => [t.value, t]));

export function employmentType(value?: string | null): EmploymentTypeDef | null {
  return value ? BY_VALUE.get(String(value).toUpperCase().trim()) ?? null : null;
}

export function employmentTypeLabel(value?: string | null): string {
  return employmentType(value)?.label ?? (value || "-");
}

export function isEmploymentType(value?: string | null): boolean {
  return !!employmentType(value);
}

/**
 * Resolve a free-text cell from an uploaded sheet to a canonical type.
 * Accepts the enum value, the human label, and the common ways people write
 * these in a spreadsheet ("full time", "Full-Time", "permanent employee").
 */
export function normalizeEmploymentType(input?: string | null): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const squashed = raw.toUpperCase().replace(/[\s\-_/]+/g, "_");
  if (BY_VALUE.has(squashed)) return squashed;

  const loose = raw.toLowerCase().replace(/[\s\-_/]+/g, "");
  for (const t of EMPLOYMENT_TYPES) {
    if (t.label.toLowerCase().replace(/[\s\-_/]+/g, "") === loose) return t.value;
    if (t.value.toLowerCase().replace(/_/g, "") === loose) return t.value;
  }

  const SYNONYMS: Record<string, string> = {
    permanentemployee: "PERMANENT",
    confirmed: "PERMANENT",
    fulltimeemployee: "FULL_TIME",
    ft: "FULL_TIME",
    freelance: "FREELANCER",
    consultant: "FREELANCER",
    contractor: "FREELANCER",
    internship: "INTERN",
    trainee: "INTERN",
    temp: "TEMPORARY",
    temporaryemployee: "TEMPORARY",
    parttime: "PART_TIME",
    pt: "PART_TIME",
    vendoremployee: "VENDOR",
    outsource: "OUTSOURCED",
    thirdparty: "VENDOR",
  };
  return SYNONYMS[loose] ?? null;
}

/** Statutory rules for a value, following the alias for legacy types. */
export function employmentRules(value?: string | null): EmploymentTypeDef {
  const t = employmentType(value);
  if (!t) return BY_VALUE.get("FULL_TIME")!;
  return t.aliasOf ? BY_VALUE.get(t.aliasOf) ?? t : t;
}

/**
 * Default monthly salary breakdown for a type, given a gross.
 *
 * Basic is set at 50% of gross, which is the common Indian structure and keeps
 * PF (computed on basic) at a defensible level rather than the 40% that gets
 * flagged in audits. Fee-based engagements are a single line with no split.
 */
export function defaultSalaryBreakdown(
  type: string | null | undefined,
  gross: number
): { basic: number; hra: number; allowances: number; deductions: number } {
  const g = Math.max(0, Math.round(Number(gross) || 0));
  const rules = employmentRules(type);

  if (rules.payMode === "PROFESSIONAL_FEE" || rules.payMode === "VENDOR_INVOICE") {
    // A fee is not a salary, no basic/HRA split, no statutory deduction.
    return { basic: g, hra: 0, allowances: 0, deductions: 0 };
  }
  if (rules.payMode === "STIPEND") {
    return { basic: g, hra: 0, allowances: 0, deductions: 0 };
  }

  const basic = Math.round(g * 0.5);
  const hra = Math.round(basic * 0.4);
  const allowances = Math.max(0, g - basic - hra);
  // Employee PF at 12% of basic, capped at the ₹15,000 statutory wage ceiling.
  const deductions = rules.pf ? Math.round(Math.min(basic, 15000) * 0.12) : 0;
  return { basic, hra, allowances, deductions };
}
