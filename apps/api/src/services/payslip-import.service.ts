/**
 * Spreadsheet-driven payroll runs: the salary-sheet preview, its commit, the
 * legacy bulk upload and the bulk template. Every path shares one parser and one
 * row matcher, so what a preview showed is what a commit generates.
 */
import * as XLSX from "xlsx";
import type { RequestContext } from "../core/context";
import { bad, MONTHS } from "../core/util";
import { resolveRuleset } from "../domain/payroll/profile";
import { parseSalarySheet, type ParsedSalaryRow } from "../domain/payroll/salary-sheet";
import { sheetRowToLines, summarizeRun, type RunResultRow } from "../domain/payroll/payslip-input";
import { governingSeparation } from "../domain/payroll/exit-pay";
import { scopedEmployeeIdsFor } from "./caller-scope";
import { clampMonth, createPayslip, currentOrg } from "./payroll.service";

/** An uploaded salary sheet, as the controller hands it over. */
export interface UploadedSheet {
  buffer: Buffer;
  originalname: string;
}

/** The run options a request carries in its body and query string. */
export interface RunInput {
  body: Record<string, any>;
  query: Record<string, any>;
}

/* ── Sheet-driven runs (preview / bulk / commit share all of this) ─────────── */

/** "1" / "true" / true in a body field or query string. */
const flag = (v) => v === true || v === 1 || ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase());
const wantsEmail = (input: RunInput) => flag(input.query.email) || flag(input.body && input.body.email);

/**
 * Group every separation by employee and keep only the one that governs payroll.
 *
 * Built once per bulk run: a sheet of 400 rows would otherwise issue 400 separate
 * separation lookups to answer a question about the handful of people who left.
 */
function separationsByEmployee(all: any[]): Map<string, any> {
  const byEmployee = new Map<string, any[]>();
  for (const sep of all) {
    const list = byEmployee.get(sep.employeeId);
    if (list) list.push(sep);
    else byEmployee.set(sep.employeeId, [sep]);
  }
  const out = new Map<string, any>();
  for (const [id, list] of byEmployee) out.set(id, governingSeparation(list));
  return out;
}

/** A parsed sheet row with the employee it resolves to (or the reason it does not). */
type MatchedSheetRow = ParsedSalaryRow & {
  employee: any | null;
  employeeId: string | null;
  matchedName: string | null;
  matchedCode: string | null;
};

/**
 * Resolve each parsed row to an employee: code, then email, then full name.
 *
 * Used by BOTH the preview and the commit so a row cannot match one way when
 * reviewed and another way when generated.
 */
function matchSheetRows(ctx: RequestContext, rows: ParsedSalaryRow[], employees: any[]): MatchedSheetRow[] {
  const byCode = new Map<string, any>(employees.map((e) => [String(e.code ?? "").toLowerCase().trim(), e]));
  const byEmail = new Map<string, any>(employees.map((e) => [String(e.email ?? "").toLowerCase().trim(), e]));
  const byName = new Map<string, any>(
    employees.map((e) => [`${e.firstName} ${e.lastName || ""}`.toLowerCase().replace(/\s+/g, " ").trim(), e])
  );

  return rows.map((r) => {
    const match =
      byCode.get(r.code.toLowerCase()) ||
      byEmail.get(r.email) ||
      byName.get(r.name.toLowerCase().replace(/\s+/g, " ").trim()) ||
      null;
    const errors = [...r.errors];
    if (!match) {
      errors.push(
        `No employee matches "${r.code || r.name}". Matching tries employee code, then email, then full name.`
      );
    } else if (!ctx.inScope(match)) {
      errors.push("Outside your assigned scope.");
    }
    return {
      ...r,
      employee: match,
      employeeId: match?.id ?? null,
      matchedName: match ? `${match.firstName} ${match.lastName || ""}`.trim() : null,
      matchedCode: match?.code ?? null,
      errors,
    };
  });
}

/** Drop the employee record before a matched row goes over the wire. */
function stripMatch({ employee: _employee, ...rest }: MatchedSheetRow) {
  return rest;
}

/**
 * Generate payslips from the uploaded sheet.
 *
 * parseSalarySheet detects the right sheet and header row and reads the ~35
 * columns real salary masters carry. The bulk endpoint used to take
 * `wb.Sheets[wb.SheetNames[0]]` with a dozen header aliases instead, which is
 * exactly the assumption salary-sheet.ts documents as wrong: a row that
 * previewed clean lost most of its components on upload, quietly.
 *
 * The simple template from GET /salary/template has no "Employee ID"/"Name"
 * header, so detectSheet declines it; that shape falls through to the legacy
 * per-row reader it was written for, and keeps working unchanged.
 */
async function runSheet(
  ctx: RequestContext,
  sheet: UploadedSheet,
  body: Record<string, any>,
  opts: { emailAll: boolean; parsed?: any; matched?: MatchedSheetRow[]; sheetName?: string },
): Promise<{ results: RunResultRow[]; file: string }> {
  const file = sheet.originalname;
  const org = await currentOrg(ctx);
  const ruleset = await resolveRuleset(ctx.repos, org); // resolved once, reused per row
  // Every separation, read once. Resolving one per row would put a query per
  // employee inside the loop for the sake of a field most rows never use.
  const exitByEmployee = separationsByEmployee(await ctx.data.separations.all());
  const results: RunResultRow[] = [];

  const parsed = opts.parsed ?? parseSalarySheet(sheet.buffer, opts.sheetName);
  if (parsed.sheet) {
    const matched = opts.matched ?? matchSheetRows(ctx, parsed.rows, await ctx.data.employees.all());
    // A period on the row wins; otherwise the run's period, which defaults to
    // the current month (the masters name their month in a title, not a column).
    const runMonth = body.month !== undefined && body.month !== "" ? clampMonth(body.month) : new Date().getMonth();
    const runYear = Number(body.year) || new Date().getFullYear();

    for (const r of matched) {
      if (r.errors.length || !r.employee) {
        results.push({ row: r.row, ok: false, employee: r.matchedCode || r.code || r.name, error: r.errors.join(" ") });
        continue;
      }
      const month = r.raw.month !== undefined ? clampMonth(r.raw.month) : runMonth;
      const year = Number(r.raw.year) || runYear;
      try {
        const out = await createPayslip(ctx, r.employee, month, year, {}, opts.emailAll, {
          ruleset, lines: sheetRowToLines(r), separation: exitByEmployee.get(r.employee.id) ?? null,
        });
        results.push({
          row: r.row, ok: true, employee: r.employee.code,
          net: out.payslip.net, emailed: out.emailed, period: `${MONTHS[month]} ${year}`,
        });
      } catch (e: any) {
        results.push({ row: r.row, ok: false, employee: r.employee.code, error: e.message });
      }
    }
    return { results, file };
  }

  // Legacy fallback: the simple bulk template (one header row, one row per
  // employee, amounts fed through the payroll engine).
  const wb = XLSX.read(sheet.buffer, { type: "buffer" });
  const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }).map(normalizeRow).map(aliasRow);
  const employees = await ctx.data.employees.all();
  const byCode = Object.fromEntries(employees.map((e) => [String(e.code).toLowerCase(), e]));
  const byEmail = Object.fromEntries(employees.map((e) => [String(e.email).toLowerCase(), e]));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const emp = byCode[String(r.employeecode || r.code || "").toLowerCase()] || byEmail[String(r.email || "").toLowerCase()];
    if (!emp) {
      results.push({ row: i + 2, ok: false, error: `No employee for code "${r.employeecode || ""}" / email "${r.email || ""}"` });
      continue;
    }
    if (!ctx.inScope(emp)) {
      results.push({ row: i + 2, ok: false, employee: emp.code, error: "Outside your assigned scope" });
      continue;
    }
    try {
      const month = r.month ? clampMonth(r.month) : new Date().getMonth();
      const year = Number(r.year) || new Date().getFullYear();
      const out = await createPayslip(ctx, emp, month, year, r, opts.emailAll, {
        ruleset, separation: exitByEmployee.get(emp.id) ?? null,
      });
      results.push({ row: i + 2, ok: true, employee: emp.code, net: out.payslip.net, emailed: out.emailed, period: `${MONTHS[month]} ${year}` });
    } catch (e: any) {
      results.push({ row: i + 2, ok: false, employee: emp.code, error: e.message });
    }
  }
  return { results, file };
}

/**
 * Summarise a run and record it, but only if it produced something.
 *
 * A file that matched no employee at all is not a payroll run; writing a
 * pay_runs row for it (as the old bulk endpoint did unconditionally) filled the
 * history with "0 payslips, net 0" entries that HR then had to interpret.
 * `payRunId` is null in that case, and the failures still come back in full.
 */
async function recordRun(ctx: RequestContext, source: string, file: UploadedSheet | null, results: RunResultRow[]) {
  const s = summarizeRun(results);
  const run = s.recordRun
    ? await ctx.data.payRuns.create({
        source, file: file ? file.originalname : null,
        periods: s.periods, processed: s.processed, succeeded: s.succeeded, failed: s.failed,
        netTotal: s.netTotal, emailed: s.emailed, runBy: ctx.user.id,
      })
    : null;
  return {
    payRunId: run ? run.id : null,
    periods: s.periods,
    processed: s.processed,
    succeeded: s.succeeded,
    failed: s.failed,
    emailed: s.emailed,
    netTotal: s.netTotal,
    results,
  };
}

function normalizeRow(r) {
  const out = {};
  for (const k of Object.keys(r)) out[String(k).trim().toLowerCase().replace(/\s+/g, "")] = r[k];
  return out;
}

/**
 * Map common spreadsheet header variants onto the canonical keys the
 * importer reads, so real-world salary sheets ("Emp. ID", "E-Mail",
 * "Basic Salary", "TDS"…) work without manual header surgery. Keys here
 * are post-normalizeRow (lowercased, whitespace stripped); an alias only
 * fills a canonical key that is absent or blank.
 */
const HEADER_ALIASES: Record<string, string[]> = {
  employeecode: ["code", "employeeid", "empid", "emp.id", "empno", "employeeno", "emp.no."],
  email: ["e-mail", "mail", "employeeemail", "workemail", "officialemail"],
  basic: ["basicsalary", "earnedbasic"],
  hra: ["earnedhra"],
  allowances: ["allowance", "specialallowance", "earnedspecialallowance"],
  incentive: ["incentives"],
  reimbursement: ["reimbursements"],
  bonus: ["bonus/other"],
  deductions: ["pf", "epf", "pf/statutory", "providentfund"],
  tax: ["tds", "tax(tds)", "incometax"],
  lossofpay: ["lop"],
  otherdeductions: ["others", "otherdeduction"],
};

function aliasRow(r) {
  const out = { ...r };
  for (const [canonical, alts] of Object.entries(HEADER_ALIASES)) {
    if (out[canonical] === undefined || out[canonical] === "") {
      for (const a of alts) {
        if (out[a] !== undefined && out[a] !== "") {
          out[canonical] = out[a];
          break;
        }
      }
    }
  }
  return out;
}

/* ── Endpoints ────────────────────────────────────────────────────────────── */

/**
 * Bulk payslips from a spreadsheet. SheetJS auto-detects the format, so both
 * .xlsx and .csv files work.
 *
 * Reads the file with the SAME parser as the salary-sheet preview, so what the
 * preview showed is what gets generated. See runSheet() for why that matters.
 */
export async function bulkPayslips(ctx: RequestContext, file: UploadedSheet | null | undefined, input: RunInput) {
  if (!file) throw bad("Upload an .xlsx or .csv file (see the template).");
  const out = await runSheet(ctx, file, input.body, { emailAll: wantsEmail(input) });
  if (!out.results.length) throw bad("The sheet has no data rows.");
  return recordRun(ctx, "EXCEL", file, out.results);
}

/**
 * Generate the payslips the salary-sheet preview just reported on.
 *
 * The file is uploaded again and re-parsed rather than the preview's rows being
 * posted back. Re-reading the same bytes with the same parser is what makes
 * "what you previewed is what you get" true, and the preview is a courtesy to
 * the reviewer, not an authorisation to write whatever the client sends. This
 * mirrors the review-then-commit idiom of the employee importer
 * (POST /employees/import/preview -> POST /employees/import).
 *
 * All-or-nothing by default: if any row has a problem, nothing is generated, so
 * HR fixes the sheet instead of discovering a half-finished payroll. Pass
 * skipInvalid=1 to generate the sound rows and report the rest. A refusal comes
 * back as `{ rejected }` (the controller answers 422 with it) so HR sees every
 * row's problems at once.
 *
 * Body/query: sheet?, month?, year?, email?, skipInvalid?
 */
export async function commitSalarySheet(
  ctx: RequestContext,
  file: UploadedSheet | null | undefined,
  input: RunInput,
): Promise<{ rejected: Record<string, any> } | { run: Record<string, any> }> {
  if (!file) throw bad("Upload the same .xlsx or .csv salary sheet you previewed.");
  const sheetName = input.body.sheet ? String(input.body.sheet) : undefined;
  const parsed = parseSalarySheet(file.buffer, sheetName);
  if (!parsed.sheet) {
    throw bad(
      `Could not find a salary table in this workbook. Sheets present: ${parsed.sheetNames.join(", ")}. ` +
        `Simple template uploads (the one from GET /salary/template) go to POST /salary/payslips/bulk.`
    );
  }

  const skipInvalid = flag(input.body.skipInvalid) || flag(input.query.skipInvalid);
  const matched = matchSheetRows(ctx, parsed.rows, await ctx.data.employees.all());
  if (!matched.length) throw bad("The sheet has no employee rows.");
  const invalid = matched.filter((r) => r.errors.length);
  if (invalid.length && !skipInvalid) {
    return {
      rejected: {
        generated: 0,
        skipped: invalid.length,
        emailed: 0,
        message: `${invalid.length} of ${matched.length} rows have problems. Nothing was generated.`,
        errors: invalid.map((r) => ({ row: r.row, problems: r.errors })),
        rows: matched.map(stripMatch),
      },
    };
  }
  if (invalid.length === matched.length) throw bad("No sound rows to generate.");

  const out = await runSheet(ctx, file, input.body, { emailAll: wantsEmail(input), parsed, matched, sheetName });
  return { run: { sheet: parsed.sheet, ...(await recordRun(ctx, "SHEET", file, out.results)) } };
}

/**
 * Dry run over a salary-master workbook.
 *
 * Nothing is written. Returns the detected sheet and header row, the per-row
 * computation, every discrepancy against the sheet's own totals, and any
 * content found below the employee table (the real workbooks carry a
 * freelancer section down there) so HR can see exactly what will and will not
 * be generated before committing.
 *
 * Commit the reviewed file with commitSalarySheet.
 */
export async function previewSalarySheet(ctx: RequestContext, file: UploadedSheet | null | undefined, body: Record<string, any>) {
  if (!file) throw bad("Upload an .xlsx or .csv salary sheet.");
  const parsed = parseSalarySheet(file.buffer, body.sheet ? String(body.sheet) : undefined);
  if (!parsed.sheet) {
    throw bad(
      `Could not find a salary table in this workbook. Sheets present: ${parsed.sheetNames.join(", ")}. ` +
        `A salary sheet needs an identity column (Employee ID or Name) and a pay column (Basic, Gross or Net Pay).`
    );
  }

  // Match each row to an employee so HR sees who will actually be paid. The
  // commit path runs the very same matcher over the very same parse.
  const rows = matchSheetRows(ctx, parsed.rows, await ctx.data.employees.all()).map(stripMatch);

  const valid = rows.filter((r) => !r.errors.length);
  return {
    sheet: parsed.sheet,
    sheetNames: parsed.sheetNames,
    unknownHeaders: parsed.unknownHeaders,
    skippedRows: parsed.skippedRows,
    trailingContent: parsed.trailingContent,
    summary: {
      total: rows.length,
      valid: valid.length,
      invalid: rows.length - valid.length,
      warnings: rows.reduce((n, r) => n + r.warnings.length, 0),
      totalNet: valid.reduce((n, r) => n + r.net, 0),
      totalGross: valid.reduce((n, r) => n + r.gross, 0),
    },
    rows,
  };
}

/**
 * The bulk-payslip Excel template, as an .xlsx buffer.
 *
 * The sample rows are seeded from real employees, which is why the route is
 * staff-only: without it any authenticated employee could read colleagues'
 * compensation. Scoped staff are limited to their own scope, matching the
 * payslip list.
 */
export async function bulkTemplate(ctx: RequestContext): Promise<Buffer> {
  const inScope = await scopedEmployeeIdsFor(ctx); // null = org-wide
  const all = await ctx.data.employees.all();
  const sample = (inScope ? all.filter((e) => inScope.has(e.id)) : all).slice(0, 3);
  const headers = ["employeeCode", "email", "month", "year", "basic", "hra", "allowances", "incentive", "reimbursement", "bonus", "tax", "otherDeductions", "lossOfPay"];
  const data = sample.map((e) => {
    const s = e.salary || {}; // employees created without a structure have no salary
    return {
      employeeCode: e.code, email: e.email,
      month: new Date().getMonth() + 1, year: new Date().getFullYear(),
      basic: s.basic ?? 0, hra: s.hra ?? 0, allowances: s.allowances ?? 0,
      incentive: 0, reimbursement: 0, bonus: 0, tax: 0, otherDeductions: 0, lossOfPay: 0,
    };
  });
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [Object.fromEntries(headers.map((h) => [h, ""]))], { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Payslips");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
