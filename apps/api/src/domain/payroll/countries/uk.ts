/**
 * United Kingdom statutory ruleset (monthly payroll).
 *
 * PAYE income tax and National Insurance use progressive slabs over MONTHLY
 * thresholds (2024/25 standard England bands, /12). Bands are editable per org
 * and should be verified with finance, they change with each tax year and with
 * the employee's tax code. Workplace pension uses a simple percentage of gross.
 */

import type { CountryRuleset } from '../types';

const UK: CountryRuleset = {
  country: 'UK',
  label: 'United Kingdom',
  currency: 'GBP',
  locale: 'en-GB',
  version: 1,
  effectiveFrom: '2024/25',
  source: 'HMRC PAYE/NI bands 2024/25 (/12 for monthly)',
  components: [
    // ── Employee deductions ──────────────────────────────────────────────
    {
      key: 'paye',
      label: 'Income Tax (PAYE)',
      type: 'TAX',
      side: 'EMPLOYEE',
      calc: 'SLAB',
      base: 'GROSS',
      // Monthly bands: personal allowance £12,570/yr → £1,047.50/mo at 0%,
      // basic 20% to £50,270/yr, higher 40% to £125,140/yr, additional 45%.
      slabs: [
        { upTo: 1047.5, rate: 0 },
        { upTo: 4189.16, rate: 20 },
        { upTo: 10428.33, rate: 40 },
        { upTo: null, rate: 45 },
      ],
      note: 'Standard 2024/25 bands /12. Verify against the employee tax code.',
    },
    {
      key: 'ni_employee',
      label: 'National Insurance',
      type: 'DEDUCTION',
      side: 'EMPLOYEE',
      calc: 'SLAB',
      base: 'GROSS',
      // Primary threshold £1,048/mo, upper earnings limit £4,189/mo.
      slabs: [
        { upTo: 1048, rate: 0 },
        { upTo: 4189, rate: 8 },
        { upTo: null, rate: 2 },
      ],
      note: 'Standard 2024/25 employee NI bands /12. Verify with finance.',
    },
    {
      key: 'pension_employee',
      label: 'Workplace Pension',
      type: 'DEDUCTION',
      side: 'EMPLOYEE',
      calc: 'PERCENT',
      rate: 5,
      base: 'GROSS',
      note: 'Auto-enrolment minimum employee contribution.',
    },

    // ── Employer contributions (cost to company, not deducted) ───────────
    {
      key: 'ni_employer',
      label: 'National Insurance, Employer',
      type: 'EMPLOYER_CONTRIBUTION',
      side: 'EMPLOYER',
      calc: 'SLAB',
      base: 'GROSS',
      // Secondary threshold £758/mo, then 13.8%.
      slabs: [
        { upTo: 758, rate: 0 },
        { upTo: null, rate: 13.8 },
      ],
    },
    {
      key: 'pension_employer',
      label: 'Workplace Pension, Employer',
      type: 'EMPLOYER_CONTRIBUTION',
      side: 'EMPLOYER',
      calc: 'PERCENT',
      rate: 3,
      base: 'GROSS',
    },
  ],
};

export default UK;
