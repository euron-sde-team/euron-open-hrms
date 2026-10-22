// Engagement types, mirrors apps/api/src/employment.ts, which is the source of
// truth for the statutory rules. Keep the two in sync: the backend validates
// against its own list, so a value that exists only here will be rejected.
//
// PART_TIME / CONTRACT / OUTSOURCED are the original three values and still
// exist in live records. They stay here so old rows render with a proper
// label, but they're flagged legacy and hidden from new-onboarding pickers.

export interface EmploymentTypeDef {
  value: string;
  label: string;
  description: string;
  /** Statutory flags, used to explain consequences at the point of choosing. */
  pf: boolean;
  esi: boolean;
  professionalTax: boolean;
  gratuityEligible: boolean;
  accruesLeave: boolean;
  onPayroll: boolean;
  legacy?: boolean;
}

export const EMPLOYMENT_TYPES: EmploymentTypeDef[] = [
  {
    value: "PERMANENT",
    label: "Permanent",
    description: "Confirmed employee with no end date.",
    pf: true, esi: true, professionalTax: true, gratuityEligible: true, accruesLeave: true, onPayroll: true,
  },
  {
    value: "FULL_TIME",
    label: "Full-time",
    description: "Full-time employee, typically fixed-term.",
    pf: true, esi: true, professionalTax: true, gratuityEligible: true, accruesLeave: true, onPayroll: true,
  },
  {
    value: "FREELANCER",
    label: "Freelancer",
    description: "Paid a fee against an invoice. TDS under 194J, no statutory deductions.",
    pf: false, esi: false, professionalTax: false, gratuityEligible: false, accruesLeave: false, onPayroll: true,
  },
  {
    value: "INTERN",
    label: "Intern",
    description: "Trainee on a stipend for a fixed period.",
    pf: false, esi: false, professionalTax: false, gratuityEligible: false, accruesLeave: true, onPayroll: true,
  },
  {
    value: "TEMPORARY",
    label: "Temporary",
    description: "Short-term staff on the rolls. Statutory deductions apply; no gratuity.",
    pf: true, esi: true, professionalTax: true, gratuityEligible: false, accruesLeave: true, onPayroll: true,
  },
  {
    value: "VENDOR",
    label: "Vendor / contractor",
    description: "Off payroll, paid against vendor invoices.",
    pf: false, esi: false, professionalTax: false, gratuityEligible: false, accruesLeave: false, onPayroll: false,
  },

  // Legacy, valid on existing records, hidden from new onboarding.
  {
    value: "PART_TIME", label: "Part-time", description: "Legacy value.",
    pf: true, esi: true, professionalTax: true, gratuityEligible: false, accruesLeave: true, onPayroll: true, legacy: true,
  },
  {
    value: "CONTRACT", label: "Contract", description: "Legacy value.",
    pf: false, esi: false, professionalTax: false, gratuityEligible: false, accruesLeave: false, onPayroll: true, legacy: true,
  },
  {
    value: "OUTSOURCED", label: "Outsourced", description: "Legacy value.",
    pf: false, esi: false, professionalTax: false, gratuityEligible: false, accruesLeave: false, onPayroll: false, legacy: true,
  },
];

/** Types offered when onboarding someone new. */
export const CURRENT_EMPLOYMENT_TYPES = EMPLOYMENT_TYPES.filter((t) => !t.legacy);

const BY_VALUE = new Map(EMPLOYMENT_TYPES.map((t) => [t.value, t]));

export function employmentType(value?: string | null): EmploymentTypeDef | undefined {
  return value ? BY_VALUE.get(value) : undefined;
}

/** Friendly label for an employment-type value (e.g. FULL_TIME → "Full-time"). */
export function employmentTypeLabel(value?: string | null): string {
  if (!value) return "-";
  return BY_VALUE.get(value)?.label ?? value;
}

/**
 * Options for a picker: the current types, plus whichever legacy type the
 * record already carries, so editing an old employee doesn't silently
 * reassign them to something else.
 */
export function employmentTypeOptions(currentValue?: string | null): EmploymentTypeDef[] {
  const legacy = currentValue ? BY_VALUE.get(currentValue) : undefined;
  return legacy?.legacy ? [...CURRENT_EMPLOYMENT_TYPES, legacy] : CURRENT_EMPLOYMENT_TYPES;
}

/** Headcount summary like "3 Permanent · 1 Intern", only types with a count. */
export function employmentBreakdown(byType: Record<string, number> = {}): string {
  const parts = EMPLOYMENT_TYPES.filter((t) => byType[t.value]).map((t) => `${byType[t.value]} ${t.label}`);
  return parts.join(" · ") || "No employees";
}
