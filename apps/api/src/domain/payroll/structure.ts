/**
 * Salary structures: one annual CTC in, a monthly earning breakup out.
 *
 * This is the direction every Indian HRMS works in (Zoho Payroll, Keka,
 * RazorpayX): HR agrees a CTC with the candidate, picks a structure, and the
 * components fall out of it. The alternative, typing six monthly figures and
 * hoping they add up, is what this replaces.
 *
 * Two rules make the model trustworthy:
 *
 *  1. A BALANCE component absorbs the remainder, so the breakup reconciles to
 *     the CTC EXACTLY. Percentages that round to the nearest rupee otherwise
 *     leave a few rupees a year unaccounted for, and payroll figures that do not
 *     add up destroy confidence in everything around them.
 *  2. Fixed components that exceed the CTC raise a named error rather than
 *     producing a negative allowance. A negative line would flow into gross, PF
 *     and net without anything obviously wrong on screen.
 *
 * Pure: no database, no org, no request. Unit-tested in tests/salary-structure.ts.
 */
import { bad } from "../../core/util";
import { defaultSalaryBreakdown, employmentRules } from "../employment";
import type { EarningLine, SalaryStructure, StructureComponent } from "./types";

/** The canonical Indian structure, matching what the market ships by default. */
export const INDIA_DEFAULT_STRUCTURE: SalaryStructure = {
  id: "in-standard",
  name: "India, standard",
  isDefault: true,
  components: [
    // 50% of CTC keeps PF (computed on basic) at a defensible level. The 40%
    // structures that circulate get flagged in audits.
    { key: "basic", label: "Basic", calc: "PERCENT_OF_CTC", value: 50 },
    { key: "hra", label: "HRA", calc: "PERCENT_OF_BASIC", value: 40 },
    { key: "conveyance", label: "Conveyance", calc: "FLAT_MONTHLY", value: 1600 },
    { key: "medical", label: "Medical", calc: "FLAT_MONTHLY", value: 1250 },
    { key: "special_allowance", label: "Special allowance", calc: "BALANCE" },
  ],
};

export interface StructureResult {
  /** Monthly earning lines, in structure order, ready for the payroll engine. */
  monthly: EarningLine[];
  /**
   * Monthly gross.
   *
   * Equals annualCtc / 12 when the CTC is gross-only. When the CTC is defined as
   * INCLUDING the employer's contributions, gross is that figure MINUS them, so
   * `gross + employerCost` is what reconciles to the CTC instead.
   */
  gross: number;
  annualGross: number;
  /** Legacy scalars, so letters, settlement and reports keep working unchanged. */
  legacy: { basic: number; hra: number; allowances: number; deductions: number };
  /** Monthly employer-side contributions, when the caller supplied a way to cost them. */
  employerCost?: number;
  /** gross + employerCost: what the role actually costs the company each month. */
  totalMonthlyCost?: number;
  /** Which convention produced this breakup. Echoed so the UI can label it. */
  ctcIncludesEmployerContributions?: boolean;
}

/**
 * Whether the CTC an organisation quotes already contains its own contributions.
 *
 * Both conventions are in wide use and they produce materially different pay for
 * the same headline number. On a 12L CTC with a 50% basic, employer PF is about
 * 21,600 a year: quoting CTC-inclusive and paying it gross-only overpays by that
 * much, and the reverse shorts the employee by it. There is no safe default that
 * suits everybody, so the organisation states which it means and every path that
 * turns a CTC into a breakup reads the same answer.
 *
 * `employerCostOf` is injected rather than imported so this module stays pure and
 * unit-testable, and so the cost always comes from the SAME payroll engine that
 * will later compute the payslip.
 */
export interface CtcOptions {
  ctcIncludesEmployerContributions?: boolean;
  /** Monthly employer-side cost for a given breakup. Needed for either field to be returned. */
  employerCostOf?: (monthly: EarningLine[]) => number;
}

const money = (n: number | null | undefined) => Math.round(Number(n) || 0);

/**
 * Compute the monthly breakup for an annual CTC.
 *
 * Resolution order is fixed rather than declaration order, because
 * PERCENT_OF_BASIC cannot be evaluated until basic exists: percent-of-CTC and
 * flat components first, then percent-of-basic, then the balance.
 */
export function computeStructure(
  structure: SalaryStructure,
  annualCtc: number,
  employmentType?: string | null,
  opts: CtcOptions = {},
): StructureResult {
  const annual = money(annualCtc);
  if (annual <= 0) throw bad("Enter an annual CTC greater than zero.");

  const monthlyCtc = Math.round(annual / 12);
  const comps = structure?.components?.length ? structure.components : INDIA_DEFAULT_STRUCTURE.components;
  const costOf = opts.employerCostOf;

  // Gross-only CTC: the components ARE the CTC, and employer contributions sit on
  // top of it. One pass, exactly as before.
  if (!opts.ctcIncludesEmployerContributions) {
    const result = allocate(comps, monthlyCtc, monthlyCtc, employmentType);
    return withEmployerCost(result, costOf, false);
  }

  /*
   * CTC-inclusive: solve gross + employerCost(gross) = monthlyCtc.
   *
   * Circular, because employer PF is a percentage of basic, basic is a percentage
   * of the budget, and the budget is the CTC minus that same PF. It is solved by
   * iteration rather than algebra because the relationship is not linear: PF is
   * capped at a wage ceiling and ESI switches off entirely above one, so the cost
   * curve has flat sections and a step in it that no closed form survives.
   *
   * The iteration contracts quickly (employer cost moves roughly 8% of gross, so
   * each pass cuts the error by about that factor) and settles in three or four
   * rounds. The loop is capped anyway, because a breakup sitting exactly on the
   * ESI ceiling can oscillate between two answers either side of the step.
   */
  if (!costOf) {
    throw bad("Employer contributions cannot be costed here, so a CTC that includes them cannot be split.");
  }

  let budget = monthlyCtc;
  let best: { result: StructureResult; cost: number } | null = null;
  let last: { result: StructureResult; cost: number } | null = null;

  for (let i = 0; i < 24; i++) {
    if (budget <= 0) break;
    const result = allocate(comps, budget, monthlyCtc, employmentType);
    const cost = money(costOf(result.monthly));
    last = { result, cost };

    const total = result.gross + cost;
    // Prefer the richest breakup that still fits inside the agreed CTC. Landing
    // UNDER it shorts nobody; landing over it means paying more than was offered,
    // which is the error that actually costs the company money.
    if (total <= monthlyCtc && (!best || result.gross > best.result.gross)) best = { result, cost };
    if (Math.abs(total - monthlyCtc) <= 1) { best = { result, cost }; break; }

    const nextBudget = monthlyCtc - cost;
    if (nextBudget === budget) break; // settled
    budget = nextBudget;
  }

  const chosen = best ?? last;
  if (!chosen) {
    throw bad(
      `A CTC of ${fmtAnnual(annual)} does not cover this structure once employer contributions are included.`,
    );
  }
  return {
    ...chosen.result,
    employerCost: chosen.cost,
    totalMonthlyCost: chosen.result.gross + chosen.cost,
    ctcIncludesEmployerContributions: true,
  };
}

/** Attach the employer-side figures to a gross-only breakup, when we can cost them. */
function withEmployerCost(
  result: StructureResult,
  costOf: CtcOptions["employerCostOf"],
  inclusive: boolean,
): StructureResult {
  if (!costOf) return { ...result, ctcIncludesEmployerContributions: inclusive };
  const cost = money(costOf(result.monthly));
  return {
    ...result,
    employerCost: cost,
    totalMonthlyCost: result.gross + cost,
    ctcIncludesEmployerContributions: inclusive,
  };
}

/**
 * Split one month's BUDGET across a structure's components.
 *
 * `budget` is what the earning lines must add up to; `monthlyCtc` is only used to
 * word the error when a structure's fixed components cannot fit, so the message
 * quotes the CTC the user actually typed rather than an internal budget they have
 * never seen.
 *
 * Resolution order is fixed rather than declaration order, because
 * PERCENT_OF_BASIC cannot be evaluated until basic exists: percent-of-CTC and
 * flat components first, then percent-of-basic, then the balance.
 */
function allocate(
  comps: StructureComponent[],
  budget: number,
  monthlyCtc: number,
  employmentType?: string | null,
): StructureResult {
  const amounts = new Map<string, number>();

  // Pass 1: everything that depends only on the budget.
  for (const c of comps) {
    if (c.calc === "PERCENT_OF_CTC") amounts.set(c.key, money((budget * Number(c.value || 0)) / 100));
    else if (c.calc === "FLAT_MONTHLY") amounts.set(c.key, money(c.value));
  }

  // Pass 2: percentages of basic.
  const basic = amounts.get("basic") ?? 0;
  for (const c of comps) {
    if (c.calc === "PERCENT_OF_BASIC") amounts.set(c.key, money((basic * Number(c.value || 0)) / 100));
  }

  // Pass 3: the balance absorbs rounding so the total is exact.
  const balances = comps.filter((c) => c.calc === "BALANCE");
  if (balances.length > 1) throw bad("A salary structure can have only one balancing component.");
  if (balances.length === 1) {
    const allocated = comps
      .filter((c) => c.calc !== "BALANCE")
      .reduce((t, c) => t + (amounts.get(c.key) ?? 0), 0);
    const remainder = budget - allocated;
    if (remainder < 0) {
      throw bad(
        `This structure needs at least ${fmtAnnual(allocated * 12)} a year: its fixed components ` +
        `come to ${fmtMonthly(allocated)} a month, which is more than a monthly CTC of ${fmtMonthly(monthlyCtc)}.`
      );
    }
    amounts.set(balances[0].key, remainder);
  }

  const monthly: EarningLine[] = comps
    .map((c) => ({
      key: c.key,
      label: c.label,
      amount: amounts.get(c.key) ?? 0,
      taxable: c.taxable !== false,
    }))
    .filter((l) => l.amount > 0);

  const gross = monthly.reduce((t, l) => t + l.amount, 0);

  return {
    monthly,
    gross,
    annualGross: gross * 12,
    legacy: legacyScalars(monthly, employmentType),
  };
}

/**
 * Collapse a breakup into the four legacy fields.
 *
 * `allowances` is everything that is neither basic nor HRA, because that is what
 * the legacy field has always meant to the letter and settlement code. Statutory
 * `deductions` stays 0 here on purpose: PF, ESI and PT are computed per run by
 * the engine, and writing a guess into this field is what made the old intake
 * paths disagree with the payslips they produced.
 */
function legacyScalars(monthly: EarningLine[], _employmentType?: string | null) {
  const get = (k: string) => monthly.find((l) => l.key === k)?.amount ?? 0;
  const basic = get("basic");
  const hra = get("hra");
  const allowances = monthly
    .filter((l) => l.key !== "basic" && l.key !== "hra")
    .reduce((t, l) => t + l.amount, 0);
  return { basic, hra, allowances, deductions: 0 };
}

/**
 * The breakup for an intake path that supplied a monthly GROSS rather than a CTC.
 *
 * Delegates to defaultSalaryBreakdown(), which is employment-type aware: a
 * stipend or a professional fee is a single line with no basic/HRA split, and
 * splitting one would invent a PF liability that does not exist.
 */
export function structureFromMonthlyGross(
  employmentType: string | null | undefined,
  monthlyGross: number,
): StructureResult {
  const b = defaultSalaryBreakdown(employmentType, monthlyGross);
  const monthly: EarningLine[] = [
    { key: "basic", label: "Basic", amount: b.basic, taxable: true },
    { key: "hra", label: "HRA", amount: b.hra, taxable: true },
    { key: "allowances", label: "Allowances", amount: b.allowances, taxable: true },
  ].filter((l) => l.amount > 0);
  const gross = monthly.reduce((t, l) => t + l.amount, 0);
  return {
    monthly,
    gross,
    annualGross: gross * 12,
    legacy: { basic: b.basic, hra: b.hra, allowances: b.allowances, deductions: b.deductions },
  };
}


/**
 * Employment types paid as a single line: no basic/HRA split, no PF.
 *
 * Reads the shared catalogue rather than hardcoding a list, so a type added to
 * employment.ts is treated correctly here without a second edit.
 */
function isUnsplitPay(employmentType?: string | null): boolean {
  const mode = employmentRules(employmentType)?.payMode;
  return mode === "STIPEND" || mode === "PROFESSIONAL_FEE" || mode === "VENDOR_INVOICE";
}

/**
 * The breakup for a legacy invite that carries only `salaryBasic`.
 *
 * That field is a monthly BASIC, not a gross: the invite form used to be labelled
 * "Monthly basic salary". Feeding it to structureFromMonthlyGross() would treat it
 * as a gross and halve the basic, quietly cutting the pay of every invite created
 * before CTC entry existed.
 *
 * So these materialise on the terms HR actually saw when they sent the invite:
 * basic as typed, HRA and allowances in the proportions that form implied. The one
 * thing not carried over is the old `deductions = basic × 0.06`, which was never a
 * real deduction; PF is computed per run by the engine now, properly.
 */
export function structureFromLegacyBasic(
  employmentType: string | null | undefined,
  monthlyBasic: number,
): StructureResult {
  const basic = money(monthlyBasic);
  if (isUnsplitPay(employmentType)) return structureFromMonthlyGross(employmentType, basic);

  const hra = money(basic * 0.4);
  const allowances = money(basic * 0.2);
  const monthly: EarningLine[] = [
    { key: "basic", label: "Basic", amount: basic, taxable: true },
    { key: "hra", label: "HRA", amount: hra, taxable: true },
    { key: "allowances", label: "Allowances", amount: allowances, taxable: true },
  ].filter((l) => l.amount > 0);
  const gross = monthly.reduce((t, l) => t + l.amount, 0);
  return { monthly, gross, annualGross: gross * 12, legacy: { basic, hra, allowances, deductions: 0 } };
}

/**
 * The one place intake paths should call.
 *
 * Accepts whatever HR actually gave us, in preference order, so the four intake
 * routes stop each inventing their own arithmetic:
 *   an explicit breakup  → use it verbatim
 *   an annual CTC        → run it through the structure
 *   a monthly gross/basic→ defaultSalaryBreakdown()
 */
export function resolveSalary(input: {
  structure?: SalaryStructure | null;
  annualCtc?: number | null;
  monthlyGross?: number | null;
  /** A legacy invite's `salaryBasic`: a monthly BASIC, not a gross. */
  legacyBasic?: number | null;
  explicit?: { basic?: number; hra?: number; allowances?: number; deductions?: number } | null;
  employmentType?: string | null;
  /** Only meaningful on the CTC path; the other intake shapes state a gross directly. */
  ctc?: CtcOptions;
}): StructureResult | null {
  const { explicit, annualCtc, monthlyGross, employmentType } = input;

  if (explicit && (explicit.basic || explicit.hra || explicit.allowances)) {
    const monthly: EarningLine[] = [
      { key: "basic", label: "Basic", amount: money(explicit.basic), taxable: true },
      { key: "hra", label: "HRA", amount: money(explicit.hra), taxable: true },
      { key: "allowances", label: "Allowances", amount: money(explicit.allowances), taxable: true },
    ].filter((l) => l.amount > 0);
    const gross = monthly.reduce((t, l) => t + l.amount, 0);
    return {
      monthly,
      gross,
      annualGross: gross * 12,
      legacy: {
        basic: money(explicit.basic),
        hra: money(explicit.hra),
        allowances: money(explicit.allowances),
        deductions: money(explicit.deductions),
      },
    };
  }

  if (Number(annualCtc) > 0) {
    // A stipend or a professional fee is a single line by law and by practice, so it
    // never goes through a basic/HRA structure even when HR states it as a CTC.
    // Beyond correctness this avoids a confusing failure: the India structure needs a
    // monthly CTC of roughly ₹9,500 before its fixed conveyance and medical fit inside
    // the 30% left after basic and HRA, and an intern's stipend is often below that.
    if (isUnsplitPay(employmentType)) {
      return structureFromMonthlyGross(employmentType, Math.round(Number(annualCtc) / 12));
    }
    return computeStructure(input.structure || INDIA_DEFAULT_STRUCTURE, Number(annualCtc), employmentType, input.ctc);
  }
  if (Number(monthlyGross) > 0) {
    return structureFromMonthlyGross(employmentType, Number(monthlyGross));
  }
  if (Number(input.legacyBasic) > 0) {
    return structureFromLegacyBasic(employmentType, Number(input.legacyBasic));
  }
  return null;
}

/** The employee `salary` object an intake path should store. */
export function salaryFromStructure(
  result: StructureResult,
  opts: { currency?: string; annualCtc?: number | null; structureId?: string | null; statutory?: any } = {},
) {
  const salary: any = {
    ...result.legacy,
    components: result.monthly.map((l) => ({
      key: l.key,
      label: l.label,
      amount: l.amount,
      taxable: l.taxable !== false,
    })),
  };
  // Always stamped. The old compensation dialog set it from the org and the new
  // CTC editor does not send it, so defaulting here keeps every intake path
  // consistent rather than making each one remember.
  if (opts.currency) salary.currency = opts.currency;
  if (Number(opts.annualCtc) > 0) salary.annualCtc = money(opts.annualCtc);
  if (opts.structureId) salary.structureId = opts.structureId;
  if (opts.statutory) salary.statutory = opts.statutory;
  return salary;
}

const fmtMonthly = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const fmtAnnual = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
