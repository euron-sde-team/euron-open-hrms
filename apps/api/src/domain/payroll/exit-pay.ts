/**
 * Exit-aware payroll: how much of a month an employee is actually owed.
 *
 * A payslip for the month somebody leaves in is not a monthly payslip. Until now
 * the generator read the saved salary structure and paid it in full whatever the
 * separation said, so an employee whose last working day was the 9th received a
 * full month's pay and a document stating they earned it. That is a real
 * overpayment on a document banks and courts accept as evidence.
 *
 * This module answers one question, "how many days of this month is this person
 * owed", and applies it. It reads nothing and writes nothing: the caller passes
 * the separation and the employee, so both the preview and the commit path can
 * run the identical computation (the same discipline the salary-sheet preview
 * and commit already follow).
 *
 * PRORATION BASIS: calendar days in the month. `perDay = amount / daysInMonth`,
 * so February pays 1/28ths and January 1/31sts, and a full month always
 * reconciles to exactly the stated salary. The alternative in common use, a
 * fixed 30-day divisor, pays 103% for a full 31-day month, which is fine while
 * proration only ever fires on partial months but stops being fine the moment
 * anybody prorates a whole one. Note that `settlement.ts` uses /30 for its F&F
 * ESTIMATE; that figure is explicitly an estimate and is not what the payslip
 * pays, so the two are deliberately left alone rather than forced together.
 */

import { round2 } from '../../core/util';
import type { EarningLine } from './types';

/** Days in a calendar month. `month` is 0-11, matching Date and the payslip rows. */
export function daysInMonth(month: number, year: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** "YYYY-MM-DD" -> UTC date, tolerant of a full ISO timestamp. Null when unparseable. */
function toUtcDate(value: unknown): Date | null {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Separation statuses whose last working day is a real, decided date.
 *
 * A resignation still awaiting approval carries only a PROPOSED last working
 * day, and payroll must not prorate a month on the strength of a date the
 * organisation has not agreed to. Everything from acceptance onward is binding.
 */
export const DECIDED_STATUSES = ['NOTICE_PERIOD', 'IN_CLEARANCE', 'COMPLETED', 'ABSCONDED'];

/**
 * Of an employee's separations, the one whose last working day governs payroll.
 *
 * People do have more than one: a resignation withdrawn in March and a
 * termination in September are two rows on the same employee, and reading the
 * older one would prorate a month against a date the organisation abandoned. The
 * most recently created DECIDED separation is the current truth.
 */
export function governingSeparation(separations: any[] | null | undefined): any | null {
  const decided = (separations || []).filter(
    (s) => s && DECIDED_STATUSES.includes(String(s.status)) && s.lastWorkingDay,
  );
  if (!decided.length) return null;
  return decided.slice().sort((a, b) => (String(a.createdAt || '') < String(b.createdAt || '') ? 1 : -1))[0];
}

export interface ExitContextInput {
  /** The separation to read, or null/undefined when there is none. */
  separation?: any | null;
  employee?: any | null;
  month: number; // 0-11
  year: number;
}

export interface ExitContext {
  /** True when this period is cut short, so the payslip should be prorated. */
  partial: boolean;
  daysInMonth: number;
  /** Days the employee is owed in this period. Equals daysInMonth when not partial. */
  payableDays: number;
  /** First and last day actually served inside this month, ISO, when partial. */
  periodStart: string | null;
  periodEnd: string | null;
  lastWorkingDay: string | null;
  /** Why the period is short. Both = joined and left inside the same month. */
  reason: 'EXIT' | 'JOIN' | 'BOTH' | null;
  /** Set when the whole month falls after the last working day: nothing is owed. */
  afterExit: boolean;
  separationId: string | null;
  separationType: string | null;
  separationStatus: string | null;
  noticeWaived: boolean;
}

/** A month with nothing exceptional about it. */
function fullMonth(month: number, year: number): ExitContext {
  const dim = daysInMonth(month, year);
  return {
    partial: false, daysInMonth: dim, payableDays: dim,
    periodStart: null, periodEnd: null, lastWorkingDay: null,
    reason: null, afterExit: false,
    separationId: null, separationType: null, separationStatus: null, noticeWaived: false,
  };
}

/**
 * Work out how much of one payroll month an employee is owed.
 *
 * The served window is [max(month start, joining date), min(month end, last
 * working day)]. The joining date is clamped for the same reason the last
 * working day is: somebody who joined on the 20th and left on the 27th of the
 * same month worked eight days, not twenty-seven, and paying either end in full
 * is the same class of error. Employees with no separation are unaffected: this
 * returns a full month and the caller's behaviour is unchanged.
 */
export function resolveExitContext(input: ExitContextInput): ExitContext {
  const { separation: sep, employee, month, year } = input;
  const dim = daysInMonth(month, year);
  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month, dim));

  const lwd = sep && DECIDED_STATUSES.includes(String(sep.status)) ? toUtcDate(sep.lastWorkingDay) : null;
  if (!lwd) return fullMonth(month, year);

  const base = fullMonth(month, year);
  base.lastWorkingDay = iso(lwd);
  base.separationId = sep.id ?? null;
  base.separationType = sep.type ?? null;
  base.separationStatus = sep.status ?? null;
  base.noticeWaived = !!(sep.noticeWaived || sep.immediate);

  // The exit predates this month entirely: there is nothing to pay, and saying
  // so is more useful than quietly producing a zero-day payslip.
  if (lwd < monthStart) return { ...base, partial: true, payableDays: 0, afterExit: true, reason: 'EXIT' };
  // The exit is in a later month, so this one is served in full.
  if (lwd >= monthEnd) return base;

  const joined = toUtcDate(employee?.joiningDate);
  const start = joined && joined > monthStart && joined <= monthEnd ? joined : monthStart;
  const end = lwd;
  const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);

  return {
    ...base,
    partial: true,
    payableDays: Math.min(days, dim),
    periodStart: iso(start),
    periodEnd: iso(end),
    reason: start > monthStart ? 'BOTH' : 'EXIT',
  };
}

/**
 * Scale recurring earnings to the days actually served.
 *
 * ONLY the recurring structural lines pass through here. One-off amounts a human
 * typed for this run (a bonus, an incentive, severance, notice pay in lieu) are
 * already the final figure and must never be scaled: severance of 50,000 scaled
 * to nine days would pay 15,000 and nobody would notice until the employee did.
 * The caller decides which lines are which; this function just does the maths.
 */
export function prorateEarnings(
  earnings: EarningLine[],
  payableDays: number,
  totalDays: number,
): EarningLine[] {
  if (!Number.isFinite(payableDays) || !Number.isFinite(totalDays) || totalDays <= 0) return earnings;
  if (payableDays >= totalDays) return earnings;
  const factor = Math.max(0, payableDays) / totalDays;
  return earnings.map((e) => ({ ...e, amount: round2(Number(e.amount || 0) * factor) }));
}

/**
 * Clamp an HR-supplied payable-day count to something a month can contain.
 *
 * HR overrides this figure routinely (unpaid days, a disputed final date), so it
 * is accepted rather than recomputed, but a typo of 300 must not pay ten months
 * of salary on one payslip.
 */
export function clampPayableDays(value: unknown, totalDays: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(totalDays, Math.round(n * 100) / 100));
}
