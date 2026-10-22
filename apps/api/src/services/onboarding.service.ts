/**
 * Onboarding case operations that touch the database.
 *
 * onboarding-case.ts stays pure so it can be unit-tested without a connection; everything
 * that reads or writes lives here. The split matters most for commitCase(), which is the
 * one function in the whole feature allowed to write to `employees`.
 */
import crypto from "crypto";
import { randomUUID as uuid } from "crypto";
import { systemRepos } from "../repositories/base.repository";
import { bad, notFound } from "../core/util";
import { pickTemplate, templateGapReason, type Section } from "../domain/onboarding-template";
import { tempPassword } from "../core/util";
import { hashPassword } from "../middleware/auth";
import { generateOfficialEmail, generateEmployeeCode } from "../domain/onboard-util";
import { resolveSalary, salaryFromStructure } from "../domain/payroll/structure";
import { structureById, orgPayrollSettings } from "../domain/payroll/profile";
import {
  buildCaseData,
  buildEmployeePatch,
  checkCase,
  computeProgress,
  canSubmit,
  OPEN_STATUSES,
  type CaseStatus,
} from "../domain/onboarding-case";

/* ── Access tokens (pre-hire links) ─────────────────────────────────────────────────── */

// Same construction as tokens.ts: a 256-bit CSPRNG value, of which only the SHA-256 hash is
// stored. The raw value exists in the emailed link and nowhere else, so a database leak
// does not hand somebody a working link into another person's KYC and bank details.
const rawToken = () => crypto.randomBytes(32).toString("base64url");
export const hashCaseToken = (raw: string) => crypto.createHash("sha256").update(String(raw)).digest("hex");

/**
 * Resolve a pre-hire link to its case, across all orgs.
 *
 * Unauthenticated callers have no org context, so this uses systemRepos and then the caller
 * builds org-scoped repos from the row it gets back. Same shape as the existing public
 * onboarding route's inviteByToken().
 */
export async function caseByToken(raw: string) {
  if (!raw) throw notFound("This onboarding link is not valid.");
  const row = await systemRepos().onboardingCases.where({ tokenHash: hashCaseToken(raw) }).one();
  if (!row) throw notFound("This onboarding link is not valid.");
  return row;
}

/* ── Creation ───────────────────────────────────────────────────────────────────────── */

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** Resolve which template applies, or explain why none does. */
export async function resolveTemplate(repos: any, person: { employmentType?: string | null; departmentId?: string | null }) {
  const templates = await repos.onboardingTemplates.all();
  const picked = pickTemplate(templates, person);
  if (!picked) throw bad(templateGapReason(templates, person) as string);
  return picked;
}

export interface CreateCaseOpts {
  employee?: any;
  invite?: any;
  template?: any;
  dueAt?: Date | string | null;
  campaignId?: string | null;
  actorId: string;
  /**
   * Use this as the pre-hire link token instead of minting a fresh one.
   *
   * Lets a case open against a token that is ALREADY in somebody's inbox. Invites emailed
   * before this feature existed carry their own token, and those links have to keep working:
   * the case is created the first time the candidate opens one, keyed on the hash of the
   * token they are already holding.
   */
  rawToken?: string | null;
}

/**
 * Open a case for somebody.
 *
 * One function for both populations, because the difference between them is small and
 * keeping it in one place is what stops the two drifting: an existing employee is
 * identified by employeeId and signs in, a pre-hire is identified by a token in a link.
 * Everything after that, the snapshot, the deadline, the sections, is identical.
 *
 * Returns the created row plus `rawToken`, which is non-null ONLY for a pre-hire and is the
 * caller's only chance to read it.
 */
export async function createCase(repos: any, opts: CreateCaseOpts) {
  const { employee, invite, actorId } = opts;
  if (!employee && !invite) throw bad("A case needs either an employee or an invite");

  const person = employee
    ? { employmentType: employee.employmentType, departmentId: employee.departmentId }
    : { employmentType: invite.employmentType, departmentId: invite.departmentId };

  const template = opts.template || (await resolveTemplate(repos, person));

  // Reopening is not creating. Somebody who already has an open case must not be handed a
  // second one by a campaign that includes them, or their half-finished answers vanish.
  if (employee) {
    const existing = (await repos.onboardingCases.where({ employeeId: employee.id }).list())
      .find((c: any) => OPEN_STATUSES.includes(c.status) || c.status === "SUBMITTED");
    if (existing) return { case: existing, rawToken: null, reused: true };
  }

  const dueAt = opts.dueAt
    ? new Date(opts.dueAt)
    : addDays(new Date(), Number(template.dueDays ?? 7));

  const raw = employee ? null : opts.rawToken || rawToken();
  // Seed from whichever record we have. A pre-hire's invite already carries the name and
  // personal email HR typed, so the candidate is not asked to retype what was on the offer.
  const seed = employee || (invite
    ? { firstName: invite.firstName, lastName: invite.lastName, personalEmail: invite.personalEmail }
    : {});
  const data = buildCaseData(template, person, seed);

  const created = await repos.onboardingCases.insert({
    employeeId: employee?.id ?? null,
    inviteId: invite?.id ?? null,
    campaignId: opts.campaignId ?? null,
    templateId: template.id ?? null,
    status: "NOT_STARTED" as CaseStatus,
    dueAt,
    tokenHash: raw ? hashCaseToken(raw) : null,
    ...data,
    createdBy: actorId,
  });

  return { case: created, rawToken: raw, reused: false };
}

/* ── Decoration ─────────────────────────────────────────────────────────────────────── */

/**
 * A case plus everything a screen needs: per-section checks, progress and the submit
 * verdict. Computed rather than stored, so an edited template or a corrected validator
 * never leaves a stale "complete" badge behind.
 */
export function decorateCase(row: any, employee?: any) {
  const checks = checkCase(row, employee?.employmentType);
  return {
    ...row,
    checks,
    progress: computeProgress(checks),
    submit: canSubmit(checks),
    // Never leak the hash to a client; it is a credential-equivalent.
    tokenHash: undefined,
  };
}

/** Overdue is derived, not stored, so it cannot go stale between sweeps. */
export const isOverdue = (row: any, now = new Date()) =>
  !!row.dueAt && OPEN_STATUSES.includes(row.status) && new Date(row.dueAt) < now;

/* ── Commit ─────────────────────────────────────────────────────────────────────────── */

export interface CommitResult {
  employeeId: string;
  changes: { path: string; label: string; from: any; to: any }[];
  documentsVerified: number;
  assetsCreated: number;
  assetsAcknowledged: number;
  /** Set only when approval CREATED the employee (a pre-hire). Carries the one-time password. */
  created?: { employee: any; password: string; officialEmail: string } | null;
}

/**
 * Turn an approved pre-hire case into a real employee, inside the caller's transaction.
 *
 * A candidate has no `employees` row while they are filling the form in: that is the whole
 * point of staging, and it is what stops an unreviewed stranger appearing on the roster. The
 * record is created here, at approval, from the invite (which carries the terms HR set:
 * department, employment type, designation, joining date, reporting line, compensation) plus
 * the answers the candidate gave (which carry everything about the person).
 *
 * The split matters. Nothing the candidate typed can set their own pay, title or start date,
 * because those come from the invite and the `mapsTo` allowlist has no path to them.
 */
async function materializePreHire(tx: any, caseRow: any, actorId: string) {
  const invite = await tx.onboardingInvites.byId(caseRow.inviteId);
  if (!invite) throw notFound("The invite behind this form no longer exists.");
  if (invite.status === "COMPLETED" && invite.employeeId) {
    // Already materialized by an earlier approval; reuse rather than create a second person.
    const existing = await tx.employees.byId(invite.employeeId);
    if (existing) return { employee: existing, password: null, officialEmail: existing.officialEmail };
  }

  const org = await tx.organizations.byId(caseRow.orgId);
  // Name comes from the form when they gave one, falling back to what HR typed on the invite.
  const answers = buildEmployeePatch(caseRow, {}).patch;
  const firstName = String(answers.firstName || invite.firstName || "").trim();
  const lastName = String(answers.lastName ?? invite.lastName ?? "").trim();
  if (!firstName) throw bad("This form has no first name on it, so no employee record can be created.");

  const officialEmail = await generateOfficialEmail(org, firstName, lastName, systemRepos());
  const code = await generateEmployeeCode(org, tx);
  const password = tempPassword();
  // Compensation comes from the invite, never from the form: the mapsTo allowlist
  // has no path to salary, so nothing the candidate typed can reach this.
  const structure = await structureById(tx, org, invite.salaryStructureId);
  const resolvedPay = resolveSalary({
    structure,
    annualCtc: Number(invite.annualCtc) || null,
    // salaryBasic is a monthly BASIC on invites predating CTC entry, not a gross.
    legacyBasic: Number(invite.salaryBasic) || null,
    employmentType: invite.employmentType,
  });

  const employee = await tx.employees.insert({
    ...answers,
    firstName,
    lastName,
    departmentId: invite.departmentId || null,
    code,
    email: officialEmail,
    officialEmail,
    employmentType: invite.employmentType,
    designation: invite.designation || "",
    managerId: invite.reportsTo || null,
    reportsTo: invite.reportsTo || null,
    joiningDate: invite.joiningDate,
    status: "ACTIVE",
    // Same derivation as every other intake path, so a candidate's payslip matches a directly
    // onboarded colleague's on identical terms.
    // Same resolver as every other intake path, so a candidate's payslip matches a
    // directly onboarded colleague's on identical terms.
    salary: resolvedPay
      ? salaryFromStructure(resolvedPay, {
          currency: orgPayrollSettings(org).currency,
          annualCtc: Number(invite.annualCtc) || null,
          structureId: structure?.id ?? null,
        })
      : { basic: 0, hra: 0, allowances: 0, deductions: 0 },
  });

  await tx.users.insert({
    email: officialEmail,
    name: `${firstName} ${lastName}`.trim(),
    role: "EMPLOYEE",
    employeeId: employee.id,
    passwordHash: hashPassword(password),
    status: "ACTIVE",
  });
  await tx.onboardingInvites.update(invite.id, {
    status: "COMPLETED",
    employeeId: employee.id,
    submittedAt: caseRow.submittedAt || new Date().toISOString(),
  });
  await tx.onboardingCases.update(caseRow.id, { employeeId: employee.id });

  // Anything HR staged against the case (the day-one laptop) becomes theirs now that they
  // exist. Done here rather than left dangling, or the asset register would hold rows owned
  // by nobody the moment the case they point at is cleaned up.
  // Filtered in JS: caseId is a jsonb field on assets, not a hot column.
  for (const a of (await tx.assets.all()).filter((x: any) => x.caseId === caseRow.id)) {
    if (a.employeeId) continue;
    await tx.assets.update(a.id, { employeeId: employee.id });
  }
  await tx.auditLog.insert({
    action: "ONBOARDING_EMPLOYEE_CREATED",
    userId: actorId,
    employeeId: employee.id,
    meta: { caseId: caseRow.id, inviteId: invite.id, code, officialEmail },
  });

  return { employee, password, officialEmail };
}

/**
 * Approve a case: write the staged answers across to the employee record.
 *
 * The ONLY path in this feature that writes to `employees`. Everything happens in one
 * transaction, so a failure part-way cannot leave a person with a new bank account and no
 * verified proof of it.
 *
 * Idempotent by construction rather than by a guard: the patch is computed as a diff
 * against the employee's current values, so replaying an approval finds nothing to change.
 */
export async function commitCase(repos: any, caseRow: any, actorId: string): Promise<CommitResult> {
  if (!caseRow.employeeId && !caseRow.inviteId) throw bad("This case has no employee record yet.");

  return repos.transaction(async (tx: any) => {
    // A pre-hire becomes an employee HERE, in the same transaction as the rest of the commit,
    // so a failure part-way cannot leave a half-created person on the roster with unverified
    // documents attached to them.
    const created = caseRow.employeeId ? null : await materializePreHire(tx, caseRow, actorId);
    const employeeId = caseRow.employeeId || created!.employee.id;

    const employee = await tx.employees.byId(employeeId);
    if (!employee) throw notFound("Employee not found");

    const { patch, changes } = buildEmployeePatch(caseRow, employee);
    if (Object.keys(patch).length) await tx.employees.update(employeeId, patch);

    // Documents the person uploaded become verified: HR approving the section IS the
    // verification, and leaving them unverified would show the same documents as
    // outstanding on the KYC checklist immediately after they were accepted.
    let documentsVerified = 0;
    for (const d of caseRow.documents || []) {
      if (!d.documentId) continue;
      const doc = await tx.documents.byId(d.documentId);
      if (!doc || doc.verified) continue;
      await tx.documents.update(d.documentId, {
        employeeId,
        verified: true,
        verifiedBy: actorId,
        verifiedAt: new Date().toISOString(),
        verifyNote: "Verified as part of onboarding",
      });
      documentsVerified++;
    }

    // Declared assets enter the register only now. Rejected ones are skipped, so a refusal
    // during review is final rather than something the commit quietly undoes.
    let assetsCreated = 0;
    for (const a of caseRow.assets?.declared || []) {
      if (a.status !== "APPROVED") continue;
      await tx.assets.insert({
        employeeId,
        category: a.category || "OTHER",
        name: a.name || "Asset",
        serial: a.serial || "",
        condition: a.condition || "Good",
        status: "IN_USE",
        assignedAt: a.receivedOn || new Date().toISOString(),
        acknowledgedAt: new Date().toISOString(),
        returnedAt: null,
        notes: a.note || "",
        declaredVia: "ONBOARDING",
        caseId: caseRow.id,
      });
      assetsCreated++;
    }

    // Acknowledged assets were already on the register; approval is what moves them from
    // "we handed this over" to "they confirmed holding it".
    let assetsAcknowledged = 0;
    for (const a of caseRow.assets?.acknowledged || []) {
      if (!a.assetId || a.received === false) continue;
      const asset = await tx.assets.byId(a.assetId);
      if (!asset || asset.status !== "PROVISIONED") continue;
      await tx.assets.update(a.assetId, {
        status: "IN_USE",
        acknowledgedAt: new Date().toISOString(),
        condition: a.condition || asset.condition,
      });
      assetsAcknowledged++;
    }

    // A pre-hire is only a real employee once their form is accepted.
    if (employee.status === "ONBOARDING") await tx.employees.update(employeeId, { status: "ACTIVE" });

    await tx.onboardingCases.update(caseRow.id, {
      status: "APPROVED" as CaseStatus,
      approvedAt: new Date().toISOString(),
      approvedBy: actorId,
      commit: { at: new Date().toISOString(), by: actorId, changes },
    });

    await tx.auditLog.insert({
      action: "ONBOARDING_APPROVED",
      userId: actorId,
      employeeId,
      meta: {
        caseId: caseRow.id,
        // Field NAMES only. The values are the PAN and bank account themselves, and an
        // audit row is read far more widely than the employee record it describes.
        changed: changes.map((c) => c.path),
        documentsVerified,
        assetsCreated,
        assetsAcknowledged,
      },
    });

    return { employeeId, changes, documentsVerified, assetsCreated, assetsAcknowledged, created };
  });
}

/* ── Section review ─────────────────────────────────────────────────────────────────── */

/** Are all the sections that need a verdict approved? */
export function allSectionsApproved(caseRow: any): boolean {
  const sections: Section[] = caseRow.templateSnapshot || [];
  if (!sections.length) return false;
  return sections.every((s) => caseRow.sections?.[s.key]?.status === "APPROVED");
}

/** Record a reviewer's verdict on one section, returning the updated section state. */
export function reviewSection(
  state: any,
  verdict: "APPROVED" | "CHANGES_REQUESTED",
  actorId: string,
  note = ""
) {
  const now = new Date().toISOString();
  return {
    ...(state || { values: {} }),
    status: verdict,
    reviewedBy: actorId,
    reviewedAt: now,
    note,
    history: [...(state?.history || []), { at: now, by: actorId, action: verdict, note }],
  };
}

export { uuid };

/* ── Campaign audience ──────────────────────────────────────────────────────────────── */

/**
 * Who a campaign's audience rule actually resolves to, right now.
 *
 * Lives here rather than in jobs/handlers.ts because both the launch handler AND the
 * campaign routes need it. A route importing the handlers module would drag that module's
 * registration side effects into the route graph, and the resulting import cycle silently
 * left four of the five handlers unregistered.
 */
export async function resolveAudience(r: any, audience: any = {}) {
  const mode = String(audience.mode || "ALL").toUpperCase();
  let employees = await r.employees.all();

  // Never chase somebody who has left, and never a vendor account.
  employees = employees.filter((e: any) => !["EXITED", "ABSCONDING"].includes(e.status));

  if (mode === "DEPARTMENT") {
    const ids = new Set(audience.departmentIds || []);
    employees = employees.filter((e: any) => ids.has(e.departmentId));
  } else if (mode === "EMPLOYMENT_TYPE") {
    const types = new Set(audience.employmentTypes || []);
    employees = employees.filter((e: any) => types.has(e.employmentType));
  } else if (mode === "SELECTED") {
    const ids = new Set(audience.employeeIds || []);
    employees = employees.filter((e: any) => ids.has(e.id));
  } else if (mode === "INCOMPLETE") {
    // Anyone missing something payroll or statutory filing needs. The cheapest useful
    // definition, rather than opening a case for the entire company to collect four fields.
    employees = employees.filter((e: any) => !e.kyc?.pan || !e.bank?.account || !e.dob || !e.emergencyContact?.phone);
  }

  return employees;
}
