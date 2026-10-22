/**
 * Payslip input assembly.
 *
 * The single place that turns an employee record, a per-run payload, or a row
 * parsed out of a salary sheet into the lines a payslip is built from. It lives
 * here rather than inside the route so that:
 *
 *   - the preview and the commit paths cannot drift apart (both call the same
 *     functions over the same parse), and
 *   - the rules below can be exercised without a server or a database.
 *
 * Nothing here talks to the database, sends mail or writes files.
 */

import { round2 } from '../../core/util';
import { statutoryFor } from './engine';
import { prorateEarnings } from './exit-pay';
import type { ParsedSalaryRow } from './salary-sheet';
import type { AmountLine, CountryRuleset, EarningLine, PayrollResult, StatutorySettings } from './types';

/** First value that is a real number. 0 counts; undefined / null / "" do not. */
export function num(...vals: unknown[]): number {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
}

/** True when a field was actually supplied (0 is supplied; "" and null are not). */
function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v));
}

/**
 * Legacy scalar salary keys, each mirrored by a component of the same key.
 *
 * TWO writers maintain `employee.salary`:
 *   - PUT /api/salary/structure writes the legacy scalars AND rebuilds
 *     `components[]` from them, so both agree.
 *   - PUT /api/employees/:id (the Compensation dialog) shallow-merges whatever
 *     it was sent, which touches the legacy scalars ONLY.
 *
 * So a divergence between `salary.basic` and the `basic` component means the
 * legacy scalar was written later, and preferring `components[]` unconditionally
 * (as the payroll read path used to) kept paying the stale figure after HR
 * edited the compensation. Where both describe the SAME key the legacy scalar
 * therefore wins. Keys that exist only in `components[]` are left untouched, and
 * legacy scalars with no matching component are NOT appended: a country-specific
 * component list may express the same money under a different key, and adding
 * the legacy value on top would pay it twice.
 */
export const LEGACY_EARNING_KEYS: readonly string[] = ['basic', 'hra', 'allowances'];

/**
 * Per-run earnings that exist because somebody is leaving.
 *
 * Declared as data rather than written out three times, because the payroll
 * route, the preview and the browser form all have to agree on the field name,
 * the component key and the label; the first time they disagree, a severance
 * payment silently fails to reach the payslip. Exported so the client and the
 * tests read the same list.
 */
export const EXIT_EARNING_FIELDS: readonly { field: string; key: string; label: string }[] = [
  { field: 'severance', key: 'severance', label: 'Severance / ex-gratia' },
  { field: 'noticePay', key: 'notice_pay', label: 'Notice pay in lieu' },
  { field: 'leaveEncashment', key: 'leave_encashment', label: 'Leave encashment' },
];

/** The mirror of the above on the deduction side. */
export const EXIT_DEDUCTION_FIELDS: readonly { field: string; key: string; label: string }[] = [
  { field: 'noticeRecovery', key: 'notice_recovery', label: 'Notice shortfall recovery' },
];

/**
 * One-off per-run earnings that are already a final figure.
 *
 * These must never be scaled by a proration factor. A 50,000 severance on a
 * nine-day final month would become 15,000, the payslip would still say
 * "Severance", and nobody would spot it until the person who was let go did.
 */
const ONE_OFF_EARNING_FIELDS: readonly { field: string; key: string; label: string }[] = [
  { field: 'incentive', key: 'incentive', label: 'Incentive' },
  { field: 'reimbursement', key: 'reimbursement', label: 'Reimbursement' },
  { field: 'bonus', key: 'bonus', label: 'Bonus / Other' },
  ...EXIT_EARNING_FIELDS,
];

export interface EarningsOptions {
  /**
   * Scale the RECURRING lines to the days actually served. Absent or null means
   * a whole month, which is every ordinary payslip.
   */
  proration?: { payableDays: number; daysInMonth: number } | null;
  /**
   * Manual run: pay ONLY what HR typed. A recurring component left blank is 0,
   * not the saved structure's figure. The generate-payslip dialog sends this,
   * because HR there restates the month from finance's numbers and a blank row
   * silently topping the gross up from a stale structure is how a leaver's final
   * payslip came out ₹2,850 over finance. Proration is moot: stated amounts are
   * never scaled.
   */
  manual?: boolean;
}

/**
 * Build the engine's earning lines from an employee + per-run extras.
 *
 * Supports the generalized comp shape ({ components:[{key,label,amount}] }) and
 * the legacy India shape ({ basic, hra, allowances }). Per-run incentive /
 * reimbursement / bonus / severance / notice pay / leave encashment are appended
 * on top. Precedence for every recurring line:
 *   per-run amount  >  legacy scalar (when it mirrors this key)  >  component.
 *
 * PRORATION applies to the recurring lines ONLY, and only to those the run did
 * not restate. A per-run amount is what HR decided this person is owed for this
 * month, so scaling it afterwards would silently contradict them, which matters
 * most in exactly the case proration exists for: a final month where HR has
 * worked the figures out by hand.
 */
export function buildEarnings(emp: any, x: any = {}, opts: EarningsOptions = {}): EarningLine[] {
  const s = (emp && emp.salary) || {};
  // Recurring lines that may be prorated, and lines that are already final.
  const recurring: EarningLine[] = [];
  const verbatim: EarningLine[] = [];

  if (Array.isArray(s.components) && s.components.length) {
    for (const c of s.components) {
      if (!c || !c.key) continue;
      const key = String(c.key);
      // Reconcile a stale component against the more recently written scalar.
      const legacy = LEGACY_EARNING_KEYS.includes(key) && present(s[key]) ? Number(s[key]) : null;
      const stated = present(x[key]);
      if (opts.manual && !stated) continue;
      const amount = num(x[key], legacy === null ? c.amount : legacy);
      if (!amount) continue;
      const line = { key, label: c.label || key, amount, taxable: c.taxable };
      (stated ? verbatim : recurring).push(line);
    }
  } else {
    // Legacy shape, mapped onto the canonical keys the engine/rulesets expect.
    for (const [key, label] of [['basic', 'Basic'], ['hra', 'HRA'], ['allowances', 'Allowances']] as const) {
      const stated = present(x[key]);
      if (opts.manual && !stated) continue;
      const amount = num(x[key], s[key]);
      if (!amount) continue;
      (stated ? verbatim : recurring).push({ key, label, amount });
    }
  }

  const prorated = opts.proration
    ? prorateEarnings(recurring, opts.proration.payableDays, opts.proration.daysInMonth)
    : recurring;

  const earnings: EarningLine[] = [...prorated, ...verbatim];

  for (const f of ONE_OFF_EARNING_FIELDS) {
    const amount = num(x[f.field]);
    if (amount) earnings.push({ key: f.key, label: f.label, amount });
  }

  // Free-form earnings HR added for this run (a retention payout, an arrear).
  // Labelled by hand, so they print as HR wrote them.
  for (const line of normaliseCustomLines(x.earningLines)) {
    earnings.push({ key: line.key, label: line.label, amount: line.amount });
  }

  return earnings;
}

/** A hand-entered line: a label, an amount, and a key derived from the label. */
function normaliseCustomLines(raw: unknown): { key: string; label: string; amount: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { key: string; label: string; amount: number }[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 20)) {
    const label = String((item as any)?.label ?? '').trim().slice(0, 60);
    const amount = round2(num((item as any)?.amount));
    // A row with a label but no amount is a half-filled form, not an instruction.
    if (!label || !amount) continue;
    let key = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'line'}`;
    // Two rows labelled the same would collide on key and confuse any later
    // per-key lookup, so the duplicate is suffixed rather than dropped.
    let n = 2;
    while (seen.has(key)) key = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_${n++}`;
    seen.add(key);
    out.push({ key, label, amount });
  }
  return out;
}

/**
 * Deduction lines entered by hand for this run, each carrying its own label.
 *
 * Kept apart from `buildExtras` on purpose. Extras are keyed by ruleset
 * component and print under the ruleset's label, which is right for a PF or TDS
 * override and wrong for "Notice shortfall recovery (12 days)" or "Laptop not
 * returned": those print as written, and an employee can therefore tell what
 * was taken and why without ringing HR.
 */
export function buildAdditionalDeductions(x: any = {}): AmountLine[] {
  const lines: AmountLine[] = [];
  for (const f of EXIT_DEDUCTION_FIELDS) {
    const amount = round2(num(x[f.field]));
    if (amount) lines.push({ key: f.key, label: f.label, amount });
  }
  for (const line of normaliseCustomLines(x.deductionLines)) {
    lines.push({ key: line.key, label: line.label, amount: line.amount });
  }
  return lines;
}

/**
 * Map per-run form/spreadsheet fields onto engine `extras` (keyed by component
 * key). This carries HR-entered statutory amounts (TDS, federal/state tax) and
 * legacy ad-hoc deductions through to the country-agnostic engine.
 *
 * `emp` supplies defaults held on the employee record. Precedence, highest
 * first: an exact ruleset component key in the payload, the legacy alias in the
 * payload, then the value stored on the employee.
 */
export function buildExtras(ruleset: CountryRuleset, x: any = {}, emp?: any): Record<string, number> {
  const extras: Record<string, number> = {};
  // Any field whose key matches a ruleset component is a per-run override.
  for (const c of ruleset.components || []) {
    const v = x[c.key];
    if (v !== undefined && v !== '') extras[c.key] = num(v);
  }
  // Legacy India fields, mapped onto the canonical ruleset keys.
  if (x.tax !== undefined || x.tds !== undefined) extras.tds = num(x.tax, x.tds);

  // "Statutory deductions (PF etc.)". The per-run field wins (including an
  // explicit 0, which means "no PF this run"); otherwise the amount stored on
  // the employee applies. Reading it only from the per-run payload is what made
  // the Compensation dialog's field look saved but do nothing.
  if (extras.pf_employee === undefined) {
    if (present(x.deductions)) extras.pf_employee = num(x.deductions);
    else if (num(emp?.salary?.deductions)) extras.pf_employee = num(emp.salary.deductions);
  }

  // Legacy ad-hoc employee deductions not tied to a statutory component.
  if (num(x.lossOfPay, x.lossofpay)) extras.adhoc_loss_of_pay = num(x.lossOfPay, x.lossofpay);
  if (num(x.otherDeductions, x.otherdeductions)) extras.adhoc_other_deductions = num(x.otherDeductions, x.otherdeductions);
  return extras;
}

/** One statutory deduction row on the generate-payslip form. */
export interface StatutoryRow {
  key: string;
  label: string;
  /** false = this employee is opted out (e.g. no PF); the row shows but is locked. */
  applicable: boolean;
  /** true = the engine never computes it (income tax), so HR must type the figure. */
  manual: boolean;
}

/**
 * The employee-side statutory rows the form offers, in ruleset order.
 *
 * Mirrors what computePayroll will actually honour, so a row HR can type into
 * is a row that reaches the payslip:
 *   - a scheme the org switched off (PF, ESI, PT) is hidden, because the engine
 *     ignores overrides for it and an input that does nothing is the bug HR hit;
 *   - income tax stays visible even when switched off, because a typed tax
 *     figure beats the toggle (see evalComponent);
 *   - an employee opted out of a scheme still sees it, locked, so the missing
 *     deduction is explained rather than looking like a glitch.
 */
export function statutoryRows(ruleset: CountryRuleset, statutory?: StatutorySettings): StatutoryRow[] {
  const rows: StatutoryRow[] = [];
  for (const c of ruleset.components || []) {
    if (c.side === 'EMPLOYER') continue;
    if (c.type !== 'DEDUCTION' && c.type !== 'TAX') continue;
    const manual = c.type === 'TAX';
    if (c.enabled === false && !manual) continue;
    const rule = statutoryFor(statutory, c.key);
    rows.push({ key: c.key, label: c.label, applicable: !(rule && rule.applicable === false), manual });
  }
  return rows;
}

/* ── Sheet-driven runs ────────────────────────────────────────────────────── */

/** The three line groups a payslip is printed and stored from. */
export interface PayslipLines {
  earnings: AmountLine[];
  deductions: AmountLine[];
  employerContributions: AmountLine[];
}

/**
 * Take a parsed salary-sheet row verbatim.
 *
 * A salary master STATES what to pay, component by component, and the preview
 * shows exactly those figures. Recomputing statutory components from the
 * employee's saved structure at commit time would make the payslip disagree
 * with the sheet HR just approved, so the sheet's own lines are used as-is.
 */
export function sheetRowToLines(row: ParsedSalaryRow): PayslipLines {
  const lines = (rows: { key: string; label: string; amount: number }[]): AmountLine[] =>
    rows.map((l) => ({ key: l.key, label: l.label, amount: round2(l.amount) }));
  return {
    earnings: lines(row.earnings),
    deductions: lines(row.deductions),
    employerContributions: lines(row.employerContributions),
  };
}

/** Gross / total deductions / net for a set of payslip lines. */
export function totalsFor(lines: PayslipLines): { gross: number; totalDeductions: number; net: number } {
  const sum = (rows: AmountLine[]) => round2(rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0));
  const gross = sum(lines.earnings);
  const totalDeductions = sum(lines.deductions);
  return { gross, totalDeductions, net: round2(gross - totalDeductions) };
}

/* ── What gets persisted ──────────────────────────────────────────────────── */

export interface PayslipRecordInput {
  employeeId: string;
  month: number;
  year: number;
  result: PayrollResult;
  filename: string;
  verification: { code: string; url: string; digest?: string };
  /**
   * How much of the month was actually paid, when it was not all of it.
   *
   * Stored rather than recomputed on read: the separation can be edited (or the
   * exit reversed) after the payslip is issued, and a payslip has to keep saying
   * what it said when it was issued. Always written, including the full-month
   * `null`s, so re-generating a prorated payslip as a full month clears the old
   * figures instead of leaving them behind on the row.
   */
  period?: {
    payableDays: number | null;
    daysInMonth: number | null;
    lastWorkingDay: string | null;
    prorated: boolean;
  };
}

/**
 * The fields written for a payslip.
 *
 * `emailedAt` is deliberately NOT here. The payslip repo's update merges the
 * patch over the current row, so including `emailedAt: null` (as the route used
 * to) cleared the "Emailed" stamp of a payslip that had already been sent every
 * time HR corrected and re-generated it. Whether the employee received a mail is
 * a fact about the past; only actually sending one may change it.
 */
export function payslipRecord(a: PayslipRecordInput): Record<string, unknown> {
  return {
    employeeId: a.employeeId,
    month: a.month,
    year: a.year,
    payableDays: a.period?.payableDays ?? null,
    daysInMonth: a.period?.daysInMonth ?? null,
    lastWorkingDay: a.period?.lastWorkingDay ?? null,
    prorated: !!a.period?.prorated,
    earnings: a.result.earnings,
    deductions: a.result.employeeDeductions,
    employerContributions: a.result.employerContributions,
    gross: a.result.gross,
    totalDeductions: a.result.totalDeductions,
    net: a.result.net,
    currency: a.result.currency,
    country: a.result.country,
    filename: a.filename,
    verifyCode: a.verification.code,
    verifyUrl: a.verification.url,
    verifyDigest: a.verification.digest,
  };
}

/** The same record for a brand-new payslip, which has demonstrably never been mailed. */
export function payslipInsertRecord(a: PayslipRecordInput): Record<string, unknown> {
  return { ...payslipRecord(a), emailedAt: null };
}

/* ── Run summary ──────────────────────────────────────────────────────────── */

/** One row's outcome in a bulk/commit run, as returned to the client. */
export interface RunResultRow {
  row: number;
  ok: boolean;
  employee?: string;
  net?: number;
  emailed?: boolean;
  period?: string;
  error?: string;
}

export interface RunSummary {
  processed: number;
  succeeded: number;
  failed: number;
  emailed: number;
  netTotal: number;
  periods: string[];
  /**
   * Whether a pay_runs row should be written. A run that generated nothing is
   * not a payroll run: recording one unconditionally (as the old bulk endpoint
   * did) put "0 payslips, 0 net" entries in the history for files that failed
   * to match a single employee.
   */
  recordRun: boolean;
}

export function summarizeRun(results: RunResultRow[]): RunSummary {
  const ok = results.filter((r) => r.ok);
  return {
    processed: results.length,
    succeeded: ok.length,
    failed: results.length - ok.length,
    emailed: results.filter((r) => r.emailed).length,
    netTotal: round2(ok.reduce((s, r) => s + (Number(r.net) || 0), 0)),
    periods: [...new Set(ok.map((r) => r.period).filter(Boolean) as string[])],
    recordRun: ok.length > 0,
  };
}
