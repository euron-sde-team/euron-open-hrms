/**
 * Global payroll, component & ruleset type definitions.
 *
 * The model mirrors how market HRMS/global-payroll platforms (Zoho, Deel, Lano,
 * SAP, payrollengine.org) structure payroll: a country-agnostic engine runs the
 * same gross→net calculation for every country, and all country-specific logic
 * lives in a `CountryRuleset` (a list of configurable `PayComponent`s). Adding a
 * country means adding a ruleset, never touching the engine.
 *
 * SCOPE: records only. We compute and store amounts; there is no bank/payment
 * integration anywhere in this module.
 */

/** What a component represents on the payslip. */
export type ComponentType =
  | 'EARNING' // adds to gross (base salary, HRA, allowances, bonus…)
  | 'DEDUCTION' // statutory/voluntary deduction taken from the employee
  | 'TAX' // income tax / withholding (a deduction, kept distinct for reporting)
  | 'EMPLOYER_CONTRIBUTION'; // cost to company, tracked, NOT subtracted from net

/** Which side bears the component. */
export type ComponentSide = 'EMPLOYEE' | 'EMPLOYER';

/** How a component's amount is derived. */
export type CalcMethod =
  | 'FLAT' // a fixed amount (`rate` is the amount)
  | 'PERCENT' // `rate`% of the resolved base (with optional cap/threshold)
  | 'SLAB'; // progressive brackets over the resolved base

/** A progressive bracket: applies `rate`% (plus optional `flat`) up to `upTo`. */
export interface Slab {
  upTo: number | null; // null = no upper bound (top bracket)
  rate: number; // percent applied within this bracket
  flat?: number; // optional flat add-on for this bracket
}

/**
 * A single configurable pay component. Country packs ship canonical defaults;
 * orgs may override rate/cap/enabled via their seeded `payroll_profiles` row.
 */
export interface PayComponent {
  key: string; // stable id, e.g. "pf_employee", "fica_ss", "paye"
  label: string; // shown on the payslip
  type: ComponentType;
  side: ComponentSide;
  calc: CalcMethod;
  rate?: number; // PERCENT: a percentage; FLAT: the amount
  /**
   * The base the calculation runs against:
   *   "GROSS", total earnings
   *   "BASIC", the `basic` earning
   *   "TAXABLE", sum of earnings flagged taxable
   *   <key>, a specific earning's amount by key
   */
  base?: 'GROSS' | 'BASIC' | 'TAXABLE' | string;
  cap?: number; // ceiling applied to the base before % (e.g. PF wage cap)
  floorThreshold?: number; // component applies only if base ≥ this (eligibility)
  /**
   * Eligibility CEILING: the component applies only if the base is ≤ this.
   *
   * Distinct from `cap`, which limits the amount the rate runs against but
   * still charges everybody. A ceiling switches the component OFF entirely
   * above the line, which is how coverage schemes like India's ESI work
   * ("applicable when gross is at or below ₹21,000"). Without it the only way
   * to express such a scheme was to disable the component per org, so every
   * employee of an org that left it on was charged.
   */
  ceilingThreshold?: number;
  slabs?: Slab[]; // SLAB brackets (lowest → highest)
  taxable?: boolean; // EARNING only: counts toward TAXABLE base (default true)
  enabled?: boolean; // false → skipped (default true)
  note?: string; // optional HR-facing hint (e.g. "verify bands with finance")
}

/** A country's statutory ruleset: currency/locale + its component list. */
export interface CountryRuleset {
  country: string; // ISO-ish code: "IN" | "US" | "UK"
  label: string; // human name, e.g. "India"
  currency: string; // ISO 4217: "INR" | "USD" | "GBP"
  locale: string; // BCP-47 for formatting: "en-IN" | "en-US" | "en-GB"
  components: PayComponent[]; // statutory deductions/taxes/employer contributions
  version?: number; // bumped when a pack's defaults change
  /**
   * The tax year / point in time these default rates reflect (e.g. "2025").
   * Statutory rates change yearly; this stamps when the pack was last verified
   * so a maintainer knows what to re-check. HR can override any rate per org.
   */
  effectiveFrom?: string;
  source?: string; // where the rates came from (for the maintainer)
  /**
   * True for generic fallback rulesets that ship with 0% placeholder rates the
   * org MUST configure. Lets the UI show a "configure rates" hint.
   */
  generic?: boolean;
  /** Optional HR-facing note shown in the settings UI (e.g. nationals-only). */
  note?: string;
}

/** A single earning line fed into the engine. */
export interface EarningLine {
  key: string;
  label: string;
  amount: number;
  taxable?: boolean; // default true
}

/** A computed money line on the resulting payslip. */
export interface AmountLine {
  key?: string;
  label: string;
  amount: number;
  /**
   * True when HR set this amount by hand rather than the ruleset computing it.
   * Surfaced on the payslip: an override that looks identical to a computed
   * figure is how a payroll dispute becomes unanswerable months later.
   */
  overridden?: boolean;
}

/** Input to `computePayroll`. */
export interface PayrollInput {
  earnings: EarningLine[];
  ruleset: CountryRuleset;
  /**
   * Per-run overrides keyed by component key. When present for a component,
   * the value is used verbatim (rounded) instead of computing from the rule, * this is how HR enters amounts that can't be derived (TDS, federal/state tax).
   */
  extras?: Record<string, number>;
  /**
   * Per-employee statutory eligibility and overrides. Distinct from `extras`:
   * extras supply amounts the rules CANNOT derive (TDS), whereas these change
   * whether a derivable component applies at all, or replace what it derived.
   */
  statutory?: StatutorySettings;
  /**
   * Deduction lines HR entered by hand for this run only, appended verbatim.
   *
   * Distinct from `extras` in the one way that matters on the printed payslip:
   * extras are keyed by component and their label comes from the ruleset (or is
   * derived from the key), so an ad-hoc recovery could only ever be called
   * "Other Deductions". These carry their own label, so "Notice shortfall
   * recovery (12 days)" reaches the employee's payslip as written. A deduction
   * somebody cannot identify is a deduction they will dispute.
   */
  additionalDeductions?: AmountLine[];
}

/** Result of `computePayroll`. */
export interface PayrollResult {
  earnings: AmountLine[];
  employeeDeductions: AmountLine[]; // reduces net (DEDUCTION + TAX, employee side)
  employerContributions: AmountLine[]; // cost to company, NOT in net
  gross: number;
  totalDeductions: number;
  net: number;
  currency: string;
  country: string;
}

/* ── Salary structures (CTC → monthly breakup) ─────────────────────────────── */

/**
 * How a structure component derives its monthly amount.
 *
 * Deliberately distinct from `CalcMethod`, which describes a STATUTORY component
 * computed from a payslip's gross. These run one step earlier and in the other
 * direction: from an annual CTC down to the earning lines the payslip is built
 * from. Sharing one enum would let a structure claim a SLAB and a deduction
 * claim a BALANCE, neither of which means anything.
 */
export type StructureCalc =
  | 'PERCENT_OF_CTC'   // `value`% of the monthly CTC
  | 'PERCENT_OF_BASIC' // `value`% of the resolved basic (so basic must resolve first)
  | 'FLAT_MONTHLY'     // a fixed monthly amount
  | 'BALANCE';         // whatever is left, so the breakup always reconciles to CTC

export interface StructureComponent {
  key: string;
  label: string;
  calc: StructureCalc;
  value?: number;      // meaningless for BALANCE
  taxable?: boolean;   // default true
}

/** An org-level salary template: CTC in, earning lines out. */
export interface SalaryStructure {
  id: string;
  name: string;
  isDefault?: boolean;
  components: StructureComponent[];
}

/** Per-employee statutory eligibility and manual overrides. */
export interface StatutorySettings {
  pf?: {
    applicable?: boolean;      // default true
    restrictToCeiling?: boolean; // default true (the ₹15,000 EPF wage ceiling)
    uan?: string;
    override?: number;         // set by hand; wins over the computed amount
  };
  esi?: { applicable?: boolean; override?: number };
  // Professional tax carries an exemption flag too: several states exempt senior
  // citizens and parents of a disabled child, so this is a real case, not symmetry.
  professionalTax?: { applicable?: boolean; state?: string; override?: number };
}
