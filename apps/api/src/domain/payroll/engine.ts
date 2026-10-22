/**
 * Country-agnostic gross→net payroll engine.
 *
 * `computePayroll` runs the SAME logic for every country. All country-specific
 * behaviour comes from the `CountryRuleset` passed in (see ./countries). The
 * engine never hardcodes a country, currency, or statutory rate.
 *
 *   gross  = Σ earnings
 *   each employee DEDUCTION/TAX  → reduces net
 *   each EMPLOYER_CONTRIBUTION   → tracked as cost-to-company, NOT in net
 *   net    = gross − Σ employee deductions
 */

import { round2 } from '../../core/util';
import type {
  AmountLine,
  CountryRuleset,
  EarningLine,
  PayComponent,
  PayrollInput,
  PayrollResult,
  Slab,
  StatutorySettings,
} from './types';

const sum = (rows: { amount: number }[]): number =>
  round2(rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0));

/** Progressive slab evaluation over `base`. Brackets must be ordered low→high. */
function evalSlab(base: number, slabs: Slab[] = []): number {
  let remaining = base;
  let lastCap = 0;
  let total = 0;
  for (const slab of slabs) {
    if (remaining <= 0) break;
    const upper = slab.upTo == null ? Infinity : slab.upTo;
    const span = Math.max(0, Math.min(base, upper) - lastCap);
    const taxedInBand = Math.min(remaining, span);
    if (taxedInBand > 0) {
      total += (taxedInBand * (slab.rate || 0)) / 100 + (slab.flat || 0);
      remaining -= taxedInBand;
    }
    lastCap = upper;
  }
  return round2(total);
}

/**
 * Resolve the base amount a component runs against.
 * Special tokens GROSS/BASIC/TAXABLE, or a specific earning's key.
 */
function resolveBase(
  comp: PayComponent,
  earnings: EarningLine[],
  gross: number,
  basic: number,
  taxable: number,
): number {
  switch (comp.base) {
    case undefined:
    case 'GROSS':
      return gross;
    case 'BASIC':
      return basic;
    case 'TAXABLE':
      return taxable;
    default: {
      const match = earnings.find((e) => e.key === comp.base);
      return match ? Number(match.amount) || 0 : gross;
    }
  }
}

/** Evaluate one component to a money amount (after override/cap/threshold). */
function evalComponent(
  comp: PayComponent,
  earnings: EarningLine[],
  gross: number,
  basic: number,
  taxable: number,
  extras: Record<string, number>,
): number {
  const override = extras[comp.key];
  const hasOverride = override !== undefined && override !== null && override !== ('' as unknown);

  // Income tax is withholding HR works out per person, not a scheme the org opts
  // into, and its computed amount is always 0. Switching it off in payroll
  // settings ("we enter TDS ourselves") used to discard the figure HR then typed,
  // so a payslip silently lost its TDS. A typed tax figure therefore beats the
  // toggle. Schemes (PF, ESI, PT) keep the toggle authoritative: their extras can
  // come from the employee record rather than this run, and a disabled scheme
  // must not start charging because an old stored amount exists.
  if (comp.enabled === false && !(comp.type === 'TAX' && hasOverride)) return 0;

  // HR per-run override always wins (TDS, federal/state tax, etc.).
  if (hasOverride) return round2(override);

  const rawBase = resolveBase(comp, earnings, gross, basic, taxable);
  // Eligibility thresholds check the *raw* base, not the capped one: whether a
  // scheme covers this employee is decided on their real wage, and only then is
  // the contribution base capped.
  if (comp.floorThreshold != null && rawBase < comp.floorThreshold) return 0;
  // A ceiling excludes the employee from the scheme entirely (ESI above the
  // wage limit), as opposed to `cap`, which merely limits the base.
  if (comp.ceilingThreshold != null && rawBase > comp.ceilingThreshold) return 0;

  const base = comp.cap != null ? Math.min(rawBase, comp.cap) : rawBase;

  switch (comp.calc) {
    case 'FLAT':
      return round2(comp.rate ?? 0);
    case 'PERCENT':
      return round2((base * (comp.rate ?? 0)) / 100);
    case 'SLAB':
      return evalSlab(base, comp.slabs);
    default:
      return 0;
  }
}


/**
 * Map a component key onto the per-employee statutory settings.
 *
 * The two halves of a scheme share one setting on purpose: switching an employee
 * out of PF must drop `pf_employee` AND `pf_employer` together, and the India
 * pack already keeps their coverage limits in step for the same reason.
 */
export function statutoryFor(statutory: StatutorySettings | undefined, key: string) {
  if (!statutory) return null;
  if (key === 'pf_employee' || key === 'pf_employer') return statutory.pf ?? null;
  if (key === 'esi_employee' || key === 'esi_employer') return statutory.esi ?? null;
  if (key === 'professional_tax') return statutory.professionalTax ?? null;
  return null;
}

/**
 * Per-employee adjustments to a component before it is computed.
 *
 * Only the PF wage ceiling today: an org that contributes on full basic rather
 * than the ₹15,000 statutory wage sets `restrictToCeiling: false`, which is a
 * real and common choice, not an override of the computed figure.
 */
function applyStatutoryTweaks(comp: PayComponent, rule: any): PayComponent {
  if (!rule) return comp;
  if ((comp.key === 'pf_employee' || comp.key === 'pf_employer') && rule.restrictToCeiling === false) {
    return { ...comp, cap: undefined };
  }
  return comp;
}

/** Compute a full payslip breakdown for one employee/run. */
export function computePayroll(input: PayrollInput): PayrollResult {
  const ruleset: CountryRuleset = input.ruleset;
  const extras = input.extras || {};

  const earnings: EarningLine[] = (input.earnings || []).filter(
    (e) => Number(e.amount) > 0,
  );
  const gross = sum(earnings);
  const basic = Number(earnings.find((e) => e.key === 'basic')?.amount || 0);
  const taxable = sum(earnings.filter((e) => e.taxable !== false));

  const earningLines: AmountLine[] = earnings.map((e) => ({
    key: e.key,
    label: e.label,
    amount: round2(e.amount),
  }));

  const employeeDeductions: AmountLine[] = [];
  const employerContributions: AmountLine[] = [];

  for (const comp of ruleset.components || []) {
    const rule = statutoryFor(input.statutory, comp.key);

    // Eligibility first: an employee outside a scheme owes nothing under it, and
    // neither does their employer. PF and ESI each have an employee and an
    // employer half that must move together, or the payslip's deduction and the
    // cost-to-company figure describe different worlds.
    if (rule && rule.applicable === false) continue;

    let amount: number;
    let overridden = false;
    if (rule && Number.isFinite(Number(rule.override))) {
      // Set by hand. Used verbatim so what HR typed is what the payslip shows.
      amount = round2(Number(rule.override));
      overridden = true;
    } else {
      amount = evalComponent(applyStatutoryTweaks(comp, rule), earnings, gross, basic, taxable, extras);
    }
    // An override of exactly 0 is a real instruction ("charge nothing this run"),
    // so it must not be swallowed by the falsy check that skips empty components.
    if (!amount && !overridden) continue;

    const line: AmountLine = { key: comp.key, label: comp.label, amount };
    if (overridden) line.overridden = true;
    if (comp.side === 'EMPLOYER') employerContributions.push(line);
    else if (comp.type === 'DEDUCTION' || comp.type === 'TAX')
      employeeDeductions.push(line);
  }

  // Allow ad-hoc employee deductions passed via extras that aren't ruleset
  // components (e.g. loss_of_pay, other_deductions from the single/bulk form).
  for (const [key, value] of Object.entries(extras)) {
    if (!value) continue;
    if (ruleset.components?.some((c) => c.key === key)) continue; // already handled
    if (!key.startsWith('adhoc_')) continue;
    employeeDeductions.push({ key, label: labelFromKey(key), amount: round2(value) });
  }

  // Hand-entered deduction lines for this run, appended with their own labels.
  // Filtered to real amounts so an empty row left behind in the form does not
  // print a zero line the employee then asks about.
  for (const line of input.additionalDeductions || []) {
    const amount = round2(Number(line.amount) || 0);
    if (!amount) continue;
    employeeDeductions.push({
      ...(line.key ? { key: line.key } : {}),
      label: line.label || 'Other deduction',
      amount,
      overridden: true,
    });
  }

  const totalDeductions = sum(employeeDeductions);
  const net = round2(gross - totalDeductions);

  return {
    earnings: earningLines,
    employeeDeductions,
    employerContributions,
    gross,
    totalDeductions,
    net,
    currency: ruleset.currency,
    country: ruleset.country,
  };
}

/** "adhoc_loss_of_pay" → "Loss Of Pay" for ad-hoc deduction labels. */
function labelFromKey(key: string): string {
  return key
    .replace(/^adhoc_/, '')
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
