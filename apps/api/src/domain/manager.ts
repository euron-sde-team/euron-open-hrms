/**
 * One fact, two columns.
 *
 * `employees` carries both `manager_id` and `reports_to` for the same thing. They were
 * written inconsistently (POST /employees set only managerId; bulk import, public
 * onboarding and the tenant UI set both; PUT /employees/:id accepted them independently)
 * and, worse, read with OPPOSITE precedence in different modules:
 *
 *   directory.routes.ts:6    e.reportsTo || e.managerId    <- org chart, directory
 *   separation.routes.ts:149 e.managerId || e.reportsTo    <- exit approvals
 *
 * So an API client that PATCHed only one of them could leave a stale value that won the
 * org chart and lost the exit flow, or the reverse. Every read now goes through
 * `managerOf`, and `syncManagerFields` keeps both columns identical on every write, so
 * the precedence stops mattering at all.
 *
 * `managerId` is treated as canonical: it is the column POST /employees has always
 * written, so it is the one most likely to be right on existing rows. Rows that only
 * ever had `reportsTo` still resolve correctly through the fallback.
 */

/** The employee's reporting manager id, or null. Use this instead of reading either column. */
export function managerOf(e: any): string | null {
  if (!e) return null;
  return e.managerId || e.reportsTo || null;
}

/** True if `employeeId` is the direct manager of `e`. */
export function isManagerOf(e: any, employeeId: string | undefined | null): boolean {
  return !!e && !!employeeId && managerOf(e) === employeeId;
}

/**
 * Move an exiting employee's direct reports up to their own manager.
 *
 * Exiting previously just flipped `status` to EXITED and left every report pointing at a
 * person who is filtered out of the org chart, so those reports silently vanished from the
 * chart while still being counted, and their leave and reimbursement approvals lost their
 * approver. A hard delete was worse: it purged the row and left dangling ids.
 *
 * Reports are moved to the exiting person's own manager (the grandparent), which keeps the
 * tree connected and matches what HR does manually. Pass `successorId` to direct them
 * somewhere specific instead. With no grandparent and no successor they become roots,
 * which is at least visible rather than invisible.
 *
 * `repos` may be a transaction handle, so this can run inside the same transaction as the exit.
 */
export async function reassignReportsOnExit(
  repos: any,
  exitingEmployeeId: string,
  opts: { successorId?: string | null } = {}
): Promise<{ reassigned: number; newManagerId: string | null }> {
  const reports = await repos.employees.find(
    (e: any) => managerOf(e) === exitingEmployeeId && e.id !== exitingEmployeeId && e.status !== "EXITED"
  );
  if (!reports.length) return { reassigned: 0, newManagerId: null };

  let newManagerId: string | null = opts.successorId || null;
  if (!newManagerId) {
    const exiting = await repos.employees.byId(exitingEmployeeId);
    newManagerId = exiting ? managerOf(exiting) : null;
  }

  let reassigned = 0;
  for (const r of reports) {
    // Never leave someone reporting to themselves if the grandparent IS this report.
    const target = newManagerId && newManagerId !== r.id ? newManagerId : null;
    await repos.employees.update(r.id, { managerId: target });
    reassigned++;
  }
  return { reassigned, newManagerId };
}

/**
 * Collapse both columns onto one value for a write.
 *
 * `suppliedOnly` matters on updates: pass the caller's patch so we only touch the
 * columns when the caller actually meant to. Without it, every unrelated update would
 * rewrite the manager from whatever the merged row happened to hold.
 */
export function syncManagerFields<T extends Record<string, any>>(doc: T, suppliedOnly?: Record<string, any>): T {
  const src = suppliedOnly ?? doc;
  const hasManager = src.managerId !== undefined;
  const hasReports = src.reportsTo !== undefined;
  if (suppliedOnly && !hasManager && !hasReports) return doc;

  // managerId wins when both are supplied and disagree.
  const value = (hasManager ? src.managerId : hasReports ? src.reportsTo : null) || null;
  return { ...doc, managerId: value, reportsTo: value };
}
