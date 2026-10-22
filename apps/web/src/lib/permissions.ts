import type { SessionUser } from "@open-hrms/types";

/**
 * Permission check, mirroring the API's RBAC resolution: ADMIN and the `*`
 * wildcard pass everything, otherwise the permission must be granted by one
 * of the user's roles. The API is the authority; this only decides what the
 * UI offers, so a stale answer costs a 403, never a leak.
 */
export function can(user: Pick<SessionUser, "role" | "permissions"> | null | undefined, perm: string): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const perms = user.permissions ?? [];
  return perms.includes("*") || perms.includes(perm);
}

/** Staff = anyone who works the HR console rather than only the employee portal. */
export function isStaffUser(user: Pick<SessionUser, "role" | "isStaff"> | null | undefined): boolean {
  if (!user) return false;
  return !!user.isStaff || user.role === "ADMIN" || user.role === "HR";
}
