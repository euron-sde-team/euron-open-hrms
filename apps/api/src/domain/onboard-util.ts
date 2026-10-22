/** Helpers for official email + employee ID generation, and onboarding emails. */

/**
 * Domain for generated official addresses: the workspace's configured
 * `officialEmailDomain`, else its verified sending domain, else a reserved
 * `.example` name (RFC 2606) so a fresh workspace never mints addresses on a
 * domain somebody else owns.
 */
function domainForOrg(org) {
  const configured = String(org.officialEmailDomain || "").trim().toLowerCase();
  if (configured) return configured;
  if (org.emailDomain && org.emailDomain.domain && org.emailDomain.status === "VERIFIED") return org.emailDomain.domain;
  return `${org.slug || "workspace"}.example`;
}

/**
 * Generate a unique official email like firstname.lastname@domain.
 * `sys` is a system (cross-org) repos factory used to check global uniqueness.
 */
async function generateOfficialEmail(org, firstName, lastName, sys) {
  const domain = domainForOrg(org);
  const base = `${firstName}.${lastName || ""}`
    .toLowerCase().trim().replace(/[^a-z0-9.]+/g, ".").replace(/\.+/g, ".").replace(/^\.|\.$/g, "") || "employee";
  const taken = new Set(
    (await sys.users.all()).map((u) => (u.email || "").toLowerCase())
      .concat((await sys.employees.all()).map((e) => (e.officialEmail || "").toLowerCase()))
  );
  let candidate = `${base}@${domain}`;
  let i = 1;
  while (taken.has(candidate.toLowerCase())) candidate = `${base}${i++}@${domain}`;
  return candidate;
}

/**
 * Generate the next employee code for an org. Honors a configured
 * `org.employeeIdRule` { prefix, suffix, seqStart, padding, resetYearly }
 * (prefix/suffix may contain {YEAR}); falls back to the default `SLUG-1000+n`.
 * `repo` is an org-scoped repos factory.
 */
async function generateEmployeeCode(org, repo) {
  const all = await repo.employees.all();
  const taken = new Set(all.map((e) => e.code));
  const rule = org.employeeIdRule;
  if (rule && (rule.prefix || rule.suffix)) {
    const year = new Date().getFullYear();
    const sub = (s) => String(s || "").replace(/\{YEAR\}/g, year as any);
    const prefix = sub(rule.prefix), suffix = sub(rule.suffix);
    const pad = Number(rule.padding || 4), start = Number(rule.seqStart || 1);
    const used = rule.resetYearly
      ? all.filter((e) => e.code && e.code.startsWith(prefix) && (suffix ? e.code.endsWith(suffix) : true)).length
      : all.length;
    let n = start + used, code;
    do { code = `${prefix}${String(n).padStart(pad, "0")}${suffix}`; n++; } while (taken.has(code));
    return code;
  }
  const prefix = (org.slug || "EMP").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "EMP";
  let n = 1000 + all.length;
  let code = `${prefix}-${n}`;
  while (taken.has(code)) code = `${prefix}-${++n}`;
  return code;
}

/**
 * Batch version of generateEmployeeCode.
 *
 * Returns a generator function that hands out successive codes against an
 * in-memory set of taken ones. Bulk import needs this because the single-shot
 * generator re-reads the employee table each call, and rows inserted earlier
 * in an open transaction aren't visible to it yet, so every row in a batch
 * would be handed the same code.
 */
function employeeCodeGenerator(org, existingCodes: Iterable<string>) {
  const taken = new Set<string>();
  for (const c of existingCodes) if (c) taken.add(String(c).toUpperCase());

  const rule = org.employeeIdRule;
  const useRule = rule && (rule.prefix || rule.suffix);
  const year = new Date().getFullYear();
  const sub = (s) => String(s || "").replace(/\{YEAR\}/g, year as any);
  const prefix = useRule
    ? sub(rule.prefix)
    : (org.slug || "EMP").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "EMP";
  const suffix = useRule ? sub(rule.suffix) : "";
  const pad = useRule ? Number(rule.padding || 4) : 0;

  let n = useRule ? Number(rule.seqStart || 1) + taken.size : 1000 + taken.size;

  return function next(): string {
    let code: string;
    do {
      code = useRule
        ? `${prefix}${String(n).padStart(pad, "0")}${suffix}`
        : `${prefix}-${n}`;
      n++;
    } while (taken.has(code.toUpperCase()));
    taken.add(code.toUpperCase());
    return code;
  };
}

export { domainForOrg, generateOfficialEmail, generateEmployeeCode, employeeCodeGenerator };
