/**
 * The employee roster: listing and reading records, hiring (or reactivating) someone,
 * editing one record or many, and removing people (archive by default, purge on request).
 *
 * Portal access lives in employee-access.service.ts and spreadsheet onboarding in
 * employee-import.service.ts.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden, todayStr, tempPassword, HttpError } from "../core/util";
import { PORTAL_URL } from "../core/config";
import { isStaff, hashPassword } from "../middleware/auth";
import { resolveSalary, salaryFromStructure } from "../domain/payroll/structure";
import { structureById, orgPayrollSettings, resolveRuleset } from "../domain/payroll/profile";
import { ctcOptionsFor, normaliseStatutory } from "./salary-structure.service";
import { assertEmployeeNotLastAdmin, staffRolesOfEmployee } from "./org-guard.service";
import { normaliseEmail, assertEmail, assertEmailAvailable, resolveLoginEmail, joiningEmail } from "./identity.service";
import { employeeInScopeOr404, resolvePortalRole } from "./employee-access.service";
import { sendTenantMail } from "../integrations/mail/mailer";
import { onboardingEmail } from "../integrations/mail/templates";
import { generateEmployeeCode } from "../domain/onboard-util";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_VALUES, CURRENT_EMPLOYMENT_TYPES } from "../domain/employment";
import { managerOf, reassignReportsOnExit } from "../domain/manager";
import { revokeForEmployee } from "../jobs/access-sweep";
import { createRepositories } from "../repositories";
import { systemRepos } from "../repositories/base.repository";
import { fullName } from "../domain/person";

const TYPES = EMPLOYMENT_TYPE_VALUES;
/** Platform-wide repositories, for the one check that must see every workspace: login emails. */
const platform = () => createRepositories(systemRepos());

/* ── Roster views ─────────────────────────────────────────────────────────── */

async function deptMap(ctx: RequestContext) {
  const d = await ctx.data.departments.all();
  return Object.fromEntries(d.map((x) => [x.id, x]));
}

/**
 * Attach the person's portal role to their roster row.
 *
 * `hasLogin` alone could not answer "is this person an admin", so the roster gave no way
 * to see who administers the workspace, and Settings > Users was the only place roles were
 * visible: a list of email addresses disconnected from the people they belong to.
 */
const loginView = (u) => (u
  ? {
      portalRole: u.role, portalRoleKeys: Array.isArray(u.roleKeys) ? u.roleKeys : [],
      portalStatus: u.status || "ACTIVE", userId: u.id,
      // The address this person actually signs in with, which may differ from any address
      // on the employee record if HR has not switched it over yet.
      loginEmail: u.email,
    }
  : { portalRole: null, portalRoleKeys: [], portalStatus: null, userId: null, loginEmail: null });

const enrich = (e, dm, um) => ({
  ...e,
  _departmentName: e.departmentId && dm[e.departmentId] ? dm[e.departmentId].name : null,
  department: e.departmentId && dm[e.departmentId] ? dm[e.departmentId].name : "-",
  hasLogin: !!um[e.id],
  ...loginView(um[e.id]),
});

async function enrichOne(ctx: RequestContext, e) {
  const dept = e.departmentId ? await ctx.data.departments.byId(e.departmentId) : null;
  const user = await ctx.data.users.findByEmployeeId(e.id);
  return { ...e, _departmentName: dept ? dept.name : null, department: dept ? dept.name : "-", hasLogin: !!user, ...loginView(user) };
}

/** Staff: all (within their scope); an employee: only themselves. Filters by department, type, status and text. */
export async function listEmployees(
  ctx: RequestContext,
  filters: { departmentId?: unknown; type?: unknown; q?: unknown; status?: unknown },
) {
  let list = await ctx.data.employees.all();
  if (!isStaff(ctx.user)) list = list.filter((e) => e.id === ctx.user.employeeId);
  // Scoped staff only see employees within their assigned departments/offices.
  list = list.filter((e) => ctx.inScope(e));
  const { departmentId, type, q, status } = filters;
  if (departmentId) list = list.filter((e) => e.departmentId === departmentId);
  if (type) list = list.filter((e) => e.employmentType === type);
  if (status) list = list.filter((e) => e.status === status);
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter((e) => `${fullName(e)} ${e.email} ${e.code} ${e.designation}`.toLowerCase().includes(s));
  }
  const dm = await deptMap(ctx);
  const um = await ctx.data.users.byEmployee();
  return list.map((e) => enrich(e, dm, um));
}

/** Direct reports of the signed-in employee (manager view), with their pending approvals. */
export async function myTeam(ctx: RequestContext) {
  if (!ctx.user.employeeId) return [];
  const reports = await ctx.data.employees.activeReportsOf(ctx.user.employeeId);
  const dm = await deptMap(ctx);
  const um = await ctx.data.users.byEmployee();
  const leaves = await ctx.data.leaveRequests.find((l) => l.status === "PENDING");
  const reimbs = await ctx.data.reimbursements.find((r) => r.status === "PENDING");
  return reports.map((e) => ({
    ...enrich(e, dm, um),
    pendingLeave: leaves.filter((l) => l.employeeId === e.id).length,
    pendingReimb: reimbs.filter((r) => r.employeeId === e.id).length,
  }));
}

/** The employment-type catalogue, with statutory rules. */
export function employmentTypes() {
  return { all: EMPLOYMENT_TYPES, current: CURRENT_EMPLOYMENT_TYPES };
}

export async function getEmployee(ctx: RequestContext, id: string) {
  const e = await ctx.data.employees.byId(id);
  if (!e) throw notFound("Employee not found");
  if (!isStaff(ctx.user) && e.id !== ctx.user.employeeId) throw forbidden();
  // A scoped admin may only view employees within their scope (self always ok).
  if (e.id !== ctx.user.employeeId && !ctx.inScope(e)) throw forbidden("Outside your assigned scope");
  return enrichOne(ctx, e);
}

/* ── Hiring ───────────────────────────────────────────────────────────────── */

/**
 * Onboard a new employee.
 * Input: { firstName, lastName, email, phone, departmentId, employmentType,
 *          designation, joiningDate, managerId, salary{basic,hra,allowances,deductions},
 *          bank, sendInvite(bool) }
 *
 * Returns `reactivated: true` (a 200 rather than a 201) when the address belonged to an
 * exited record that was brought back instead.
 */
export async function createEmployee(ctx: RequestContext, b: any) {
  if (!b.firstName || !b.email) throw bad("First name and email are required");
  if (!TYPES.includes(b.employmentType)) throw bad(`employmentType must be one of: ${TYPES.join(", ")}`);
  const email = String(b.email).toLowerCase().trim();

  /*
   * Re-adding somebody who was deleted.
   *
   * A delete here is a SOFT delete: the employee goes to EXITED but their login row stays,
   * so this check ("is the email taken") fired on a person who no longer appears anywhere
   * in the UI. HR saw "A user/employee with that email already exists" about someone they
   * had just removed, with no way forward: the roster does not list exited staff, so there
   * was nothing to click.
   *
   * The email IS the login identity and has to stay unique, so the fix is not to drop the
   * constraint but to recognise this case and offer the correct action: bring the existing
   * record back. Reactivating also keeps their code, documents, payslips and history
   * attached, which creating a second record would silently orphan.
   */
  const existingUser = await platform().users.findByEmail(email);
  const existingEmp = await ctx.data.employees.findByEmail(email);

  if (existingEmp && existingEmp.status === "EXITED") {
    if (!b.reactivate) {
      throw new HttpError(409, JSON.stringify({
        code: "EMPLOYEE_EXITED",
        message: fullName(existingEmp) +
          ` (${existingEmp.code}) already exists with this email but was exited. Reactivate them to keep their history, or use a different email.`,
        employeeId: existingEmp.id,
        employeeCode: existingEmp.code,
      }));
    }
    // Reactivate in place: apply the submitted details over the existing record.
    const patch: any = { status: "ACTIVE" };
    for (const k of ["firstName", "lastName", "phone", "designation", "departmentId", "employmentType", "joiningDate", "officeId"]) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    if (b.salary) patch.salary = { ...(existingEmp.salary || {}), ...b.salary };
    const revived = await ctx.data.employees.update(existingEmp.id, patch);
    // Their login was disabled on delete; let them back in.
    if (existingUser) await platform().users.update(existingUser.id, { status: "ACTIVE" });
    await ctx.data.auditLog.create({
      action: "EMPLOYEE_REACTIVATED",
      userId: ctx.user.id,
      meta: { employeeId: existingEmp.id, code: existingEmp.code, email },
    });
    return { employee: await enrichOne(ctx, revived), reactivated: true as const };
  }

  /*
   * The email is taken by a LOGIN rather than by anyone on the roster.
   *
   * "A user/employee with that email already exists" was a dead end: staff logins created
   * from Settings > Users have no employee record, so they never appear on the Employees
   * page. HR searched the roster, found nothing, and had no way to tell what was blocking
   * them. Reported from production for a COO who already had an admin login.
   *
   * Sign-in is by email with no workspace picker, so the address has to stay unique across
   * the whole system. That means the answer differs by case, and each case gets its own
   * message rather than one generic refusal.
   */
  if (existingUser) {
    const sameOrg = existingUser.orgId === ctx.orgId;
    const linkedEmp = existingUser.employeeId
      ? await ctx.data.employees.byId(existingUser.employeeId)
      : null;

    if (sameOrg && !linkedEmp) {
      // A login here with no employee record attached (a staff invite, or one whose
      // employee row was purged). Give it an employee record instead of refusing: the
      // person keeps ONE identity and one set of credentials.
      if (!b.linkExistingUser) {
        throw new HttpError(409, JSON.stringify({
          code: "USER_WITHOUT_EMPLOYEE",
          message:
            `${existingUser.email} already has a login in this workspace (role ${existingUser.role})` +
            `, but no employee record. Create the employee record and attach it to that existing login, ` +
            `or use a different email.`,
          userId: existingUser.id,
          role: existingUser.role,
        }));
      }
      // fall through: create the employee, then link it to this login below.
    } else if (!sameOrg) {
      throw bad(
        "That email already has a login in another workspace. Sign-in is by email address, " +
        "so it can only belong to one workspace. Use a different address for this person."
      );
    } else {
      throw bad("A user/employee with that email already exists");
    }
  } else if (existingEmp) {
    throw bad("A user/employee with that email already exists");
  }
  if (b.departmentId && !(await ctx.data.departments.byId(b.departmentId)))
    throw bad("Unknown department");

  const org = (await ctx.data.organizations.byId(ctx.orgId))!;
  const code = b.code || (await generateEmployeeCode(org, ctx.repos));

  /*
   * Two addresses, one identity.
   *
   * `email` remains the record's primary contact address (it is a hot column, indexed, and
   * every existing query uses it). `personalEmail` mirrors it, and `officialEmail` is the
   * work address when the organisation issues one. The login is the official address if
   * present, because that is what people expect to sign in with, while the joining invite
   * still goes to the personal inbox: a new joiner cannot read a company mailbox they have
   * not been given yet.
   */
  const officialEmail = normaliseEmail(b.officialEmail);
  if (officialEmail) {
    assertEmail(officialEmail, "official email");
    await assertEmailAvailable(ctx.repos, officialEmail);
  }

  const basic = Number(b.salary?.basic || 0);

  // Accepts, in order: an explicit breakup, an annual CTC run through the org's
  // structure, or a monthly basic/gross.
  const wantsCtc = Number(b.salary?.annualCtc) > 0;
  const statutory = normaliseStatutory(b.salary?.statutory);
  const structure = wantsCtc ? await structureById(ctx.repos, org, b.salary?.structureId) : null;
  const resolved = resolveSalary({
    structure,
    annualCtc: Number(b.salary?.annualCtc) || null,
    monthlyGross: basic || null,
    explicit: b.salary?.hra || b.salary?.allowances ? b.salary : null,
    employmentType: b.employmentType,
    // The same CTC convention the editor's preview used, so the breakup HR saw
    // when adding the person is the one that gets stored.
    ctc: wantsCtc ? ctcOptionsFor(org, await resolveRuleset(ctx.repos, org), statutory) : undefined,
  });
  const resolvedSalary: any = resolved
    ? salaryFromStructure(resolved, {
        currency: orgPayrollSettings(org).currency,
        annualCtc: Number(b.salary?.annualCtc) || null,
        structureId: structure?.id ?? null,
      })
    : { basic: 0, hra: 0, allowances: 0, deductions: 0 };
  if (statutory) resolvedSalary.statutory = statutory;

  const empDoc = {
    departmentId: b.departmentId || null,
    code,
    firstName: b.firstName,
    lastName: b.lastName || "",
    email,
    personalEmail: email,
    officialEmail,
    phone: b.phone || "",
    employmentType: b.employmentType,
    designation: b.designation || "",
    managerId: b.managerId || null,
    joiningDate: b.joiningDate || todayStr(),
    status: b.sendInvite ? "ONBOARDING" : "ACTIVE",
    // One derivation for every intake path. The old inline basic*0.4/0.2/0.06
    // disagreed with defaultSalaryBreakdown(), ignored employment type (so an
    // intern's stipend was split into HRA), and wrote a "deduction" that looked
    // like PF without being computed like PF.
    salary: resolvedSalary,
    bank: b.bank || { account: "", ifsc: "" },
  };

  let emp;
  let invite: any = null;
  // Linking an existing login: the person already has credentials, so create the employee
  // record and attach it. Never mint a second login for the same address.
  const linkingUser = existingUser && existingUser.orgId === ctx.orgId && !existingUser.employeeId && b.linkExistingUser
    ? existingUser
    : null;

  if (linkingUser) {
    emp = await ctx.data.employees.create(empDoc);
    await ctx.data.users.update(linkingUser.id, { employeeId: emp.id });
    await ctx.data.auditLog.create({
      action: "EMPLOYEE_LINKED_TO_EXISTING_USER",
      userId: ctx.user.id,
      meta: { employeeId: emp.id, userId: linkingUser.id, email, role: linkingUser.role },
    });
  } else if (b.sendInvite) {
    const pwd = tempPassword();
    // Portal role is chosen on the employee form, so HR can hire an HR manager or an
    // administrator in one step instead of creating the person and then separately
    // inviting the same address from Settings.
    const portalRole = await resolvePortalRole(ctx, b.portalRole);
    emp = await ctx.data.transaction(async (tx) => {
      const created = await tx.employees.create(empDoc);
      await tx.users.create({
        // The work address when there is one, so they sign in with what they expect.
        email: resolveLoginEmail(created),
        name: fullName(created),
        role: portalRole,
        employeeId: created.id,
        passwordHash: hashPassword(pwd),
      });
      return created;
    });
    const dept = emp.departmentId ? await ctx.data.departments.byId(emp.departmentId) : null;
    // Delivered to the personal inbox: the work mailbox is not reachable on day one.
    invite = await sendTenantMail(org, onboardingEmail({ org, emp, dept, password: pwd, portalUrl: PORTAL_URL, to: joiningEmail(emp) }));
    await ctx.data.auditLog.create({ action: "ONBOARD_EMAIL", employeeId: emp.id, userId: ctx.user.id, meta: invite });
  } else {
    emp = await ctx.data.employees.create(empDoc);
  }

  // Register a newly-typed designation into the org's managed list so it's
  // offered as a suggestion next time (the onboarding field is pick-or-type).
  const desig = String(empDoc.designation || "").trim();
  if (desig) {
    const current = Array.isArray(org.designations) ? org.designations : [];
    if (!current.some((d) => String(d).toLowerCase() === desig.toLowerCase())) {
      await ctx.data.organizations.update(org.id, { designations: [...current, desig].slice(0, 300) });
    }
  }

  return { employee: await enrichOne(ctx, emp), invite, linkedToExistingUser: !!linkingUser };
}

/* ── Editing ──────────────────────────────────────────────────────────────── */

/**
 * Refuse a status edit that would exit somebody.
 *
 * Writing EXITED straight onto the record skipped everything leaving involves: the login
 * stayed live, their reports were orphaned off the org chart, and nothing was audited. The
 * exit flow (a separation, or archiving) does all of that, so that is the only way out.
 * Re-sending EXITED for someone already exited changes nothing and is allowed.
 */
function assertNotExitingByEdit(current: any, nextStatus: unknown) {
  if (nextStatus === "EXITED" && current.status !== "EXITED") {
    throw bad("Status EXITED cannot be set by editing. Use the separation flow, or archive the employee, so their login is revoked and their reports are reassigned.");
  }
}

/** Validate, normalise and de-duplicate an official/personal address edit. Empty clears it. */
async function checkedEmail(ctx: RequestContext, employeeId: string, raw: unknown, label: string) {
  const value = normaliseEmail(raw);
  if (value) {
    assertEmail(value, label);
    await assertEmailAvailable(ctx.repos, value, { employeeId });
  }
  return value;
}

const EMAIL_FIELDS = [["officialEmail", "official email"], ["personalEmail", "personal email"]] as const;

export async function updateEmployee(ctx: RequestContext, id: string, b: any) {
  const e = await employeeInScopeOr404(ctx, id);
  assertNotExitingByEdit(e, b.status);
  const patch: any = {};
  const simple = [
    "firstName", "lastName", "phone", "designation", "departmentId", "managerId", "reportsTo",
    "joiningDate", "status", "personalEmail", "officialEmail", "dob", "gender", "bloodGroup",
    "maritalStatus", "nationality", "currentAddress", "permanentAddress", "education", "experience",
    "officeId", "uan", "pan", "esiNumber",
  ];
  for (const k of simple) if (b[k] !== undefined) patch[k] = b[k];

  /*
   * Addresses are validated and de-duplicated here rather than only on create.
   *
   * They were previously in the allow-list and written through untouched, so an edit could
   * introduce an invalid address, or hand one person an address already on somebody else's
   * record, and the clash would only surface later as a failed login or a misdirected letter.
   */
  for (const [field, label] of EMAIL_FIELDS) {
    if (b[field] === undefined) continue;
    patch[field] = await checkedEmail(ctx, e.id, b[field], label);
  }

  if (b.employmentType && TYPES.includes(b.employmentType)) patch.employmentType = b.employmentType;
  /*
   * Contractual notice period, in days.
   *
   * A term of the individual contract, not an org-wide setting: a senior hire on
   * 90 days and a probationer on 7 work at the same company. Left unset the exit
   * flow falls back to the organisation's default. An empty string clears it back
   * to that default rather than storing 0, which would mean "no notice at all".
   */
  if (b.noticePeriodDays !== undefined) {
    const n = Number(b.noticePeriodDays);
    patch.noticePeriodDays =
      b.noticePeriodDays === "" || b.noticePeriodDays === null || !Number.isFinite(n) || n < 0
        ? null
        : Math.min(Math.round(n), 365);
  }
  if (b.salary) patch.salary = { ...e.salary, ...b.salary };
  if (b.bank) patch.bank = { ...(e.bank || {}), ...b.bank };
  if (b.socials) patch.socials = { ...(e.socials || {}), ...b.socials };
  if (b.emergencyContact) patch.emergencyContact = { ...(e.emergencyContact || {}), ...b.emergencyContact };
  /*
   * Aadhaar is stored in FULL.
   *
   * It used to be masked here to last-four while the self-onboarding route stored the whole
   * number, so the same field meant different things depending on which door the employee came
   * through, and neither HR nor payroll could tell which. PF and ESIC filing need the whole
   * twelve digits, so a masked value is not a safer version of the record, it is an unusable
   * one that sends somebody to ask for the number again by email.
   *
   * The obligation this moves rather than removes is access control: `documents.manage` plus
   * the existing department/office scoping gate who can read it, and AI_DOC_EXCLUDE still
   * stops an Aadhaar image being sent to a model.
   */
  if (b.kyc) patch.kyc = { ...(e.kyc || {}), ...b.kyc };
  const updated = await ctx.data.employees.update(e.id, patch);
  return enrichOne(ctx, updated);
}

/** Fields the grid may edit. Deliberately excludes salary and bank: compensation and
 *  bank details do not belong in a fast multi-row editor. Mirrors the PUT allow-list. */
const BULK_EDITABLE = [
  "firstName", "lastName", "phone", "designation", "departmentId", "managerId", "reportsTo",
  "joiningDate", "status", "personalEmail", "officialEmail", "employmentType", "officeId",
];

/**
 * Edit many records at once. Input: [{ id, ...fields }].
 *
 * Editing 100 people meant opening 100 modals. The spreadsheet importer cannot help:
 * it is insert-only and actively rejects rows whose email already exists, so there was
 * no update-by-import path either.
 *
 * Per-row rather than transactional on purpose: the grid reports which rows saved and
 * which failed, and one bad cell must not silently discard 99 good edits. Scope and
 * validation are re-checked per row, because a bulk endpoint is exactly where a missing
 * per-row check turns into a cross-scope write.
 */
export async function bulkUpdateEmployees(ctx: RequestContext, rawUpdates: unknown) {
  const updates = Array.isArray(rawUpdates) ? rawUpdates : null;
  if (!updates) throw bad("Provide updates: [{ id, ...fields }]");
  if (!updates.length) throw bad("Provide at least one update");
  if (updates.length > 500) throw bad("Up to 500 rows per request");

  const [depts, emps] = await Promise.all([ctx.data.departments.all(), ctx.data.employees.all()]);
  const deptIds = new Set<string>(depts.map((d) => String(d.id)));
  const empById = new Map<string, any>(emps.map((e) => [String(e.id), e]));

  const updated: any[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const row of updates) {
    const id = String(row?.id || "");
    const e = empById.get(id);
    try {
      if (!e) throw new Error("Employee not found");
      if (!ctx.inScope(e)) throw new Error("Outside your assigned scope");

      const patch: any = {};
      for (const k of BULK_EDITABLE) if (row[k] !== undefined) patch[k] = row[k];

      assertNotExitingByEdit(e, patch.status);
      // Same address rules as PUT /:id. Rows save one at a time, so a later row reusing an
      // address an earlier row just took fails here as a duplicate too.
      for (const [field, label] of EMAIL_FIELDS) {
        if (patch[field] !== undefined) patch[field] = await checkedEmail(ctx, id, patch[field], label);
      }
      if (patch.employmentType !== undefined && !TYPES.includes(patch.employmentType)) {
        throw new Error(`employmentType must be one of: ${TYPES.join(", ")}`);
      }
      if (patch.departmentId) {
        if (!deptIds.has(String(patch.departmentId))) throw new Error("Unknown department");
      }
      // Reporting line: reject unknown managers, self-reference and cycles here rather
      // than letting the org chart discover them later.
      const nextManager = patch.managerId !== undefined ? patch.managerId : patch.reportsTo;
      if (nextManager) {
        if (!empById.has(String(nextManager))) throw new Error("Unknown manager");
        if (String(nextManager) === id) throw new Error("An employee cannot report to themselves");
        let walk = empById.get(String(nextManager));
        const seen = new Set<string>([id]);
        while (walk) {
          if (seen.has(String(walk.id))) throw new Error("That change would create a reporting cycle");
          seen.add(String(walk.id));
          const up = managerOf(walk);
          walk = up ? empById.get(String(up)) : null;
        }
      }
      if (!Object.keys(patch).length) throw new Error("No editable fields supplied");

      const saved = await ctx.data.employees.update(id, patch);
      // Keep the in-memory copy current so later rows in the same batch validate
      // against what this request has already written, not a stale snapshot.
      empById.set(id, saved);
      updated.push(saved);
    } catch (err) {
      failed.push({ id, error: (err as Error).message });
    }
  }

  if (updated.length) {
    await ctx.data.auditLog.create({
      action: "EMPLOYEES_BULK_UPDATE",
      userId: ctx.user.id,
      meta: { updated: updated.length, failed: failed.length, ids: updated.map((u) => u.id) },
    });
  }

  return { updated: await Promise.all(updated.map((u) => enrichOne(ctx, u))), failed, savedCount: updated.length };
}

/* ── Removal ──────────────────────────────────────────────────────────────── */

/**
 * Records that belong to an employee and would be destroyed by a permanent delete.
 * `statutory` marks the ones an employer is generally required to retain, which is what
 * makes archiving the right default rather than a softer-sounding synonym for deletion.
 */
const DEPENDENTS: Array<{ repo: string; label: string; statutory?: boolean }> = [
  { repo: "payslips", label: "payslips", statutory: true },
  { repo: "attendance", label: "attendance records", statutory: true },
  { repo: "leaveRequests", label: "leave requests" },
  { repo: "leaveBalances", label: "leave balances" },
  { repo: "documents", label: "documents and issued letters", statutory: true },
  { repo: "separations", label: "separation records", statutory: true },
  { repo: "reimbursements", label: "reimbursements", statutory: true },
  { repo: "appraisals", label: "appraisals" },
  { repo: "pips", label: "performance plans" },
  { repo: "assets", label: "assigned assets" },
  { repo: "perks", label: "perks" },
  { repo: "workLogs", label: "work logs" },
  { repo: "familyBenefits", label: "family benefits" },
  { repo: "wellbeing", label: "well-being entries" },
  { repo: "aiTokens", label: "AI allowances" },
  { repo: "onboardingInvites", label: "onboarding invites" },
];

/**
 * What removing this person would actually cost, so the choice between archiving and
 * destroying is made with the numbers in view rather than behind a one-line confirm.
 */
export async function deleteImpact(ctx: RequestContext, id: string) {
  const e = await employeeInScopeOr404(ctx, id);

  const counts: any[] = [];
  for (const d of DEPENDENTS) {
    const n = await ctx.data[d.repo].where({ employeeId: e.id }).count();
    if (n > 0) counts.push({ ...d, count: n });
  }
  const reports = await ctx.data.employees.activeReportsOf(e.id);
  const staffRoles = await staffRolesOfEmployee(ctx.repos, e.id);
  const user = await ctx.data.users.findByEmployeeId(e.id);

  return {
    employeeId: e.id,
    code: e.code,
    name: fullName(e),
    status: e.status,
    alreadyArchived: e.status === "EXITED",
    records: counts,
    totalRecords: counts.reduce((n, c) => n + c.count, 0),
    hasStatutoryRecords: counts.some((c) => c.statutory),
    directReports: reports.map((r) => ({ id: r.id, name: fullName(r), code: r.code })),
    portalRoles: staffRoles,
    loginEmail: user ? user.email : null,
  };
}

/** Archive by default; `hard` purges. Both confirmations are echoed back by the caller. */
export async function deleteEmployee(
  ctx: RequestContext,
  id: string,
  opts: { hard: boolean; confirmStaff: boolean; confirm: unknown },
) {
  const e = await employeeInScopeOr404(ctx, id);

  /*
   * Administrators are on the roster now, so this route can reach one.
   *
   * Both branches below destroy access: the hard delete removes the linked user row
   * outright, and the soft delete revokes the login via revokeForEmployee(). Removing the
   * last administrator either way leaves the workspace with nobody who can administer it.
   * This is the guard that replaces the old "admins may not be employees" rule.
   */
  await assertEmployeeNotLastAdmin(ctx.repos, e.id, "remove them from the roster");

  /*
   * Deleting a colleague who also holds staff access is a bigger action than deleting a
   * regular employee: it destroys (or disables) an HR or admin login as a side effect,
   * which is not something the roster screen implies. Make it deliberate.
   */
  const staffRoles = await staffRolesOfEmployee(ctx.repos, e.id);
  if (staffRoles.length && !opts.confirmStaff) {
    throw new HttpError(409, JSON.stringify({
      code: "EMPLOYEE_HAS_STAFF_ACCESS",
      message:
        fullName(e) +
        ` also has portal access (${staffRoles.join(", ")}). Removing them will ` +
        (opts.hard ? "delete that login and all their records." : "disable that login.") +
        ` Confirm to continue.`,
      roles: staffRoles,
      employeeId: e.id,
    }));
  }

  if (opts.hard) {
    /*
     * Permanent deletion is gated on typing the employee code.
     *
     * This destroys payslips, attendance, issued letters and separation records, which an
     * employer is generally required to retain and which no other feature can reconstruct.
     * Every established HR system treats archiving as the normal way to remove somebody and
     * permanent deletion as a rare correction for a record created in error. A one-line
     * browser confirm was not a proportionate gate for that, so the caller must echo back
     * the employee's own code, which cannot be done by clicking through.
     */
    const typed = String(opts.confirm || "").trim();
    if (typed.toUpperCase() !== String(e.code || "").toUpperCase()) {
      throw new HttpError(409, JSON.stringify({
        code: "CONFIRM_CODE_REQUIRED",
        message:
          `Permanently deleting ${e.firstName} ${e.lastName || ""}`.trim() +
          ` destroys their payroll, attendance and document history, which cannot be recovered. ` +
          `Type their employee code (${e.code}) to confirm, or archive them instead.`,
        employeeId: e.id,
        employeeCode: e.code,
      }));
    }
    await ctx.data.transaction(async (tx) => {
      // Cascade: remove every dependent record keyed by this employee so we
      // never leave orphans (separations/payslips/leave/etc. pointing at a
      // deleted employee). All are hot-column "employeeId" tables.
      const dependents = [
        "leaveBalances", "leaveRequests", "documents", "attendance", "payslips",
        "reimbursements", "onboardingInvites", "separations", "pips", "appraisals",
        "workLogs", "aiTokens", "assets", "perks", "familyBenefits", "wellbeing",
      ];
      for (const repo of dependents) {
        await tx[repo].removeWhere({ employeeId: e.id });
      }
      const user = await tx.users.findByEmployeeId(e.id);
      if (user) await tx.users.remove(user.id);
      // Must happen BEFORE the row goes: moving reports up needs this person's own
      // manager. Skipping it leaves dangling manager ids and reports that disappear
      // from the org chart.
      await reassignReportsOnExit(tx, e.id);
      await tx.employees.remove(e.id);
    });
    await ctx.data.auditLog.create({
      action: "EMPLOYEE_PURGED",
      userId: ctx.user.id,
      meta: { employeeId: e.id, code: e.code, name: fullName(e), email: e.email },
    });
    return { ok: true, purged: true };
  }
  await ctx.data.employees.update(e.id, { status: "EXITED" });

  // Revoke the login in the same breath as the delete.
  //
  // The soft delete only set status=EXITED, so the person vanished from the roster while
  // their login stayed ACTIVE and they could keep signing in. The periodic sweep in
  // access-sweep.ts does not catch it either: that walks SEPARATIONS, and deleting from
  // the admin screen creates no separation record, so nothing ever revoked them.
  const revoked = await revokeForEmployee(ctx.repos, e.id);

  // EXITED employees are filtered out of the org chart, so their reports would otherwise
  // point at someone invisible and drop out of the hierarchy themselves.
  const moved = await reassignReportsOnExit(ctx.repos, e.id);
  if (moved.reassigned) {
    await ctx.data.auditLog.create({
      action: "REPORTS_REASSIGNED_ON_EXIT",
      userId: ctx.user.id,
      meta: { exitedEmployeeId: e.id, reassigned: moved.reassigned, newManagerId: moved.newManagerId },
    });
  }
  await ctx.data.auditLog.create({
    action: "EMPLOYEE_ARCHIVED",
    userId: ctx.user.id,
    meta: { employeeId: e.id, code: e.code, accessRevoked: revoked, reportsReassigned: moved.reassigned },
  });
  return { ok: true, archived: true, exited: true, accessRevoked: revoked, reportsReassigned: moved.reassigned, newManagerId: moved.newManagerId || null };
}
