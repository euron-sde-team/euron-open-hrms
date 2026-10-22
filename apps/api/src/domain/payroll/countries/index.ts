/**
 * Country-pack registry.
 *
 * - Accurate packs (IN/US/UK + the 21 in more-countries.ts) ship verified
 *   statutory rates.
 * - Every OTHER ISO country (iso-countries.ts) is still selectable via a GENERIC
 *   fallback ruleset: correct currency/locale, with Income Tax + Social Security
 *   components defaulted to 0% that HR configures per org.
 *
 * Adding/upgrading a country = add an accurate pack here; the engine never
 * changes. If you later integrate a compliance-data provider (Symmetry/Vertex),
 * it can populate these same CountryRuleset objects.
 */

import type { CountryRuleset } from '../types';
import { ISO_BY_CODE, ISO_COUNTRIES } from '../iso-countries';
import INDIA from './in';
import USA from './us';
import UK from './uk';
import { MORE_PACKS } from './more-countries';

/** Accurate, hand-verified packs keyed by country code. */
const ACCURATE: Record<string, CountryRuleset> = {
  IN: INDIA,
  US: USA,
  UK,
  ...Object.fromEntries(MORE_PACKS.map((p) => [p.country, p])),
};

export const DEFAULT_COUNTRY = 'IN';

/** Normalize loose country input ("india", "gb", "usa") to a registry code. */
export function normalizeCountry(input?: string): string {
  if (!input) return DEFAULT_COUNTRY;
  const c = String(input).trim().toUpperCase();
  const aliases: Record<string, string> = {
    INDIA: 'IN', BHARAT: 'IN',
    USA: 'US', 'UNITED STATES': 'US',
    GB: 'UK', GBR: 'UK', 'UNITED KINGDOM': 'UK', ENGLAND: 'UK',
    UAE: 'AE', 'UNITED ARAB EMIRATES': 'AE',
  };
  return aliases[c] || c;
}

/** Build a generic 0%-default ruleset for any ISO country. */
function genericRuleset(code: string): CountryRuleset {
  const iso = ISO_BY_CODE[code];
  const currency = iso?.currency || 'USD';
  const locale = iso?.locale || 'en-US';
  return {
    country: code,
    label: iso?.label || code,
    currency,
    locale,
    version: 1,
    generic: true,
    note:
      'No built-in statutory pack for this country yet, configure the rates below ' +
      'for your jurisdiction. Income tax is entered per payslip.',
    components: [
      {
        key: 'social_security_employee', label: 'Social Security', type: 'DEDUCTION',
        side: 'EMPLOYEE', calc: 'PERCENT', rate: 0, base: 'GROSS',
        note: 'Set your country’s employee social-security rate.',
      },
      { key: 'income_tax', label: 'Income Tax', type: 'TAX', side: 'EMPLOYEE', calc: 'FLAT', rate: 0,
        note: 'Entered per payslip by HR.' },
      {
        key: 'social_security_employer', label: 'Social Security, Employer', type: 'EMPLOYER_CONTRIBUTION',
        side: 'EMPLOYER', calc: 'PERCENT', rate: 0, base: 'GROSS',
        note: 'Set your country’s employer social-security rate.',
      },
    ],
  };
}

/** Is there an ACCURATE (hand-verified) pack for this country? */
export function hasAccuratePack(country?: string): boolean {
  return !!ACCURATE[normalizeCountry(country)];
}

/** True if this country is selectable at all (accurate pack or known ISO). */
export function isSupportedCountry(country?: string): boolean {
  const c = normalizeCountry(country);
  return !!ACCURATE[c] || !!ISO_BY_CODE[c];
}

/**
 * The ruleset for a country: accurate pack if we have one, else a generic
 * editable fallback. Falls back to IN only for completely unknown input.
 */
export function getRuleset(country?: string): CountryRuleset {
  const c = normalizeCountry(country);
  if (ACCURATE[c]) return ACCURATE[c];
  if (ISO_BY_CODE[c]) return genericRuleset(c);
  return ACCURATE[DEFAULT_COUNTRY];
}

/**
 * All selectable countries for the settings dropdown, every ISO country, with
 * a `builtIn` flag marking which ones ship an accurate statutory pack.
 */
export function listCountries(): Array<{
  country: string;
  label: string;
  currency: string;
  locale: string;
  builtIn: boolean;
}> {
  // Start from the ISO list (covers everything), prefer accurate-pack metadata.
  const rows = ISO_COUNTRIES.map((iso) => {
    const pack = ACCURATE[iso.country];
    return {
      country: iso.country,
      label: iso.label,
      currency: pack?.currency || iso.currency,
      locale: pack?.locale || iso.locale,
      builtIn: !!pack,
    };
  });
  // Built-in (accurate) countries first, then the rest alphabetically.
  return rows.sort((a, b) => {
    if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export { ACCURATE as PACKS };
