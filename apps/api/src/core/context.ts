/**
 * What a service needs to know about the caller, without Express.
 *
 * Controllers build it from the request (`contextFrom(req)`); background jobs and the
 * CLI build it directly (`systemContext(orgId)`). Services take a context and plain
 * inputs and return plain data, so they can be called and tested without HTTP.
 */
import { repos as scopedRepos } from "../repositories/base.repository";
import { createRepositories, type Repositories } from "../repositories";

export interface RequestContext {
  /** The caller's workspace. Every repository in `data` is scoped to it. */
  orgId: string;
  /** The signed-in user row (with resolved `perms`). */
  user: any;
  /** Permission check, e.g. ctx.can("payroll.manage"). */
  can(code: string): boolean;
  /** Department/office scope check for a specific employee record. */
  inScope(employee: any): boolean;
  /** The caller's department/office scope ({ scopeType: "ALL" } for org-wide callers). */
  scope: { scopeType: string; scopeIds: string[] };
  /** Set when an operator is acting as this user (impersonation). */
  impersonatorId: string | null;
  /** Repositories for this workspace. */
  data: Repositories;
  /**
   * The underlying workspace-scoped store. Only for the shared domain helpers that take a
   * store directly (notifications, last-admin guard, onboarding engine); new code uses `data`.
   */
  repos: any;
  requestId?: string;
  ip?: string;
}

/** Build the context for an authenticated request (after authRequired). */
export function contextFrom(req: any): RequestContext {
  if (!req.__ctx) {
    req.__ctx = {
      orgId: req.user.orgId,
      user: req.user,
      can: req.can,
      inScope: req.inScope,
      scope: req.scope || { scopeType: "ALL", scopeIds: [] },
      impersonatorId: req.impersonatorId || null,
      data: createRepositories(req.repos),
      repos: req.repos,
      requestId: req.id ? String(req.id) : undefined,
      ip: req.ip,
    } satisfies RequestContext;
  }
  return req.__ctx;
}

/** A context for system work in one workspace (jobs, sweeps, the CLI): full access. */
export function systemContext(orgId: string): RequestContext {
  const store = scopedRepos({ orgId });
  return {
    orgId,
    user: null,
    can: () => true,
    inScope: () => true,
    scope: { scopeType: "ALL", scopeIds: [] },
    impersonatorId: null,
    data: createRepositories(store),
    repos: store,
  };
}
