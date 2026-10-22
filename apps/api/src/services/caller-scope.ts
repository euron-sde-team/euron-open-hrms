/**
 * The caller's department/office scope as a set of employee ids, for services that
 * filter lists of employee-owned records (payslips, claims, documents, exports).
 */
import type { RequestContext } from "../core/context";
import { scopedEmployeeIds } from "../security/rbac";

/** Ids of the employees the caller may act on, or null for org-wide callers (no filtering needed). */
export function scopedEmployeeIdsFor(ctx: RequestContext): Promise<Set<string> | null> {
  return scopedEmployeeIds({ scope: ctx.scope, repos: ctx.repos }) as Promise<Set<string> | null>;
}
