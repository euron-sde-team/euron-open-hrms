/**
 * Roles & permissions. Built-in roles are read-only (defined in rbac.js); custom roles
 * are per-org and live in org.data.customRoles.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound } from "../core/util";
import { PERMISSIONS, isValidCode, BUILTIN_ROLES, BUILTIN_KEYS, customRolesOf, userRoleKeys } from "../security/rbac";

const slug = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
const isStaffRole = (perms) => perms.includes("*") || perms.includes("staff.access");

/** All roles (built-in + custom) with user counts, plus the org's custom map. */
async function loadRoles(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const custom = { ...customRolesOf(org) };
  const users = await ctx.data.users.all();
  // Count every role each user holds (primary + additional), de-duplicated per user.
  const count = {};
  users.forEach((u) => userRoleKeys(u).forEach((k) => (count[k] = (count[k] || 0) + 1)));
  const list: any[] = [];
  for (const key of BUILTIN_KEYS) {
    const perms = BUILTIN_ROLES[key].permissions;
    list.push({ key, name: BUILTIN_ROLES[key].name, permissions: perms, builtin: true, staff: isStaffRole(perms), userCount: count[key] || 0 });
  }
  for (const [key, c] of Object.entries(custom) as [string, any][]) {
    const perms = Array.isArray(c.permissions) ? c.permissions : [];
    list.push({ key, name: c.name || key, permissions: perms, builtin: false, staff: isStaffRole(perms), userCount: count[key] || 0 });
  }
  return { list, custom };
}

const saveCustomRoles = (ctx: RequestContext, custom) => ctx.data.organizations.update(ctx.orgId, { customRoles: custom });

/** Grouped permission catalog for the UI. */
export const permissionCatalog = () => PERMISSIONS;

/** Built-in + custom roles. */
export async function listRoles(ctx: RequestContext) {
  return (await loadRoles(ctx)).list;
}

export async function createRole(ctx: RequestContext, input: { name?: unknown; permissions?: unknown }) {
  const name = String(input.name || "").trim();
  if (!name) throw bad("Role name is required");
  const key = slug(name);
  if (!key) throw bad("Invalid role name");
  if (BUILTIN_KEYS.map((k) => k.toLowerCase()).includes(key)) throw bad("That name clashes with a built-in role");
  const perms = (Array.isArray(input.permissions) ? input.permissions : []).filter(isValidCode);
  const { custom } = await loadRoles(ctx);
  if (custom[key]) throw bad("A role with that name already exists");
  custom[key] = { name, permissions: perms };
  await saveCustomRoles(ctx, custom);
  await ctx.data.auditLog.create({ action: "ROLE_CREATE", userId: ctx.user.id, meta: { key, name } });
  return { key, name, permissions: perms, builtin: false, staff: isStaffRole(perms), userCount: 0 };
}

export async function updateRole(ctx: RequestContext, key: string, input: { name?: unknown; permissions?: unknown }) {
  const { custom } = await loadRoles(ctx);
  if (!custom[key]) throw notFound("Custom role not found");
  if (input.name !== undefined) custom[key].name = String(input.name).trim() || custom[key].name;
  if (Array.isArray(input.permissions)) custom[key].permissions = input.permissions.filter(isValidCode);
  await saveCustomRoles(ctx, custom);
  await ctx.data.auditLog.create({ action: "ROLE_UPDATE", userId: ctx.user.id, meta: { key } });
  return { key, name: custom[key].name, permissions: custom[key].permissions, builtin: false, staff: isStaffRole(custom[key].permissions) };
}

/** Delete a custom role; blocked while any user holds it. */
export async function deleteRole(ctx: RequestContext, key: string) {
  const { custom } = await loadRoles(ctx);
  if (!custom[key]) throw notFound("Custom role not found");
  if (await ctx.data.users.findOne((u) => userRoleKeys(u).includes(key))) throw bad("Cannot delete a role assigned to users. Reassign them first.");
  delete custom[key];
  await saveCustomRoles(ctx, custom);
  await ctx.data.auditLog.create({ action: "ROLE_DELETE", userId: ctx.user.id, meta: { key } });
  return { ok: true };
}
