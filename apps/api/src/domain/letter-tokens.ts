/**
 * Token vocabulary for editable letter templates.
 *
 * HR writes letter copy with placeholders such as {{employee.firstName}}, and this module
 * turns a letter's subject matter into the flat map of values those placeholders resolve
 * against. Keeping the vocabulary in one place means the editor's token palette, the
 * template validator and the renderer can never disagree about what exists.
 *
 * Values are pre-formatted for print (dates as "02 January 2026", money in the employee's
 * currency), because a letter is the wrong place to discover that a date arrived as an ISO
 * string or an amount as a bare number.
 */
import { money, round2, compEarnings } from "../core/util";

export interface TokenSpec {
  key: string;
  label: string;
  group: string;
  /** Shown in the palette so HR can see the shape of the value before using it. */
  example: string;
}

/**
 * The catalogue, grouped as the editor presents it. Every key here is resolved by
 * buildTokens(); anything absent from a given letter's subject matter resolves to an
 * empty string rather than leaving a raw {{token}} in a signed PDF.
 */
export const TOKENS: TokenSpec[] = [
  // Employee
  { key: "employee.firstName", label: "First name", group: "Employee", example: "Priya" },
  { key: "employee.lastName", label: "Last name", group: "Employee", example: "Nair" },
  { key: "employee.fullName", label: "Full name", group: "Employee", example: "Priya Nair" },
  { key: "employee.code", label: "Employee code", group: "Employee", example: "ACME-1024" },
  { key: "employee.designation", label: "Designation", group: "Employee", example: "Product Designer" },
  { key: "employee.department", label: "Department", group: "Employee", example: "Design" },
  { key: "employee.employmentType", label: "Employment type", group: "Employee", example: "full-time" },
  { key: "employee.joiningDate", label: "Joining date", group: "Employee", example: "01 September 2026" },
  { key: "employee.confirmationDate", label: "Confirmation date", group: "Employee", example: "01 March 2027" },
  { key: "employee.probationMonths", label: "Probation (months)", group: "Employee", example: "6" },
  { key: "employee.personalEmail", label: "Personal email", group: "Employee", example: "priya@example.com" },
  { key: "employee.officialEmail", label: "Official email", group: "Employee", example: "priya.nair@acme.com" },
  { key: "employee.phone", label: "Phone", group: "Employee", example: "+91 98765 43210" },
  { key: "employee.currentAddress", label: "Current address", group: "Employee", example: "12 MG Road, Bengaluru" },
  { key: "employee.permanentAddress", label: "Permanent address", group: "Employee", example: "8 Park Street, Kolkata" },
  { key: "employee.managerName", label: "Reporting manager", group: "Employee", example: "Arjun Sharma" },
  { key: "employee.pronounThey", label: "Pronoun (they)", group: "Employee", example: "they" },
  { key: "employee.pronounThem", label: "Pronoun (them)", group: "Employee", example: "them" },
  { key: "employee.pronounTheir", label: "Pronoun (their)", group: "Employee", example: "their" },

  // Organisation
  { key: "org.name", label: "Organisation name", group: "Organisation", example: "Acme Technologies" },
  { key: "org.legalName", label: "Legal entity name", group: "Organisation", example: "Acme Technologies Pvt. Ltd." },
  { key: "org.address", label: "Registered address", group: "Organisation", example: "4th Floor, Example Tower, Bengaluru" },
  { key: "org.signatoryName", label: "Signatory name", group: "Organisation", example: "Meera Nair" },
  { key: "org.signatoryTitle", label: "Signatory title", group: "Organisation", example: "Head of People" },

  // Letter
  { key: "letter.date", label: "Date of issue", group: "Letter", example: "14 August 2026" },
  { key: "letter.reference", label: "Reference", group: "Letter", example: "ACME-1024" },
  { key: "letter.effectiveDate", label: "Effective date", group: "Letter", example: "01 April 2027" },
  { key: "letter.lastWorkingDay", label: "Last working day", group: "Letter", example: "30 June 2027" },
  { key: "letter.noticePeriodDays", label: "Notice period (days)", group: "Letter", example: "60" },
  { key: "letter.reason", label: "Reason", group: "Letter", example: "Organisational restructuring" },
  { key: "letter.subReason", label: "Reason category", group: "Letter", example: "Layoff" },
  { key: "letter.daysAbsent", label: "Days absent", group: "Letter", example: "7" },

  // Compensation
  { key: "salary.basic", label: "Basic (monthly)", group: "Compensation", example: "INR 50,000" },
  { key: "salary.hra", label: "HRA (monthly)", group: "Compensation", example: "INR 20,000" },
  { key: "salary.allowances", label: "Allowances (monthly)", group: "Compensation", example: "INR 10,000" },
  { key: "salary.gross", label: "Gross (monthly)", group: "Compensation", example: "INR 80,000" },
  { key: "salary.annualCtc", label: "Annual CTC", group: "Compensation", example: "INR 9,60,000" },
  { key: "salary.previousAnnualCtc", label: "Previous annual CTC", group: "Compensation", example: "INR 8,40,000" },
  { key: "salary.incrementPct", label: "Increment percentage", group: "Compensation", example: "14.29%" },
];

export const TOKEN_KEYS = TOKENS.map((t) => t.key);
const TOKEN_KEY_SET = new Set(TOKEN_KEYS);

/** Print format for dates: "02 January 2026". Empty string for a missing date. */
export const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "";

/** "FULL_TIME" becomes "full-time", for use mid-sentence. */
export const employmentLabel = (t?: string | null) => String(t || "FULL_TIME").replace(/_/g, "-").toLowerCase();

/** "MISCONDUCT" becomes "Misconduct". */
const humanise = (s?: string | null) =>
  s ? String(s).replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "";

/**
 * Date on which probation ends, derived from the joining date. Returned as ISO so the
 * caller formats it once, alongside every other date.
 */
export function probationEndDate(joiningDate?: string | null, months?: number | null): string | null {
  const n = Number(months || 0);
  if (!joiningDate || !n) return null;
  const d = new Date(joiningDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

export interface TokenSubject {
  org: any;
  brand: any;
  employee: any;
  dept?: any;
  manager?: any;
  /** Salary to describe. Defaults to employee.salary; the appraisal letter passes the revised one. */
  salary?: any;
  previousSalary?: any;
  effectiveDate?: string | null;
  lastWorkingDay?: string | null;
  reason?: string | null;
  subReason?: string | null;
  daysAbsent?: number | null;
  noticePeriodDays?: number | null;
}

/**
 * Build the flat token map for one letter.
 *
 * Every key in TOKENS is present in the result, empty when it does not apply, so a template
 * can reference anything without risking a literal "{{employee.managerName}}" being printed
 * on a document that goes to a bank or a future employer.
 */
export function buildTokens(s: TokenSubject): Record<string, string> {
  const e = s.employee || {};
  const org = s.org || {};
  const brand = s.brand || {};
  const salary = s.salary || e.salary || {};
  const currency = salary.currency || "INR";
  const gross = compEarnings(salary);
  const annual = round2(gross * 12);
  const prevAnnual = s.previousSalary ? round2(compEarnings(s.previousSalary) * 12) : 0;
  const pct = prevAnnual > 0 ? round2(((annual - prevAnnual) / prevAnnual) * 100) : 0;
  const fullName = `${e.firstName || ""} ${e.lastName || ""}`.trim();

  const t: Record<string, string> = {
    "employee.firstName": e.firstName || "",
    "employee.lastName": e.lastName || "",
    "employee.fullName": fullName,
    "employee.code": e.code || "",
    "employee.designation": e.designation || "",
    "employee.department": s.dept ? s.dept.name : "",
    "employee.employmentType": employmentLabel(e.employmentType),
    "employee.joiningDate": fmtDate(e.joiningDate),
    "employee.confirmationDate": fmtDate(probationEndDate(e.joiningDate, e.probationMonths)),
    "employee.probationMonths": e.probationMonths ? String(e.probationMonths) : "",
    "employee.personalEmail": e.personalEmail || "",
    "employee.officialEmail": e.officialEmail || e.email || "",
    "employee.phone": e.phone || "",
    "employee.currentAddress": e.currentAddress || "",
    "employee.permanentAddress": e.permanentAddress || "",
    "employee.managerName": s.manager ? `${s.manager.firstName || ""} ${s.manager.lastName || ""}`.trim() : "",
    // Letters are written about a specific person whose pronouns HRMS does not record, so
    // they/them is used throughout. A wrong guess misgenders a real person on a permanent
    // document; the neutral form never does.
    "employee.pronounThey": "they",
    "employee.pronounThem": "them",
    "employee.pronounTheir": "their",

    "org.name": org.name || "",
    "org.legalName": brand.legalName || org.name || "",
    "org.address": org.address || "",
    // brandFor() resolves the signatory from tenant settings, falling back to a generic one.
    "org.signatoryName": (brand.signatory && brand.signatory.name) || "",
    "org.signatoryTitle": (brand.signatory && brand.signatory.title) || "",

    "letter.date": fmtDate(new Date().toISOString()),
    "letter.reference": e.code || "",
    "letter.effectiveDate": fmtDate(s.effectiveDate),
    "letter.lastWorkingDay": fmtDate(s.lastWorkingDay),
    "letter.noticePeriodDays": s.noticePeriodDays ? String(s.noticePeriodDays) : "",
    "letter.reason": s.reason || "",
    "letter.subReason": humanise(s.subReason),
    "letter.daysAbsent": s.daysAbsent ? String(s.daysAbsent) : "",

    "salary.basic": money(Number(salary.basic || 0), currency),
    "salary.hra": money(Number(salary.hra || 0), currency),
    "salary.allowances": money(Number(salary.allowances || 0), currency),
    "salary.gross": money(gross, currency),
    "salary.annualCtc": money(annual, currency),
    "salary.previousAnnualCtc": prevAnnual ? money(prevAnnual, currency) : "",
    "salary.incrementPct": prevAnnual ? `${pct >= 0 ? "+" : ""}${pct}%` : "",
  };
  return t;
}

/**
 * Substitute {{tokens}} in a string.
 *
 * Unknown or empty tokens collapse to nothing, and the surrounding whitespace is tidied so
 * an unused placeholder mid-sentence does not leave a double space or a space before a
 * comma. Templates are authored by people, and a blank optional field is normal.
 */
export function renderText(text: string, tokens: Record<string, string>): string {
  if (!text) return "";
  return String(text)
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => tokens[key] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

/** Token names used in a string that are not in the catalogue. Drives template validation. */
export function unknownTokens(text: string): string[] {
  const found: string[] = [];
  for (const m of String(text || "").matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    if (!TOKEN_KEY_SET.has(m[1])) found.push(m[1]);
  }
  return found;
}
