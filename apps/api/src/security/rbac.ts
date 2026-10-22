/**
 * Role-based access control: permission catalog, built-in roles, and resolution.
 *
 * Model: one role per user. A role is either a built-in key (defined here) or a
 * custom role stored per-org in `org.data.customRoles`. A role grants a set of
 * permission codes; `"*"` means superuser. `staff.access` is the base capability
 * that makes a role "staff" (drives the permission-based isStaff()).
 */

// Permission catalog, grouped for the admin UI. `staff.access` is the base gate.
const PERMISSIONS = [
  { group: "Core", items: [["staff.access", "Staff access (see the admin/HR app)"]] },
  { group: "People", items: [
    ["employees.manage", "Manage employees"],
    ["onboarding.manage", "Manage onboarding & invites"],
    // Separate from onboarding.manage on purpose. Sending a joining form is routine
    // coordination; approving one writes statutory identifiers and a bank account onto the
    // employee record, so an organisation may well want fewer people holding it.
    ["onboarding.review", "Review & approve submitted onboarding"],
  ] },
  { group: "Time & Leave", items: [
    ["leave.approve", "Approve / reject leave"],
    // Leave types, the company's leave rules and minimum coverage. HR work, so it is not
    // tied to settings.manage, which also covers company profile, branding and data export.
    ["leave.manage", "Manage leave types & policies"],
    ["attendance.manage", "View & regularize attendance"],
  ] },
  { group: "Payroll", items: [
    ["payroll.manage", "Run payroll & payslips"],
    ["reimbursements.manage", "Approve reimbursements"],
    ["vendors.manage", "Manage vendors & bills"],
  ] },
  { group: "Performance", items: [
    ["performance.manage", "Manage PIP & appraisals"],
    ["wellbeing.pulse", "View well-being pulse"],
  ] },
  { group: "Workplace", items: [
    ["documents.manage", "Manage all documents"],
    ["assets.manage", "Manage assets"],
    ["perks.manage", "Manage perks"],
    ["aitokens.manage", "Manage AI token allowances"],
  ] },
  { group: "Company", items: [
    ["announcements.manage", "Post announcements"],
    ["content.manage", "Manage policies, benefits, holidays"],
    ["reports.view", "View reports & exports"],
    ["audit.view", "View the audit log"],
  ] },
  { group: "Administration", items: [
    ["settings.manage", "Manage organization settings"],
    ["users.manage", "Manage users & invites"],
    ["roles.manage", "Manage roles & permissions"],
  ] },
];

const ALL_CODES = PERMISSIONS.flatMap((g) => g.items.map(([c]) => c));
const isValidCode = (c) => ALL_CODES.includes(c);

// The permissions a full "staff" (HR-like) role holds, excluding the admin-only trio.
const STAFF_PERMS = ALL_CODES.filter((c) => !["settings.manage", "users.manage", "roles.manage"].includes(c));

// Built-in roles (reproduce the current fixed behaviour exactly).
const BUILTIN_ROLES = {
  ADMIN: { name: "Admin", permissions: ["*"] },
  HR: { name: "HR", permissions: STAFF_PERMS },
  MANAGER: { name: "Manager", permissions: [] }, // power is hierarchy-derived (reportsTo)
  EMPLOYEE: { name: "Employee", permissions: [] },
  VENDOR: { name: "Vendor", permissions: [] },
};
const BUILTIN_KEYS = Object.keys(BUILTIN_ROLES);

/** Custom roles for an org (from org.data.customRoles), as { key: {name, permissions} }. */
const customRolesOf = (org) => (org && org.customRoles && typeof org.customRoles === "object" ? org.customRoles : {});

/** Look up a role definition (built-in or custom) by key. */
function roleDef(key, org) {
  if (BUILTIN_ROLES[key]) return { key, builtin: true, ...BUILTIN_ROLES[key] };
  const c = customRolesOf(org)[key];
  return c ? { key, builtin: false, name: c.name || key, permissions: Array.isArray(c.permissions) ? c.permissions : [] } : null;
}

/**
 * Every role key a user holds: their primary `role` plus any additional
 * `roleKeys` (stored in user.data, no migration needed), de-duplicated.
 */
function userRoleKeys(user) {
  const extra = Array.isArray(user && user.roleKeys) ? user.roleKeys : [];
  return [...new Set([user.role, ...extra].filter(Boolean))];
}

/** True if any of the user's roles is custom (not a built-in key) -> needs the org loaded. */
const userNeedsOrg = (user) => userRoleKeys(user).some((k) => !BUILTIN_ROLES[k]);

/**
 * Resolve a user's permission Set as the UNION of all their roles (primary +
 * additional). Built-in roles resolve without the org; custom roles need the
 * org (org.data.customRoles). Unknown roles contribute nothing.
 */
function resolvePermissions(user, org: any = null) {
  const perms = new Set();
  for (const key of userRoleKeys(user)) {
    const def = roleDef(key, org);
    if (def) for (const p of def.permissions) perms.add(p);
  }
  return perms;
}

const hasPerm = (set, code) => !!set && (set.has("*") || set.has(code));
/** A role is "staff" if it is superuser or holds the base staff.access permission. */
const isStaffPerms = (set) => hasPerm(set, "staff.access");

// ── Scoped access ────────────────────────────────────────────────────────────
//
// A user's admin powers can be limited to specific departments or offices. The
// scope lives in `user.data.scope` (no schema change). Absent / ALL = org-wide,
// which is the historical behaviour, so every existing user is unaffected.

const SCOPE_TYPES = ["ALL", "DEPARTMENT", "OFFICE"];

/**
 * Resolve a user's access scope. Returns { scopeType, scopeIds }. Superusers
 * (the "*" permission) are always org-wide regardless of any stored scope.
 */
function resolveScope(user, perms?) {
  if (perms && perms.has && perms.has("*")) return { scopeType: "ALL", scopeIds: [] };
  const s = user && user.scope;
  if (!s || !SCOPE_TYPES.includes(s.scopeType) || s.scopeType === "ALL") {
    return { scopeType: "ALL", scopeIds: [] };
  }
  const ids = Array.isArray(s.scopeIds) ? s.scopeIds.filter(Boolean) : [];
  // A scope with no ids can't match anything useful, treat as org-wide to avoid
  // accidentally locking a user out of everything.
  if (!ids.length) return { scopeType: "ALL", scopeIds: [] };
  return { scopeType: s.scopeType, scopeIds: ids };
}

/**
 * Is `employee` within `scope`? ALL matches everything; DEPARTMENT/OFFICE match
 * when the employee's departmentId/officeId is in scopeIds. A null employee is
 * out of scope (caller decides whether that 404s or 403s).
 */
function employeeInScope(scope, employee) {
  if (!scope || scope.scopeType === "ALL") return true;
  if (!employee) return false;
  if (scope.scopeType === "DEPARTMENT") return scope.scopeIds.includes(employee.departmentId);
  if (scope.scopeType === "OFFICE") return scope.scopeIds.includes(employee.officeId);
  return true;
}

/** Filter a list of employees down to those within `scope`. */
function filterEmployeesByScope(scope, employees) {
  if (!scope || scope.scopeType === "ALL") return employees;
  return (employees || []).filter((e) => employeeInScope(scope, e));
}

/**
 * The set of employee ids a request's caller may act on, given their scope.
 * Returns null for org-wide (ALL) callers, callers should treat null as
 * "no filtering needed". Used by employee-owned-record routes (leave, salary,
 * reimbursements, …) to restrict lists and guard per-record actions.
 */
async function scopedEmployeeIds(req) {
  if (!req.scope || req.scope.scopeType === "ALL") return null;
  const all = await req.repos.employees.all();
  return new Set(filterEmployeesByScope(req.scope, all).map((e) => e.id));
}

export {
  PERMISSIONS, ALL_CODES, isValidCode, STAFF_PERMS,
  BUILTIN_ROLES, BUILTIN_KEYS, customRolesOf, roleDef,
  resolvePermissions, hasPerm, isStaffPerms, userRoleKeys, userNeedsOrg,
  SCOPE_TYPES, resolveScope, employeeInScope, filterEmployeesByScope, scopedEmployeeIds,
};
