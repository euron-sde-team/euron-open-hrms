/**
 * Last-administrator protection.
 *
 * An org must always retain at least one person who can actually sign in and administer
 * it. Nothing enforced that before: the codebase instead avoided the problem by keeping
 * admins out of the employee table entirely, so that deleting an employee could never
 * delete an admin's login. Promotion to ADMIN archived the person's employee record
 * (status EXITED) for exactly this reason.
 *
 * That trade is backwards. It means an admin is not a person: they cannot mark attendance,
 * take leave, be someone's reporting manager, receive a payslip or resign. Guarding the
 * handful of operations that can actually remove the last administrator costs far less
 * than excluding every administrator from the HR system.
 *
 * "Administrator" here means holding the `*` (superuser) permission through any role,
 * built-in or custom, which is the same test the rest of the app uses for full access.
 */
import { forbidden } from "../core/util";
import { resolvePermissions, hasPerm, userNeedsOrg, roleDef } from "../security/rbac";

/**
 * Would this set of role keys still grant superuser?
 *
 * Lets a caller ask about the state AFTER a role edit, so the last-admin guard fires only
 * when a change actually strips `*` rather than on every role change.
 */
function grantsSuperuser(roleKeys: string[], org): boolean {
  return (roleKeys || []).some((k) => ((roleDef(k, org) || { permissions: [] }).permissions || []).includes("*"));
}

/**
 * Can this user actually sign in right now?
 *
 * DISABLED accounts are locked out, and INVITED accounts have never set a password
 * (`auth.ts:69` blocks them). An outstanding invitation to a colleague is not a safety
 * net: counting it would let the only working administrator delete themselves and leave
 * the org with nobody who can get in.
 */
const canSignIn = (u) => u && u.status !== "DISABLED" && u.status !== "INVITED";

/** Every user in the org who can sign in and holds `*`. Excludes `exceptUserId`. */
async function activeAdmins(repos, exceptUserId?: string | null) {
  const users = await repos.users.all();
  let org: any = null;
  const admins: any[] = [];
  for (const u of users) {
    if (u.id === exceptUserId) continue;
    if (!canSignIn(u)) continue;
    // Built-in roles resolve without a DB read; a custom role needs org.customRoles.
    if (userNeedsOrg(u) && !org) org = await repos.organizations.byId(repos.ctx && repos.ctx.orgId);
    if (hasPerm(resolvePermissions(u, org || {}), "*")) admins.push(u);
  }
  return admins;
}

/**
 * Throw unless the org would still have a usable administrator after `userId` loses
 * access. Call BEFORE the write, from every path that can disable, delete, demote or
 * exit a login. A no-op when `userId` is not an administrator.
 *
 * `action` completes the sentence "…the only administrator, so you cannot <action>".
 */
async function assertNotLastAdmin(repos, userId: string, action: string) {
  if (!userId) return;
  const user = await repos.users.byId(userId);
  if (!user) return;

  let org: any = null;
  if (userNeedsOrg(user)) org = await repos.organizations.byId(repos.ctx && repos.ctx.orgId);
  if (!hasPerm(resolvePermissions(user, org || {}), "*")) return; // not an admin, nothing to protect

  const others = await activeAdmins(repos, userId);
  if (others.length === 0) {
    throw forbidden(
      `${user.name || user.email} is the only administrator of this workspace, so you cannot ${action}. ` +
      `Give someone else the Admin role first.`
    );
  }
}

/**
 * Same check keyed by employee rather than login, for the employee-facing routes
 * (delete, separation) that hold an employee id and may or may not have a linked user.
 */
async function assertEmployeeNotLastAdmin(repos, employeeId: string, action: string) {
  if (!employeeId) return;
  const user = await repos.users.where({ employeeId }).one(); // employeeId is a hot col (indexed)
  if (user) await assertNotLastAdmin(repos, user.id, action);
}

/** Does this employee's login hold staff access? Used to warn before destructive edits. */
async function staffRolesOfEmployee(repos, employeeId: string): Promise<string[]> {
  const user = await repos.users.where({ employeeId }).one();
  if (!user) return [];
  let org: any = null;
  if (userNeedsOrg(user)) org = await repos.organizations.byId(repos.ctx && repos.ctx.orgId);
  const perms = resolvePermissions(user, org || {});
  if (!hasPerm(perms, "staff.access")) return [];
  const extra = Array.isArray(user.roleKeys) ? user.roleKeys : [];
  return [...new Set([user.role, ...extra].filter(Boolean))];
}

export { assertNotLastAdmin, assertEmployeeNotLastAdmin, activeAdmins, staffRolesOfEmployee, canSignIn, grantsSuperuser };
