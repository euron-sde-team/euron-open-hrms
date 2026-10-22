/**
 * Gratuity under the Payment of Gratuity Act, 1972.
 *
 * Paid on separation to employees who complete five years of continuous
 * service. It was missing entirely, so full-and-final settlements understated
 * what a long-serving leaver was owed.
 *
 *   gratuity = (15 x last drawn monthly wages x completed years) / 26
 *
 * where "wages" means basic + dearness allowance (NOT gross, including HRA
 * and allowances would overstate it), 26 is the assumed working days in a
 * month, and 15 represents 15 days' wages per completed year.
 *
 * Eligibility follows the Act and settled case law:
 *   - Five years of continuous service, EXCEPT where service ends due to
 *     death or disablement, when the five-year rule does not apply.
 *   - A year with more than 240 days worked counts as a full year; by the
 *     Madras High Court's reading, 4 years and 240 days qualifies as five.
 *   - Service beyond a completed year counts as another full year only if the
 *     excess is six months or more.
 *   - Statutory ceiling of Rs 20,00,000.
 *
 * Engagement type matters: only types flagged `gratuityEligible` in
 * server/employment.ts can accrue it, which excludes freelancers, vendors,
 * interns and temporary staff.
 */

import { employmentRules } from "../employment";

export const GRATUITY_CEILING = 2_000_000;
const DAYS_PER_MONTH = 26;
const DAYS_PER_YEAR_FACTOR = 15;

export interface GratuityInput {
  /** Last drawn monthly basic. */
  basic: number;
  /** Last drawn monthly dearness allowance, if the org runs one. */
  da?: number;
  joiningDate: string;
  lastWorkingDay: string;
  employmentType?: string | null;
  /** Death or permanent disablement waives the five-year qualifying period. */
  reason?: "RESIGNATION" | "TERMINATION" | "RETIREMENT" | "DEATH" | "DISABLEMENT" | string;
  /** Establishments not covered by the Act use 30 days instead of 26. */
  covered?: boolean;
}

export interface GratuityResult {
  eligible: boolean;
  amount: number;
  /** Completed years used in the formula, after the six-month rounding rule. */
  yearsCounted: number;
  /** Raw service, for display. */
  serviceYears: number;
  serviceMonths: number;
  serviceDays: number;
  wages: number;
  cappedByCeiling: boolean;
  reason: string;
  formula: string;
}

function dayDiff(fromIso: string, toIso: string): number | null {
  const a = new Date(`${fromIso}T00:00:00Z`);
  const b = new Date(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export function computeGratuity(input: GratuityInput): GratuityResult {
  const wages = Math.max(0, Number(input.basic || 0) + Number(input.da || 0));
  const empty: GratuityResult = {
    eligible: false,
    amount: 0,
    yearsCounted: 0,
    serviceYears: 0,
    serviceMonths: 0,
    serviceDays: 0,
    wages,
    cappedByCeiling: false,
    reason: "",
    formula: "",
  };

  const totalDays = dayDiff(input.joiningDate, input.lastWorkingDay);
  if (totalDays === null || totalDays < 0) {
    return { ...empty, reason: "Joining date or last working day is missing or invalid." };
  }

  const serviceYears = Math.floor(totalDays / 365);
  const remainderDays = totalDays - serviceYears * 365;
  const serviceMonths = Math.floor(remainderDays / 30);
  const serviceDays = remainderDays - serviceMonths * 30;

  const rules = employmentRules(input.employmentType);
  if (!rules.gratuityEligible) {
    return {
      ...empty,
      serviceYears,
      serviceMonths,
      serviceDays,
      reason: `Gratuity does not apply to ${String(input.employmentType ?? "this engagement").toLowerCase().replace(/_/g, " ")} engagements.`,
    };
  }

  const waivesQualifyingPeriod = input.reason === "DEATH" || input.reason === "DISABLEMENT";

  // 4 years + 240 days counts as five years of continuous service.
  const qualifies =
    waivesQualifyingPeriod || serviceYears >= 5 || (serviceYears === 4 && remainderDays >= 240);

  if (!qualifies) {
    return {
      ...empty,
      serviceYears,
      serviceMonths,
      serviceDays,
      reason: `Needs five years of continuous service; ${serviceYears}y ${serviceMonths}m completed.`,
    };
  }

  // Round up to another full year only when the excess is six months or more.
  const excessMonths = serviceMonths + serviceDays / 30;
  let yearsCounted = serviceYears + (excessMonths >= 6 ? 1 : 0);
  // Death/disablement inside the first five years still counts actual service.
  if (yearsCounted < 1) yearsCounted = 1;

  const divisor = input.covered === false ? 30 : DAYS_PER_MONTH;
  const raw = (DAYS_PER_YEAR_FACTOR * wages * yearsCounted) / divisor;
  const capped = raw > GRATUITY_CEILING;
  const amount = Math.round(Math.min(raw, GRATUITY_CEILING));

  return {
    eligible: true,
    amount,
    yearsCounted,
    serviceYears,
    serviceMonths,
    serviceDays,
    wages,
    cappedByCeiling: capped,
    reason: waivesQualifyingPeriod
      ? "Five-year qualifying period waived (death or disablement)."
      : capped
        ? `Computed amount exceeded the statutory ceiling of ${GRATUITY_CEILING.toLocaleString("en-IN")} and was capped.`
        : "Eligible.",
    formula: `(${DAYS_PER_YEAR_FACTOR} x ${wages.toLocaleString("en-IN")} x ${yearsCounted}) / ${divisor}`,
  };
}
