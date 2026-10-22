import { it, expect } from "vitest";
/**
 * Hermetic regression checks for the payslip input path: what an employee's
 * saved compensation, a per-run form and a salary sheet each turn into.
 *
 * These cover the failures the payroll repair was about, all of which were
 * silent (a wrong number on a real payslip, never an error):
 *   1. the bulk upload read a different, poorer parse than the preview,
 *   3. re-generating a payslip cleared its "Emailed" stamp,
 *   4. a stale components[] outranked the salary HR had just edited,
 *   5. the employee's stored statutory deduction was never applied,
 *   6. a pay run was recorded even when nothing was generated.
 *
 * No server and no database. Run: npx tsx tests/payslip-input.ts
 */
import * as XLSX from "xlsx";
import {
  buildEarnings,
  buildExtras,
  payslipInsertRecord,
  payslipRecord,
  sheetRowToLines,
  statutoryRows,
  summarizeRun,
  totalsFor,
} from "../../src/domain/payroll/payslip-input";
import { parseSalarySheet } from "../../src/domain/payroll/salary-sheet";
import { getRuleset } from "../../src/domain/payroll/countries";
import { computePayroll } from "../../src/domain/payroll/engine";

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

/* ── 4. A stale components[] must not outrank an edited salary ─────────────── */
section("Earnings: edited salary beats a stale components[]");
{
  // What the database actually looks like after PUT /salary/structure wrote both
  // shapes and then PUT /employees/:id (the Compensation dialog) shallow-merged
  // a new basic over the legacy keys only.
  const emp = {
    code: "E-1",
    salary: {
      basic: 60000, hra: 20000, allowances: 10000, deductions: 0,
      components: [
        { key: "basic", label: "Basic", amount: 50000 },
        { key: "hra", label: "HRA", amount: 20000 },
        { key: "allowances", label: "Allowances", amount: 10000 },
      ],
    },
  };
  const earnings = buildEarnings(emp);
  check("the edited basic is paid, not the stale component", amountOf(earnings, "basic") === 60000, earnings);
  check("untouched components are unchanged", amountOf(earnings, "hra") === 20000 && amountOf(earnings, "allowances") === 10000, earnings);
  check("gross reflects the edit", earnings.reduce((s, e) => s + e.amount, 0) === 90000);

  // An edit down to zero is an edit, not a missing value.
  const zeroed = buildEarnings({ ...emp, salary: { ...emp.salary, allowances: 0 } });
  check("an allowance edited to zero is dropped", amountOf(zeroed, "allowances") === 0, zeroed);

  // A per-run amount still wins over both.
  const perRun = buildEarnings(emp, { basic: 70000 });
  check("a per-run amount still wins", amountOf(perRun, "basic") === 70000, perRun);
}
{
  // Country-specific components carry keys the legacy fields cannot express.
  // Those must be left alone, and the legacy scalars must NOT be added on top,
  // or the same money is paid twice.
  const emp = {
    code: "E-2",
    salary: {
      basic: 50000, hra: 0, allowances: 0,
      components: [
        { key: "base_salary", label: "Base Salary", amount: 60000 },
        { key: "shift_premium", label: "Shift Premium", amount: 5000 },
      ],
    },
  };
  const earnings = buildEarnings(emp);
  check("component-only keys are untouched", amountOf(earnings, "base_salary") === 60000 && amountOf(earnings, "shift_premium") === 5000, earnings);
  check("a legacy scalar with no matching component is NOT added on top",
    earnings.reduce((s, e) => s + e.amount, 0) === 65000, earnings);
}
{
  const legacyOnly = buildEarnings({ code: "E-3", salary: { basic: 30000, hra: 12000, allowances: 6000 } });
  check("the legacy-only shape still works", legacyOnly.map((e) => e.key).join(",") === "basic,hra,allowances", legacyOnly);
  check("employees with no salary at all produce nothing", buildEarnings({ code: "E-4" }).length === 0);
}

/* ── 5. The stored "statutory deductions (PF etc.)" must apply ─────────────── */
section("Extras: the employee's stored statutory deduction is a default");
{
  const IN = getRuleset("IN");
  const emp = { code: "E-1", salary: { basic: 50000, hra: 20000, allowances: 10000, deductions: 3000 } };

  const stored = buildExtras(IN, {}, emp);
  check("the saved amount is applied when the run says nothing", stored.pf_employee === 3000, stored);

  const perRun = buildExtras(IN, { deductions: 4500 }, emp);
  check("a per-run amount overrides the saved one", perRun.pf_employee === 4500, perRun);

  const explicitZero = buildExtras(IN, { deductions: 0 }, emp);
  check("an explicit per-run zero means zero, not 'fall back'", explicitZero.pf_employee === 0, explicitZero);

  const byComponentKey = buildExtras(IN, { pf_employee: 1234 }, emp);
  check("the exact component key wins over the legacy alias", byComponentKey.pf_employee === 1234, byComponentKey);

  const noEmployee = buildExtras(IN, {});
  check("nothing stored and nothing entered leaves PF to the rules", noEmployee.pf_employee === undefined, noEmployee);

  // The whole point: it has to reach the payslip.
  const result = computePayroll({
    earnings: buildEarnings(emp),
    ruleset: IN,
    extras: buildExtras(IN, {}, emp),
  });
  const pf = result.employeeDeductions.find((d) => d.label.includes("Provident"))?.amount ?? 0;
  check("the payslip deducts the stored amount instead of the computed 1,800", pf === 3000, result.employeeDeductions);

  // Other legacy fields still map through.
  const legacy = buildExtras(IN, { tax: 5000, lossOfPay: 900, otherDeductions: 100 }, emp);
  check("TDS / LOP / other deductions still map", legacy.tds === 5000 && legacy.adhoc_loss_of_pay === 900 && legacy.adhoc_other_deductions === 100, legacy);
}

/* ── 1. Preview and commit must read the sheet the same way ────────────────── */
section("Sheet: the commit reads what the preview showed");
{
  // A real salary master: several sheets, a title banner above the header, a
  // misspelled + negative "Total Deducton", interleaved employee/employer
  // contributions, and a Grand Total row.
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Employee ID", "Employee Name", "Shift", "Rate per day", "Food Deduction"],
    ["E-1", "Asha Rao", "Day", 30, 0],
  ]), "Food Deduction");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["ACME PRIVATE LIMITED"],
    ["Salary Sheet for the Month of July 2026"],
    ["Employee ID", "Name", "BASIC", "HRA", "Special Allowance", "Statutory Bonus", "LTA",
      "PF EE", "Employee ESI", "PT", "TDS", "PF ER", "Employer ESI", "Gross", "Total Deducton", "Net Pay"],
    ["E-1", "Asha Rao", 20000, 10000, 5000, 1000, 2000, -1800, -285, -200, -1500, 1800, 1235, 38000, -3785, 34215],
    ["Grand Total", "", 20000, 10000, 5000, 1000, 2000, -1800, -285, -200, -1500, 1800, 1235, 38000, -3785, 34215],
    ["", "No PF & ESI deuctions for freelancers"],
  ]), "ACME");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const parsed = parseSalarySheet(buf);
  check("the salary sheet is found, not SheetNames[0]", parsed.sheet?.name === "ACME", parsed.sheet);
  check("the header row under the banner is found", parsed.sheet?.headerRow === 2, parsed.sheet);
  check("one employee row, total and note excluded", parsed.rows.length === 1, parsed.rows.map((r) => r.name));

  const lines = sheetRowToLines(parsed.rows[0]);
  const totals = totalsFor(lines);

  // This is the regression: the old bulk endpoint knew 12 header aliases and
  // took the first sheet's first row as the header, so most of these columns
  // never reached the payslip.
  check("every earning column survives", lines.earnings.length === 5, lines.earnings);
  for (const [key, amount] of [["basic", 20000], ["hra", 10000], ["specialAllowance", 5000], ["statutoryBonus", 1000], ["lta", 2000]] as [string, number][]) {
    check(`  earning ${key} = ${amount}`, amountOf(lines.earnings, key) === amount, lines.earnings);
  }
  check("every deduction survives, sign corrected", lines.deductions.length === 4, lines.deductions);
  for (const [key, amount] of [["pfEmployee", 1800], ["esiEmployee", 285], ["professionalTax", 200], ["tds", 1500]] as [string, number][]) {
    check(`  deduction ${key} = ${amount}`, amountOf(lines.deductions, key) === amount, lines.deductions);
  }
  check("employer contributions stay on the employer side",
    lines.employerContributions.length === 2 && !lines.deductions.some((d) => /employer/i.test(d.label)), lines);

  check("totals match the sheet's own gross", totals.gross === 38000, totals);
  check("totals match the sheet's own deduction", totals.totalDeductions === 3785, totals);
  check("totals match the sheet's own net", totals.net === 34215, totals);
  check("the preview's figures ARE the committed figures",
    totals.net === parsed.rows[0].net && totals.gross === parsed.rows[0].gross, { totals, row: parsed.rows[0] });
  check("no warnings, because our arithmetic agrees with the sheet",
    parsed.rows[0].warnings.length === 0 && parsed.rows[0].errors.length === 0, parsed.rows[0]);

  // What the old reader did with the same file, kept here so the difference is
  // demonstrable rather than asserted: first sheet, first row as the header.
  const legacy: any[] = XLSX.utils.sheet_to_json(XLSX.read(buf, { type: "buffer" }).Sheets[XLSX.read(buf, { type: "buffer" }).SheetNames[0]], { defval: "" });
  check("the old first-sheet reader lands on the wrong sheet entirely",
    !Object.keys(legacy[0] ?? {}).some((k) => /basic/i.test(k)), Object.keys(legacy[0] ?? {}));

  // Per-row periods, when the sheet carries them.
  const withPeriod = parseSalarySheet(XLSX.write(
    (() => {
      const w = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([
        ["Employee ID", "Name", "Month", "Year", "BASIC", "Gross", "Net Pay"],
        ["E-1", "Asha Rao", 7, 2026, 20000, 20000, 20000],
      ]), "S");
      return w;
    })(), { type: "buffer", bookType: "xlsx" }) as Buffer);
  check("Month/Year columns are read when present",
    Number(withPeriod.rows[0]?.raw.month) === 7 && Number(withPeriod.rows[0]?.raw.year) === 2026, withPeriod.rows[0]?.raw);
}

/* ── 3. Re-generating must not clear the "Emailed" stamp ───────────────────── */
section("Persistence: a re-generate keeps a payslip's emailed stamp");
{
  const fields = {
    employeeId: "emp-1", month: 6, year: 2026,
    result: {
      earnings: [{ key: "basic", label: "Basic", amount: 20000 }],
      employeeDeductions: [{ key: "pf_employee", label: "PF", amount: 1800 }],
      employerContributions: [],
      gross: 20000, totalDeductions: 1800, net: 18200,
      currency: "INR", country: "IN",
    },
    filename: "payslip_acme_E-1_2026-07.pdf",
    verification: { code: "ABC123", url: "https://x/verify", digest: "d1" },
  };

  const patch = payslipRecord(fields);
  check("the update patch does not mention emailedAt", !("emailedAt" in patch), Object.keys(patch));
  check("it does carry the recomputed money", patch.net === 18200 && patch.gross === 20000, patch);

  // repo.update merges the patch over the current row ({...current, ...patch}).
  const alreadyMailed = { id: "p1", ...payslipInsertRecord(fields), emailedAt: "2026-07-05T10:00:00.000Z" };
  const afterRegenerate = { ...alreadyMailed, ...patch };
  check("after a re-generate the stamp survives", afterRegenerate.emailedAt === "2026-07-05T10:00:00.000Z", afterRegenerate.emailedAt);

  check("a brand-new payslip starts with no stamp", payslipInsertRecord(fields).emailedAt === null);
}

/* ── 6. A run that generated nothing is not a run ──────────────────────────── */
section("Run summary: pay runs are only recorded when something happened");
{
  const allFailed = summarizeRun([
    { row: 4, ok: false, error: "No employee matches \"E-9\"." },
    { row: 5, ok: false, error: "No employee matches \"E-8\"." },
  ]);
  check("nothing succeeded -> no pay run recorded", allFailed.recordRun === false, allFailed);
  check("...and the failures are still counted", allFailed.processed === 2 && allFailed.failed === 2 && allFailed.succeeded === 0, allFailed);
  check("...with a zero net rather than a made-up one", allFailed.netTotal === 0 && allFailed.periods.length === 0, allFailed);

  const mixed = summarizeRun([
    { row: 4, ok: true, employee: "E-1", net: 34215, emailed: true, period: "July 2026" },
    { row: 5, ok: true, employee: "E-2", net: 20000, emailed: false, period: "July 2026" },
    { row: 6, ok: false, employee: "E-3", error: "no compensation on record" },
  ]);
  check("a partly successful run IS recorded", mixed.recordRun === true, mixed);
  check("counts add up", mixed.processed === 3 && mixed.succeeded === 2 && mixed.failed === 1, mixed);
  check("net total sums only the successes", mixed.netTotal === 54215, mixed);
  check("emailed counts only the delivered ones", mixed.emailed === 1, mixed);
  check("periods are de-duplicated", mixed.periods.length === 1 && mixed.periods[0] === "July 2026", mixed.periods);

  check("an empty run records nothing", summarizeRun([]).recordRun === false);
}

/* ── 7. A typed TDS survives TDS being switched off in payroll settings ───── */
section("Deductions: per-run TDS beats a disabled tds component");
{
  // Shape of a real prod org: TDS and PF switched off, PT on.
  const base = getRuleset("IN");
  const ruleset = {
    ...base,
    components: base.components.map((c) =>
      ["tds", "pf_employee", "pf_employer"].includes(c.key) ? { ...c, enabled: false } : c,
    ),
  };
  const earnings = [
    { key: "basic", label: "Basic", amount: 83334 },
    { key: "hra", label: "HRA", amount: 41667 },
    { key: "special_allowance", label: "Special allowance", amount: 41666 },
    { key: "custom_travelling_allowance", label: "Travelling Allowance", amount: 12796 },
  ];
  const r = computePayroll({ ruleset, earnings, extras: buildExtras(ruleset, { tax: 16033 }) } as any);
  check("gross is the sum of the earnings", r.gross === 179463, r.gross);
  check("typed TDS is deducted", amountOf(r.employeeDeductions, "tds") === 16033, r.employeeDeductions);
  check("PT still applies", amountOf(r.employeeDeductions, "professional_tax") === 200, r.employeeDeductions);
  check("net matches finance", r.net === 163230, r.net);

  // A disabled scheme must stay off even when the employee record carries an amount.
  const pf = computePayroll({
    ruleset, earnings, extras: buildExtras(ruleset, {}, { salary: { deductions: 1800 } }),
  } as any);
  check("disabled PF ignores a stored deduction", amountOf(pf.employeeDeductions, "pf_employee") === 0, pf.employeeDeductions);
  check("blank TDS with TDS off charges nothing", amountOf(pf.employeeDeductions, "tds") === 0, pf.employeeDeductions);
}

/* ── 8. The form only offers deduction rows the engine will honour ───────── */
section("Deductions: form rows match what the engine honours");
{
  const base = getRuleset("IN");
  const off = (keys: string[]) => ({
    ...base,
    components: base.components.map((c) => (keys.includes(c.key) ? { ...c, enabled: false } : c)),
  });
  const rows = statutoryRows(off(["tds", "pf_employee", "pf_employer", "esi_employee", "esi_employer"]) as any);
  const keys = rows.map((r) => r.key);
  check("org-disabled PF/ESI are hidden", !keys.includes("pf_employee") && !keys.includes("esi_employee"), keys);
  check("TDS stays visible when switched off", keys.includes("tds"), keys);
  check("TDS is marked manual", rows.find((r) => r.key === "tds")?.manual === true, rows);
  check("PT is shown and computed", rows.find((r) => r.key === "professional_tax")?.manual === false, rows);
  check("employer contributions are never rows", !keys.some((k) => k.endsWith("_employer")), keys);

  const optedOut = statutoryRows(base, { pf: { applicable: false } });
  check("an opted-out employee sees PF locked", optedOut.find((r) => r.key === "pf_employee")?.applicable === false, optedOut);
}

/* ── 9. Manual runs pay only what HR typed ────────────────────────────────── */
section("Earnings: manual run ignores the saved structure");
{
  // Prince's real saved structure: carries Conveyance + Medical finance never paid.
  const emp = {
    salary: {
      basic: 83334, hra: 33334, allowances: 49999,
      components: [
        { key: "basic", label: "Basic", amount: 83334 },
        { key: "hra", label: "HRA", amount: 33334 },
        { key: "conveyance", label: "Conveyance", amount: 1600 },
        { key: "medical", label: "Medical", amount: 1250 },
        { key: "special_allowance", label: "Special allowance", amount: 47149 },
      ],
    },
  };
  const typed = {
    basic: 83334, hra: 41667, special_allowance: 41666,
    earningLines: [{ label: "Travelling Allowance", amount: 12796 }],
  };
  const manual = buildEarnings(emp, typed, { manual: true });
  const keys = manual.map((l) => l.key);
  check("blank Conveyance/Medical are not paid", !keys.includes("conveyance") && !keys.includes("medical"), keys);
  check("gross is exactly what HR typed", manual.reduce((t, l) => t + l.amount, 0) === 179463, manual);
  check("typed figures are used verbatim", amountOf(manual, "hra") === 41667, manual);

  const prorated = buildEarnings(emp, { basic: 50000 }, { manual: true, proration: { payableDays: 21, daysInMonth: 30 } });
  check("manual amounts are never scaled", prorated.length === 1 && amountOf(prorated, "basic") === 50000, prorated);

  const legacy = buildEarnings(emp, typed);
  check("non-manual runs still fall back to the structure", amountOf(legacy, "conveyance") === 1600, legacy);

  const pfStored = buildExtras(getRuleset("IN"), {}, undefined);
  check("manual run (no emp) carries no stored PF", pfStored.pf_employee === undefined, pfStored);
}
