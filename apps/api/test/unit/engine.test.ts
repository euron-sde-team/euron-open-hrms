import { it, expect } from "vitest";
/**
 * Standalone sanity checks for the payroll engine. Pure-function tests, no
 * server or DB needed. Run: `npx tsx server/payroll/engine.test.ts`
 */

import { computePayroll } from "../../src/domain/payroll/engine";
import { getRuleset, listCountries, hasAccuratePack } from "../../src/domain/payroll/countries";
import type { CountryRuleset, EarningLine } from "../../src/domain/payroll/types";

/** One test case per check: `actual` must be within `tol` of `expected`. */
function check(name: string, actual: number, expected: number, tol = 0.5) {
  it(name, () => {
    expect(Math.abs(actual - expected), `${name}: got ${actual}, expected ~${expected}`).toBeLessThanOrEqual(tol);
  });
}

// ── India ────────────────────────────────────────────────────────────────────
// basic 50000, hra 20000, allowances 10000 → gross 80000.
// PF = 12% of min(basic, 15000 cap) = 1800. Professional tax (gross > 25000) = 200.
// ESI: gross is over the ₹21,000 coverage ceiling, so it does not apply; this
// block passes extras.esi_employee = 0 anyway, because it also checks that an
// explicit per-run override is honoured. The ceiling itself is exercised below.
{
  const earnings: EarningLine[] = [
    { key: 'basic', label: 'Basic', amount: 50000 },
    { key: 'hra', label: 'HRA', amount: 20000 },
    { key: 'allowances', label: 'Allowances', amount: 10000 },
  ];
  const r = computePayroll({
    earnings,
    ruleset: getRuleset('IN'),
    // TDS entered by HR; ESI disabled for a high earner via override 0.
    extras: { tds: 5000, esi_employee: 0 },
  });
  check('IN gross', r.gross, 80000);
  const pf = r.employeeDeductions.find((d) => d.label.includes('Provident'))?.amount;
  check('IN PF (capped)', pf || 0, 1800);
  const pt = r.employeeDeductions.find((d) => d.label.includes('Professional'))?.amount;
  check('IN professional tax', pt || 0, 200);
  // deductions = PF 1800 + PT 200 + TDS 5000 = 7000 → net 73000
  check('IN total deductions', r.totalDeductions, 7000);
  check('IN net', r.net, 73000);
  const pfEr = r.employerContributions.find((d) => d.label.includes('Employer'))?.amount;
  check('IN employer PF tracked', pfEr || 0, 1800);
}

// ── United States ─────────────────────────────────────────────────────────────
// base 6000 → gross 6000. FICA SS 6.2% = 372, Medicare 1.45% = 87,
// federal tax (HR) 800. net = 6000 - (372+87+800) = 4741.
{
  const earnings: EarningLine[] = [
    { key: 'basic', label: 'Base Salary', amount: 6000 },
  ];
  const r = computePayroll({
    earnings,
    ruleset: getRuleset('US'),
    extras: { federal_tax: 800, state_tax: 0, retirement_401k: 0 },
  });
  check('US gross', r.gross, 6000);
  const ss = r.employeeDeductions.find((d) => d.label.includes('Social Security'))?.amount;
  check('US FICA SS', ss || 0, 372);
  const med = r.employeeDeductions.find((d) => d.label.includes('Medicare'))?.amount;
  check('US Medicare', med || 0, 87);
  check('US total deductions', r.totalDeductions, 1259);
  check('US net', r.net, 4741);
}

// ── United Kingdom ────────────────────────────────────────────────────────────
// gross 4000/mo. PAYE slab: 0% to 1047.50, 20% on (4000-1047.50)=2952.50 → 590.50.
// NI slab: 0% to 1048, 8% on (4000-1048)=2952 → 236.16. Pension 5% = 200.
// net = 4000 - (590.50 + 236.16 + 200) = 2973.34.
{
  const earnings: EarningLine[] = [
    { key: 'basic', label: 'Gross Salary', amount: 4000 },
  ];
  const r = computePayroll({ earnings, ruleset: getRuleset('UK') });
  check('UK gross', r.gross, 4000);
  const paye = r.employeeDeductions.find((d) => d.label.includes('PAYE'))?.amount;
  check('UK PAYE', paye || 0, 590.5);
  const ni = r.employeeDeductions.find((d) => d.label.includes('National Insurance'))?.amount;
  check('UK NI', ni || 0, 236.16);
  const pension = r.employeeDeductions.find((d) => d.label.includes('Pension'))?.amount;
  check('UK pension', pension || 0, 200);
  check('UK net', r.net, 2973.34);
}

// ── New accurate packs (spot-check a few) ─────────────────────────────────────
{
  // Germany: gross 5000 → pension 9.3% + health 8.55% + care 1.8% + unemp 1.3% = 20.95% = 1047.50
  const r = computePayroll({
    earnings: [{ key: 'basic', label: 'Base', amount: 5000 }],
    ruleset: getRuleset('DE'),
  });
  check('DE gross', r.gross, 5000);
  check('DE total employee deductions (~20.95% under ceilings)', r.totalDeductions, 1047.5);
  check('DE currency EUR', r.currency === 'EUR' ? 1 : 0, 1);
  check('DE has employer contributions', r.employerContributions.length > 0 ? 1 : 0, 1);
}
{
  // Singapore: gross 5000 (≤ ceiling) → CPF employee 20% = 1000
  const r = computePayroll({
    earnings: [{ key: 'basic', label: 'Base', amount: 5000 }],
    ruleset: getRuleset('SG'),
  });
  check('SG CPF employee 20%', r.totalDeductions, 1000);
  check('SG currency SGD', r.currency === 'SGD' ? 1 : 0, 1);
}
{
  // UAE expat scenario: disable both GPSSA lines → net = gross, no income tax
  const r = computePayroll({
    earnings: [{ key: 'basic', label: 'Base', amount: 30000 }],
    ruleset: getRuleset('AE'),
    extras: { gpssa_employee: 0, gpssa_employer: 0 },
  });
  check('AE expat (GPSSA disabled) net = gross', r.net, 30000);
  check('AE currency AED', r.currency === 'AED' ? 1 : 0, 1);
}

// ── Generic fallback for a non-pack country ───────────────────────────────────
{
  const r = computePayroll({
    earnings: [{ key: 'basic', label: 'Base', amount: 5000 }],
    ruleset: getRuleset('SE'), // Sweden, no accurate pack
  });
  check('SE (generic) currency SEK', r.currency === 'SEK' ? 1 : 0, 1);
  check('SE (generic) net = gross at 0% defaults', r.net, 5000);
  check('SE is NOT an accurate pack', hasAccuratePack('SE') ? 0 : 1, 1);
  check('SE generic ruleset flagged', getRuleset('SE').generic ? 1 : 0, 1);
}

// ── Eligibility ceilings (ESI and friends) ───────────────────────────────────
// A ceiling switches a component OFF above the line, unlike `cap`, which limits
// the base but still charges everybody. India's ESI is a coverage scheme with a
// ₹21,000 gross limit; the pack used to carry `floorThreshold: 0` ("applies from
// zero upward"), so every Indian employee was charged ESI at every salary.
{
  const IN = getRuleset('IN');
  const esi = IN.components.find((c) => c.key === 'esi_employee')!;
  check('IN ESI is defined by a ceiling, not a floor', esi.ceilingThreshold === 21000 && esi.floorThreshold == null ? 1 : 0, 1);

  // Below the ceiling: covered. 0.75% of 20,000 = 150 employee, 3.25% = 650 employer.
  const low = computePayroll({
    earnings: [{ key: 'basic', label: 'Basic', amount: 12000 }, { key: 'hra', label: 'HRA', amount: 8000 }],
    ruleset: IN,
  });
  const lowEsi = low.employeeDeductions.find((d) => d.label === 'ESI')?.amount ?? 0;
  check('IN ESI charged at 20,000 gross (under the ceiling)', lowEsi, 150);
  const lowEsiEr = low.employerContributions.find((d) => d.label.startsWith('ESI'))?.amount ?? 0;
  check('IN employer ESI charged too', lowEsiEr, 650);

  // Exactly on the line is still covered ("at or below ₹21,000").
  const edge = computePayroll({
    earnings: [{ key: 'basic', label: 'Basic', amount: 21000 }],
    ruleset: IN,
  });
  check('IN ESI at exactly 21,000 is still charged', edge.employeeDeductions.find((d) => d.label === 'ESI')?.amount ?? 0, 157.5);

  // A rupee over: outside the scheme entirely, both halves.
  const over = computePayroll({
    earnings: [{ key: 'basic', label: 'Basic', amount: 21001 }],
    ruleset: IN,
  });
  check('IN ESI NOT charged at 21,001 gross', over.employeeDeductions.find((d) => d.label === 'ESI')?.amount ?? 0, 0);
  check('IN employer ESI NOT charged at 21,001 gross', over.employerContributions.filter((d) => d.label.startsWith('ESI')).length, 0);

  // The high earner from the first block, with no per-run override this time.
  const high = computePayroll({
    earnings: [
      { key: 'basic', label: 'Basic', amount: 50000 },
      { key: 'hra', label: 'HRA', amount: 20000 },
      { key: 'allowances', label: 'Allowances', amount: 10000 },
    ],
    ruleset: IN,
    extras: { tds: 5000 },
  });
  check('IN 80,000 gross: no ESI without any override', high.employeeDeductions.some((d) => d.label === 'ESI') ? 1 : 0, 0);
  check('IN 80,000 net = 73,000 without disabling ESI by hand', high.net, 73000);
}
{
  // The engine concept itself, on a synthetic pack: ceiling and floor compose,
  // and an HR per-run override still beats both (that is how an exception gets
  // entered for a covered employee).
  const ruleset: CountryRuleset = {
    country: 'ZZ', label: 'Testland', currency: 'ZZD', locale: 'en',
    components: [
      { key: 'scheme', label: 'Scheme', type: 'DEDUCTION', side: 'EMPLOYEE', calc: 'PERCENT', rate: 10, base: 'GROSS', ceilingThreshold: 1000 },
      { key: 'band', label: 'Band', type: 'DEDUCTION', side: 'EMPLOYEE', calc: 'PERCENT', rate: 10, base: 'GROSS', floorThreshold: 500, ceilingThreshold: 1000 },
    ],
  };
  const at = (amount: number, extras?: Record<string, number>) =>
    computePayroll({ earnings: [{ key: 'basic', label: 'Base', amount }], ruleset, extras });

  check('ceiling: charged below the line', at(900).employeeDeductions.find((d) => d.key === 'scheme')?.amount ?? 0, 90);
  check('ceiling: not charged above the line', at(1100).employeeDeductions.find((d) => d.key === 'scheme')?.amount ?? 0, 0);
  check('floor + ceiling: inside the band', at(800).employeeDeductions.find((d) => d.key === 'band')?.amount ?? 0, 80);
  check('floor + ceiling: below the floor', at(400).employeeDeductions.find((d) => d.key === 'band')?.amount ?? 0, 0);
  check('floor + ceiling: above the ceiling', at(1100).employeeDeductions.find((d) => d.key === 'band')?.amount ?? 0, 0);
  check('a per-run override still wins over the ceiling', at(1100, { scheme: 25 }).employeeDeductions.find((d) => d.key === 'scheme')?.amount ?? 0, 25);
  check('no ceiling set = charged at any amount',
    computePayroll({
      earnings: [{ key: 'basic', label: 'Base', amount: 99999 }],
      ruleset: { ...ruleset, components: [{ ...ruleset.components[0], ceilingThreshold: undefined }] },
    }).totalDeductions, 9999.9);
}

// ── Registry coverage ─────────────────────────────────────────────────────────
{
  const all = listCountries();
  check('listCountries returns 100+ countries', all.length >= 100 ? 1 : 0, 1);
  const builtIn = all.filter((c) => c.builtIn).length;
  check('24 accurate built-in packs', builtIn, 24);
}
