/**
 * Bulk employee onboarding from a spreadsheet.
 *
 * One declarative column spec drives all three sides of the feature, the
 * downloadable template, the parser that reads an uploaded sheet, and the
 * validator that reports problems before anything is written. Adding a field
 * means adding one row to COLUMNS; the template header, the header-matching
 * aliases and the validation all follow automatically, so they cannot drift
 * apart the way three hand-maintained lists would.
 *
 * The flow is deliberately two-phase: HR uploads, sees exactly what will be
 * created (and what is wrong, per row and per cell), and only then commits.
 */

import * as XLSX from "xlsx";
import {
  CURRENT_EMPLOYMENT_TYPES,
  defaultSalaryBreakdown,
  employmentRules,
  normalizeEmploymentType,
} from "./employment";

export type FieldKind = "text" | "email" | "date" | "number" | "enum" | "phone";

export interface ColumnSpec {
  /** Key on the parsed row object. */
  key: string;
  /** Human header written into the template. */
  header: string;
  kind: FieldKind;
  required?: boolean;
  /** Extra header spellings accepted when reading an uploaded sheet. */
  aliases?: string[];
  /** Allowed values for `enum` columns. */
  options?: string[];
  /** Shown in the template's Instructions sheet. */
  help: string;
  /** Example value for the sample row. */
  sample: string | number;
  group: string;
}

const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
const MARITAL = ["Single", "Married", "Divorced", "Widowed"];
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export const COLUMNS: ColumnSpec[] = [
  // ── Identity ────────────────────────────────────────────────────────────
  { key: "firstName", header: "First name", kind: "text", required: true, group: "Identity", help: "Given name. Required.", sample: "Priya" },
  { key: "lastName", header: "Last name", kind: "text", group: "Identity", help: "Family name.", sample: "Nair" },
  { key: "email", header: "Personal email", kind: "email", required: true, aliases: ["email", "personal email id", "personal e-mail"], group: "Identity", help: "The address the joining invite is sent to. Must be unique. Required.", sample: "priya.nair@gmail.com" },
  { key: "officialEmail", header: "Official email", kind: "email", aliases: ["work email", "company email"], group: "Identity", help: "Leave blank to have the company address generated on joining.", sample: "" },
  { key: "phone", header: "Phone", kind: "phone", aliases: ["mobile", "contact number"], group: "Identity", help: "Include the country code, e.g. +91 98765 43210.", sample: "+91 98765 43210" },
  { key: "dob", header: "Date of birth", kind: "date", aliases: ["dob", "birth date"], group: "Identity", help: "Format YYYY-MM-DD (e.g. 1996-04-17).", sample: "1996-04-17" },
  { key: "gender", header: "Gender", kind: "enum", options: GENDERS, group: "Identity", help: `One of: ${GENDERS.join(", ")}.`, sample: "Female" },
  { key: "bloodGroup", header: "Blood group", kind: "enum", options: BLOOD, group: "Identity", help: `One of: ${BLOOD.join(", ")}.`, sample: "O+" },
  { key: "maritalStatus", header: "Marital status", kind: "enum", options: MARITAL, group: "Identity", help: `One of: ${MARITAL.join(", ")}.`, sample: "Single" },
  { key: "nationality", header: "Nationality", kind: "text", group: "Identity", help: "Defaults to Indian if left blank.", sample: "Indian" },

  // ── Engagement ──────────────────────────────────────────────────────────
  { key: "code", header: "Employee code", kind: "text", aliases: ["employee id", "emp code", "emp id"], group: "Engagement", help: "Leave blank to generate the next code automatically.", sample: "" },
  { key: "employmentType", header: "Employment type", kind: "enum", required: true, options: CURRENT_EMPLOYMENT_TYPES.map((t) => t.label), aliases: ["type", "engagement type", "employee type"], group: "Engagement", help: `One of: ${CURRENT_EMPLOYMENT_TYPES.map((t) => t.label).join(", ")}. Required, it decides whether PF, ESI and professional tax apply.`, sample: "Permanent" },
  { key: "departmentName", header: "Department", kind: "text", aliases: ["dept", "department name"], group: "Engagement", help: "Must match an existing department name, or leave blank.", sample: "Engineering" },
  { key: "designation", header: "Designation", kind: "text", aliases: ["title", "job title", "role"], group: "Engagement", help: "Free text, e.g. Senior Engineer.", sample: "Product Designer" },
  // `required` here means "the template carries this column and we flag the
  // file if the whole column is absent". Individual blank cells are handled by
  // validateRows, which defaults this one to today with a warning.
  { key: "joiningDate", header: "Joining date", kind: "date", required: true, aliases: ["doj", "date of joining", "start date"], group: "Engagement", help: "Format YYYY-MM-DD. Past dates are allowed for people who already joined. A blank cell defaults to today.", sample: "2026-09-01" },
  { key: "managerEmail", header: "Reporting manager email", kind: "email", aliases: ["manager email", "reports to", "reporting manager"], group: "Engagement", help: "The manager's email as already recorded in the system. Blank means no manager.", sample: "" },
  { key: "officeName", header: "Work location", kind: "text", aliases: ["office", "location", "branch"], group: "Engagement", help: "Must match an existing office name, or leave blank.", sample: "Bengaluru HQ" },
  { key: "probationMonths", header: "Probation (months)", kind: "number", group: "Engagement", help: "Blank uses the default for the employment type.", sample: "" },

  // ── Salary ──────────────────────────────────────────────────────────────
  { key: "monthlyGross", header: "Monthly gross", kind: "number", aliases: ["gross", "monthly salary", "salary", "gross salary"], group: "Salary", help: "Total monthly pay before deductions. If you fill this and leave the components blank, Basic / HRA / Allowances are derived from it.", sample: 85000 },
  { key: "basic", header: "Basic", kind: "number", group: "Salary", help: "Blank derives 50% of monthly gross, which keeps PF at a defensible level.", sample: "" },
  { key: "hra", header: "HRA", kind: "number", aliases: ["house rent allowance"], group: "Salary", help: "Blank derives 40% of Basic.", sample: "" },
  { key: "allowances", header: "Other allowances", kind: "number", aliases: ["allowance", "special allowance"], group: "Salary", help: "Blank derives the remainder of monthly gross.", sample: "" },
  { key: "deductions", header: "Other deductions", kind: "number", group: "Salary", help: "Recurring deductions beyond the statutory ones. Blank means none.", sample: "" },

  // ── Statutory ───────────────────────────────────────────────────────────
  { key: "pan", header: "PAN", kind: "text", aliases: ["pan number", "pan card"], group: "Statutory", help: "Ten characters, e.g. ABCDE1234F. Required before the first payroll run.", sample: "ABCDE1234F" },
  { key: "aadhaar", header: "Aadhaar", kind: "text", aliases: ["aadhar", "aadhaar number", "aadhar card", "uid"], group: "Statutory", help: "Twelve digits. Stored in full, as PF and ESIC filing need the whole number.", sample: "1234 5678 9012" },
  { key: "uan", header: "UAN", kind: "text", aliases: ["pf uan", "uan number"], group: "Statutory", help: "Twelve-digit Universal Account Number, if the employee already has one.", sample: "" },
  { key: "esiNumber", header: "ESI number", kind: "text", aliases: ["esic", "esi ip number"], group: "Statutory", help: "Seventeen digits, if already registered.", sample: "" },

  // ── Bank ────────────────────────────────────────────────────────────────
  { key: "bankAccount", header: "Bank account number", kind: "text", aliases: ["account number", "a/c no", "bank a/c"], group: "Bank", help: "Salary account number. Required before the first payroll run.", sample: "50100123456789" },
  { key: "bankIfsc", header: "IFSC", kind: "text", aliases: ["ifsc code"], group: "Bank", help: "Eleven characters, e.g. HDFC0001234.", sample: "HDFC0001234" },
  { key: "bankName", header: "Bank name", kind: "text", group: "Bank", help: "e.g. HDFC Bank.", sample: "HDFC Bank" },

  // ── Contact ─────────────────────────────────────────────────────────────
  { key: "currentAddress", header: "Current address", kind: "text", aliases: ["present address", "communication address"], group: "Contact", help: "Where the employee currently lives.", sample: "12, 4th Cross, Indiranagar, Bengaluru 560038" },
  { key: "permanentAddress", header: "Permanent address", kind: "text", aliases: ["home address"], group: "Contact", help: "Blank copies the current address.", sample: "" },
  { key: "emergencyName", header: "Emergency contact name", kind: "text", group: "Contact", help: "Who to call in an emergency.", sample: "Anil Nair" },
  { key: "emergencyPhone", header: "Emergency contact phone", kind: "phone", group: "Contact", help: "Include the country code.", sample: "+91 98450 11223" },
  { key: "emergencyRelation", header: "Emergency contact relation", kind: "text", group: "Contact", help: "e.g. Father, Spouse.", sample: "Father" },
];

const BY_HEADER = new Map<string, ColumnSpec>();
const normHeader = (s: string) => String(s ?? "").toLowerCase().replace(/[\s._\-/()]+/g, "");
for (const c of COLUMNS) {
  BY_HEADER.set(normHeader(c.header), c);
  BY_HEADER.set(normHeader(c.key), c);
  for (const a of c.aliases ?? []) BY_HEADER.set(normHeader(a), c);
}

export const TEMPLATE_HEADERS = COLUMNS.map((c) => c.header);

/* ── Value coercion ─────────────────────────────────────────────────────── */

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Excel serial date → ISO. Sheets often hand back a number, not a string. */
function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  // Excel's epoch is 1899-12-30 (accounting for its 1900 leap-year bug).
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Accepts ISO, an Excel serial, dd/mm/yyyy and dd-mm-yyyy. */
export function toIsoDate(input: unknown): string | null {
  if (input == null || input === "") return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input.toISOString().slice(0, 10);
  }
  if (typeof input === "number") return excelSerialToIso(input);

  const s = String(input).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : s;
  }
  // Day-first, which is what an Indian HR team will type.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : iso;
  }
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Strips currency symbols, commas and spaces before parsing. */
export function toNumber(input: unknown): number | null {
  if (input == null || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const cleaned = String(input).replace(/[₹$,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const digitsOnly = (s: unknown) => String(s ?? "").replace(/\D/g, "");

function matchEnum(value: string, options: string[]): string | null {
  const loose = value.toLowerCase().replace(/[\s._\-/]+/g, "");
  return options.find((o) => o.toLowerCase().replace(/[\s._\-/]+/g, "") === loose) ?? null;
}

/* ── Parsing ────────────────────────────────────────────────────────────── */

export interface ParsedSheet {
  rows: Record<string, unknown>[];
  /** Headers in the file we did not recognise, surfaced so typos are visible. */
  unknownHeaders: string[];
  /** Required columns entirely absent from the file. */
  missingRequired: string[];
}

/**
 * Read an uploaded .xlsx/.csv buffer into raw row objects keyed by column key.
 *
 * Header matching is forgiving (case, spacing, punctuation and a list of
 * aliases) because the file has usually been round-tripped through somebody's
 * own spreadsheet before it gets here.
 */
export function parseWorkbook(buffer: Buffer): ParsedSheet {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  // Prefer the sheet named "Employees" (what our template calls it); else the first.
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === "employees") ?? wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : null;
  if (!sheet) return { rows: [], unknownHeaders: [], missingRequired: [] };

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: true });
  if (!grid.length) return { rows: [], unknownHeaders: [], missingRequired: [] };

  const headerRow = (grid[0] ?? []).map((h) => String(h ?? "").trim());
  const unknownHeaders: string[] = [];
  const colFor: (ColumnSpec | null)[] = headerRow.map((h) => {
    if (!h) return null;
    const spec = BY_HEADER.get(normHeader(h));
    if (!spec) unknownHeaders.push(h);
    return spec ?? null;
  });

  const present = new Set(colFor.filter(Boolean).map((c) => c!.key));
  const missingRequired = COLUMNS.filter((c) => c.required && !present.has(c.key)).map(
    (c) => c.header
  );

  const rows: Record<string, unknown>[] = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    const obj: Record<string, unknown> = {};
    let hasValue = false;
    for (let i = 0; i < colFor.length; i++) {
      const spec = colFor[i];
      if (!spec) continue;
      const raw = line[i];
      if (raw === undefined || raw === null || String(raw).trim() === "") continue;
      obj[spec.key] = raw instanceof Date ? raw : typeof raw === "number" ? raw : String(raw).trim();
      hasValue = true;
    }
    if (hasValue) {
      obj.__row = r + 1; // 1-based spreadsheet row, so errors point at the real line
      rows.push(obj);
    }
  }

  return { rows, unknownHeaders, missingRequired };
}

/* ── Validation ─────────────────────────────────────────────────────────── */

export interface RowIssue {
  field: string;
  message: string;
}

export interface ValidatedRow {
  /** Spreadsheet row number, for pointing the user at the right line. */
  row: number;
  /** Normalised, ready-to-insert values. Null when the row cannot be created. */
  value: NormalizedEmployee | null;
  errors: RowIssue[];
  /** Non-blocking: the row imports, but something was assumed or dropped. */
  warnings: RowIssue[];
}

export interface NormalizedEmployee {
  firstName: string;
  lastName: string;
  email: string;
  officialEmail: string;
  phone: string;
  dob: string | null;
  gender: string;
  bloodGroup: string;
  maritalStatus: string;
  nationality: string;
  code: string;
  employmentType: string;
  departmentId: string | null;
  departmentName: string;
  designation: string;
  joiningDate: string;
  managerId: string | null;
  /** Kept so the commit phase can link managers who are themselves rows in this file. */
  managerEmail: string;
  officeId: string | null;
  probationMonths: number;
  salary: { basic: number; hra: number; allowances: number; deductions: number };
  monthlyGross: number;
  pan: string;
  aadhaar: string;
  uan: string;
  esiNumber: string;
  bank: { account: string; ifsc: string; bankName: string };
  currentAddress: string;
  permanentAddress: string;
  emergencyContact: { name: string; phone: string; relation: string };
}

export interface ValidationContext {
  /** Existing department names → id. */
  departments: { id: string; name: string }[];
  /** Existing office names → id. */
  offices: { id: string; name: string }[];
  /** Existing employees, for manager lookup by email. */
  employees: { id: string; email?: string | null; code?: string | null }[];
  /** Every email already taken by a user or employee, lowercased. */
  takenEmails: Set<string>;
}

/**
 * Validate and normalise parsed rows without writing anything.
 *
 * Errors block a row; warnings let it through with a stated assumption. Both
 * are reported per field so the UI can point at the offending cell rather than
 * saying "row 14 is bad".
 */
export function validateRows(
  rows: Record<string, unknown>[],
  ctx: ValidationContext
): ValidatedRow[] {
  const deptByName = new Map(ctx.departments.map((d) => [d.name.toLowerCase().trim(), d]));
  const officeByName = new Map(ctx.offices.map((o) => [String(o.name ?? "").toLowerCase().trim(), o]));
  const empByEmail = new Map(
    ctx.employees
      .filter((e) => e.email)
      .map((e) => [String(e.email).toLowerCase().trim(), e])
  );
  const existingCodes = new Set(
    ctx.employees.map((e) => String(e.code ?? "").toUpperCase().trim()).filter(Boolean)
  );

  // Emails and codes seen earlier *in this same file*, a sheet duplicated
  // against itself is at least as common as one duplicating the database.
  const seenEmails = new Set<string>();
  const seenCodes = new Set<string>();

  // EVERY email in the file, gathered up front (not just rows seen so far), because a
  // manager may appear below their own report. Used to tell "manager is in this file, the
  // commit will link them" apart from "no such manager anywhere".
  const emailsInFile = new Set<string>(
    rows.map((r) => String(r.email ?? "").toLowerCase().trim()).filter(Boolean)
  );

  return rows.map((raw) => {
    const row = Number(raw.__row ?? 0);
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];
    const str = (k: string) => String(raw[k] ?? "").trim();

    // ── Identity ────────────────────────────────────────────────────────
    const firstName = str("firstName");
    if (!firstName) errors.push({ field: "First name", message: "Required." });

    const email = str("email").toLowerCase();
    if (!email) {
      errors.push({ field: "Personal email", message: "Required." });
    } else if (!EMAIL_RE.test(email)) {
      errors.push({ field: "Personal email", message: `"${email}" is not a valid email address.` });
    } else if (ctx.takenEmails.has(email)) {
      errors.push({ field: "Personal email", message: "Already used by an existing employee or user." });
    } else if (seenEmails.has(email)) {
      errors.push({ field: "Personal email", message: "Appears more than once in this file." });
    } else {
      seenEmails.add(email);
    }

    const officialEmail = str("officialEmail").toLowerCase();
    if (officialEmail && !EMAIL_RE.test(officialEmail)) {
      errors.push({ field: "Official email", message: `"${officialEmail}" is not a valid email address.` });
    }

    const dobRaw = raw.dob;
    let dob: string | null = null;
    if (dobRaw != null && String(dobRaw).trim() !== "") {
      dob = toIsoDate(dobRaw);
      if (!dob) {
        errors.push({ field: "Date of birth", message: `Could not read "${String(dobRaw)}". Use YYYY-MM-DD.` });
      } else if (new Date(dob) > new Date()) {
        errors.push({ field: "Date of birth", message: "Is in the future." });
      }
    }

    const enumField = (key: string, label: string, options: string[]) => {
      const v = str(key);
      if (!v) return "";
      const matched = matchEnum(v, options);
      if (!matched) {
        warnings.push({ field: label, message: `"${v}" is not a recognised value and was left blank.` });
        return "";
      }
      return matched;
    };
    const gender = enumField("gender", "Gender", GENDERS);
    const bloodGroup = enumField("bloodGroup", "Blood group", BLOOD);
    const maritalStatus = enumField("maritalStatus", "Marital status", MARITAL);

    // ── Engagement ──────────────────────────────────────────────────────
    const typeRaw = str("employmentType");
    const employmentType = normalizeEmploymentType(typeRaw);
    if (!typeRaw) {
      errors.push({ field: "Employment type", message: "Required." });
    } else if (!employmentType) {
      errors.push({
        field: "Employment type",
        message: `"${typeRaw}" is not a known type. Use one of: ${CURRENT_EMPLOYMENT_TYPES.map((t) => t.label).join(", ")}.`,
      });
    }

    // A blank joining date has one obvious, safe default (today) and is easy to
    // correct afterwards, so it defaults with a stated warning rather than
    // blocking the row, this also preserves the pre-existing API contract,
    // where callers could omit it. A date we cannot *parse* is still an error:
    // silently substituting today for "31/31/2026" would hide a real mistake.
    //
    // Employment type gets no such leniency, because there is no safe default
    //, quietly filing a freelancer as full-time applies PF, ESI and
    // professional tax to someone who owes none, and nothing about the record
    // looks wrong afterwards.
    const joiningRaw = raw.joiningDate;
    let joiningDate: string | null = null;
    if (joiningRaw == null || String(joiningRaw).trim() === "") {
      joiningDate = new Date().toISOString().slice(0, 10);
      warnings.push({ field: "Joining date", message: `Not given, defaulted to today (${joiningDate}).` });
    } else {
      joiningDate = toIsoDate(joiningRaw);
      if (!joiningDate) {
        errors.push({ field: "Joining date", message: `Could not read "${String(joiningRaw)}". Use YYYY-MM-DD.` });
      }
    }
    if (dob && joiningDate && new Date(joiningDate) <= new Date(dob)) {
      errors.push({ field: "Joining date", message: "Is on or before the date of birth." });
    }

    const departmentName = str("departmentName");
    let departmentId: string | null = null;
    if (departmentName) {
      const dept = deptByName.get(departmentName.toLowerCase());
      if (dept) departmentId = dept.id;
      else warnings.push({ field: "Department", message: `No department named "${departmentName}". Imported without one.` });
    }

    const officeName = str("officeName");
    let officeId: string | null = null;
    if (officeName) {
      const office = officeByName.get(officeName.toLowerCase());
      if (office) officeId = office.id;
      else warnings.push({ field: "Work location", message: `No office named "${officeName}". Imported without one.` });
    }

    const managerEmail = str("managerEmail").toLowerCase();
    let managerId: string | null = null;
    if (managerEmail) {
      const mgr = empByEmail.get(managerEmail);
      if (mgr) {
        managerId = mgr.id;
      } else if (emailsInFile.has(managerEmail)) {
        // The manager is another row in this same sheet. `empByEmail` only holds employees
        // that existed BEFORE the import, so importing a whole org in one file used to drop
        // every internal manager link with a warning. The commit does a second pass once
        // all rows have ids, so this is expected rather than a problem.
        managerId = null;
      } else {
        warnings.push({ field: "Reporting manager email", message: `No employee with email "${managerEmail}". Imported without a manager.` });
      }
    }

    const code = str("code").toUpperCase();
    if (code) {
      if (existingCodes.has(code)) errors.push({ field: "Employee code", message: `"${code}" is already in use.` });
      else if (seenCodes.has(code)) errors.push({ field: "Employee code", message: `"${code}" appears more than once in this file.` });
      else seenCodes.add(code);
    }

    const rules = employmentRules(employmentType);
    const probRaw = toNumber(raw.probationMonths);
    const probationMonths = probRaw == null ? rules.probationMonths : Math.max(0, Math.round(probRaw));

    // ── Salary ──────────────────────────────────────────────────────────
    const gross = toNumber(raw.monthlyGross);
    const basicIn = toNumber(raw.basic);
    const hraIn = toNumber(raw.hra);
    const allowIn = toNumber(raw.allowances);
    const dedIn = toNumber(raw.deductions);

    for (const [k, label] of [
      ["monthlyGross", "Monthly gross"],
      ["basic", "Basic"],
      ["hra", "HRA"],
      ["allowances", "Other allowances"],
      ["deductions", "Other deductions"],
    ] as const) {
      const present = raw[k] != null && String(raw[k]).trim() !== "";
      if (present && toNumber(raw[k]) == null) {
        errors.push({ field: label, message: `"${String(raw[k])}" is not a number.` });
      } else if (present && (toNumber(raw[k]) as number) < 0) {
        errors.push({ field: label, message: "Cannot be negative." });
      }
    }

    let salary = { basic: 0, hra: 0, allowances: 0, deductions: 0 };
    if (basicIn != null || hraIn != null || allowIn != null) {
      // Explicit components win; anything omitted stays zero rather than being
      // silently invented on top of numbers HR deliberately specified.
      salary = {
        basic: Math.max(0, Math.round(basicIn ?? 0)),
        hra: Math.max(0, Math.round(hraIn ?? 0)),
        allowances: Math.max(0, Math.round(allowIn ?? 0)),
        deductions: Math.max(0, Math.round(dedIn ?? 0)),
      };
      const sum = salary.basic + salary.hra + salary.allowances;
      if (gross != null && Math.abs(sum - gross) > 1) {
        warnings.push({
          field: "Monthly gross",
          message: `Components add up to ${sum.toLocaleString("en-IN")}, which differs from the stated gross of ${gross.toLocaleString("en-IN")}. The components were used.`,
        });
      }
    } else if (gross != null && gross > 0) {
      salary = defaultSalaryBreakdown(employmentType, gross);
      if (dedIn != null) salary.deductions = Math.max(0, Math.round(dedIn));
    } else if (rules.onPayroll) {
      warnings.push({ field: "Monthly gross", message: "No salary given. Imported at zero, set it before running payroll." });
    }

    const monthlyGross = salary.basic + salary.hra + salary.allowances;

    // ── Statutory ───────────────────────────────────────────────────────
    const pan = str("pan").toUpperCase().replace(/\s/g, "");
    if (pan && !PAN_RE.test(pan)) {
      errors.push({ field: "PAN", message: `"${pan}" is not a valid PAN (five letters, four digits, one letter).` });
    }

    const aadhaarDigits = digitsOnly(raw.aadhaar);
    if (aadhaarDigits && aadhaarDigits.length !== 12) {
      errors.push({ field: "Aadhaar", message: `Expected 12 digits, got ${aadhaarDigits.length}.` });
    }

    const uanDigits = digitsOnly(raw.uan);
    if (uanDigits && uanDigits.length !== 12) {
      warnings.push({ field: "UAN", message: `Expected 12 digits, got ${uanDigits.length}. Imported as given.` });
    }

    const esiDigits = digitsOnly(raw.esiNumber);
    if (esiDigits && esiDigits.length !== 17) {
      warnings.push({ field: "ESI number", message: `Expected 17 digits, got ${esiDigits.length}. Imported as given.` });
    }

    if (rules.pf && !pan) {
      warnings.push({ field: "PAN", message: "Missing. It is needed before this employee's first payroll run." });
    }

    // ── Bank ────────────────────────────────────────────────────────────
    const bankAccount = str("bankAccount").replace(/\s/g, "");
    const bankIfsc = str("bankIfsc").toUpperCase().replace(/\s/g, "");
    if (bankIfsc && !IFSC_RE.test(bankIfsc)) {
      errors.push({ field: "IFSC", message: `"${bankIfsc}" is not a valid IFSC (four letters, a zero, then six characters).` });
    }
    if (bankAccount && !bankIfsc) {
      warnings.push({ field: "IFSC", message: "Account number given without an IFSC. Salary cannot be paid until it's set." });
    }

    // ── Contact ─────────────────────────────────────────────────────────
    const currentAddress = str("currentAddress");
    const permanentAddress = str("permanentAddress") || currentAddress;

    const value: NormalizedEmployee | null = errors.length
      ? null
      : {
          firstName,
          lastName: str("lastName"),
          email,
          officialEmail,
          phone: str("phone"),
          dob,
          gender,
          bloodGroup,
          maritalStatus,
          nationality: str("nationality") || "Indian",
          code,
          employmentType: employmentType!,
          departmentId,
          departmentName,
          designation: str("designation"),
          joiningDate: joiningDate!,
          managerId,
          managerEmail,
          officeId,
          probationMonths,
          salary,
          monthlyGross,
          pan,
          aadhaar: aadhaarDigits,
          uan: uanDigits,
          esiNumber: esiDigits,
          bank: { account: bankAccount, ifsc: bankIfsc, bankName: str("bankName") },
          currentAddress,
          permanentAddress,
          emergencyContact: {
            name: str("emergencyName"),
            phone: str("emergencyPhone"),
            relation: str("emergencyRelation"),
          },
        };

    return { row, value, errors, warnings };
  });
}

/* ── Template generation ────────────────────────────────────────────────── */

/**
 * Build the downloadable .xlsx template.
 *
 * Three sheets: the one to fill in (with two example rows), a field-by-field
 * guide, and a reference sheet listing this organisation's real departments,
 * offices and designations so people pick names that will actually match.
 */
export function buildTemplate(opts: {
  orgName: string;
  departments: string[];
  offices: string[];
  designations: string[];
}): Buffer {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Employees ────────────────────────────────────────────────
  const sample2: Record<string, string | number> = {
    firstName: "Rahul",
    lastName: "Mehta",
    email: "rahul.mehta@example.com",
    phone: "+91 99000 11223",
    dob: "1994-11-02",
    gender: "Male",
    employmentType: "Intern",
    designation: "Engineering Intern",
    joiningDate: "2026-09-15",
    monthlyGross: 25000,
    nationality: "Indian",
  };

  const rows = [
    TEMPLATE_HEADERS,
    COLUMNS.map((c) => c.sample),
    COLUMNS.map((c) => sample2[c.key] ?? ""),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = COLUMNS.map((c) => ({
    wch: Math.min(38, Math.max(14, c.header.length + 4)),
  }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, "Employees");

  // ── Sheet 2: Instructions ─────────────────────────────────────────────
  const guide: (string | number)[][] = [
    [`${opts.orgName}, bulk employee onboarding`],
    [],
    ["How to use this file"],
    ["1.", "Fill in the 'Employees' sheet. One employee per row."],
    ["2.", "The two example rows are there to show the format, delete them before uploading."],
    ["3.", "Only First name, Personal email, Employment type and Joining date are required."],
    ["4.", "Upload the file on the Onboarding page. You'll see exactly what will be created, and any problems, before anything is saved."],
    [],
    ["Notes"],
    ["•", "Dates: use YYYY-MM-DD. Past joining dates are fine for people who already joined."],
    ["•", "Salary: fill Monthly gross and leave the components blank to have Basic / HRA / Allowances derived, or specify the components yourself."],
    ["•", "Employment type decides whether PF, ESI and professional tax apply, see the Reference sheet."],
    ["•", "Aadhaar is stored in full, since PF and ESIC filing need the whole number."],
    [],
    ["Field", "Required", "Notes"],
    ...COLUMNS.map((c) => [c.header, c.required ? "Yes" : "", c.help]),
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guide);
  wsGuide["!cols"] = [{ wch: 30 }, { wch: 10 }, { wch: 96 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, "Instructions");

  // ── Sheet 3: Reference ────────────────────────────────────────────────
  const maxLen = Math.max(
    CURRENT_EMPLOYMENT_TYPES.length,
    opts.departments.length,
    opts.offices.length,
    opts.designations.length,
    1
  );
  const ref: (string | number)[][] = [
    ["Employment types (use exactly these)", "PF", "ESI", "Prof. tax", "Gratuity", "Leave", "", "Departments", "Offices", "Designations in use"],
  ];
  for (let i = 0; i < maxLen; i++) {
    const t = CURRENT_EMPLOYMENT_TYPES[i];
    ref.push([
      t?.label ?? "",
      t ? (t.pf ? "Yes" : "No") : "",
      t ? (t.esi ? "Yes" : "No") : "",
      t ? (t.professionalTax ? "Yes" : "No") : "",
      t ? (t.gratuityEligible ? "Yes" : "No") : "",
      t ? (t.accruesLeave ? "Yes" : "No") : "",
      "",
      opts.departments[i] ?? "",
      opts.offices[i] ?? "",
      opts.designations[i] ?? "",
    ]);
  }
  ref.push([]);
  ref.push(["Gender", ...GENDERS]);
  ref.push(["Marital status", ...MARITAL]);
  ref.push(["Blood group", ...BLOOD]);
  const wsRef = XLSX.utils.aoa_to_sheet(ref);
  wsRef["!cols"] = [
    { wch: 34 }, { wch: 8 }, { wch: 8 }, { wch: 11 }, { wch: 10 }, { wch: 8 },
    { wch: 3 }, { wch: 26 }, { wch: 26 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, wsRef, "Reference");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Build an .xlsx of the rows that failed, so HR can fix and re-upload just those. */
export function buildErrorReport(results: ValidatedRow[], originals: Record<string, unknown>[]): Buffer {
  const byRow = new Map(originals.map((o) => [Number(o.__row ?? 0), o]));
  const failed = results.filter((r) => r.errors.length);

  const rows: (string | number)[][] = [["Sheet row", "Problems", ...TEMPLATE_HEADERS]];
  for (const r of failed) {
    const original = byRow.get(r.row) ?? {};
    rows.push([
      r.row,
      r.errors.map((e) => `${e.field}: ${e.message}`).join(" | "),
      ...COLUMNS.map((c) => {
        const v = original[c.key];
        return v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | number);
      }),
    ]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 10 }, { wch: 70 }, ...COLUMNS.map(() => ({ wch: 20 }))];
  XLSX.utils.book_append_sheet(wb, ws, "Errors");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
