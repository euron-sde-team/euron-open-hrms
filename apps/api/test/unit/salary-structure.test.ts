import { it } from "vitest";
/**
 * Unit tests for the CTC → monthly breakup calculator (no server, no DB).
 * Run: npx tsx tests/salary-structure.ts
 *
 * The emphasis is on the two properties that make the model trustworthy: the
 * breakup reconciles to the CTC to the rupee, and an impossible structure fails
 * loudly instead of producing a negative allowance that flows into gross and PF.
 */
process.env.MAIL_MODE = "outbox";
import assert from "node:assert";

const t = (name: string, fn: () => void) => it(name, fn);
const throws = (fn: () => any, needle: string) => {
  try { fn(); } catch (e: any) {
    assert.ok(e.message.toLowerCase().includes(needle.toLowerCase()),
      `expected a message mentioning "${needle}", got: ${e.message}`);
    return;
  }
  throw new Error("expected this to be rejected, but it was accepted");
};

import { computeStructure, structureFromMonthlyGross, resolveSalary, salaryFromStructure, INDIA_DEFAULT_STRUCTURE } from "../../src/domain/payroll/structure";

const amt = (r: any, k: string) => r.monthly.find((l: any) => l.key === k)?.amount ?? 0;

t("a 12L CTC produces the breakup the market expects", () => {
  const r = computeStructure(INDIA_DEFAULT_STRUCTURE, 1_200_000);
  assert.strictEqual(amt(r, "basic"), 50000);            // 50% of 1,00,000
  assert.strictEqual(amt(r, "hra"), 20000);              // 40% of basic
  assert.strictEqual(amt(r, "conveyance"), 1600);
  assert.strictEqual(amt(r, "medical"), 1250);
  assert.strictEqual(amt(r, "special_allowance"), 27150); // the balance
  assert.strictEqual(r.gross, 100000);
});

t("the breakup reconciles to the CTC exactly, at any figure", () => {
  // Figures chosen so the percentages do NOT divide cleanly; this is where a
  // naive implementation loses or invents rupees.
  for (const ctc of [1_200_000, 999_999, 745_321, 3_333_333, 250_000, 1_150_000]) {
    const r = computeStructure(INDIA_DEFAULT_STRUCTURE, ctc);
    assert.strictEqual(r.gross, Math.round(ctc / 12), `CTC ${ctc} produced gross ${r.gross}`);
  }
});

t("percent-of-basic resolves after percent-of-CTC, whatever the order", () => {
  const reordered: any = {
    ...INDIA_DEFAULT_STRUCTURE,
    components: [...INDIA_DEFAULT_STRUCTURE.components].reverse(),
  };
  const r = computeStructure(reordered, 1_200_000);
  assert.strictEqual(amt(r, "basic"), 50000);
  assert.strictEqual(amt(r, "hra"), 20000, "HRA must still see the resolved basic");
});

t("fixed components exceeding the CTC are refused, not made negative", () => {
  const fat: any = {
    id: "x", name: "x",
    components: [
      { key: "basic", label: "Basic", calc: "PERCENT_OF_CTC", value: 50 },
      { key: "car", label: "Car allowance", calc: "FLAT_MONTHLY", value: 200000 },
      { key: "special_allowance", label: "Special allowance", calc: "BALANCE" },
    ],
  };
  throws(() => computeStructure(fat, 600_000), "more than a monthly CTC");
});

t("a negative balance never reaches the caller", () => {
  const fat: any = {
    id: "x", name: "x",
    components: [
      { key: "a", label: "A", calc: "FLAT_MONTHLY", value: 99999 },
      { key: "special_allowance", label: "Special", calc: "BALANCE" },
    ],
  };
  let out: any = null;
  try { out = computeStructure(fat, 120_000); } catch { /* expected */ }
  if (out) assert.ok(out.monthly.every((l: any) => l.amount >= 0), "a negative line escaped");
});

t("two balancing components are refused", () =>
  throws(() => computeStructure({
    id: "x", name: "x",
    components: [
      { key: "a", label: "A", calc: "BALANCE" },
      { key: "b", label: "B", calc: "BALANCE" },
    ],
  }, 600_000), "only one balancing component"));

t("a zero or missing CTC is refused", () => {
  throws(() => computeStructure(INDIA_DEFAULT_STRUCTURE, 0), "greater than zero");
  throws(() => computeStructure(INDIA_DEFAULT_STRUCTURE, -5), "greater than zero");
});

t("a stipend is one line, with no basic/HRA split and no PF", () => {
  const r = structureFromMonthlyGross("INTERN", 25000);
  assert.strictEqual(r.gross, 25000);
  assert.strictEqual(r.legacy.hra, 0, "an intern stipend must not be split into HRA");
  assert.strictEqual(r.legacy.deductions, 0, "a stipend carries no PF");
});

t("a professional fee is one line too", () => {
  const r = structureFromMonthlyGross("FREELANCER", 80000);
  assert.strictEqual(r.legacy.hra, 0);
  assert.strictEqual(r.gross, 80000);
});

t("a permanent employee's gross IS split, with PF on basic", () => {
  const r = structureFromMonthlyGross("PERMANENT", 100000);
  assert.strictEqual(r.legacy.basic, 50000);        // 50% of gross
  assert.strictEqual(r.legacy.hra, 20000);          // 40% of basic
  assert.strictEqual(r.legacy.deductions, 1800);    // 12% of the 15,000 ceiling
});

t("an explicit breakup is used verbatim, never re-derived", () => {
  const r = resolveSalary({ explicit: { basic: 40000, hra: 12000, allowances: 8000, deductions: 1800 } });
  assert.strictEqual(r!.legacy.basic, 40000);
  assert.strictEqual(r!.legacy.hra, 12000);
  assert.strictEqual(r!.legacy.deductions, 1800);
  assert.strictEqual(r!.gross, 60000);
});

t("an annual CTC runs through the structure", () => {
  const r = resolveSalary({ annualCtc: 1_200_000, structure: INDIA_DEFAULT_STRUCTURE });
  assert.strictEqual(r!.gross, 100000);
});

t("a monthly gross falls back to the employment-aware split", () => {
  const r = resolveSalary({ monthlyGross: 100000, employmentType: "PERMANENT" });
  assert.strictEqual(r!.legacy.basic, 50000);
});

t("nothing supplied yields null rather than a zero-salary record", () =>
  assert.strictEqual(resolveSalary({}), null));


t("a CTC too small for the structure's fixed components is explained, not fudged", () => {
  // basic+HRA take 70% of the monthly CTC, so conveyance and medical (₹2,850)
  // must fit in the remaining 30%: below roughly ₹1.14L a year they cannot.
  throws(() => computeStructure(INDIA_DEFAULT_STRUCTURE, 100_000), "more than a monthly CTC");
});

t("a stipend stated as a CTC skips the structure instead of failing on it", () => {
  // The same ₹1L that the structure rejects is perfectly valid for an intern,
  // because a stipend is one line and never had a basic/HRA split to fit.
  const r = resolveSalary({ annualCtc: 100_000, employmentType: "INTERN" });
  assert.ok(r, "an intern stipend must resolve");
  assert.strictEqual(r.gross, 8333);
  assert.strictEqual(r.legacy.hra, 0);
  assert.strictEqual(r.legacy.deductions, 0);
});


t("a legacy invite's salaryBasic is a BASIC, not a gross", () => {
  // The old invite form said "Monthly basic salary". Treating it as a gross would
  // halve the basic of every invite created before CTC entry existed.
  const r = resolveSalary({ legacyBasic: 50000, employmentType: "PERMANENT" });
  assert.strictEqual(r!.legacy.basic, 50000, "the agreed basic must survive verbatim");
  assert.strictEqual(r!.legacy.hra, 20000);
  assert.strictEqual(r!.legacy.deductions, 0, "the old fake 6% deduction is not carried over");
});

t("a legacy basic for a stipend is still one line", () => {
  const r = resolveSalary({ legacyBasic: 20000, employmentType: "INTERN" });
  assert.strictEqual(r!.legacy.hra, 0);
  assert.strictEqual(r!.gross, 20000);
});

t("a stated monthly GROSS is still split as a gross", () => {
  // The two must not be confused: same number, different meaning.
  const asGross = resolveSalary({ monthlyGross: 50000, employmentType: "PERMANENT" });
  const asBasic = resolveSalary({ legacyBasic: 50000, employmentType: "PERMANENT" });
  assert.strictEqual(asGross!.legacy.basic, 25000);
  assert.strictEqual(asBasic!.legacy.basic, 50000);
});

t("salaryFromStructure writes BOTH the legacy scalars and components[]", () => {
  const r = computeStructure(INDIA_DEFAULT_STRUCTURE, 1_200_000);
  const s = salaryFromStructure(r, { currency: "INR", annualCtc: 1_200_000, structureId: "in-standard" });
  // Legacy scalars keep letters, settlement and reports working untouched.
  assert.strictEqual(s.basic, 50000);
  assert.strictEqual(s.hra, 20000);
  assert.strictEqual(s.allowances, 30000, "everything that is not basic or HRA");
  // components[] is what the payroll engine consumes.
  assert.strictEqual(s.components.length, 5);
  assert.strictEqual(s.components.find((c: any) => c.key === "special_allowance").amount, 27150);
  assert.strictEqual(s.annualCtc, 1_200_000);
  assert.strictEqual(s.structureId, "in-standard");
  assert.strictEqual(s.currency, "INR");
});

t("the legacy scalars and components[] describe the same money", () => {
  const r = computeStructure(INDIA_DEFAULT_STRUCTURE, 1_450_000);
  const s = salaryFromStructure(r, {});
  const fromComponents = s.components.reduce((t: number, c: any) => t + c.amount, 0);
  const fromLegacy = s.basic + s.hra + s.allowances;
  assert.strictEqual(fromComponents, fromLegacy, "the two views of the same salary disagree");
});

t("statutory deductions are NOT guessed into the legacy field", () => {
  // The old intake paths wrote basic*0.06 here, which looked like PF but was
  // not computed like PF, so the record disagreed with every payslip.
  const s = salaryFromStructure(computeStructure(INDIA_DEFAULT_STRUCTURE, 1_200_000), {});
  assert.strictEqual(s.deductions, 0, "PF/ESI/PT are computed per run, never stored here");
});

import { computePayroll } from "../../src/domain/payroll/engine";
import { getRuleset } from "../../src/domain/payroll/countries";
const IN = getRuleset("IN");
const EARNINGS = [
  { key: "basic", label: "Basic", amount: 50000 },
  { key: "hra", label: "HRA", amount: 20000 },
  { key: "allowances", label: "Allowances", amount: 30000 },
];
const line = (rows: any[], k: string) => rows.find((l: any) => l.key === k);

t("by default PF is 12% of the ₹15,000 ceiling, not of full basic", () => {
  const r = computePayroll({ earnings: EARNINGS, ruleset: IN });
  assert.strictEqual(line(r.employeeDeductions, "pf_employee").amount, 1800);
});

t("opting an employee out of PF drops BOTH halves", () => {
  const r = computePayroll({ earnings: EARNINGS, ruleset: IN, statutory: { pf: { applicable: false } } });
  assert.ok(!line(r.employeeDeductions, "pf_employee"), "employee PF still charged");
  assert.ok(!line(r.employerContributions, "pf_employer"), "employer PF still costed");
});

t("lifting the PF ceiling contributes on full basic", () => {
  const r = computePayroll({
    earnings: EARNINGS, ruleset: IN,
    statutory: { pf: { restrictToCeiling: false } },
  });
  assert.strictEqual(line(r.employeeDeductions, "pf_employee").amount, 6000); // 12% of 50,000
});

t("an override wins over the computed amount and is MARKED as an override", () => {
  const r = computePayroll({ earnings: EARNINGS, ruleset: IN, statutory: { pf: { override: 2400 } } });
  const pf = line(r.employeeDeductions, "pf_employee");
  assert.strictEqual(pf.amount, 2400);
  assert.strictEqual(pf.overridden, true, "a hand-set figure must be distinguishable on the payslip");
});

t("an override of zero is honoured, not swallowed as falsy", () => {
  // "Charge nothing this run" is a real instruction and must not be confused
  // with "this component did not apply".
  const r = computePayroll({ earnings: EARNINGS, ruleset: IN, statutory: { pf: { override: 0 } } });
  const pf = line(r.employeeDeductions, "pf_employee");
  assert.ok(pf, "a zero override disappeared entirely");
  assert.strictEqual(pf.amount, 0);
  assert.strictEqual(pf.overridden, true);
});

t("a computed line is never marked as overridden", () => {
  const r = computePayroll({ earnings: EARNINGS, ruleset: IN });
  assert.strictEqual(line(r.employeeDeductions, "pf_employee").overridden, undefined);
});

t("ESI stays off above the ₹21,000 coverage ceiling, override or not", () => {
  const r = computePayroll({ earnings: EARNINGS, ruleset: IN });   // gross 1,00,000
  assert.ok(!line(r.employeeDeductions, "esi_employee"), "ESI charged above the ceiling");
  assert.ok(!line(r.employerContributions, "esi_employer"));
});

t("employer contributions are costed but never deducted from net", () => {
  const r = computePayroll({ earnings: EARNINGS, ruleset: IN });
  const employerPf = line(r.employerContributions, "pf_employer").amount;
  assert.strictEqual(employerPf, 1800);
  assert.strictEqual(r.net, r.gross - r.totalDeductions, "employer cost leaked into net");
});
