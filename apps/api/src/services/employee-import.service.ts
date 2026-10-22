/**
 * Bulk onboarding from a spreadsheet: the template download, a dry-run preview, an error
 * report of the rows that failed, and the commit.
 */
import type { RequestContext } from "../core/context";
import { bad, tempPassword } from "../core/util";
import { PORTAL_URL } from "../core/config";
import { hashPassword } from "../middleware/auth";
import { sendTenantMail } from "../integrations/mail/mailer";
import { onboardingEmail } from "../integrations/mail/templates";
import { employeeCodeGenerator } from "../domain/onboard-util";
import { employmentRules } from "../domain/employment";
import {
  buildTemplate,
  buildErrorReport,
  parseWorkbook,
  validateRows,
  type NormalizedEmployee,
} from "../domain/onboarding-import";
import { resolveLoginEmail, joiningEmail } from "./identity.service";
import { systemRepos } from "../repositories/base.repository";
import { createRepositories } from "../repositories";
import { fullName } from "../domain/person";

/** A generated file for the controller to send as a download. */
export interface Download {
  filename: string;
  contentType: string;
  body: Buffer;
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Shared context for validating an uploaded sheet against this org's data.
 *
 *  Everything here is read through the caller's workspace repositories, which are bound
 *  to the caller's org. The one deliberate exception is the email probe: a login is unique
 *  platform-wide, so an address already held by another workspace would pass an
 *  org-scoped check and then fail at insert. That probe asks only about the
 *  addresses actually present in the sheet (one IN query) instead of reading
 *  every org's users, so no other tenant's data enters this process. */
async function importContext(ctx: RequestContext, rows: any[] = []) {
  const candidates = [
    ...new Set(
      (rows || [])
        .flatMap((r: any) => [r?.email, r?.officialEmail])
        .map((e: any) => String(e ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const [departments, offices, employees, orgUsers, globalMatches] = await Promise.all([
    ctx.data.departments.all(),
    ctx.data.offices.all(),
    ctx.data.employees.all(),
    ctx.data.users.all(),
    candidates.length ? createRepositories(systemRepos()).users.findByEmails(candidates) : Promise.resolve([]),
  ]);
  const takenEmails = new Set<string>();
  for (const u of [...orgUsers, ...globalMatches]) if (u.email) takenEmails.add(String(u.email).toLowerCase());
  for (const e of employees) {
    if (e.email) takenEmails.add(String(e.email).toLowerCase());
    if (e.officialEmail) takenEmails.add(String(e.officialEmail).toLowerCase());
  }
  return {
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    offices: offices.map((o) => ({ id: o.id, name: o.name })),
    employees: employees.map((e) => ({ id: e.id, email: e.email, code: e.code })),
    takenEmails,
  };
}

/** The raw rows a client sent back, or a 400. */
function requireRows(raw: unknown): any[] {
  if (!Array.isArray(raw) || !raw.length) throw bad("rows[] required");
  return raw;
}

/**
 * The .xlsx to fill in.
 * Pre-populated with this org's real departments, offices and designations so
 * the names people type will actually match on upload.
 */
export async function importTemplate(ctx: RequestContext): Promise<Download> {
  const org = (await ctx.data.organizations.byId(ctx.orgId))!;
  const [departments, offices] = await Promise.all([
    ctx.data.departments.all(),
    ctx.data.offices.all(),
  ]);
  const body = buildTemplate({
    orgName: org.name,
    departments: departments.map((d) => d.name).sort(),
    offices: offices.map((o) => o.name).filter(Boolean).sort(),
    designations: (Array.isArray(org.designations) ? org.designations : []).slice(0, 200),
  });
  const slug = String(org.slug || "org").replace(/[^a-z0-9-]/gi, "");
  return { filename: `${slug}-employee-onboarding-template.xlsx`, contentType: XLSX, body };
}

/**
 * Dry run.
 *
 * Parses and validates the sheet without writing anything, returning a
 * per-row, per-field account of what would happen. The caller sends the same
 * raw rows back to POST /import to commit; nothing is held server-side
 * between the two calls.
 */
export async function previewImport(ctx: RequestContext, file: Buffer | undefined) {
  if (!file) throw bad("A spreadsheet file is required");
  const { rows, unknownHeaders, missingRequired } = parseWorkbook(file);
  if (!rows.length) {
    throw bad("No data rows found. Fill in the 'Employees' sheet and upload again.");
  }
  const results = validateRows(rows, await importContext(ctx, rows));
  const valid = results.filter((r) => !r.errors.length);
  return {
    summary: {
      total: results.length,
      valid: valid.length,
      invalid: results.length - valid.length,
      warnings: results.reduce((n, r) => n + r.warnings.length, 0),
    },
    unknownHeaders,
    missingRequired,
    rows: results,
    rawRows: rows,
  };
}

/**
 * An .xlsx of just the failed rows, with their problems spelled out, so HR can fix and
 * re-upload those.
 */
export async function importErrorReport(ctx: RequestContext, rawRows: unknown): Promise<Download> {
  const raw = requireRows(rawRows || []);
  const results = validateRows(raw, await importContext(ctx, raw));
  return { filename: "onboarding-errors.xlsx", contentType: XLSX, body: buildErrorReport(results, raw) };
}

/**
 * Commit a bulk onboarding.
 *
 * `rows` are the same raw objects the preview returned. They are re-validated here rather
 * than trusted: the preview is a client-facing courtesy, not an authorisation, and the
 * database may have changed between the two calls (someone else may have claimed an email
 * in the meantime).
 *
 * By default the import is all-or-nothing, if any row is invalid nothing is
 * written, so HR fixes the sheet rather than discovering a half-loaded roster.
 * Pass skipInvalid to import the good rows and report the rest.
 *
 * `committed: false` means the batch was refused and nothing was written.
 */
export async function commitImport(
  ctx: RequestContext,
  input: { rows?: unknown; sendInvite?: unknown; skipInvalid?: unknown },
) {
  const raw = requireRows(input.rows || []);
  if (raw.length > 2000) throw bad("Import is limited to 2000 rows per file. Split the sheet and upload again.");

  const sendInvite = input.sendInvite !== false; // default: invite each imported employee
  const skipInvalid = input.skipInvalid === true;

  const results = validateRows(raw, await importContext(ctx, raw));
  const invalid = results.filter((r) => r.errors.length);
  const valid = results.filter((r) => !r.errors.length);

  if (invalid.length && !skipInvalid) {
    return {
      committed: false as const,
      report: {
        imported: 0,
        // Report the count of problem rows here too, a refusal that doesn't say
        // how much was wrong is harder to act on than one that does.
        skipped: invalid.length,
        invited: 0,
        message: `${invalid.length} of ${results.length} rows have problems. Nothing was imported.`,
        errors: invalid.map((r) => ({ row: r.row, problems: r.errors })),
        rows: results,
      },
    };
  }
  if (!valid.length) throw bad("No valid rows to import.");

  const org = (await ctx.data.organizations.byId(ctx.orgId))!;
  const nextCode = employeeCodeGenerator(org, await ctx.data.employees.codes());

  const newDesigs = new Set<string>();
  const created: Array<{ emp: any; pwd: string; dept: any; managerEmail: string }> = [];
  // How many manager links were resolved against other rows in the same file.
  let linkedInFile = 0;

  await ctx.data.transaction(async (tx) => {
    for (const { value } of valid) {
      const v = value as NormalizedEmployee;
      const rules = employmentRules(v.employmentType);
      if (v.designation) newDesigs.add(v.designation);

      const emp = await tx.employees.create({
        departmentId: v.departmentId,
        officeId: v.officeId,
        code: v.code || nextCode(),
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        officialEmail: v.officialEmail || "",
        personalEmail: v.email,
        phone: v.phone,
        dob: v.dob,
        gender: v.gender,
        bloodGroup: v.bloodGroup,
        maritalStatus: v.maritalStatus,
        nationality: v.nationality,
        employmentType: v.employmentType,
        designation: v.designation,
        managerId: v.managerId,
        reportsTo: v.managerId,
        joiningDate: v.joiningDate,
        probationMonths: v.probationMonths,
        status: sendInvite ? "ONBOARDING" : "ACTIVE",
        salary: v.salary,
        bank: v.bank,
        pan: v.pan,
        uan: v.uan,
        esiNumber: v.esiNumber,
        // Stored in full, matching the self-onboarding route. Written only when the sheet
        // actually carried one, so an import without the column cannot blank an existing
        // number that somebody supplied through onboarding.
        kyc: v.aadhaar ? { aadhaar: v.aadhaar } : {},
        currentAddress: v.currentAddress,
        permanentAddress: v.permanentAddress,
        emergencyContact: v.emergencyContact,
        importedAt: new Date().toISOString(),
        importedBy: ctx.user.id,
      });

      // Off-payroll engagements (vendors/contractors) get a record but no
      // portal login, they are billed through the vendor module instead.
      let pwd = "";
      if (sendInvite && rules.onPayroll) {
        pwd = tempPassword();
        await tx.users.create({
          // Official address when the sheet supplied one, so imported staff sign in with
          // the same address as anyone hired through the form.
          email: resolveLoginEmail(emp),
          name: fullName(v),
          role: "EMPLOYEE",
          employeeId: emp.id,
          passwordHash: hashPassword(pwd),
        });
      }
      const dept = v.departmentId ? await tx.departments.byId(v.departmentId) : null;
      created.push({ emp, pwd, dept, managerEmail: v.managerEmail || "" });
    }

    // Second pass: link managers who are themselves rows in this same file.
    //
    // The validator resolves managerEmail against employees that existed BEFORE the
    // import, so importing a whole org in one sheet used to drop every internal manager
    // link (a warning, not an error, so it passed silently). Now that all rows have ids,
    // resolve the rest. Same transaction, so the hierarchy is never half-built.
    const idByEmail = new Map<string, string>();
    for (const { emp } of created) {
      for (const addr of [emp.email, emp.officialEmail, emp.personalEmail]) {
        if (addr) idByEmail.set(String(addr).toLowerCase(), emp.id);
      }
    }
    for (const row of created) {
      if (!row.managerEmail || row.emp.managerId) continue;
      const managerId = idByEmail.get(row.managerEmail.toLowerCase());
      if (managerId && managerId !== row.emp.id) {
        await tx.employees.update(row.emp.id, { managerId });
        linkedInFile++;
      }
    }
  });

  // Register any new designations into the org's managed list (picker suggestions).
  if (newDesigs.size) {
    const cur = Array.isArray(org.designations) ? org.designations : [];
    const lower = new Set(cur.map((d: string) => d.toLowerCase()));
    const merged = [...cur, ...[...newDesigs].filter((d) => !lower.has(d.toLowerCase()))].slice(0, 300);
    if (merged.length !== cur.length) await ctx.data.organizations.update(org.id, { designations: merged });
  }

  // Send onboarding emails AFTER the transaction commits (mail is best-effort and
  // must not roll back the import). Each gets the portal link + temp password.
  let invited = 0;
  if (sendInvite) {
    for (const { emp, pwd, dept } of created) {
      if (!pwd) continue;
      try {
        const mail = await sendTenantMail(org, onboardingEmail({ org, emp, dept, password: pwd, portalUrl: PORTAL_URL, to: joiningEmail(emp) }));
        if (mail && (mail.mode === "smtp" || mail.mode === "ses")) invited++;
      } catch (_e) { /* a single failed email shouldn't fail the import */ }
    }
  }

  await ctx.data.auditLog.create({
    action: "EMPLOYEE_IMPORT",
    userId: ctx.user.id,
    meta: { imported: created.length, skipped: invalid.length, invited, sendInvite, skipInvalid, managersLinkedInFile: linkedInFile },
  });

  return {
    committed: true as const,
    report: {
      imported: created.length,
      skipped: invalid.length,
      managersLinkedInFile: linkedInFile,
      invited,
      warnings: valid.reduce((n, r) => n + r.warnings.length, 0),
      errors: invalid.map((r) => ({ row: r.row, problems: r.errors })),
    },
  };
}
