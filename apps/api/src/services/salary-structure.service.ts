/**
 * Salary structures (CTC -> monthly breakup): the org's templates, the live
 * preview behind the compensation editor, and each employee's salary record.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden } from "../core/util";
import { isStaff } from "../middleware/auth";
import { computePayroll } from "../domain/payroll/engine";
import { resolveRuleset, orgPayrollSettings, listStructures, saveStructures, structureById } from "../domain/payroll/profile";
import { resolveSalary, salaryFromStructure } from "../domain/payroll/structure";
import { num } from "../domain/payroll/payslip-input";
import type { CountryRuleset } from "../domain/payroll/types";
import { currentOrg } from "./payroll.service";

/**
 * Keep only the statutory fields we understand, and only where they are numbers
 * or booleans. An override arriving as a string would be stored and then compared
 * numerically by the engine, which is the sort of thing that silently zeroes a
 * deduction.
 */
export function normaliseStatutory(raw: any) {
  if (!raw || typeof raw !== "object") return undefined;
  const numOrUndef = (v: any) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : undefined);
  const out: any = {};
  if (raw.pf) {
    out.pf = {
      applicable: raw.pf.applicable !== false,
      restrictToCeiling: raw.pf.restrictToCeiling !== false,
      ...(raw.pf.uan ? { uan: String(raw.pf.uan).trim() } : {}),
      ...(numOrUndef(raw.pf.override) !== undefined ? { override: numOrUndef(raw.pf.override) } : {}),
    };
  }
  if (raw.esi) {
    out.esi = {
      applicable: raw.esi.applicable !== false,
      ...(numOrUndef(raw.esi.override) !== undefined ? { override: numOrUndef(raw.esi.override) } : {}),
    };
  }
  if (raw.professionalTax) {
    out.professionalTax = {
      applicable: raw.professionalTax.applicable !== false,
      ...(raw.professionalTax.state ? { state: String(raw.professionalTax.state) } : {}),
      ...(numOrUndef(raw.professionalTax.override) !== undefined ? { override: numOrUndef(raw.professionalTax.override) } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * How this organisation reads a CTC, and how to cost the employer side of one.
 *
 * Returned as one object so the preview and the save path take the SAME
 * convention from the SAME place. If they diverged, HR would agree one breakup on
 * screen and store a different one, which is the kind of defect nobody notices
 * until an employee compares their payslip to their offer letter.
 */
export function ctcOptionsFor(org: any, ruleset: CountryRuleset, statutory?: any) {
  return {
    ctcIncludesEmployerContributions: orgPayrollSettings(org).ctcIncludesEmployerContributions,
    // Costed by the payroll engine itself, so the figure reserved out of the CTC
    // is the one that will actually be contributed each month.
    employerCostOf: (monthly: any[]) =>
      computePayroll({ earnings: monthly, ruleset, statutory }).employerContributions.reduce(
        (t: number, l: any) => t + Number(l.amount || 0),
        0,
      ),
  };
}

function requireStaff(ctx: RequestContext) {
  if (!isStaff(ctx.user)) throw forbidden("Staff access required");
}

/**
 * The org's templates, seeded with the India default on first use.
 * Readable by any staff member: the compensation editor needs it to render.
 */
export async function listSalaryStructures(ctx: RequestContext) {
  requireStaff(ctx);
  return listStructures(ctx.repos, await ctx.data.organizations.byId(ctx.orgId));
}

/** Replace the org's structures after validating every component. */
export async function saveSalaryStructures(ctx: RequestContext, rawStructures: unknown) {
  const raw = Array.isArray(rawStructures) ? rawStructures : [];
  if (!raw.length) throw bad("Keep at least one salary structure.");

  const CALCS = ["PERCENT_OF_CTC", "PERCENT_OF_BASIC", "FLAT_MONTHLY", "BALANCE"];
  const structures = raw.map((st: any, i: number) => {
    const name = String(st?.name || "").trim();
    if (!name) throw bad(`Structure ${i + 1} needs a name.`);
    const comps = Array.isArray(st.components) ? st.components : [];
    if (!comps.length) throw bad(`"${name}" has no components.`);
    if (comps.filter((c: any) => c?.calc === "BALANCE").length > 1) {
      throw bad(`"${name}" has more than one balancing component. Only one can absorb the remainder.`);
    }
    const seen = new Set<string>();
    return {
      id: String(st.id || `st-${Date.now()}-${i}`),
      name,
      isDefault: !!st.isDefault,
      components: comps.map((c: any) => {
        const key = String(c?.key || "").trim();
        if (!key) throw bad(`"${name}" has a component with no key.`);
        if (seen.has(key)) throw bad(`"${name}" uses the component "${key}" twice.`);
        seen.add(key);
        const calc = String(c?.calc || "").toUpperCase();
        if (!CALCS.includes(calc)) throw bad(`"${name}": "${key}" has an unknown calculation "${c?.calc}".`);
        return {
          key,
          label: String(c.label || key),
          calc,
          value: calc === "BALANCE" ? undefined : Number(c.value) || 0,
          taxable: c.taxable !== false,
        };
      }),
    };
  });

  // Exactly one default, for the same reason onboarding forms have exactly one:
  // otherwise which structure a new hire gets depends on row order.
  if (!structures.some((x: any) => x.isDefault)) structures[0].isDefault = true;
  let seenDefault = false;
  for (const st of structures) {
    if (st.isDefault && seenDefault) st.isDefault = false;
    if (st.isDefault) seenDefault = true;
  }

  const org = await ctx.data.organizations.byId(ctx.orgId);
  const saved = await saveStructures(ctx.repos, org, structures as any);
  await ctx.data.auditLog.create({
    action: "SALARY_STRUCTURES_UPDATED",
    userId: ctx.user.id,
    meta: { count: saved.length, names: saved.map((x: any) => x.name) },
  });
  return saved;
}

/**
 * The live breakup behind the compensation editor, plus what it will actually
 * cost: employer PF/ESI are computed here rather than in the browser so the
 * figure HR agrees to at hire time is the one payroll will produce.
 */
export async function previewSalaryStructure(ctx: RequestContext, body: Record<string, any>) {
  requireStaff(ctx);
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const structure = await structureById(ctx.repos, org, body?.structureId);

  const rules = await resolveRuleset(ctx.repos, org);
  const settings = orgPayrollSettings(org);
  const result = resolveSalary({
    structure,
    annualCtc: Number(body?.annualCtc) || null,
    monthlyGross: Number(body?.monthlyGross) || null,
    employmentType: body?.employmentType,
    ctc: ctcOptionsFor(org, rules, body?.statutory),
  });
  if (!result) throw bad("Enter an annual CTC to see the breakup.");

  const run = computePayroll({
    earnings: result.monthly,
    ruleset: rules,
    statutory: body?.statutory,
  });

  const employerCost = run.employerContributions.reduce((t: number, l: any) => t + l.amount, 0);
  return {
    structureId: structure?.id ?? null,
    monthly: result.monthly,
    gross: result.gross,
    annualGross: result.annualGross,
    deductions: run.employeeDeductions,
    employerContributions: run.employerContributions,
    net: run.net,
    // What the role actually costs: gross plus the employer-side contributions.
    // Under the gross-only convention this is MORE than the CTC that was typed;
    // under the inclusive one it reconciles back to it.
    trueAnnualCtc: Math.round((result.gross + employerCost) * 12),
    employerCost,
    annualEmployerCost: Math.round(employerCost * 12),
    ctcIncludesEmployerContributions: settings.ctcIncludesEmployerContributions,
    currency: rules.currency,
  };
}

/** One employee's salary record: their own, or (staff) anyone in scope. */
export async function getEmployeeSalary(ctx: RequestContext, employeeId: string) {
  const e = await ctx.data.employees.byId(employeeId);
  if (!e) throw notFound("Employee not found");
  if (!isStaff(ctx.user) && e.id !== ctx.user.employeeId) throw forbidden();
  if (e.id !== ctx.user.employeeId && !ctx.inScope(e)) throw forbidden("Outside your assigned scope");
  return { employeeId: e.id, employmentType: e.employmentType, salary: e.salary };
}

/** Set an employee's compensation, from an annual CTC or an explicit breakup. Returns the saved salary. */
export async function updateEmployeeSalary(ctx: RequestContext, employeeId: string, s: Record<string, any>) {
  const e = await ctx.data.employees.byId(employeeId);
  if (!e) throw notFound("Employee not found");
  if (!ctx.inScope(e)) throw forbidden("Outside your assigned scope");
  const prev = e.salary || {};

  // An annual CTC is the primary way to state compensation; the structure derives
  // the rest. An explicit breakup is still accepted verbatim, because appraisal
  // letters and the bulk grid state revised figures directly.
  const org = await currentOrg(ctx);
  const wantsCtc = Number(s.annualCtc) > 0;
  const structure = wantsCtc ? await structureById(ctx.repos, org, s.structureId ?? prev.structureId) : null;

  const resolved = wantsCtc
    ? resolveSalary({
        structure,
        annualCtc: Number(s.annualCtc),
        employmentType: e.employmentType,
        // Same convention, same costing function as the preview above.
        ctc: ctcOptionsFor(org, await resolveRuleset(ctx.repos, org), normaliseStatutory(s.statutory) ?? e.salary?.statutory),
      })
    : null;

  const salary: any = resolved
    ? salaryFromStructure(resolved, {
        currency: s.currency || prev.currency || orgPayrollSettings(org).currency,
        annualCtc: Number(s.annualCtc),
        structureId: structure?.id ?? null,
      })
    : {
        // Always keep the legacy keys populated (letters/settlement/reports may
        // read them) AND maintain components[] for the engine.
        basic: num(s.basic, prev.basic),
        hra: num(s.hra, prev.hra),
        allowances: num(s.allowances, prev.allowances),
        deductions: num(s.deductions, prev.deductions),
      };

  if (!resolved) {
    if (s.currency) salary.currency = String(s.currency);
    else if (prev.currency) salary.currency = prev.currency;

    if (Array.isArray(s.components)) {
      salary.components = s.components
        .filter((c: any) => c && c.key)
        .map((c: any) => ({ key: String(c.key), label: String(c.label || c.key), amount: num(c.amount), taxable: c.taxable !== false }));
    } else {
      salary.components = [
        { key: "basic", label: "Basic", amount: salary.basic },
        { key: "hra", label: "HRA", amount: salary.hra },
        { key: "allowances", label: "Allowances", amount: salary.allowances },
      ].filter((c) => c.amount);
    }
    // Carry forward what this request did not restate. Rebuilding the object
    // from the body alone silently dropped the CTC and the statutory flags the
    // moment anyone saved a plain breakup.
    if (prev.annualCtc && !wantsCtc) salary.annualCtc = prev.annualCtc;
    if (prev.structureId) salary.structureId = prev.structureId;
  }

  // Statutory eligibility and overrides: explicit when sent, preserved otherwise.
  const statutory = s.statutory !== undefined ? normaliseStatutory(s.statutory) : prev.statutory;
  if (statutory) salary.statutory = statutory;

  const updated: any = await ctx.data.employees.update(e.id, { salary });
  await ctx.data.auditLog.create({
    action: "SALARY_STRUCTURE_UPDATED",
    userId: ctx.user.id,
    employeeId: e.id,
    // Field names and the headline figure only; the full breakup is on the record.
    meta: { annualCtc: salary.annualCtc ?? null, structureId: salary.structureId ?? null, gross: resolved?.gross ?? null },
  });
  return updated.salary;
}
