/**
 * Professional tax (PT), per-state monthly slabs.
 *
 * PT is levied by state governments, not the centre, so there is no single
 * national slab. The previous ruleset carried one Karnataka-shaped slab with a
 * "varies by state" note and applied it to every organisation, which is wrong
 * in two directions at once:
 *
 *   - Employers in Delhi, Haryana, Punjab, Rajasthan, UP, Uttarakhand and
 *     Himachal Pradesh were deducting a tax that does not exist there.
 *   - Employers in states with genuinely different bands (Maharashtra, West
 *     Bengal, Andhra/Telangana) were deducting the wrong amount.
 *
 * Article 276 of the Constitution caps professional tax at Rs 2,500 per person
 * per year, which every schedule below respects.
 *
 * These are the commonly-published slabs and are a starting point, not tax
 * advice. Each schedule carries `verifyNote` and the org can override every
 * value from Settings, states revise their notifications and a hardcoded
 * table WILL drift.
 */

import type { Slab } from "./types";

export interface PtSchedule {
  /** State code, matching server/holidays.ts INDIAN_STATES. */
  state: string;
  name: string;
  /** No professional tax levied in this state. */
  none?: boolean;
  /**
   * Monthly slabs on gross salary. `flat` is the rupee amount for the band
   * (PT is a flat amount per band, never a percentage).
   */
  slabs?: Slab[];
  /** Some states levy a higher amount in one month to reach the annual cap. */
  februaryExtra?: number;
  /** Women are exempt below this monthly gross (Maharashtra does this). */
  womenExemptBelow?: number;
  /** Annual ceiling, Rs 2,500 by constitutional limit. */
  annualCap: number;
  verifyNote: string;
}

const CAP = 2500;

/** Convenience: a band that levies `amount` up to `upTo` (null = no ceiling). */
const band = (upTo: number | null, amount: number): Slab => ({ upTo, rate: 0, flat: amount });

export const PT_SCHEDULES: PtSchedule[] = [
  {
    state: "KA",
    name: "Karnataka",
    slabs: [band(24999, 0), band(null, 200)],
    annualCap: CAP,
    verifyNote: "Rs 200/month above Rs 25,000 monthly gross. Confirm against the current Karnataka notification.",
  },
  {
    state: "MH",
    name: "Maharashtra",
    slabs: [band(7500, 0), band(10000, 175), band(null, 200)],
    februaryExtra: 100,
    womenExemptBelow: 25000,
    annualCap: CAP,
    verifyNote: "Rs 300 in February to reach the Rs 2,500 annual cap. Women are exempt below Rs 25,000/month.",
  },
  {
    state: "WB",
    name: "West Bengal",
    slabs: [band(10000, 0), band(15000, 110), band(25000, 130), band(40000, 150), band(null, 200)],
    annualCap: CAP,
    verifyNote: "Five bands on monthly gross. Confirm against the current West Bengal schedule.",
  },
  {
    state: "AP",
    name: "Andhra Pradesh",
    slabs: [band(15000, 0), band(20000, 150), band(null, 200)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Andhra Pradesh notification.",
  },
  {
    state: "TG",
    name: "Telangana",
    slabs: [band(15000, 0), band(20000, 150), band(null, 200)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Telangana notification.",
  },
  {
    state: "GJ",
    name: "Gujarat",
    slabs: [band(12000, 0), band(null, 200)],
    annualCap: CAP,
    verifyNote: "Rs 200/month above Rs 12,000 monthly gross.",
  },
  {
    state: "MP",
    name: "Madhya Pradesh",
    slabs: [band(18750, 0), band(25000, 125), band(33333, 167), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Bands are set to reach the Rs 2,500 annual cap; confirm the current schedule.",
  },
  {
    state: "TN",
    name: "Tamil Nadu",
    slabs: [band(21000, 0), band(30000, 135), band(45000, 315), band(60000, 690), band(75000, 1025), band(null, 1250)],
    annualCap: CAP,
    verifyNote: "Tamil Nadu levies HALF-YEARLY and rates vary by municipal body, the amounts here are half-yearly, not monthly. Verify with your local corporation before running payroll.",
  },
  {
    state: "KL",
    name: "Kerala",
    slabs: [band(1999, 0), band(2999, 120), band(4999, 180), band(7499, 300), band(9999, 450), band(12499, 600), band(16666, 750), band(20833, 1000), band(null, 1250)],
    annualCap: CAP,
    verifyNote: "Kerala levies HALF-YEARLY through local bodies, amounts here are half-yearly on half-yearly income. Verify with your panchayat/municipality.",
  },
  {
    state: "OR",
    name: "Odisha",
    slabs: [band(13304, 0), band(25000, 125), band(null, 200)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Odisha schedule.",
  },
  {
    state: "AS",
    name: "Assam",
    slabs: [band(10000, 0), band(15000, 150), band(24999, 180), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Assam schedule.",
  },
  {
    state: "BR",
    name: "Bihar",
    slabs: [band(25000, 0), band(41666, 83), band(83333, 166), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Bihar levies annually; monthly equivalents shown. Confirm before use.",
  },
  {
    state: "JH",
    name: "Jharkhand",
    slabs: [band(25000, 0), band(41666, 100), band(66666, 150), band(83333, 175), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Jharkhand schedule.",
  },
  {
    state: "TR",
    name: "Tripura",
    slabs: [band(7500, 0), band(15000, 150), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Tripura schedule.",
  },
  {
    state: "ML",
    name: "Meghalaya",
    slabs: [band(4166, 0), band(6250, 16), band(8333, 25), band(12500, 41), band(16666, 62), band(20833, 83), band(25000, 104), band(29166, 125), band(33333, 150), band(37500, 175), band(41666, 200), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Meghalaya schedule.",
  },
  {
    state: "SK",
    name: "Sikkim",
    slabs: [band(20000, 0), band(30000, 125), band(40000, 150), band(null, 200)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Sikkim schedule.",
  },
  {
    state: "NL",
    name: "Nagaland",
    slabs: [band(4000, 0), band(5000, 35), band(7000, 75), band(9000, 110), band(12000, 180), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Nagaland schedule.",
  },
  {
    state: "MN",
    name: "Manipur",
    slabs: [band(4166, 0), band(6250, 100), band(8333, 167), band(10416, 200), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Manipur schedule.",
  },
  {
    state: "MZ",
    name: "Mizoram",
    slabs: [band(5000, 0), band(8000, 75), band(10000, 120), band(12000, 150), band(15000, 180), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Mizoram schedule.",
  },
  {
    state: "PY",
    name: "Puducherry",
    slabs: [band(16666, 0), band(33333, 41), band(50000, 83), band(66666, 125), band(83333, 166), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Puducherry schedule.",
  },
  {
    state: "GA",
    name: "Goa",
    slabs: [band(15000, 0), band(25000, 150), band(null, 200)],
    annualCap: CAP,
    verifyNote: "Confirm against the current Goa schedule.",
  },
  {
    state: "CT",
    name: "Chhattisgarh",
    slabs: [band(40000, 0), band(50000, 130), band(66666, 150), band(83333, 175), band(null, 208)],
    annualCap: CAP,
    verifyNote: "Chhattisgarh levies annually; monthly equivalents shown. Confirm before use.",
  },

  // ── States and UTs that levy NO professional tax ──────────────────────
  // This is the correctness fix that matters most: the previous single slab
  // deducted PT from employees in all of these, where none is owed.
  { state: "DL", name: "Delhi", none: true, annualCap: 0, verifyNote: "Delhi does not levy professional tax." },
  { state: "HR", name: "Haryana", none: true, annualCap: 0, verifyNote: "Haryana does not levy professional tax." },
  { state: "PB", name: "Punjab", none: true, annualCap: 0, verifyNote: "Punjab levies a development tax on income-tax payers rather than a classic PT, configure manually if applicable." },
  { state: "RJ", name: "Rajasthan", none: true, annualCap: 0, verifyNote: "Rajasthan does not levy professional tax." },
  { state: "UP", name: "Uttar Pradesh", none: true, annualCap: 0, verifyNote: "Uttar Pradesh does not levy professional tax." },
  { state: "UK", name: "Uttarakhand", none: true, annualCap: 0, verifyNote: "Uttarakhand does not levy professional tax." },
  { state: "HP", name: "Himachal Pradesh", none: true, annualCap: 0, verifyNote: "Himachal Pradesh does not levy professional tax." },
  { state: "JK", name: "Jammu & Kashmir", none: true, annualCap: 0, verifyNote: "No professional tax levied." },
  { state: "LA", name: "Ladakh", none: true, annualCap: 0, verifyNote: "No professional tax levied." },
  { state: "CH", name: "Chandigarh", none: true, annualCap: 0, verifyNote: "No professional tax levied." },
  { state: "AN", name: "Andaman & Nicobar Islands", none: true, annualCap: 0, verifyNote: "No professional tax levied." },
  { state: "AR", name: "Arunachal Pradesh", none: true, annualCap: 0, verifyNote: "No professional tax levied." },
];

const BY_STATE = new Map(PT_SCHEDULES.map((s) => [s.state, s]));

export function ptSchedule(state?: string | null): PtSchedule | undefined {
  return state ? BY_STATE.get(String(state).toUpperCase()) : undefined;
}

/** States that levy PT, for a settings picker. */
export const PT_STATES = PT_SCHEDULES.filter((s) => !s.none).map((s) => ({ code: s.state, name: s.name }));

/**
 * Monthly professional tax for a gross, in a state.
 *
 * Returns 0 with a reason when the state levies none, so the caller can
 * explain the zero on the payslip rather than leaving a silent blank.
 */
export function professionalTaxFor(
  monthlyGross: number,
  state?: string | null,
  opts: { gender?: string | null; month?: number } = {}
): { amount: number; reason: string; schedule?: PtSchedule } {
  const schedule = ptSchedule(state);
  if (!schedule) {
    return { amount: 0, reason: state ? `No professional tax schedule configured for ${state}.` : "No state set for the organisation, professional tax not applied." };
  }
  if (schedule.none) {
    return { amount: 0, reason: `${schedule.name} does not levy professional tax.`, schedule };
  }

  const gross = Math.max(0, Number(monthlyGross) || 0);

  if (
    schedule.womenExemptBelow &&
    String(opts.gender ?? "").toUpperCase() === "FEMALE" &&
    gross < schedule.womenExemptBelow
  ) {
    return {
      amount: 0,
      reason: `Women earning under ${schedule.womenExemptBelow.toLocaleString("en-IN")}/month are exempt in ${schedule.name}.`,
      schedule,
    };
  }

  const slabs = schedule.slabs ?? [];
  let amount = 0;
  for (const s of slabs) {
    if (s.upTo === null || gross <= s.upTo) {
      amount = Number(s.flat ?? 0);
      break;
    }
  }

  // Some states levy extra in February so the year totals the cap.
  if (schedule.februaryExtra && opts.month === 1) amount += schedule.februaryExtra;

  return {
    amount: Math.round(amount),
    reason: amount === 0 ? `Below the ${schedule.name} threshold.` : `${schedule.name} schedule.`,
    schedule,
  };
}

/**
 * Turn a state's schedule into the SLAB component the payroll engine consumes,
 * so professional tax stays a normal configurable component rather than a
 * special case inside the engine.
 */
export function ptComponentFor(state?: string | null) {
  const schedule = ptSchedule(state);
  if (!schedule || schedule.none) {
    return {
      key: "professional_tax",
      label: "Professional Tax",
      type: "DEDUCTION" as const,
      side: "EMPLOYEE" as const,
      calc: "SLAB" as const,
      base: "GROSS" as const,
      slabs: [{ upTo: null, rate: 0, flat: 0 }],
      enabled: false,
      note: schedule
        ? schedule.verifyNote
        : "No state configured. Set the organisation's state in Settings to apply professional tax.",
    };
  }
  return {
    key: "professional_tax",
    label: "Professional Tax",
    type: "DEDUCTION" as const,
    side: "EMPLOYEE" as const,
    calc: "SLAB" as const,
    base: "GROSS" as const,
    slabs: schedule.slabs,
    enabled: true,
    note: `${schedule.name}: ${schedule.verifyNote}`,
  };
}
