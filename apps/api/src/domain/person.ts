/**
 * One person, one identity.
 *
 * A login account (`users`) and an HR record (`employees`) describe the same human. They
 * were previously created by separate paths: self-signup and the staff invite made a login
 * with `employeeId: null`, so administrators and HR staff existed nowhere in the HR system.
 * They could not mark attendance, take leave, appear on the org chart, be named as somebody's
 * reporting manager, receive a payslip, or resign, because every one of those features is
 * keyed by employee id.
 *
 * This module is the single place that pairs the two, so no path can create half a person.
 */
import { generateEmployeeCode } from "./onboard-util";
import { todayStr , isoDate } from "../core/util";

/**
 * "First Last" for an employee or login row, never "First undefined".
 *
 * lastName is optional (single-name people, imports that left it blank), and a bare template
 * literal printed the word "undefined" into letter titles, leave lists and the wellbeing pulse.
 */
function fullName(p: any): string {
  return `${p?.firstName || ""} ${p?.lastName || ""}`.trim();
}

/** Split a display name into first / last, tolerating single-word and empty names. */
function splitName(name: string, fallback: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: fallback, lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Create the employee record for an existing login and link them together.
 *
 * Idempotent: if the user already has a linked employee, that record is returned untouched,
 * so this is safe to call from the backfill, from signup retries, and from the "create
 * employee record" action without risking a duplicate roster entry.
 *
 * Deliberately minimal: name, code, joining date and employment type only. Salary, bank and
 * statutory details are left empty for HR to fill in, because inventing a salary for an
 * administrator would put a fabricated number straight onto a payslip.
 */
async function ensureEmployeeForUser(repos, org, user, opts: any = {}) {
  if (user.employeeId) {
    const existing = await repos.employees.byId(user.employeeId);
    if (existing) return { employee: existing, created: false };
    // Dangling link (the employee row was purged). Fall through and make a fresh one.
  }

  const { firstName, lastName } = splitName(
    opts.firstName ? `${opts.firstName} ${opts.lastName || ""}` : user.name,
    String(user.email || "user").split("@")[0]
  );

  const employee = await repos.employees.insert({
    departmentId: opts.departmentId || null,
    officeId: opts.officeId || null,
    code: opts.code || (await generateEmployeeCode(org, repos)),
    firstName,
    lastName,
    // The login address is the work address; a personal one is captured separately later.
    email: user.email,
    officialEmail: opts.officialEmail || user.email,
    personalEmail: opts.personalEmail || "",
    phone: opts.phone || user.phone || "",
    employmentType: opts.employmentType || "FULL_TIME",
    designation: opts.designation || "",
    managerId: opts.managerId || null,
    joiningDate: opts.joiningDate || isoDate(user.createdAt) || todayStr(),
    status: opts.status || "ACTIVE",
    salary: { basic: 0, hra: 0, allowances: 0, deductions: 0 },
    bank: { account: "", ifsc: "" },
    // Marks records this module created rather than ones HR entered, so a backfill run
    // is identifiable (and reversible) afterwards.
    createdVia: opts.createdVia || "AUTO",
  });

  await repos.users.update(user.id, { employeeId: employee.id });
  return { employee, created: true };
}

export { ensureEmployeeForUser, splitName, fullName };
