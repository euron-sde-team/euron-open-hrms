/**
 * Minimum-coverage leave guard.
 *
 * Opt-in per tenant (org.leaveCoverage.enabled, default OFF) and per department
 * (department.coveragePolicy). When enabled for a department, granting leave that
 * would drop that department below `minPresent` people on any working day is a
 * conflict. `mode` decides whether that is a hard block (override-able) or a warning.
 *
 * Config lives in the existing `data` JSONB (no migration), like department.headId.
 */

const isWeekend = (ymd: string): boolean => {
  const d = new Date(ymd + "T00:00:00Z").getUTCDay();
  return d === 0 || d === 6; // Sun / Sat
};

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return out;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface CoverageResult {
  enabled: boolean;        // is the tenant master switch on
  applicable: boolean;     // does a policy apply to this employee's department
  mode: "warn" | "block";
  minPresent: number;
  department: string | null;
  headcount: number;
  conflicts: { date: string; present: number; minPresent: number }[];
}

/**
 * Check whether a leave request (or proposed dates) would break coverage.
 * `excludeRequestId` omits an existing request from the "others on leave" tally
 * (used when re-checking at approval time so the request doesn't count itself).
 */
export async function checkCoverage(
  req: any,
  opts: { employeeId: string; from: string; to: string; excludeRequestId?: string }
): Promise<CoverageResult> {
  const off: CoverageResult = { enabled: false, applicable: false, mode: "warn", minPresent: 0, department: null, headcount: 0, conflicts: [] };

  const org = await req.repos.organizations.byId(req.user.orgId);
  if (!org || !org.leaveCoverage || !org.leaveCoverage.enabled) return off;

  const emp = await req.repos.employees.byId(opts.employeeId);
  if (!emp || !emp.departmentId) return { ...off, enabled: true };

  const dept = await req.repos.departments.byId(emp.departmentId);
  const policy = dept && dept.coveragePolicy;
  if (!policy || !policy.enabled) return { ...off, enabled: true, department: dept ? dept.name : null };

  const minPresent = Math.max(1, Number(policy.minPresent) || 1);
  const mode: "warn" | "block" = policy.mode === "block" ? "block" : "warn";

  const members = await req.repos.employees.find(
    (e: any) => e.departmentId === dept.id && e.status !== "EXITED"
  );
  const memberIds = new Set(members.map((m: any) => m.id));
  const headcount = members.length;

  const holidays = new Set((await req.repos.holidays.all()).map((h: any) => h.date));

  // Other members' approved/pending leave (exclude the request being evaluated).
  const others = (await req.repos.leaveRequests.all()).filter(
    (r: any) =>
      memberIds.has(r.employeeId) &&
      (r.status === "APPROVED" || r.status === "PENDING") &&
      r.id !== opts.excludeRequestId
  );

  const conflicts: CoverageResult["conflicts"] = [];
  for (const day of eachDay(opts.from, opts.to)) {
    if (isWeekend(day) || holidays.has(day)) continue;
    const onLeave = new Set<string>();
    for (const r of others) if (r.from <= day && day <= r.to) onLeave.add(r.employeeId);
    onLeave.add(opts.employeeId); // granting this request puts the requester on leave that day
    const present = headcount - onLeave.size;
    if (present < minPresent) conflicts.push({ date: day, present, minPresent });
  }

  return { enabled: true, applicable: true, mode, minPresent, department: dept.name, headcount, conflicts };
}

/** Compact one-line summary of conflicting days for error/UI messages. */
export function conflictSummary(c: CoverageResult): string {
  const dept = c.department || "the team";
  const days = c.conflicts.map((x) => x.date).join(", ");
  return `Granting this leaves ${dept} below ${c.minPresent} present on ${days}.`;
}
