/**
 * Standard Indian leave catalogue and eligibility.
 *
 * The org previously seeded four leave types with a flat annual quota that
 * applied to everyone equally. Two things were wrong with that in an Indian
 * context:
 *
 *   - Statutory leave (maternity, paternity, bereavement, marriage) was
 *     missing entirely, so HR tracked it outside the system.
 *   - Quota did not depend on engagement type. An intern on a six-month
 *     stipend accrued the same 15 earned-leave days as a permanent employee,
 *     and a freelancer paid against invoices accrued leave at all, which is
 *     not a thing that should happen.
 *
 * Eligibility is therefore derived from server/employment.ts rather than
 * restated here, so the two cannot disagree.
 */

import { employmentRules } from "./employment";

export interface LeaveTypeDef {
  key: string;
  name: string;
  /** Annual entitlement for a full-time permanent employee. */
  maxPerYear: number;
  paid: boolean;
  /** Days that may roll into next year. 0 = use it or lose it. */
  carryForwardCap: number;
  /** Unused balance is paid out at separation. */
  encashable: boolean;
  /** Accrues month by month rather than being granted up front. */
  accrualMonthly: boolean;
  /**
   * Counts toward the company's monthly paid-leave limit, when that rule is on
   * (see leave-rules.ts). Block leave for a life event is not a monthly habit.
   */
  countsTowardMonthlyLimit: boolean;
  /** A long request needs advance notice, when that rule is on. Unplanned absence is exempt. */
  needsAdvanceNotice: boolean;
  /** Restricted to a gender, where the statute is gendered. */
  appliesTo?: "ALL" | "FEMALE" | "MALE";
  /** Engagement types that get this leave. Empty = every on-payroll type. */
  onlyTypes?: string[];
  description: string;
  statutory?: string;
}

export const LEAVE_CATALOGUE: LeaveTypeDef[] = [
  {
    key: "CASUAL",
    name: "Casual Leave",
    maxPerYear: 12,
    paid: true,
    carryForwardCap: 0,
    encashable: false,
    accrualMonthly: true,
    countsTowardMonthlyLimit: true,
    needsAdvanceNotice: true,
    description: "Short, unplanned personal absences. Typically not carried forward.",
  },
  {
    key: "SICK",
    name: "Sick Leave",
    maxPerYear: 12,
    paid: true,
    carryForwardCap: 0,
    encashable: false,
    accrualMonthly: true,
    countsTowardMonthlyLimit: true,
    needsAdvanceNotice: false,
    description: "Illness and medical appointments. A medical certificate may be required beyond three consecutive days.",
  },
  {
    key: "EARNED",
    name: "Earned / Privilege Leave",
    maxPerYear: 15,
    paid: true,
    carryForwardCap: 30,
    encashable: true,
    accrualMonthly: true,
    countsTowardMonthlyLimit: true,
    needsAdvanceNotice: true,
    description: "Planned leave, accrued monthly. Carries forward up to the cap and is encashed at separation.",
    statutory: "Shops & Establishments Acts generally mandate 15-18 days of annual leave with wages.",
  },
  {
    key: "MATERNITY",
    name: "Maternity Leave",
    maxPerYear: 182,
    paid: true,
    carryForwardCap: 0,
    encashable: false,
    accrualMonthly: false,
    countsTowardMonthlyLimit: false,
    needsAdvanceNotice: true,
    appliesTo: "FEMALE",
    description: "26 weeks for the first two children, 12 weeks thereafter. Granted as a block, not accrued.",
    statutory: "Maternity Benefit Act 1961, as amended 2017.",
  },
  {
    key: "PATERNITY",
    name: "Paternity Leave",
    maxPerYear: 15,
    paid: true,
    carryForwardCap: 0,
    encashable: false,
    accrualMonthly: false,
    countsTowardMonthlyLimit: false,
    needsAdvanceNotice: true,
    appliesTo: "MALE",
    description: "Company-provided leave for new fathers and partners. Not statutory in the private sector.",
  },
  {
    key: "BEREAVEMENT",
    name: "Bereavement Leave",
    maxPerYear: 5,
    paid: true,
    carryForwardCap: 0,
    encashable: false,
    accrualMonthly: false,
    countsTowardMonthlyLimit: false,
    needsAdvanceNotice: false,
    description: "On the death of an immediate family member.",
  },
  {
    key: "MARRIAGE",
    name: "Marriage Leave",
    maxPerYear: 5,
    paid: true,
    carryForwardCap: 0,
    encashable: false,
    accrualMonthly: false,
    countsTowardMonthlyLimit: false,
    needsAdvanceNotice: true,
    description: "One-time leave around the employee's own marriage.",
  },
  {
    key: "COMP_OFF",
    name: "Compensatory Off",
    maxPerYear: 0,
    paid: true,
    carryForwardCap: 0,
    encashable: false,
    accrualMonthly: false,
    countsTowardMonthlyLimit: false,
    needsAdvanceNotice: true,
    description: "Granted case by case against approved work on a holiday or weekend. No standing quota.",
  },
  {
    key: "LOP",
    name: "Loss of Pay",
    maxPerYear: 0,
    paid: false,
    carryForwardCap: 0,
    encashable: false,
    accrualMonthly: false,
    countsTowardMonthlyLimit: false,
    needsAdvanceNotice: true,
    description: "Unpaid absence. Always available, and deducted from that month's salary.",
  },
];

const BY_KEY = new Map(LEAVE_CATALOGUE.map((t) => [t.key, t]));
export const leaveType = (key: string) => BY_KEY.get(key);

/* ── Eligibility ────────────────────────────────────────────────────────── */

export interface EligibilityInput {
  employmentType?: string | null;
  gender?: string | null;
  /** ISO date. Used to pro-rate the first year. */
  joiningDate?: string | null;
  /** Year being computed. Defaults to the current year. */
  year?: number;
}

export interface Entitlement {
  key: string;
  name: string;
  /** Days this person actually gets this year, after pro-rating. */
  days: number;
  paid: boolean;
  carryForwardCap: number;
  encashable: boolean;
  /** Why the number is what it is, surfaced in the UI. */
  reason: string;
  eligible: boolean;
}

/** Whole months of the year remaining on/after the joining date. */
function monthsInYear(joiningDate: string | null | undefined, year: number): number {
  if (!joiningDate) return 12;
  const d = new Date(`${joiningDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return 12;
  if (d.getUTCFullYear() < year) return 12;
  if (d.getUTCFullYear() > year) return 0;
  // Joining on or before the 15th counts that month as a full accrual month,
  // which is the common Indian payroll convention.
  const startMonth = d.getUTCMonth() + (d.getUTCDate() <= 15 ? 0 : 1);
  return Math.max(0, 12 - startMonth);
}

/**
 * What leave does this person actually get?
 *
 * Returns every catalogue type with an `eligible` flag and a stated reason, so
 * the UI can show "Maternity Leave, not applicable to this engagement type"
 * rather than silently omitting rows and leaving HR wondering.
 */
export function entitlements(input: EligibilityInput): Entitlement[] {
  const year = input.year ?? new Date().getUTCFullYear();
  const rules = employmentRules(input.employmentType);
  const months = monthsInYear(input.joiningDate, year);
  const gender = String(input.gender ?? "").toUpperCase();

  return LEAVE_CATALOGUE.map((t) => {
    const base: Omit<Entitlement, "days" | "reason" | "eligible"> = {
      key: t.key,
      name: t.name,
      paid: t.paid,
      carryForwardCap: t.carryForwardCap,
      encashable: t.encashable,
    };

    // Loss of pay is always available, it is the absence of an entitlement,
    // not an entitlement, so no eligibility rule should remove it.
    if (t.key === "LOP") {
      return { ...base, days: 0, eligible: true, reason: "Unpaid; always available." };
    }

    if (!rules.accruesLeave) {
      return {
        ...base,
        days: 0,
        eligible: false,
        reason: `Not applicable, ${String(input.employmentType ?? "this engagement").toLowerCase().replace(/_/g, " ")} engagements do not accrue paid leave.`,
      };
    }

    if (t.appliesTo === "FEMALE" && gender && gender !== "FEMALE") {
      return { ...base, days: 0, eligible: false, reason: "Applies to female employees." };
    }
    if (t.appliesTo === "MALE" && gender && gender !== "MALE") {
      return { ...base, days: 0, eligible: false, reason: "Applies to male employees." };
    }

    if (t.maxPerYear === 0) {
      return { ...base, days: 0, eligible: true, reason: "Granted case by case; no standing quota." };
    }

    // Block-granted statutory leave (maternity etc.) is not pro-rated, you
    // either qualify for the block or you don't.
    if (!t.accrualMonthly) {
      return { ...base, days: t.maxPerYear, eligible: true, reason: "Granted as a block when the event occurs." };
    }

    // Interns get a pro-rata half quota: they accrue leave, but a six-month
    // intern earning a permanent employee's annual entitlement is not right.
    const typeFactor = String(input.employmentType).toUpperCase() === "INTERN" ? 0.5 : 1;
    const full = Math.round(t.maxPerYear * typeFactor);
    const days = months >= 12 ? full : Math.floor((full * months) / 12);

    const parts: string[] = [];
    if (typeFactor !== 1) parts.push("interns accrue at half rate");
    if (months < 12) parts.push(`joined part-way through ${year} (${months} accrual month${months === 1 ? "" : "s"})`);

    return {
      ...base,
      days,
      eligible: true,
      reason: parts.length ? `Pro-rated: ${parts.join("; ")}.` : "Full annual entitlement.",
    };
  });
}

/** Just the types this person can actually apply for. */
export function eligibleTypes(input: EligibilityInput): Entitlement[] {
  return entitlements(input).filter((e) => e.eligible);
}
