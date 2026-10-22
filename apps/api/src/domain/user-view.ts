/** Shared "public user" projection returned by auth/login/verify endpoints. */
import { resolvePermissions, isStaffPerms } from "../security/rbac";
import { isManagerOf } from "./manager";

async function publicUser(user, org, r) {
  let employee: any = null;
  let hasReports = false;
  if (user.employeeId) {
    employee = await r.employees.byId(user.employeeId);
    hasReports =
      (await r.employees.count(
        (e) =>
          e.orgId === user.orgId &&
          e.status !== "EXITED" &&
          isManagerOf(e, user.employeeId)
      )) > 0;
  }
  // Resolve the user's real staff status (permission-based, so custom staff roles
  // count) + their permission codes, so the client can gate UI consistently with
  // the server instead of guessing from the role string.
  const perms = resolvePermissions(user, org || {});
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isStaff: isStaffPerms(perms),
    permissions: [...perms],
    employeeId: user.employeeId,
    vendorId: user.vendorId || null,
    status: user.status || "ACTIVE",
    hasReports,
    // First-run product tour: null until the user finishes/skips it (then an ISO date).
    tourSeenAt: user.tourSeenAt || null,
    org: org ? { id: org.id, name: org.name, slug: org.slug, branding: org.branding || null } : null,
    employee: employee
      ? { id: employee.id, code: employee.code, employmentType: employee.employmentType, departmentId: employee.departmentId }
      : null,
  };
}

export { publicUser };
