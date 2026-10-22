import { it, expect } from "vitest";
/**
 * Hermetic checks for the two CTC conventions.
 *
 * The same headline number means two different salaries depending on whether the
 * organisation counts its own contributions inside it. On a 12L CTC with a 50%
 * basic, employer PF alone is about 21,600 a year: quoting one convention and
 * paying the other is a five-figure annual error per employee, on the number a
 * candidate accepted an offer on.
 *
 * No server and no database. Run: npx tsx tests/ctc-convention.ts
 */
import { computeStructure, INDIA_DEFAULT_STRUCTURE } from "../../src/domain/payroll/structure";
import { computePayroll } from "../../src/domain/payroll/engine";
import { getRuleset } from "../../src/domain/payroll/countries";
import type { EarningLine } from "../../src/domain/payroll/types";

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

const ruleset = getRuleset("IN");
const employerCostOf = (monthly: EarningLine[]) =>
  computePayroll({ earnings: monthly, ruleset }).employerContributions.reduce((t, l) => t + Number(l.amount || 0), 0);

const CTC = 1_200_000; // 12L a year, 100,000 a month

section("Gross-only CTC (the default, unchanged behaviour)");
{
  const r = computeStructure(INDIA_DEFAULT_STRUCTURE, CTC, "FULL_TIME", { employerCostOf });
  check("the breakup reconciles to the CTC exactly", r.gross === 100000, r.gross);
  check("employer cost sits ON TOP of it", (r.totalMonthlyCost ?? 0) > 100000, r.totalMonthlyCost);
  check("and is reported", (r.employerCost ?? 0) > 0, r.employerCost);
  check("flagged as gross-only", r.ctcIncludesEmployerContributions === false, r.ctcIncludesEmployerContributions);

  // Costing is optional: callers with no ruleset to hand still get a breakup.
  const bare = computeStructure(INDIA_DEFAULT_STRUCTURE, CTC, "FULL_TIME");
  check("works with no costing function supplied", bare.gross === 100000 && bare.employerCost === undefined, bare.employerCost);
}

section("CTC-inclusive: gross + employer cost reconciles to the CTC");
{
  const r = computeStructure(INDIA_DEFAULT_STRUCTURE, CTC, "FULL_TIME", {
    ctcIncludesEmployerContributions: true,
    employerCostOf,
  });
  const total = r.gross + (r.employerCost ?? 0);
  check("total cost lands on the CTC (within a rupee)", Math.abs(total - 100000) <= 1, { gross: r.gross, employerCost: r.employerCost, total });
  check("never EXCEEDS the agreed CTC", total <= 100000, total);
  check("gross is lower than the gross-only convention", r.gross < 100000, r.gross);
  check("flagged as inclusive", r.ctcIncludesEmployerContributions === true, r.ctcIncludesEmployerContributions);
  check("totalMonthlyCost is reported", r.totalMonthlyCost === total, { reported: r.totalMonthlyCost, total });

  // The reserved amount must be the REAL contribution, not an estimate: recompute
  // it from the resulting breakup with the same engine payroll will use.
  const recomputed = employerCostOf(r.monthly);
  check("the reserve equals what payroll will actually contribute", Math.abs(recomputed - (r.employerCost ?? 0)) <= 1, { reserved: r.employerCost, recomputed });
}

section("The two conventions differ by the employer contribution");
{
  const grossOnly = computeStructure(INDIA_DEFAULT_STRUCTURE, CTC, "FULL_TIME", { employerCostOf });
  const inclusive = computeStructure(INDIA_DEFAULT_STRUCTURE, CTC, "FULL_TIME", {
    ctcIncludesEmployerContributions: true, employerCostOf,
  });
  const gap = grossOnly.gross - inclusive.gross;
  check("inclusive pays less gross, by roughly the employer cost", gap > 0 && Math.abs(gap - (inclusive.employerCost ?? 0)) <= 2, {
    grossOnly: grossOnly.gross, inclusive: inclusive.gross, gap, employerCost: inclusive.employerCost,
  });
}

section("It converges across a wide range of CTCs");
{
  // Including salaries below the ESI ceiling, where the employer cost curve has a
  // STEP in it: ESI switches off entirely above 21,000 gross. A naive solver can
  // oscillate across that step forever.
  for (const annual of [180_000, 240_000, 252_000, 260_000, 300_000, 600_000, 1_200_000, 5_000_000]) {
    const r = computeStructure(INDIA_DEFAULT_STRUCTURE, annual, "FULL_TIME", {
      ctcIncludesEmployerContributions: true, employerCostOf,
    });
    const total = r.gross + (r.employerCost ?? 0);
    const monthlyCtc = Math.round(annual / 12);
    const ok = total <= monthlyCtc && monthlyCtc - total <= Math.max(2, monthlyCtc * 0.04);
    check(`CTC ${annual.toLocaleString("en-IN")} settles inside budget`, ok, {
      monthlyCtc, gross: r.gross, employerCost: r.employerCost, total, shortfall: monthlyCtc - total,
    });
  }
}

section("Guard rails");
{
  let threw = "";
  try {
    computeStructure(INDIA_DEFAULT_STRUCTURE, CTC, "FULL_TIME", { ctcIncludesEmployerContributions: true });
  } catch (e) { threw = (e as Error).message; }
  check("inclusive mode without a costing function is refused, not guessed", /cannot be costed/i.test(threw), threw);

  let tooSmall = "";
  try {
    // The default structure carries 2,850 a month of flat components.
    computeStructure(INDIA_DEFAULT_STRUCTURE, 12_000, "FULL_TIME", { ctcIncludesEmployerContributions: true, employerCostOf });
  } catch (e) { tooSmall = (e as Error).message; }
  check("a CTC too small for the structure raises a named error", tooSmall.length > 0, tooSmall);
}
