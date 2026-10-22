/**
 * India statutory ruleset (monthly payroll).
 *
 * Rates/caps reflect common 2024 to 25 norms and are intentionally EDITABLE per org
 * (seeded into payroll_profiles). Income tax (TDS) depends on annual projection &
 * regime, so it is entered by HR per run (FLAT, via extras) rather than computed.
 */

import type { CountryRuleset } from '../types';

const INDIA: CountryRuleset = {
  country: 'IN',
  label: 'India',
  currency: 'INR',
  locale: 'en-IN',
  version: 1,
  effectiveFrom: '2024',
  source: 'EPFO/ESIC norms; professional tax is state-specific',
  components: [
    // ── Employee deductions ──────────────────────────────────────────────
    {
      key: 'pf_employee',
      label: 'Provident Fund (PF)',
      type: 'DEDUCTION',
      side: 'EMPLOYEE',
      calc: 'PERCENT',
      rate: 12,
      base: 'BASIC',
      cap: 15000, // EPF statutory wage ceiling
    },
    {
      key: 'esi_employee',
      label: 'ESI',
      type: 'DEDUCTION',
      side: 'EMPLOYEE',
      calc: 'PERCENT',
      rate: 0.75,
      base: 'GROSS',
      // ESI covers employees earning up to ₹21,000 gross/month and NOBODY above
      // that. This is a ceiling, not a floor: the pack used to carry
      // `floorThreshold: 0`, which reads as "applies from ₹0 upward" and so
      // deducted ESI from every Indian employee at every salary.
      ceilingThreshold: 21000,
      note: 'Applicable when gross is at or below ₹21,000. Higher earners are outside the scheme.',
    },
    {
      key: 'professional_tax',
      label: 'Professional Tax',
      type: 'DEDUCTION',
      side: 'EMPLOYEE',
      calc: 'SLAB',
      base: 'GROSS',
      // Representative Karnataka-style slab; varies by state, editable per org.
      slabs: [
        { upTo: 25000, rate: 0 },
        { upTo: null, rate: 0, flat: 200 },
      ],
      note: 'State-specific. Verify slab with the org’s registered state.',
    },
    {
      key: 'tds',
      label: 'Income Tax (TDS)',
      type: 'TAX',
      side: 'EMPLOYEE',
      calc: 'FLAT',
      rate: 0, // HR enters the monthly TDS per run via extras.tds
      note: 'Entered per run by HR (depends on annual projection & regime).',
    },

    // ── Employer contributions (cost to company, not deducted) ───────────
    {
      key: 'pf_employer',
      label: 'PF, Employer',
      type: 'EMPLOYER_CONTRIBUTION',
      side: 'EMPLOYER',
      calc: 'PERCENT',
      rate: 12,
      base: 'BASIC',
      cap: 15000,
    },
    {
      key: 'esi_employer',
      label: 'ESI, Employer',
      type: 'EMPLOYER_CONTRIBUTION',
      side: 'EMPLOYER',
      calc: 'PERCENT',
      rate: 3.25,
      base: 'GROSS',
      // Same coverage limit as the employee half: no employee ESI, no employer
      // ESI. Kept in step so the cost-to-company figure matches the deduction.
      ceilingThreshold: 21000,
      note: 'Applicable when gross is at or below ₹21,000.',
    },
  ],
};

export default INDIA;
