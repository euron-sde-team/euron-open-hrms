/**
 * Salary-master sheet parser.
 *
 * Built against real-world salary-master workbooks rather than an
 * idealised template, because those are what HR actually produces. Their shape
 * breaks every assumption the previous importer made:
 *
 *   - The workbook has SEVERAL sheets ("50% Basic", "<COMPANY>", "Food
 *     Deduction"). The old code took SheetNames[0], which is the wrong sheet.
 *   - The header is NOT the first row. Row 0 is the company name, row 1 is
 *     "Salary Sheet for the Month of ...", and the real header is row 2.
 *   - There is a "Grand Total" row and trailing free-text notes ("Not
 *     structured", "No PF & ESI deuctions") that are not employees.
 *   - "Employee ID" appears TWICE as a column.
 *   - "Total Deducton" is misspelled, and its values are NEGATIVE.
 *   - Deductions and employer contributions are interleaved (PF EE, PF ER,
 *     Employee ESI, Employer ESI).
 *
 * The parser therefore detects the sheet and the header row rather than
 * assuming them, and cross-checks its own arithmetic against the sheet's
 * stated Gross / Total Deduction / Net Pay so a mis-mapped column surfaces as
 * a discrepancy instead of a wrong payslip.
 */

import * as XLSX from "xlsx";

export type FieldRole = "META" | "EARNING" | "DEDUCTION" | "EMPLOYER" | "CHECK" | "IGNORE";

export interface SalaryColumn {
  key: string;
  label: string;
  role: FieldRole;
  /** Header spellings seen in the wild, normalised before matching. */
  aliases: string[];
  /** Deduction columns that arrive negative and should be read as magnitude. */
  absolute?: boolean;
}

/** Normalise a header cell for matching: case, spacing and punctuation-insensitive. */
const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[\s._\-/()]+/g, "").replace(/&/g, "and").trim();

export const SALARY_COLUMNS: SalaryColumn[] = [
  // ── Identity ──────────────────────────────────────────────────────────
  { key: "code", label: "Employee ID", role: "META", aliases: ["employeeid", "empid", "empcode", "employeecode", "id"] },
  { key: "name", label: "Name", role: "META", aliases: ["name", "employeename", "ename"] },
  { key: "email", label: "Email", role: "META", aliases: ["email", "emailid", "officialemail", "workemail"] },
  { key: "designation", label: "Designation", role: "META", aliases: ["designation", "title", "jobtitle", "role"] },
  { key: "joinDate", label: "Join Date", role: "META", aliases: ["joindate", "dateofjoining", "doj"] },
  { key: "leavingDate", label: "Leaving Date", role: "META", aliases: ["leavingdate", "dateofexit", "exitdate", "lastworkingday"] },

  // ── Period / attendance ───────────────────────────────────────────────
  // Month/Year are optional: the real masters name the period in a title row,
  // not a column, so a sheet-driven run falls back to the period the caller
  // asked for. When the columns ARE present they win, which is what lets one
  // file carry more than one month.
  { key: "month", label: "Month", role: "META", aliases: ["month", "salarymonth", "payrollmonth", "paymonth"] },
  { key: "year", label: "Year", role: "META", aliases: ["year", "salaryyear", "payrollyear", "payyear"] },
  { key: "monthDays", label: "Month Days", role: "META", aliases: ["monthdays", "daysinmonth", "totaldays"] },
  { key: "lop", label: "LOP", role: "META", aliases: ["lop", "lossofpay", "lopdays", "unpaiddays"] },
  { key: "workDays", label: "Work Day", role: "META", aliases: ["workday", "workdays", "paiddays", "effectivesalarydays"] },

  // ── Earnings ──────────────────────────────────────────────────────────
  { key: "basic", label: "Basic", role: "EARNING", aliases: ["basic", "basicsalary", "basicpay"] },
  { key: "hra", label: "HRA", role: "EARNING", aliases: ["hra", "houserentallowance"] },
  { key: "statutoryBonus", label: "Statutory Bonus", role: "EARNING", aliases: ["statutorybonus", "bonus", "statbonus"] },
  { key: "specialAllowance", label: "Special Allowance", role: "EARNING", aliases: ["specialallowance", "specialallow", "spallowance"] },
  { key: "travellingAllowance", label: "Travelling Allowance", role: "EARNING", aliases: ["travellingallowance", "travelallowance", "conveyance", "conveyanceallowance"] },
  { key: "lta", label: "LTA", role: "EARNING", aliases: ["lta", "leavetravelallowance"] },
  { key: "flexi", label: "Flexi Component", role: "EARNING", aliases: ["felxicomponent", "flexicomponent", "flexi", "flexibenefit"] },
  { key: "foodAllowance", label: "Food Allowance", role: "EARNING", aliases: ["foodallowance", "mealallowance"] },
  { key: "incentive", label: "Incentive", role: "EARNING", aliases: ["incentive", "performanceincentive"] },
  { key: "arrears", label: "Arrears", role: "EARNING", aliases: ["arrears", "arrear"] },
  { key: "reimbursement", label: "Reimbursement", role: "EARNING", aliases: ["reimbursement", "reimbursements"] },

  // ── Employee deductions ───────────────────────────────────────────────
  { key: "pfEmployee", label: "PF (employee)", role: "DEDUCTION", aliases: ["pfee", "pfemployee", "employeepf", "providentfund", "epf"], absolute: true },
  { key: "esiEmployee", label: "ESI (employee)", role: "DEDUCTION", aliases: ["employeeesi", "esiee", "esiemployee", "esi"], absolute: true },
  { key: "professionalTax", label: "Professional Tax", role: "DEDUCTION", aliases: ["pt", "professionaltax", "proftax"], absolute: true },
  { key: "tds", label: "TDS", role: "DEDUCTION", aliases: ["tds", "incometax", "tax"], absolute: true },
  { key: "foodDeduction", label: "Food Deduction", role: "DEDUCTION", aliases: ["fooddeduction", "mealdeduction"], absolute: true },
  { key: "insurance", label: "Insurance", role: "DEDUCTION", aliases: ["insurance", "mediclaim", "groupinsurance"], absolute: true },
  { key: "advance", label: "Advance / recovery", role: "DEDUCTION", aliases: ["advance", "salaryadvance", "recovery", "loan"], absolute: true },
  { key: "otherDeductions", label: "Other deductions", role: "DEDUCTION", aliases: ["otherdeduction", "otherdeductions", "misc"], absolute: true },

  // ── Employer contributions (cost to company, not deducted) ────────────
  { key: "pfEmployer", label: "PF (employer)", role: "EMPLOYER", aliases: ["pfer", "pfemployer", "employerpf"], absolute: true },
  { key: "esiEmployer", label: "ESI (employer)", role: "EMPLOYER", aliases: ["employeresi", "esier", "esiemployer"], absolute: true },

  // ── Sheet's own totals, used to CHECK our arithmetic, never as input ──
  { key: "sheetGross", label: "Gross (sheet)", role: "CHECK", aliases: ["gross", "grossearnings", "monthlygross", "grosssalary"] },
  { key: "sheetTotalDeduction", label: "Total deduction (sheet)", role: "CHECK", aliases: ["totaldeducton", "totaldeduction", "totaldeductions"], absolute: true },
  { key: "sheetNetPay", label: "Net pay (sheet)", role: "CHECK", aliases: ["netpay", "net", "takehome", "netsalary"] },

  // ── Present but not used for a monthly payslip ────────────────────────
  { key: "annualCtc", label: "Annual CTC", role: "IGNORE", aliases: ["annualctc", "ctc", "annualcost"] },
  { key: "monthlyCtc", label: "Monthly CTC", role: "IGNORE", aliases: ["monthlyctc"] },
  { key: "annualGross", label: "Annual Gross", role: "IGNORE", aliases: ["annualgross"] },
  { key: "today", label: "Today", role: "IGNORE", aliases: ["today", "asondate"] },
  { key: "years", label: "Years", role: "IGNORE", aliases: ["years", "tenure", "experience"] },
  { key: "tdsForYear", label: "TDS for the year", role: "IGNORE", aliases: ["tdsfortheyear", "annualtds"] },
];

const BY_ALIAS = new Map<string, SalaryColumn>();
for (const c of SALARY_COLUMNS) {
  BY_ALIAS.set(norm(c.label), c);
  BY_ALIAS.set(norm(c.key), c);
  for (const a of c.aliases) BY_ALIAS.set(a, c);
}

/**
 * Rows that close a table rather than describe an employee.
 *
 * These matter more than they look: the real workbooks put a SECOND table
 * below the employee list (a freelancer / professional-fees section with its
 * own header), separated by a "Total" row. Parsing straight through produced
 * four junk rows whose "name" was a header cell. The main table therefore
 * ENDS at the first total row, and anything after it is reported separately
 * instead of being silently mangled into payslips.
 */
const TOTAL_ROW = /^(grand\s*total|total|sub\s*total)\b/i;
const NOTE_ROW = /^(note|notes)\b/i;

/* ── Value coercion ─────────────────────────────────────────────────────── */

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[₹$,\s]/g, "").trim();
  if (!s || s === "-" || s === "_") return null;
  // Accounting-style negatives: (1,234) means -1234.
  const paren = s.match(/^\((.+)\)$/);
  const n = Number(paren ? `-${paren[1]}` : s);
  return Number.isFinite(n) ? n : null;
}

/* ── Sheet + header detection ───────────────────────────────────────────── */

export interface SheetChoice {
  name: string;
  headerRow: number;
  /** How many headers on that row we recognised. */
  matched: number;
  /** Headers on that row we did not recognise. */
  unknown: string[];
}

/** Score a candidate header row by how many known salary columns it names. */
function scoreHeaderRow(row: unknown[]): { matched: number; unknown: string[] } {
  let matched = 0;
  const unknown: string[] = [];
  for (const cell of row ?? []) {
    const label = String(cell ?? "").trim();
    if (!label) continue;
    if (BY_ALIAS.has(norm(label))) matched++;
    else unknown.push(label);
  }
  return { matched, unknown };
}

/**
 * Pick the sheet and header row to read.
 *
 * Scans the first 12 rows of every sheet and takes whichever (sheet, row)
 * names the most known salary columns. This is why "50% Basic" being first in
 * the workbook no longer matters, and why a title banner above the header is
 * harmless.
 */
export function detectSheet(wb: XLSX.WorkBook, preferredSheet?: string): SheetChoice | null {
  let best: SheetChoice | null = null;

  const names = preferredSheet && wb.SheetNames.includes(preferredSheet)
    ? [preferredSheet]
    : wb.SheetNames;

  for (const name of names) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: true });
    for (let r = 0; r < Math.min(12, grid.length); r++) {
      const { matched, unknown } = scoreHeaderRow(grid[r]);
      // A header row must name a basic identity column and at least one pay
      // component; otherwise a stray row of labels can win on count alone.
      const labels = (grid[r] ?? []).map((c) => norm(c));
      const hasIdentity = labels.some((l) => ["employeeid", "empid", "name", "employeename"].includes(l));
      const hasMoney = labels.some((l) => ["basic", "gross", "netpay", "monthlygross"].includes(l));
      if (!hasIdentity || !hasMoney) continue;
      if (!best || matched > best.matched) best = { name, headerRow: r, matched, unknown };
    }
  }
  return best;
}

/* ── Parsing ────────────────────────────────────────────────────────────── */

export interface ParsedSalaryRow {
  /** 1-based spreadsheet row, for pointing at the real line. */
  row: number;
  raw: Record<string, unknown>;
  code: string;
  name: string;
  email: string;
  earnings: { key: string; label: string; amount: number }[];
  deductions: { key: string; label: string; amount: number }[];
  employerContributions: { key: string; label: string; amount: number }[];
  gross: number;
  totalDeductions: number;
  net: number;
  /** Sheet's own stated figures, when present. */
  stated: { gross: number | null; totalDeductions: number | null; net: number | null };
  monthDays: number | null;
  lop: number | null;
  workDays: number | null;
  errors: string[];
  warnings: string[];
}

export interface ParsedSalarySheet {
  sheet: SheetChoice | null;
  sheetNames: string[];
  rows: ParsedSalaryRow[];
  /** Headers present in the file that we ignored. */
  unknownHeaders: string[];
  /** Rows skipped as totals/notes, for transparency. */
  skippedRows: { row: number; text: string }[];
  /**
   * Content found AFTER the employee table closed. The real workbooks put a
   * freelancer / professional-fees section down here; it is surfaced so HR
   * knows it exists and was not imported, rather than being silently dropped
   * or silently mangled.
   */
  trailingContent: { row: number; text: string }[];
}

/**
 * Read a salary-master workbook into per-employee payslip rows.
 *
 * Nothing is written; the caller previews, then commits.
 */
export function parseSalarySheet(buffer: Buffer, preferredSheet?: string): ParsedSalarySheet {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = detectSheet(wb, preferredSheet);
  if (!sheet) {
    return { sheet: null, sheetNames: wb.SheetNames, rows: [], unknownHeaders: [], skippedRows: [], trailingContent: [] };
  }

  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet.name], {
    header: 1, blankrows: false, raw: true,
  });
  const header = grid[sheet.headerRow] ?? [];

  // Map column index -> spec. Duplicate headers (the sheets carry "Employee
  // ID" twice) keep the FIRST occurrence; a later blank duplicate must not
  // overwrite a populated earlier one.
  const colSpec: (SalaryColumn | null)[] = [];
  const claimed = new Set<string>();
  const unknownHeaders: string[] = [];
  header.forEach((cell, i) => {
    const label = String(cell ?? "").trim();
    if (!label) { colSpec[i] = null; return; }
    const spec = BY_ALIAS.get(norm(label));
    if (!spec) { colSpec[i] = null; unknownHeaders.push(label); return; }
    if (claimed.has(spec.key)) { colSpec[i] = null; return; }
    claimed.add(spec.key);
    colSpec[i] = spec;
  });

  const rows: ParsedSalaryRow[] = [];
  const skippedRows: { row: number; text: string }[] = [];
  const trailing: { row: number; text: string }[] = [];
  let ended = false;

  for (let r = sheet.headerRow + 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    const firstCell = String(line[0] ?? "").trim();
    const secondCell = String(line[1] ?? "").trim();

    // Once the table has closed, collect what follows for reporting rather
    // than trying to read it as employees.
    if (ended) {
      const text = [firstCell, secondCell].filter(Boolean).join(" ");
      if (text) trailing.push({ row: r + 1, text });
      continue;
    }

    if (TOTAL_ROW.test(firstCell) || TOTAL_ROW.test(secondCell)) {
      skippedRows.push({ row: r + 1, text: firstCell || secondCell });
      ended = true;
      continue;
    }
    if (NOTE_ROW.test(firstCell) || NOTE_ROW.test(secondCell)) {
      skippedRows.push({ row: r + 1, text: firstCell || secondCell });
      continue;
    }

    const raw: Record<string, unknown> = {};
    let anyValue = false;
    for (let i = 0; i < colSpec.length; i++) {
      const spec = colSpec[i];
      if (!spec) continue;
      const v = line[i];
      if (v === undefined || v === null || String(v).trim() === "") continue;
      raw[spec.key] = v;
      anyValue = true;
    }
    if (!anyValue) continue;

    const code = String(raw.code ?? "").trim();
    const name = String(raw.name ?? "").trim();
    // A row with neither an id nor a name is a stray note, not an employee.
    if (!code && !name) {
      skippedRows.push({ row: r + 1, text: firstCell || secondCell || "(blank)" });
      continue;
    }

    // A row carrying text but no money at all is a stray label ("Not
    // structured", "Resigned & Transferred"), not a person to pay.
    const hasMoney = SALARY_COLUMNS.some(
      (c) => (c.role === "EARNING" || c.role === "DEDUCTION" || c.role === "CHECK") && toNum(raw[c.key]) !== null
    );
    if (!hasMoney) {
      skippedRows.push({ row: r + 1, text: [code, name].filter(Boolean).join(" ") });
      continue;
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    const money = (spec: SalaryColumn): number => {
      const n = toNum(raw[spec.key]);
      if (n === null) return 0;
      return spec.absolute ? Math.abs(n) : n;
    };

    const earnings = SALARY_COLUMNS.filter((c) => c.role === "EARNING")
      .map((c) => ({ key: c.key, label: c.label, amount: money(c) }))
      .filter((e) => e.amount !== 0);
    const deductions = SALARY_COLUMNS.filter((c) => c.role === "DEDUCTION")
      .map((c) => ({ key: c.key, label: c.label, amount: money(c) }))
      .filter((d) => d.amount !== 0);
    const employerContributions = SALARY_COLUMNS.filter((c) => c.role === "EMPLOYER")
      .map((c) => ({ key: c.key, label: c.label, amount: money(c) }))
      .filter((d) => d.amount !== 0);

    const gross = Math.round(earnings.reduce((s, e) => s + e.amount, 0));
    const totalDeductions = Math.round(deductions.reduce((s, d) => s + d.amount, 0));
    const net = gross - totalDeductions;

    const statedGross = toNum(raw.sheetGross);
    const statedDeduction = toNum(raw.sheetTotalDeduction);
    const statedNet = toNum(raw.sheetNetPay);
    const stated = {
      gross: statedGross,
      totalDeductions: statedDeduction === null ? null : Math.abs(statedDeduction),
      net: statedNet,
    };

    if (!earnings.length) {
      errors.push("No earning components found on this row, nothing to pay.");
    }

    // Cross-check against the sheet's own totals. A mismatch usually means a
    // column was mapped to the wrong role, which is precisely the failure a
    // silent importer would turn into a wrong payslip.
    const TOL = 2; // rupees, to absorb the sheet's own rounding
    if (stated.gross !== null && Math.abs(stated.gross - gross) > TOL) {
      warnings.push(
        `Computed gross ${gross.toLocaleString("en-IN")} differs from the sheet's ${Math.round(stated.gross).toLocaleString("en-IN")}.`
      );
    }
    if (stated.net !== null && Math.abs(stated.net - net) > TOL) {
      warnings.push(
        `Computed net ${net.toLocaleString("en-IN")} differs from the sheet's ${Math.round(stated.net).toLocaleString("en-IN")}.`
      );
    }
    if (net < 0) errors.push(`Net pay is negative (${net.toLocaleString("en-IN")}).`);

    const monthDays = toNum(raw.monthDays);
    const lop = toNum(raw.lop);
    const workDays = toNum(raw.workDays);
    if (monthDays !== null && workDays !== null && lop !== null && Math.abs(monthDays - (workDays + lop)) > 0.5) {
      warnings.push(`Month days (${monthDays}) does not equal work days (${workDays}) plus LOP (${lop}).`);
    }

    rows.push({
      row: r + 1,
      raw,
      code,
      name,
      email: String(raw.email ?? "").trim().toLowerCase(),
      earnings, deductions, employerContributions,
      gross, totalDeductions, net,
      stated, monthDays, lop, workDays,
      errors, warnings,
    });
  }

  return {
    sheet, sheetNames: wb.SheetNames, rows,
    unknownHeaders: [...new Set(unknownHeaders)],
    skippedRows, trailingContent: trailing,
  };
}
