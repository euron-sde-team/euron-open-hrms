/**
 * An employee's portal access, managed from the employee record: which role their login
 * holds (or none), which address they sign in with, and re-sending their credentials.
 *
 * Managing this here rather than only in Settings > Users is the point of one-person-one-
 * identity: promoting someone to HR or Admin is a fact about that employee, not a separate
 * account-administration chore performed against a disconnected list of email addresses.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden, tempPassword } from "../core/util";
import { PORTAL_URL } from "../core/config";
import { hashPassword } from "../middleware/auth";
import { BUILTIN_KEYS, customRolesOf } from "../security/rbac";
import { assertNotLastAdmin, grantsSuperuser } from "./org-guard.service";
import { normaliseEmail, assertEmail, assertEmailAvailable, resolveLoginEmail, setLoginEmail } from "./identity.service";
import { sendTenantMail } from "../integrations/mail/mailer";
import { onboardingEmail, loginEmailChangedEmail } from "../integrations/mail/templates";
import { fullName } from "../domain/person";


/** The employee, provided the caller's department/office scope reaches them. */
export async function employeeInScopeOr404(ctx: RequestContext, id: string) {
  const e = await ctx.data.employees.byId(id);
  if (!e) throw notFound("Employee not found");
  if (!ctx.inScope(e)) throw forbidden("Outside your assigned scope");
  return e;
}

/**
 * Validate a requested portal role, defaulting to EMPLOYEE.
 *
 * VENDOR is excluded: those logins belong to the vendor module and are billed, not paid.
 */
export async function resolvePortalRole(ctx: RequestContext, requested: unknown) {
  const role = String(requested || "").trim() || "EMPLOYEE";
  if (role === "VENDOR") throw bad("Vendor logins are created from the Vendors module");
  if (BUILTIN_KEYS.includes(role)) return role;
  const org = await ctx.data.organizations.byId(ctx.orgId);
  if (customRolesOf(org)[role]) return role;
  throw bad(`Unknown role: ${role}`);
}

/**
 * Switch which address this person signs in with; omit `email` to adopt the employee's
 * official address.
 *
 * Separate from editing the record on purpose: editing an employee record is routine,
 * while changing an authentication identity ends every open session for that account and
 * has to be deliberate and audited.
 *
 * Both the old and the new address are told, because the old inbox is the only place a
 * warning reaches the person if the change was not theirs.
 */
export async function changeLoginEmail(ctx: RequestContext, id: string, requested: unknown) {
  const e = await employeeInScopeOr404(ctx, id);

  const user = await ctx.data.users.findByEmployeeId(e.id);
  if (!user) throw bad("This employee has no login yet. Grant portal access first.");

  const next = normaliseEmail(requested) || resolveLoginEmail(e);
  if (!next) throw bad("There is no address to switch to. Add an official email first.");
  assertEmail(next, "sign-in address");

  const before = user.email;
  const result = await setLoginEmail(ctx.repos, user, next);
  if (!result.changed) return { ok: true, changed: false, loginEmail: before };

  const org = await ctx.data.organizations.byId(ctx.orgId);
  const name = fullName(e);
  // Old address first: if this change was not expected, that is where it will be noticed.
  const recipients = [...new Set([before, result.to, normaliseEmail(e.personalEmail)].filter(Boolean))];
  const mail: any[] = [];
  for (const to of recipients) {
    mail.push(await sendTenantMail(org, loginEmailChangedEmail({
      org, name, to, oldEmail: before, newEmail: result.to, portalUrl: PORTAL_URL,
    })));
  }
  await ctx.data.auditLog.create({
    action: "EMPLOYEE_LOGIN_EMAIL",
    userId: ctx.user.id,
    meta: { employeeId: e.id, userId: user.id, from: before, to: result.to },
  });
  return { ok: true, changed: true, loginEmail: result.to, previousEmail: before, notified: recipients, mail };
}

/**
 * Grant, change or withdraw an employee's login. `role: "NONE"` disables the login without
 * touching the employment record. Creating one emails a temporary password.
 *
 * `created` tells the controller a new login was minted (a 201).
 */
export async function setPortalAccess(ctx: RequestContext, id: string, requested: unknown) {
  const e = await employeeInScopeOr404(ctx, id);
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const existing = await ctx.data.users.findByEmployeeId(e.id);
  const wants = String(requested || "").trim().toUpperCase();

  // Withdraw access.
  if (wants === "NONE") {
    if (!existing) return { created: false, body: { ok: true, role: null, changed: false } };
    await assertNotLastAdmin(ctx.repos, existing.id, "remove their portal access");
    await ctx.data.users.update(existing.id, { status: "DISABLED", credentialsChangedAt: new Date().toISOString() });
    await ctx.data.auditLog.create({ action: "EMPLOYEE_PORTAL_ACCESS", userId: ctx.user.id, meta: { employeeId: e.id, role: "NONE" } });
    return { created: false, body: { ok: true, role: null, changed: true } };
  }

  const role = await resolvePortalRole(ctx, requested);

  if (existing) {
    if (existing.id === ctx.user.id && role !== existing.role) throw bad("You cannot change your own role");
    // Only guard when the change would actually strip superuser.
    if (!grantsSuperuser([role, ...(Array.isArray(existing.roleKeys) ? existing.roleKeys : [])], org))
      await assertNotLastAdmin(ctx.repos, existing.id, "change their role");
    // Re-enabling a withdrawn login is part of granting access again.
    const updated = (await ctx.data.users.update(existing.id, { role, status: "ACTIVE" }))!;
    await ctx.data.auditLog.create({ action: "EMPLOYEE_PORTAL_ACCESS", userId: ctx.user.id, meta: { employeeId: e.id, from: existing.role, to: role } });
    return { created: false, body: { ok: true, role: updated.role, changed: true, invited: false } };
  }

  // No login yet: create one and email the credentials.
  const loginEmail = resolveLoginEmail(e);
  if (!loginEmail) throw bad("This employee has no email address to sign in with");
  await assertEmailAvailable(ctx.repos, loginEmail, { employeeId: e.id });
  const pwd = tempPassword();
  await ctx.data.users.create({
    email: loginEmail,
    name: fullName(e),
    role,
    employeeId: e.id,
    passwordHash: hashPassword(pwd),
    status: "ACTIVE",
  });
  const dept = e.departmentId ? await ctx.data.departments.byId(e.departmentId) : null;
  const invite = await sendTenantMail(org, onboardingEmail({ org, emp: e, dept, password: pwd, portalUrl: PORTAL_URL }));
  await ctx.data.auditLog.create({ action: "EMPLOYEE_PORTAL_ACCESS", userId: ctx.user.id, meta: { employeeId: e.id, to: role, created: true } });
  return { created: true, body: { ok: true, role, changed: true, invited: true, invite } };
}

/** (Re)create the login with a fresh temporary password and email the credentials. */
export async function resendCredentials(ctx: RequestContext, id: string) {
  const e = await employeeInScopeOr404(ctx, id);
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const pwd = tempPassword();
  const user = await ctx.data.users.findByEmployeeId(e.id);
  if (user) await ctx.data.users.update(user.id, { passwordHash: hashPassword(pwd) });
  else {
    // The same identity path as granting portal access: sign in with the official address
    // when there is one, and refuse an address another login already holds (that used to
    // surface as a unique-constraint 500, or mint a login on the wrong address).
    const loginEmail = resolveLoginEmail(e);
    if (!loginEmail) throw bad("This employee has no email address to sign in with");
    await assertEmailAvailable(ctx.repos, loginEmail, { employeeId: e.id });
    await ctx.data.users.create({
      email: loginEmail, name: fullName(e),
      role: "EMPLOYEE", employeeId: e.id, passwordHash: hashPassword(pwd),
    });
  }
  const dept = e.departmentId ? await ctx.data.departments.byId(e.departmentId) : null;
  const invite = await sendTenantMail(org, onboardingEmail({ org, emp: e, dept, password: pwd, portalUrl: PORTAL_URL }));
  return { ok: true, invite };
}
