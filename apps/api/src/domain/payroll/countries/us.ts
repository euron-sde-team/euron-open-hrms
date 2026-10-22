/**
 * United States statutory ruleset (monthly payroll).
 *
 * FICA (Social Security + Medicare) is computed; federal & state income tax
 * withholding depend on W-4 / state tables, so they are entered by HR per run
 * (FLAT, via extras). 401(k) is an employee elective deferral entered per run.
 * The Social Security cap below is the ANNUAL wage base; the engine cap is
 * applied to the monthly base, so set it via org override if you need monthly
 * proration, the default leaves SS uncapped at typical monthly salaries.
 */

import type { CountryRuleset } from '../types';

const USA: CountryRuleset = {
  country: 'US',
  label: 'United States',
  currency: 'USD',
  locale: 'en-US',
  version: 1,
  effectiveFrom: '2025',
  source: 'IRS/SSA FICA rates; federal/state income tax HR-entered',
  components: [
    // ── Employee deductions ──────────────────────────────────────────────
    {
      key: 'fica_ss',
      label: 'Social Security',
      type: 'DEDUCTION',
      side: 'EMPLOYEE',
      calc: 'PERCENT',
      rate: 6.2,
      base: 'GROSS',
      note: 'Subject to the annual SS wage base; cap monthly per org if needed.',
    },
    {
      key: 'medicare',
      label: 'Medicare',
      type: 'DEDUCTION',
      side: 'EMPLOYEE',
      calc: 'PERCENT',
      rate: 1.45,
      base: 'GROSS',
    },
    {
      key: 'federal_tax',
      label: 'Federal Income Tax',
      type: 'TAX',
      side: 'EMPLOYEE',
      calc: 'FLAT',
      rate: 0, // HR enters per run via extras.federal_tax
      note: 'Entered per run by HR (W-4 / IRS withholding tables).',
    },
    {
      key: 'state_tax',
      label: 'State Income Tax',
      type: 'TAX',
      side: 'EMPLOYEE',
      calc: 'FLAT',
      rate: 0, // HR enters per run via extras.state_tax (0 in no-tax states)
      note: 'Entered per run by HR; 0 in states with no income tax.',
    },
    {
      key: 'retirement_401k',
      label: '401(k) Contribution',
      type: 'DEDUCTION',
      side: 'EMPLOYEE',
      calc: 'FLAT',
      rate: 0, // employee elective; entered per run via extras.retirement_401k
      taxable: true,
      note: 'Employee elective deferral, entered per run.',
    },

    // ── Employer contributions (cost to company, not deducted) ───────────
    {
      key: 'fica_ss_employer',
      label: 'Social Security, Employer',
      type: 'EMPLOYER_CONTRIBUTION',
      side: 'EMPLOYER',
      calc: 'PERCENT',
      rate: 6.2,
      base: 'GROSS',
    },
    {
      key: 'medicare_employer',
      label: 'Medicare, Employer',
      type: 'EMPLOYER_CONTRIBUTION',
      side: 'EMPLOYER',
      calc: 'PERCENT',
      rate: 1.45,
      base: 'GROSS',
    },
  ],
};

export default USA;
