import { it, expect } from "vitest";
/**
 * Hermetic checks for exit-aware payroll and notice-period resolution.
 *
 * Both halves of this were silent failures on a document people are paid from:
 *
 *   1. an employee whose last working day was mid-month was paid a FULL month,
 *      and the payslip stated they had earned it;
 *   2. "immediate exit" was stored and then ignored, so somebody released on the
 *      spot sat in NOTICE_PERIOD, which is the status payroll, the directory,
 *      clock-in reminders and the letter suggestions all key off.
 *
 * No server and no database. Run: npx tsx tests/exit-pay.ts
 */
import {
  clampPayableDays,
  daysInMonth,
  governingSeparation,
  prorateEarnings,
  resolveExitContext,
} from "../../src/domain/payroll/exit-pay";
import { buildAdditionalDeductions, buildEarnings } from "../../src/domain/payroll/payslip-input";
import { computePayroll } from "../../src/domain/payroll/engine";
import { getRuleset } from "../../src/domain/payroll/countries";
import { resolveNotice, defaultNoticeDays } from "../../src/domain/separation-config";

/** Legacy section headers become a prefix on the test names that follow them. */
let current = "";
const section = (title: string) => {
  current = title;
};
const named = (name: string) => (current ? `${current} > ${name}` : name);

/** One test case per legacy check, so each assertion reports on its own. */
function check(name: string, cond: boolean, detail?: unknown) {
  it(named(name), () => {
    expect(cond, detail === undefined ? name : `${name} -> ${JSON.stringify(detail)?.slice(0, 400)}`).toBe(true);
  });
}
const amountOf = (lines: { key?: string; label: string; amount: number }[], key: string) =>
  lines.find((l) => l.key === key)?.amount ?? 0;

const EMPLOYEE = {
  id: "e1", code: "E-1", joiningDate: "2020-04-01",
  salary: { basic: 30000, hra: 15000, allowances: 15000, currency: "INR" },
};
const NOTICE = (over: Record<string, unknown> = {}) => ({
  id: "s1", employeeId: "e1", status: "NOTICE_PERIOD", type: "RESIGNATION",
  lastWorkingDay: "2026-02-14", createdAt: "2026-01-01T00:00:00.000Z", ...over,
});

/* ── Calendar basis ───────────────────────────────────────────────────────── */
section("Proration basis: calendar days in the month");
{
  check("February 2026 has 28 days", daysInMonth(1, 2026) === 28, daysInMonth(1, 2026));
  check("February 2024 (leap) has 29 days", daysInMonth(1, 2024) === 29, daysInMonth(1, 2024));
  check("January has 31 days", daysInMonth(0, 2026) === 31, daysInMonth(0, 2026));

  const ctx = resolveExitContext({ separation: NOTICE(), employee: EMPLOYEE, month: 1, year: 2026 });
  check("LWD 14 Feb pays 14 of 28 days", ctx.partial && ctx.payableDays === 14 && ctx.daysInMonth === 28, ctx);

  // Exactly half a month must pay exactly half the salary, which is the whole
  // reason the divisor is the month's own length rather than a fixed 30.
  const lines = prorateEarnings([{ key: "basic", label: "Basic", amount: 60000 }], 14, 28);
  check("half of February pays exactly half", lines[0].amount === 30000, lines[0]);
}

/* ── Which months are affected ────────────────────────────────────────────── */
section("Only the months an exit actually touches");
{
  const before = resolveExitContext({ separation: NOTICE(), employee: EMPLOYEE, month: 0, year: 2026 });
  check("the month BEFORE the exit is a full month", !before.partial && before.payableDays === 31, before);

  const after = resolveExitContext({ separation: NOTICE(), employee: EMPLOYEE, month: 2, year: 2026 });
  check("the month AFTER the exit pays nothing and says so", after.afterExit && after.payableDays === 0, after);

  const none = resolveExitContext({ separation: null, employee: EMPLOYEE, month: 1, year: 2026 });
  check("an employee with no separation is untouched", !none.partial && none.payableDays === 28, none);

  // An exit on the last day of the month IS a full month; prorating it would
  // shave a day off the pay of everyone who leaves at a month end, which is most
  // of them.
  const lastDay = resolveExitContext({ separation: NOTICE({ lastWorkingDay: "2026-02-28" }), employee: EMPLOYEE, month: 1, year: 2026 });
  check("an exit on the last day of the month pays the full month", !lastDay.partial, lastDay);
}

/* ── An undecided resignation must not cut anyone's pay ───────────────────── */
section("Only a DECIDED last working day prorates");
{
  const pending = resolveExitContext({
    separation: { id: "s2", status: "PENDING_HR", proposedLastWorkingDay: "2026-02-14", lastWorkingDay: null, createdAt: "2026-01-01" },
    employee: EMPLOYEE, month: 1, year: 2026,
  });
  check("a resignation awaiting HR pays the full month", !pending.partial && pending.payableDays === 28, pending);

  const withdrawn = governingSeparation([
    { id: "old", status: "WITHDRAWN", lastWorkingDay: "2026-02-14", createdAt: "2026-01-01" },
    { id: "new", status: "NOTICE_PERIOD", lastWorkingDay: "2026-09-30", createdAt: "2026-08-01" },
  ]);
  check("the most recent decided separation governs", withdrawn?.id === "new", withdrawn);

  check("no decided separation returns null", governingSeparation([{ id: "x", status: "PENDING_HR", lastWorkingDay: null }]) === null);
}

/* ── Joined and left inside the same month ────────────────────────────────── */
section("A window clamped at BOTH ends");
{
  const ctx = resolveExitContext({
    separation: NOTICE({ lastWorkingDay: "2026-02-20" }),
    employee: { ...EMPLOYEE, joiningDate: "2026-02-11" },
    month: 1, year: 2026,
  });
  check("joined 11 Feb, left 20 Feb pays 10 days", ctx.payableDays === 10 && ctx.reason === "BOTH", ctx);
}

/* ── What prorates and what does not ──────────────────────────────────────── */
section("Recurring pay scales; one-off pay never does");
{
  const earnings = buildEarnings(
    EMPLOYEE,
    { severance: 50000, noticePay: 20000, bonus: 5000, leaveEncashment: 8000 },
    { proration: { payableDays: 14, daysInMonth: 28 } },
  );
  check("basic is halved", amountOf(earnings, "basic") === 15000, earnings);
  check("hra is halved", amountOf(earnings, "hra") === 7500, earnings);
  check("severance is paid in full", amountOf(earnings, "severance") === 50000, earnings);
  check("notice pay in lieu is paid in full", amountOf(earnings, "notice_pay") === 20000, earnings);
  check("leave encashment is paid in full", amountOf(earnings, "leave_encashment") === 8000, earnings);
  check("bonus is paid in full", amountOf(earnings, "bonus") === 5000, earnings);
}

/* ── HR's own figures outrank the derived ones ────────────────────────────── */
section("A hand-entered amount is never scaled afterwards");
{
  const earnings = buildEarnings(EMPLOYEE, { basic: 21000 }, { proration: { payableDays: 14, daysInMonth: 28 } });
  check("a stated basic is used verbatim", amountOf(earnings, "basic") === 21000, earnings);
  check("an unstated hra is still prorated", amountOf(earnings, "hra") === 7500, earnings);

  const explicitZero = buildEarnings(EMPLOYEE, { hra: 0 }, { proration: { payableDays: 14, daysInMonth: 28 } });
  check("an explicit 0 drops the line rather than paying half", amountOf(explicitZero, "hra") === 0, explicitZero);
}

/* ── Payable days: clamped, but HR's call ─────────────────────────────────── */
section("Payable-day override");
{
  check("a blank override means 'use the derived figure'", clampPayableDays("", 28) === null);
  check("9 days is taken as given", clampPayableDays(9, 28) === 9);
  check("a typo of 300 cannot pay ten months", clampPayableDays(300, 28) === 28);
  check("a negative is floored at zero", clampPayableDays(-4, 28) === 0);
  check("half days survive", clampPayableDays(13.5, 28) === 13.5);
}

/* ── Statutory deductions follow the reduced wage ─────────────────────────── */
section("Deductions recompute on what was actually earned");
{
  const ruleset = getRuleset("IN");
  const full = computePayroll({ earnings: buildEarnings(EMPLOYEE, {}), ruleset });
  const half = computePayroll({
    earnings: buildEarnings(EMPLOYEE, {}, { proration: { payableDays: 14, daysInMonth: 28 } }),
    ruleset,
  });
  check("gross halves", half.gross === 30000 && full.gross === 60000, { full: full.gross, half: half.gross });
  check("PF is charged on the earned wage, not the contractual one",
    amountOf(half.employeeDeductions, "pf_employee") <= amountOf(full.employeeDeductions, "pf_employee"),
    { full: amountOf(full.employeeDeductions, "pf_employee"), half: amountOf(half.employeeDeductions, "pf_employee") });
}

/* ── Hand-entered deductions keep their own labels ────────────────────────── */
section("Ad-hoc deductions print as HR wrote them");
{
  const lines = buildAdditionalDeductions({
    noticeRecovery: 12000,
    deductionLines: [
      { label: "Laptop not returned", amount: 45000 },
      { label: "Salary advance (Jan)", amount: 5000 },
      { label: "half-filled row", amount: 0 },
      { label: "", amount: 900 },
    ],
  });
  check("notice recovery is a labelled line", lines.some((l) => l.key === "notice_recovery" && l.amount === 12000), lines);
  check("custom labels survive verbatim", lines.some((l) => l.label === "Laptop not returned"), lines);
  check("rows without an amount or a label are dropped", lines.length === 3, lines);

  const run = computePayroll({
    earnings: buildEarnings(EMPLOYEE, {}),
    ruleset: getRuleset("IN"),
    additionalDeductions: lines,
  });
  check("they reduce net pay", run.totalDeductions >= 62000, run.totalDeductions);
  check("and are flagged as hand-set", run.employeeDeductions.filter((l) => l.overridden).length === 3, run.employeeDeductions);
}

/* ── Notice period ────────────────────────────────────────────────────────── */
section("Notice period resolution");
{
  const today = "2026-09-01";
  const org = { noticePeriodDays: 45 };
  const senior = { noticePeriodDays: 90 };

  check("the employee's own contract wins", defaultNoticeDays(senior, org) === 90);
  check("the org default fills the gap", defaultNoticeDays({}, org) === 45);
  check("30 days when nobody states one", defaultNoticeDays(null, null) === 30);

  const def = resolveNotice({ mode: "DEFAULT", employee: senior, org, from: today });
  check("DEFAULT serves the contractual notice", def.noticeDays === 90 && def.lastWorkingDay === "2026-11-30" && !def.waived, def);
  check("and records where the number came from", def.source === "employee", def);

  const days = resolveNotice({ mode: "DAYS", noticeDays: 15, employee: senior, org, from: today });
  check("DAYS overrides the contract", days.noticeDays === 15 && days.lastWorkingDay === "2026-09-16", days);

  const until = resolveNotice({ mode: "UNTIL", lastWorkingDay: "2026-10-15", employee: senior, org, from: today });
  check("UNTIL derives the day count from the date", until.noticeDays === 44 && until.lastWorkingDay === "2026-10-15", until);

  const skip = resolveNotice({ mode: "SKIP", employee: senior, org, from: today });
  check("SKIP waives notice and ends today", skip.waived && skip.noticeDays === 0 && skip.lastWorkingDay === today, skip);
  check("SKIP reports the exit as already past", skip.alreadyPast, skip);

  const backdated = resolveNotice({ mode: "SKIP", lastWorkingDay: "2026-08-20", employee: senior, org, from: today });
  check("a back-dated skip keeps the stated day", backdated.lastWorkingDay === "2026-08-20", backdated);

  // The bug this whole path exists for: a last working day of today is an exit,
  // not a notice period, however HR phrased it.
  const untilToday = resolveNotice({ mode: "UNTIL", lastWorkingDay: today, employee: senior, org, from: today });
  check("'serve until today' is an exit, not a notice period", untilToday.waived && untilToday.alreadyPast, untilToday);

  // Callers written before notice modes existed send only a date, or nothing.
  const legacyDate = resolveNotice({ lastWorkingDay: "2026-10-15", employee: senior, org, from: today });
  check("a bare date is still read as UNTIL", legacyDate.mode === "UNTIL" && legacyDate.lastWorkingDay === "2026-10-15", legacyDate);
  const legacyNone = resolveNotice({ employee: senior, org, from: today });
  check("nothing at all falls back to the contract", legacyNone.mode === "DEFAULT" && legacyNone.noticeDays === 90, legacyNone);

  check("a nonsense day count is capped", resolveNotice({ mode: "DAYS", noticeDays: 99999, from: today }).noticeDays === 365);
}
