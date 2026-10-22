/**
 * Accurate statutory packs for 21 additional countries (2024/2025).
 *
 * Each ruleset ships social-contribution rates as EDITABLE defaults (HR can
 * override per org via the settings UI). Income tax is HR-entered per payslip
 * everywhere, it depends on per-employee allowances/tax codes/annual projection
 * and cannot be reduced to one stored rate. Rates are stamped with the year they
 * reflect; statutory rates change yearly, so re-verify against the cited source.
 *
 * Many employer rates (work-injury, housing funds) are per-company in reality, * shipped as a typical default and flagged in `note`. UAE/Saudi social security
 * is nationals-only; the packs default to the common case and note the expat
 * (≈0) treatment.
 */

import type { CountryRuleset } from '../types';

// ── Helpers to keep the packs terse ─────────────────────────────────────────
const pct = (
  key: string,
  label: string,
  rate: number,
  side: 'EMPLOYEE' | 'EMPLOYER',
  extra: Partial<CountryRuleset['components'][number]> = {},
): CountryRuleset['components'][number] => ({
  key,
  label,
  type: side === 'EMPLOYER' ? 'EMPLOYER_CONTRIBUTION' : 'DEDUCTION',
  side,
  calc: 'PERCENT',
  rate,
  base: 'GROSS',
  ...extra,
});

const incomeTax = (label = 'Income Tax', key = 'income_tax') =>
  ({
    key,
    label,
    type: 'TAX' as const,
    side: 'EMPLOYEE' as const,
    calc: 'FLAT' as const,
    rate: 0,
    note: 'Entered per payslip by HR (depends on allowances / tax code / annual projection).',
  });

export const MORE_PACKS: CountryRuleset[] = [
  // ── Americas + Oceania ────────────────────────────────────────────────────
  {
    country: 'CA', label: 'Canada', currency: 'CAD', locale: 'en-CA', version: 1,
    effectiveFrom: '2025', source: 'CRA CPP/EI 2025 (Quebec uses QPP/QPIP, separate)',
    components: [
      pct('cpp_employee', 'CPP', 5.95, 'EMPLOYEE', { base: 'GROSS', note: 'On (pensionable − $3,500), capped at YMPE $71,300 (2025).' }),
      pct('ei_employee', 'Employment Insurance', 1.64, 'EMPLOYEE', { cap: 65700 / 12, note: 'Max insurable $65,700/yr (2025).' }),
      incomeTax('Federal + Provincial Tax', 'income_tax'),
      pct('cpp_employer', 'CPP, Employer', 5.95, 'EMPLOYER'),
      pct('ei_employer', 'EI, Employer', 2.296, 'EMPLOYER', { note: 'Employer EI = 1.4× employee.' }),
    ],
  },
  {
    country: 'AU', label: 'Australia', currency: 'AUD', locale: 'en-AU', version: 1,
    effectiveFrom: 'FY2025-26', source: 'ATO, Super guarantee 12%, Medicare levy 2%',
    components: [
      pct('medicare_levy', 'Medicare Levy', 2, 'EMPLOYEE', { note: 'Reconciled at tax return; low-income phase-in applies.' }),
      incomeTax('Income Tax (PAYG)', 'income_tax'),
      pct('superannuation', 'Superannuation Guarantee', 12, 'EMPLOYER', { note: '12% of ordinary time earnings (from 1 Jul 2025); quarterly max base applies.' }),
    ],
  },
  {
    country: 'BR', label: 'Brazil', currency: 'BRL', locale: 'pt-BR', version: 1,
    effectiveFrom: '2025', source: 'INSS 2025 brackets; FGTS 8%; IRRF HR-entered',
    components: [
      // INSS is progressive; 11% is the common effective ceiling rate, editable.
      pct('inss_employee', 'INSS', 11, 'EMPLOYEE', { cap: 8157.41, note: 'Progressive 7.5 to 14%; capped at teto R$8,157.41 (2025). Default ~ceiling rate; adjust per salary.' }),
      incomeTax('Income Tax (IRRF)', 'income_tax'),
      pct('fgts', 'FGTS', 8, 'EMPLOYER', { note: 'Deposit to worker fund, no cap.' }),
      pct('inss_employer', 'INSS, Employer (patronal)', 20, 'EMPLOYER', { note: '~20% + RAT 1 to 3% + Sistema S ~3.3 to 5.8% (per-company).' }),
    ],
  },
  {
    country: 'MX', label: 'Mexico', currency: 'MXN', locale: 'es-MX', version: 1,
    effectiveFrom: '2025', source: 'IMSS/INFONAVIT 2025; ISR HR-entered',
    components: [
      pct('imss_employee', 'IMSS', 2.775, 'EMPLOYEE', { note: 'Combined employee IMSS branches incl. CEAV ~2.775% (approx; SBC-capped at 25 UMA).' }),
      incomeTax('Income Tax (ISR)', 'income_tax'),
      pct('imss_employer', 'IMSS, Employer', 22, 'EMPLOYER', { note: '~20 to 35% across branches incl. variable CEAV/Riesgos (per-company).' }),
      pct('infonavit', 'INFONAVIT (housing), Employer', 5, 'EMPLOYER'),
    ],
  },

  // ── Europe ────────────────────────────────────────────────────────────────
  {
    country: 'DE', label: 'Germany', currency: 'EUR', locale: 'de-DE', version: 1,
    effectiveFrom: '2025', source: 'German social insurance 2025 (ceilings apply)',
    components: [
      pct('pension_employee', 'Pension (Rentenversicherung)', 9.3, 'EMPLOYEE', { cap: 8050, note: 'Ceiling €8,050/mo (2025).' }),
      pct('health_employee', 'Health (Krankenversicherung)', 8.55, 'EMPLOYEE', { cap: 5512.5, note: '7.3% + ½ avg Zusatzbeitrag; ceiling €5,512.50/mo.' }),
      pct('care_employee', 'Long-term Care (Pflege)', 1.8, 'EMPLOYEE', { cap: 5512.5, note: '+0.6% childless surcharge (age 23+).' }),
      pct('unemployment_employee', 'Unemployment', 1.3, 'EMPLOYEE', { cap: 8050 }),
      incomeTax('Income Tax (Lohnsteuer)', 'income_tax'),
      pct('pension_employer', 'Pension, Employer', 9.3, 'EMPLOYER', { cap: 8050 }),
      pct('health_employer', 'Health, Employer', 8.55, 'EMPLOYER', { cap: 5512.5 }),
      pct('care_employer', 'Care, Employer', 1.8, 'EMPLOYER', { cap: 5512.5 }),
      pct('unemployment_employer', 'Unemployment, Employer', 1.3, 'EMPLOYER', { cap: 8050 }),
    ],
  },
  {
    country: 'FR', label: 'France', currency: 'EUR', locale: 'fr-FR', version: 1,
    effectiveFrom: '2025', source: 'URSSAF/CLEISS 2025 (simplified employee charges)',
    components: [
      pct('csg_crds', 'CSG/CRDS', 9.7, 'EMPLOYEE', { note: 'On 98.25% of gross (simplified to gross here).' }),
      pct('pension_employee', 'Old-age + AGIRC-ARRCO', 11.31, 'EMPLOYEE', { note: 'Combined capped/uncapped + complementary pension (approx).' }),
      incomeTax('Income Tax (Prélèvement à la source)', 'income_tax'),
      pct('social_employer', 'Employer Social Charges', 42, 'EMPLOYER', { note: 'Health/family/pension/unemployment combined ~40 to 45% (varies; reduced for low earners).' }),
    ],
  },
  {
    country: 'NL', label: 'Netherlands', currency: 'EUR', locale: 'nl-NL', version: 1,
    effectiveFrom: '2025', source: 'Belastingdienst 2025; NI bundled into income tax',
    components: [
      incomeTax('Income Tax + National Insurance (loonheffing)', 'income_tax'),
      pct('zvw_employer', 'Health levy (Zvw), Employer', 6.51, 'EMPLOYER', { cap: 75864 / 12, note: 'Capped at €75,864/yr (2025).' }),
      pct('ww_employer', 'Unemployment (WW/Awf), Employer', 2.74, 'EMPLOYER', { cap: 75864 / 12, note: 'Low rate 2.74% / high 7.74%.' }),
      pct('aof_employer', 'Disability (Aof), Employer', 7.64, 'EMPLOYER', { cap: 75864 / 12, note: 'Small employer 6.28% / larger 7.64%.' }),
    ],
  },
  {
    country: 'IE', label: 'Ireland', currency: 'EUR', locale: 'en-IE', version: 1,
    effectiveFrom: '2025', source: 'Revenue.ie PRSI Class A (Oct 2025 rates)',
    components: [
      pct('prsi_employee', 'PRSI', 4.2, 'EMPLOYEE', { note: 'Class A1; nil if weekly earnings ≤ €352.' }),
      incomeTax('Income Tax (PAYE) + USC', 'income_tax'),
      pct('prsi_employer', 'PRSI, Employer', 11.25, 'EMPLOYER', { note: '11.25% higher / 9.0% lower rate; includes NTF levy.' }),
    ],
  },
  {
    country: 'ES', label: 'Spain', currency: 'EUR', locale: 'es-ES', version: 1,
    effectiveFrom: '2025', source: 'Seguridad Social 2025 (max base €4,909.50/mo)',
    components: [
      pct('ss_employee', 'Social Security', 6.47, 'EMPLOYEE', { cap: 4909.5, note: 'Common contingencies 4.7% + unemployment 1.55% + training 0.1% + MEI 0.13%.' }),
      incomeTax('Income Tax (IRPF)', 'income_tax'),
      pct('ss_employer', 'Social Security, Employer', 30.57, 'EMPLOYER', { cap: 4909.5, note: 'Excludes per-activity work-accident (AT/EP).' }),
    ],
  },
  {
    country: 'IT', label: 'Italy', currency: 'EUR', locale: 'it-IT', version: 1,
    effectiveFrom: '2025', source: 'INPS 2025 (rate sector-dependent)',
    components: [
      pct('inps_employee', 'INPS', 9.19, 'EMPLOYEE', { note: '9.19% standard; +1% above first bracket (€55,448).' }),
      incomeTax('Income Tax (IRPEF)', 'income_tax'),
      pct('inps_employer', 'INPS, Employer', 30, 'EMPLOYER', { note: '~28 to 30%; INAIL work-injury separate (per-activity).' }),
    ],
  },
  {
    country: 'PL', label: 'Poland', currency: 'PLN', locale: 'pl-PL', version: 1,
    effectiveFrom: '2025', source: 'ZUS 2025 (pension/disability capped at PLN 260,190/yr)',
    components: [
      pct('pension_employee', 'Pension (emerytalne)', 9.76, 'EMPLOYEE'),
      pct('disability_employee', 'Disability (rentowe)', 1.5, 'EMPLOYEE'),
      pct('sickness_employee', 'Sickness (chorobowe)', 2.45, 'EMPLOYEE'),
      pct('health_employee', 'Health (zdrowotne)', 9, 'EMPLOYEE', { note: 'Base = gross − employee social (~13.71%).' }),
      incomeTax('Income Tax (PIT)', 'income_tax'),
      pct('pension_employer', 'Pension, Employer', 9.76, 'EMPLOYER'),
      pct('disability_employer', 'Disability, Employer', 6.5, 'EMPLOYER'),
      pct('accident_employer', 'Accident (wypadkowe), Employer', 1.67, 'EMPLOYER', { note: 'Per-employer 0.67 to 3.33%.' }),
      pct('labour_fund_employer', 'Labour Fund, Employer', 2.45, 'EMPLOYER'),
    ],
  },

  // ── Asia / Middle East / Africa ───────────────────────────────────────────
  {
    country: 'AE', label: 'United Arab Emirates', currency: 'AED', locale: 'ar-AE', version: 1,
    effectiveFrom: '2025', source: 'GPSSA Law 57/2023, NATIONALS ONLY; expats ≈ 0; no income tax',
    note: 'GPSSA pension applies to UAE/GCC nationals only. For expatriate employees, disable both components (no statutory social security, no personal income tax).',
    components: [
      pct('gpssa_employee', 'GPSSA Pension (nationals)', 11, 'EMPLOYEE', { cap: 70000, note: 'New national members (Law 57/2023). Disable for expats.' }),
      pct('gpssa_employer', 'GPSSA, Employer (nationals)', 15, 'EMPLOYER', { cap: 70000, note: 'Disable for expats.' }),
    ],
  },
  {
    country: 'SA', label: 'Saudi Arabia', currency: 'SAR', locale: 'ar-SA', version: 1,
    effectiveFrom: '2025', source: 'GOSI 2025, nationals vs non-Saudis; no income tax',
    note: 'Saudi nationals: pension + SANED. Non-Saudis: employer 2% occupational hazard only, disable the employee/pension lines for expats.',
    components: [
      pct('gosi_employee', 'GOSI (Saudi nationals)', 9.75, 'EMPLOYEE', { cap: 45000, note: 'Pension 9% + SANED 0.75%. New entrants step to 10.25%. Disable for non-Saudis.' }),
      pct('gosi_employer', 'GOSI, Employer (Saudi)', 11.75, 'EMPLOYER', { cap: 45000, note: 'Non-Saudis: employer 2% (occupational hazard) only.' }),
    ],
  },
  {
    country: 'SG', label: 'Singapore', currency: 'SGD', locale: 'en-SG', version: 1,
    effectiveFrom: '2025', source: 'CPF Board 2025, CITIZENS/PRs ONLY (OW ceiling SGD 7,400/mo)',
    note: 'CPF applies to citizens & PRs only (age ≤55 default). Foreigners: disable CPF (employer pays SDL + Foreign Worker Levy instead).',
    components: [
      pct('cpf_employee', 'CPF (citizens/PRs)', 20, 'EMPLOYEE', { cap: 7400, note: 'Age ≤55. Rates step down by age band. Disable for foreigners.' }),
      incomeTax('Income Tax (self-assessed)', 'income_tax'),
      pct('cpf_employer', 'CPF, Employer (citizens/PRs)', 17, 'EMPLOYER', { cap: 7400, note: 'Disable for foreigners.' }),
    ],
  },
  {
    country: 'JP', label: 'Japan', currency: 'JPY', locale: 'ja-JP', version: 1,
    effectiveFrom: 'FY2025', source: 'Japan social insurance FY2025 (Tokyo rates; prefecture-specific)',
    components: [
      pct('health_employee', 'Health Insurance', 4.95, 'EMPLOYEE', { cap: 1390000, note: 'Tokyo ~9.91% total; varies by prefecture.' }),
      pct('pension_employee', "Pension (Kosei Nenkin)", 9.15, 'EMPLOYEE', { cap: 650000 }),
      pct('employment_ins_employee', 'Employment Insurance', 0.55, 'EMPLOYEE'),
      incomeTax('Income Tax (gensen)', 'income_tax'),
      pct('health_employer', 'Health, Employer', 4.95, 'EMPLOYER', { cap: 1390000 }),
      pct('pension_employer', 'Pension, Employer', 9.15, 'EMPLOYER', { cap: 650000 }),
      pct('employment_ins_employer', 'Employment Insurance, Employer', 0.9, 'EMPLOYER'),
    ],
  },
  {
    country: 'CN', label: 'China', currency: 'CNY', locale: 'zh-CN', version: 1,
    effectiveFrom: '2024/25', source: 'Shanghai social insurance + housing fund (city-specific)',
    note: 'Rates and contribution bases are city-specific (Shanghai shown). Housing-fund % is employer-selectable within the legal band.',
    components: [
      pct('pension_employee', 'Pension', 8, 'EMPLOYEE', { cap: 36921, note: 'Shanghai base floor ¥7,384 / ceiling ¥36,921.' }),
      pct('medical_employee', 'Medical', 2, 'EMPLOYEE', { cap: 36921 }),
      pct('unemployment_employee', 'Unemployment', 0.5, 'EMPLOYEE', { cap: 36921 }),
      pct('housing_fund_employee', 'Housing Provident Fund', 7, 'EMPLOYEE', { cap: 36921, note: 'Employer-selectable 5 to 7% (SH).' }),
      incomeTax('Income Tax (IIT)', 'income_tax'),
      pct('pension_employer', 'Pension, Employer', 16, 'EMPLOYER', { cap: 36921 }),
      pct('medical_employer', 'Medical, Employer', 9, 'EMPLOYER', { cap: 36921 }),
      pct('unemployment_employer', 'Unemployment, Employer', 0.5, 'EMPLOYER', { cap: 36921 }),
      pct('housing_fund_employer', 'Housing Fund, Employer', 7, 'EMPLOYER', { cap: 36921 }),
    ],
  },
  {
    country: 'PH', label: 'Philippines', currency: 'PHP', locale: 'en-PH', version: 1,
    effectiveFrom: '2025', source: 'SSS/PhilHealth/Pag-IBIG 2025',
    components: [
      pct('sss_employee', 'SSS', 5, 'EMPLOYEE', { cap: 35000, note: 'MSC ceiling ₱35,000 (2025).' }),
      pct('philhealth_employee', 'PhilHealth', 2.5, 'EMPLOYEE', { cap: 100000, note: 'Salary floor ₱10,000 / ceiling ₱100,000.' }),
      pct('pagibig_employee', 'Pag-IBIG', 2, 'EMPLOYEE', { cap: 10000, note: 'Comp capped ₱10,000 → max ₱200/mo.' }),
      incomeTax('Withholding Tax', 'income_tax'),
      pct('sss_employer', 'SSS, Employer', 10, 'EMPLOYER', { cap: 35000 }),
      pct('philhealth_employer', 'PhilHealth, Employer', 2.5, 'EMPLOYER', { cap: 100000 }),
      pct('pagibig_employer', 'Pag-IBIG, Employer', 2, 'EMPLOYER', { cap: 10000 }),
    ],
  },
  {
    country: 'ID', label: 'Indonesia', currency: 'IDR', locale: 'id-ID', version: 1,
    effectiveFrom: '2024/25', source: 'BPJS Ketenagakerjaan + Kesehatan',
    components: [
      pct('jht_employee', 'BPJS JHT (old age)', 2, 'EMPLOYEE'),
      pct('jp_employee', 'BPJS JP (pension)', 1, 'EMPLOYEE', { cap: 10547400, note: 'Ceiling re-indexed each March.' }),
      pct('health_employee', 'BPJS Kesehatan (health)', 1, 'EMPLOYEE', { cap: 12000000 }),
      incomeTax('Income Tax (PPh 21)', 'income_tax'),
      pct('jht_employer', 'BPJS JHT, Employer', 3.7, 'EMPLOYER'),
      pct('jp_employer', 'BPJS JP, Employer', 2, 'EMPLOYER', { cap: 10547400 }),
      pct('health_employer', 'BPJS Kesehatan, Employer', 4, 'EMPLOYER', { cap: 12000000 }),
      pct('jkm_employer', 'BPJS JKM (death), Employer', 0.3, 'EMPLOYER'),
    ],
  },
  {
    country: 'ZA', label: 'South Africa', currency: 'ZAR', locale: 'en-ZA', version: 1,
    effectiveFrom: '2025', source: 'SARS UIF (capped R17,712/mo) + SDL',
    components: [
      pct('uif_employee', 'UIF', 1, 'EMPLOYEE', { cap: 17712, note: 'Capped → max R177.12/mo.' }),
      incomeTax('Income Tax (PAYE)', 'income_tax'),
      pct('uif_employer', 'UIF, Employer', 1, 'EMPLOYER', { cap: 17712 }),
      pct('sdl_employer', 'Skills Development Levy, Employer', 1, 'EMPLOYER', { note: 'Only if annual payroll > R500,000.' }),
    ],
  },
  {
    country: 'NG', label: 'Nigeria', currency: 'NGN', locale: 'en-NG', version: 1,
    effectiveFrom: '2025', source: 'PenCom CPS + NHF',
    components: [
      pct('pension_employee', 'Pension (CPS)', 8, 'EMPLOYEE', { base: 'GROSS', note: 'On basic+housing+transport.' }),
      pct('nhf_employee', 'National Housing Fund (NHF)', 2.5, 'EMPLOYEE', { base: 'BASIC', note: 'On basic salary; configurable (mandatory public sector).' }),
      incomeTax('Income Tax (PAYE)', 'income_tax'),
      pct('pension_employer', 'Pension, Employer', 10, 'EMPLOYER', { base: 'GROSS' }),
      pct('nsitf_employer', 'NSITF, Employer', 1, 'EMPLOYER'),
    ],
  },
  {
    country: 'KE', label: 'Kenya', currency: 'KES', locale: 'en-KE', version: 1,
    effectiveFrom: '2025', source: 'NSSF Year-3 (Feb 2025) + SHIF + Housing Levy',
    components: [
      pct('nssf_employee', 'NSSF', 6, 'EMPLOYEE', { cap: 72000, note: 'Tier I+II; UEL KES 72,000 → max KES 4,320/mo (2025).' }),
      pct('shif_employee', 'SHIF (health)', 2.75, 'EMPLOYEE', { note: 'Min KES 300/mo, no cap.' }),
      pct('housing_levy_employee', 'Affordable Housing Levy', 1.5, 'EMPLOYEE'),
      incomeTax('Income Tax (PAYE)', 'income_tax'),
      pct('nssf_employer', 'NSSF, Employer', 6, 'EMPLOYER', { cap: 72000 }),
      pct('housing_levy_employer', 'Housing Levy, Employer', 1.5, 'EMPLOYER'),
    ],
  },
];
