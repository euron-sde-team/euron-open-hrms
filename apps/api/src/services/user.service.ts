/**
 * Workspace user management: invite teammates, list users, resend invites,
 * enable/disable accounts, and assign roles (built-in or custom). Distinct from
 * employees: these are login accounts.
 */
import crypto from "crypto";
import type { RequestContext } from "../core/context";
import { bad, notFound, tempPassword } from "../core/util";
import { PORTAL_URL } from "../core/config";
import { validate } from "../core/validate";
import { logger } from "../core/logger";
import { hashPassword } from "../middleware/auth";
import { BUILTIN_KEYS, customRolesOf, SCOPE_TYPES } from "../security/rbac";
import { createToken } from "../security/tokens";
import { assertNotLastAdmin, grantsSuperuser } from "./org-guard.service";
import { ensureEmployeeForUser } from "../domain/person";
import { EMPLOYMENT_TYPE_VALUES } from "../domain/employment";
import { sendTenantMail } from "../integrations/mail/mailer";
import { staffInviteEmail, staffTempPasswordEmail } from "../integrations/mail/templates";
import { systemRepos } from "../repositories/base.repository";
import { createRepositories } from "../repositories";

const nowIso = () => new Date().toISOString();
const view = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, roleKeys: Array.isArray(u.roleKeys) ? u.roleKeys : [], scope: u.scope && u.scope.scopeType ? u.scope : { scopeType: "ALL", scopeIds: [] }, status: u.status || "ACTIVE", employeeId: u.employeeId || null, vendorId: u.vendorId || null, createdAt: u.createdAt });
const mailView = (to: string, mail: any) => ({ to, mode: mail.mode, delivered: mail.delivered, error: mail.error });

const INVITE_SCHEMA = {
  email: { required: true, email: true, label: "Email" },
  name: { trim: true, max: 120, default: "" },
  role: { trim: true, max: 40, default: "HR" },
  sendInvite: { type: "boolean", default: true },
  // Optional employee details, so an invited teammate lands on the roster properly placed.
  departmentId: { trim: true, max: 64, default: "" },
  designation: { trim: true, max: 120, default: "" },
  joiningDate: { trim: true, max: 10, default: "" },
  employmentType: { trim: true, max: 40, default: "" },
};

// VENDOR is reserved for vendor onboarding; staff roles = built-ins (minus VENDOR) + custom.
const ASSIGNABLE_BUILTIN = BUILTIN_KEYS.filter((k) => k !== "VENDOR");
async function validRole(ctx: RequestContext, key) {
  if (ASSIGNABLE_BUILTIN.includes(key)) return true;
  const org = await ctx.data.organizations.byId(ctx.orgId);
  return !!customRolesOf(org)[key];
}

/** Optional employee placement, checked the same way by invite and create-employee. */
async function assertPlacement(ctx: RequestContext, departmentId, employmentType) {
  if (departmentId && !(await ctx.data.departments.byId(departmentId))) throw bad("Unknown department");
  if (employmentType && !EMPLOYMENT_TYPE_VALUES.includes(employmentType))
    throw bad(`employmentType must be one of: ${EMPLOYMENT_TYPE_VALUES.join(", ")}`);
}

async function userOr404(ctx: RequestContext, id: string) {
  const user = await ctx.data.users.byId(id);
  if (!user) throw notFound("User not found");
  return user;
}

/**
 * Workspace login accounts (excludes vendor logins), newest first.
 *
 * Each row carries its linked employee, and `needsEmployee` flags a login that has none.
 * Those were previously invisible from both sides: absent from the Employees page because
 * they have no employee record, and indistinguishable here from a properly linked account.
 */
export async function listUsers(ctx: RequestContext) {
  const list = await ctx.data.users.staffAndEmployeeLogins();
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const employees = await ctx.data.employees.all();
  const empById = new Map<string, any>(employees.map((e) => [e.id, e]));
  return list.map((u) => {
    const e = u.employeeId ? empById.get(u.employeeId) : null;
    return {
      ...view(u),
      employee: e ? { id: e.id, code: e.code, name: `${e.firstName} ${e.lastName || ""}`.trim(), status: e.status } : null,
      needsEmployee: !e,
    };
  });
}

/**
 * Give an existing login an employee record.
 *
 * The recovery path for accounts that predate one-person-one-identity (every admin and HR
 * login created before this) and for the rare case where the record was purged out from
 * under a login. Idempotent: returns the existing record if there already is one.
 */
export async function createEmployeeForUser(
  ctx: RequestContext,
  id: string,
  input: { departmentId?: any; designation?: any; joiningDate?: any; employmentType?: any },
) {
  const user = await userOr404(ctx, id);
  if (user.role === "VENDOR") throw bad("Vendor accounts are billed through the vendor module, not the roster");
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const { departmentId, designation, joiningDate, employmentType } = input;
  await assertPlacement(ctx, departmentId, employmentType);
  const { employee, created } = await ensureEmployeeForUser(ctx.repos, org, user, {
    departmentId, designation, joiningDate, employmentType, createdVia: "BACKFILL_UI",
  });
  if (created) {
    await ctx.data.auditLog.create({
      action: "USER_EMPLOYEE_CREATED",
      userId: ctx.user.id,
      meta: { targetUserId: user.id, employeeId: employee.id, code: employee.code },
    });
  }
  return { created, employee };
}

/**
 * Add a teammate. Both modes email the user; neither returns a password in the response.
 *  - sendInvite=true (default): email an invite link; the user sets their own
 *    password (status INVITED until they accept).
 *  - sendInvite=false: create the account ACTIVE now with a generated temporary
 *    password and EMAIL it to the user, who signs in and changes it later via
 *    Settings → change password.
 */
export async function inviteUser(ctx: RequestContext, body: unknown) {
  const { email, name, role, sendInvite, departmentId, designation, joiningDate, employmentType } = validate(INVITE_SCHEMA, body);
  await assertPlacement(ctx, departmentId, employmentType);
  if (!(await validRole(ctx, role))) throw bad("Unknown role");
  if (await createRepositories(systemRepos()).users.findByEmail(email)) throw bad("A user with that email already exists");

  // In temp-password mode we generate a readable one and activate immediately.
  const temp = sendInvite ? null : tempPassword();
  const user = await ctx.data.users.create({
    email, name: name || email.split("@")[0], role, employeeId: null,
    // Invite mode: unusable random hash until they accept and set a password.
    // Temp mode: hash of the generated temporary password (emailed to the user).
    passwordHash: hashPassword(temp || crypto.randomBytes(24).toString("base64url")),
    status: sendInvite ? "INVITED" : "ACTIVE",
    emailVerifiedAt: sendInvite ? null : nowIso(),
    credentialsChangedAt: nowIso(),
    invitedBy: ctx.user.id,
  });
  const org = (await ctx.data.organizations.byId(ctx.orgId))!;

  /*
   * A teammate invited here is a colleague, not a disembodied login.
   *
   * This route used to hard-code `employeeId: null`, which is how every HR and admin
   * account in the system ended up missing from the employee roster. The optional details
   * let the inviter place them properly straight away; everything else takes a sensible
   * default and HR can complete the record later.
   */
  try {
    const made = await ensureEmployeeForUser(ctx.repos, org, user, {
      departmentId, designation, joiningDate, employmentType,
      status: sendInvite ? "ONBOARDING" : "ACTIVE",
      createdVia: "STAFF_INVITE",
    });
    user.employeeId = made.employee.id; // keep the response consistent with what was written
  } catch (e) {
    // Never cost someone their invitation; the record is recoverable from Settings > Users.
    logger.error({ err: e, userId: user.id }, "staff invite: could not create the employee record");
  }

  const mail: any = sendInvite
    ? await sendTenantMail(
        org,
        staffInviteEmail({
          to: email,
          orgName: org.name,
          inviterName: ctx.user.name,
          role,
          token: await createToken({ type: "USER_INVITE", orgId: ctx.orgId, userId: user.id, email }),
        })
      )
    : await sendTenantMail(
        org,
        staffTempPasswordEmail({ to: email, orgName: org.name, inviterName: ctx.user.name, role, password: temp, portalUrl: PORTAL_URL })
      );
  await ctx.data.auditLog.create({ action: "USER_INVITE", userId: ctx.user.id, meta: { invitedUserId: user.id, email, role, mode: sendInvite ? "invite" : "temp-password" } });
  return { user: view(user), mail: mailView(email, mail) };
}

/** Re-send an outstanding invite. */
export async function resendInvite(ctx: RequestContext, id: string) {
  const user = await userOr404(ctx, id);
  if (user.status !== "INVITED") throw bad("This user has already accepted their invite");
  const org = (await ctx.data.organizations.byId(ctx.orgId))!;
  const token = await createToken({ type: "USER_INVITE", orgId: ctx.orgId, userId: user.id, email: user.email });
  const mail: any = await sendTenantMail(org, staffInviteEmail({ to: user.email, orgName: org.name, inviterName: ctx.user.name, role: user.role, token }));
  return { ok: true, mail: mailView(user.email, mail) };
}

/** Enable or disable an account: anything other than DISABLED means ACTIVE. */
export async function setUserStatus(ctx: RequestContext, id: string, requested: unknown) {
  if (id === ctx.user.id) throw bad("You cannot change your own account status");
  const user = await userOr404(ctx, id);
  // Explicit only: an empty or misspelt request must never re-enable a disabled account.
  if (requested !== "ACTIVE" && requested !== "DISABLED") throw bad('status must be "ACTIVE" or "DISABLED"');
  const status = requested;
  // Disabling the only administrator locks everybody out of the workspace.
  if (status === "DISABLED") await assertNotLastAdmin(ctx.repos, user.id, "disable their account");
  // Disabling bumps credentialsChangedAt to kill any active sessions immediately.
  const patch = status === "DISABLED" ? { status, credentialsChangedAt: nowIso() } : { status };
  const updated = await ctx.data.users.update(user.id, patch);
  await ctx.data.auditLog.create({ action: "USER_STATUS", userId: ctx.user.id, meta: { targetUserId: user.id, status } });
  return view(updated);
}

/** Assign a primary role (built-in or custom). */
export async function setUserRole(ctx: RequestContext, id: string, requested: unknown) {
  const role = String(requested || "");
  if (!(await validRole(ctx, role))) throw bad("Unknown role");
  const user = await userOr404(ctx, id);
  if (user.role === "VENDOR") throw bad("Vendor accounts cannot be reassigned");
  if (id === ctx.user.id && role !== user.role) throw bad("You cannot change your own role");

  /*
   * Promotion to ADMIN used to ARCHIVE the person's employee record (status EXITED) and
   * unlink it, so that later deleting that employee could not destroy the admin's login.
   * The cost was that being promoted removed you from your own company: no attendance, no
   * leave, gone from the org chart, unusable as a reporting manager, unable to resign.
   *
   * The login is now protected where the danger actually is (see org-guard.ts, wired into
   * every demote / disable / delete / separate path), so a promotion is just a promotion.
   *
   * Only a change that STRIPS superuser needs guarding: moving between two roles that both
   * grant `*` leaves the org's administrator count untouched.
   */
  const orgForRoles = await ctx.data.organizations.byId(ctx.orgId);
  const nextKeys = [role, ...(Array.isArray(user.roleKeys) ? user.roleKeys : [])];
  if (!grantsSuperuser(nextKeys, orgForRoles)) await assertNotLastAdmin(ctx.repos, user.id, "change their role");

  const updated = await ctx.data.users.update(user.id, { role });
  await ctx.data.auditLog.create({ action: "USER_ROLE", userId: ctx.user.id, meta: { targetUserId: user.id, from: user.role, to: role } });
  return view(updated);
}

/**
 * Set ADDITIONAL roles beyond the user's primary role. A user's permissions are the union
 * of all their roles.
 */
export async function setAdditionalRoles(ctx: RequestContext, id: string, roleKeys: unknown) {
  const user = await userOr404(ctx, id);
  if (user.role === "VENDOR") throw bad("Vendor accounts cannot hold additional roles");
  if (id === ctx.user.id) throw bad("You cannot change your own roles");
  const raw = Array.isArray(roleKeys) ? roleKeys : [];
  const keys = [...new Set(raw.map((k) => String(k)).filter(Boolean))].filter((k) => k !== user.role); // primary role is implicit
  for (const k of keys) if (!(await validRole(ctx, k))) throw bad(`Unknown role: ${k}`);
  // Dropping an additional role can strip superuser just as a demotion can.
  const orgForRoles = await ctx.data.organizations.byId(ctx.orgId);
  if (!grantsSuperuser([user.role, ...keys], orgForRoles))
    await assertNotLastAdmin(ctx.repos, user.id, "remove those roles");
  const updated = await ctx.data.users.update(user.id, { roleKeys: keys });
  await ctx.data.auditLog.create({ action: "USER_ROLES", userId: ctx.user.id, meta: { targetUserId: user.id, roleKeys: keys } });
  return view(updated);
}

/**
 * Limit a user's admin powers to specific departments/offices. ALL = org-wide.
 */
export async function setUserScope(ctx: RequestContext, id: string, input: { scopeType?: unknown; scopeIds?: unknown }) {
  const user = await userOr404(ctx, id);
  if (id === ctx.user.id) throw bad("You cannot change your own scope");
  const type = String(input.scopeType || "ALL").toUpperCase();
  if (!SCOPE_TYPES.includes(type)) throw bad(`scopeType must be one of: ${SCOPE_TYPES.join(", ")}`);
  let scope: any = { scopeType: "ALL", scopeIds: [] };
  if (type !== "ALL") {
    const ids = [...new Set((Array.isArray(input.scopeIds) ? input.scopeIds : []).map((x) => String(x)).filter(Boolean))];
    if (!ids.length) throw bad("Select at least one department/office, or choose Whole organisation");
    // Validate the ids exist (departments or offices, per type).
    const valid = type === "DEPARTMENT"
      ? new Set((await ctx.data.departments.all()).map((d) => d.id))
      : new Set((await ctx.data.offices.all()).map((o) => o.id));
    for (const sid of ids) if (!valid.has(sid)) throw bad(`Unknown ${type.toLowerCase()}: ${sid}`);
    scope = { scopeType: type, scopeIds: ids };
  }
  const updated = await ctx.data.users.update(user.id, { scope });
  await ctx.data.auditLog.create({ action: "USER_SCOPE", userId: ctx.user.id, meta: { targetUserId: user.id, scope } });
  return view(updated);
}
