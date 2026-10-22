/**
 * Payslips and pay runs: generating a payslip (exit-aware, verified, filed, mailed),
 * previewing one, the form context behind the generate dialog, listing, re-sending,
 * withdrawing and downloading payslips, and the pay-run history.
 *
 * Salary structures live in salary-structure.service.ts, the org's payroll rules in
 * payroll-settings.service.ts, and spreadsheet-driven runs in payslip-import.service.ts.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden, round2, money, MONTHS } from "../core/util";
import { isStaff } from "../middleware/auth";
import { generatePayslipPdf, payslipFileName } from "../pdf/payslip";
import { sendTenantMail } from "../integrations/mail/mailer";
import { notifyEmployee } from "./notification.service";
import { scopedEmployeeIdsFor } from "./caller-scope";
import { logger } from "../core/logger";
import * as storage from "../integrations/storage";
import { computePayroll } from "../domain/payroll/engine";
import { resolveRuleset } from "../domain/payroll/profile";
import {
  buildAdditionalDeductions,
  buildEarnings,
  buildExtras,
  payslipInsertRecord,
  payslipRecord,
  totalsFor,
  EXIT_DEDUCTION_FIELDS,
  statutoryRows,
  EXIT_EARNING_FIELDS,
  type PayslipLines,
} from "../domain/payroll/payslip-input";
import {
  clampPayableDays,
  governingSeparation,
  resolveExitContext,
  type ExitContext,
} from "../domain/payroll/exit-pay";
import { computeSettlement } from "../domain/settlement";
import { typeDef } from "../domain/separation-config";
import { issueVerification, revokeVerification } from "../security/verification";
import type { CountryRuleset } from "../domain/payroll/types";
import { managerOf } from "../domain/manager";

/** The caller's workspace row. Always present for an authenticated request. */
export async function currentOrg(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  if (!org) throw notFound("Organization not found");
  return org;
}

/** A month as 0-11, from a month name ("Mar", "march"), a 1-based number, or a 0-based one. */
export function clampMonth(m) {
  if (typeof m === "string") {
    const idx = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m.toLowerCase().slice(0, 3)));
    if (idx >= 0) return idx;
  }
  const n = Number(m);
  if (Number.isNaN(n)) return new Date().getMonth();
  if (n >= 1 && n <= 12) return n - 1; // 1-based input
  return Math.max(0, Math.min(11, n));
}

/** The employee a staff-only payroll action targets, refused when outside the caller's scope. */
async function inScopeEmployee(ctx: RequestContext, employeeId: string) {
  const emp = await ctx.data.employees.byId(employeeId);
  if (!emp) throw notFound("Employee not found");
  if (!ctx.inScope(emp)) throw forbidden("Outside your assigned scope");
  return emp;
}

/* ── Exit-aware assembly (shared by the preview and the commit) ───────────── */

/**
 * Work out how much of this month the employee is owed.
 *
 * `separation` is passed in when the caller already has it (a bulk run reads
 * every separation once rather than one per row); otherwise it is looked up.
 */
async function exitContextFor(ctx: RequestContext, emp, month: number, year: number, separation?: any | null): Promise<ExitContext> {
  const sep = separation !== undefined
    ? separation
    // employeeId is a hot column, so this is an indexed lookup, not a scan.
    : governingSeparation(await ctx.data.separations.where({ employeeId: emp.id }).list());
  return resolveExitContext({ separation: sep, employee: emp, month, year });
}

/**
 * The payable-day count a run will actually use, and whether it prorates.
 *
 * HR's stated figure wins over the derived one. They are the ones who know about
 * the unpaid week, the disputed final date, or the sabbatical, and the derived
 * number is a starting point rather than a verdict. `prorate: false` pays the
 * whole month regardless, which is the escape hatch for an exit that was agreed
 * as a full final month.
 */
function payableDaysFor(exit: ExitContext, body: any): { payableDays: number; prorated: boolean } {
  const stated = clampPayableDays(body?.payableDays, exit.daysInMonth);
  if (body?.prorate === false && stated === null) return { payableDays: exit.daysInMonth, prorated: false };
  const days = stated ?? exit.payableDays;
  return { payableDays: days, prorated: days < exit.daysInMonth };
}

/**
 * Turn an employee + a per-run payload into the three line groups of a payslip.
 *
 * The preview endpoint and the commit path BOTH call this, over the same body,
 * so the figures HR approved on screen are arithmetically the ones that get
 * written and printed. Splitting them was the failure mode the salary-sheet
 * preview/commit pair was built to avoid, and an exit payslip is exactly where a
 * surprise is least affordable.
 */
async function assemblePayslip(
  ctx: RequestContext, emp, month: number, year: number, body: any, ruleset: CountryRuleset,
  opts: { lines?: PayslipLines; separation?: any | null } = {},
) {
  const exit = await exitContextFor(ctx, emp, month, year, opts.separation);

  if (opts.lines) {
    // Sheet-driven run: the salary master states every component and the preview
    // showed those exact figures, so nothing here is recomputed or scaled.
    const t = totalsFor(opts.lines);
    if (t.gross <= 0) throw bad(`${emp.code}: the sheet row has no earnings, so there is nothing to pay.`);
    return {
      exit,
      payableDays: exit.daysInMonth,
      prorated: false,
      result: {
        earnings: opts.lines.earnings,
        employeeDeductions: opts.lines.deductions,
        employerContributions: opts.lines.employerContributions,
        gross: t.gross, totalDeductions: t.totalDeductions, net: t.net,
        currency: ruleset.currency, country: ruleset.country,
      },
    };
  }

  const { payableDays, prorated } = payableDaysFor(exit, body);
  // The generate dialog is a manual run: only HR's figures, no saved-structure
  // fallback for blank rows (see EarningsOptions.manual).
  const manual = body?.manual === true;
  const earnings = buildEarnings(emp, body, {
    proration: prorated ? { payableDays, daysInMonth: exit.daysInMonth } : null,
    manual,
  });

  // A zero-gross payslip is almost always a mistake (no compensation on record
  // and no amounts in the run), refuse it with a pointer to the fix. An exit that
  // genuinely owes nothing gets its own message: "set their salary" is unhelpful
  // advice when the salary is fine and the person simply left last month.
  const grossCheck = earnings.reduce((t, e) => t + Number(e.amount || 0), 0);
  if (grossCheck <= 0) {
    throw bad(
      manual && !exit.afterExit
        ? "Enter at least one earning. Blank rows are paid as 0 (use \"Fill from saved salary\" to start from the structure)."
        : exit.afterExit
        ? `${emp.code}: their last working day was ${exit.lastWorkingDay}, before this month began, so there is nothing to pay. Generate the payslip for their final month instead.`
        : payableDays <= 0 && exit.partial
          ? `${emp.code}: no payable days in this month. Set the days paid, or add the amounts to pay.`
          : `${emp.code}: no compensation on record and no amounts provided. Set their salary (Employees, Set compensation) or include earnings in the upload.`,
    );
  }

  const result = computePayroll({
    earnings,
    ruleset,
    // A manual run does not pull the employee's stored PF amount either; a PF
    // figure has to be typed (or computed by the org's rules) to apply.
    extras: buildExtras(ruleset, body, manual ? undefined : emp),
    // Per-employee eligibility and overrides live on the salary record, so a
    // person opted out of PF, or on a hand-set figure, stays that way on every
    // run without HR re-entering it each month.
    statutory: emp.salary?.statutory,
    additionalDeductions: buildAdditionalDeductions(body),
  });

  return { exit, payableDays, prorated, result };
}

/**
 * Generate (or re-generate) one employee's payslip for a month.
 *
 * `opts.lines` short-circuits the payroll engine with amounts read straight off a
 * salary sheet. Everything else (PDF, verification, document filing,
 * notification, optional email) is identical either way.
 */
export async function createPayslip(
  ctx: RequestContext, emp, month, year, extras, email,
  opts: { ruleset?: CountryRuleset; lines?: PayslipLines; separation?: any | null } = {},
) {
  const ruleset = opts.ruleset;
  const lines = opts.lines;
  // prevent duplicate for same month/year, overwrite if exists
  const existing = await ctx.data.payslips.forPeriod(emp.id, month, year); // indexed (employeeId+month+year hot cols)
  const org = await currentOrg(ctx);
  const dept = emp.departmentId ? await ctx.data.departments.byId(emp.departmentId) : null;

  // Resolve the org's effective country ruleset (cached per request by callers).
  const rules = ruleset || (await resolveRuleset(ctx.repos, org));

  const { result, exit, payableDays, prorated } = await assemblePayslip(
    ctx, emp, month, year, extras, rules, { lines, separation: opts.separation },
  );

  const slip = {
    month, year,
    earnings: result.earnings,
    deductions: result.employeeDeductions,
    employerContributions: result.employerContributions,
    currency: result.currency,
    locale: rules.locale,
    // Printed only on a payslip that is NOT a whole month. On an ordinary run the
    // PDF deliberately says nothing, because stating "30 days paid" would be a
    // claim about attendance the payroll module has no evidence for.
    ...(prorated ? { daysPaid: payableDays } : {}),
  };
  // Resolve the extra letterhead facts HR asked to see on every document.
  const managerId = managerOf(emp);
  const manager = managerId
    ? await ctx.data.employees.byId(managerId)
    : null;
  const office = emp.officeId ? await ctx.data.offices.byId(emp.officeId) : null;

  // Issue the verification record BEFORE rendering, so the QR, the short code
  // and the content digest can be printed onto the PDF itself.
  const verification = await issueVerification({
    kind: "PAYSLIP",
    orgId: org.id,
    orgName: org.name,
    employeeId: emp.id,
    subjectName: `${emp.firstName} ${emp.lastName || ""}`.trim(),
    subjectCode: emp.code || null,
    facts: {
      period: `${MONTHS[month]} ${year}`,
      month, year,
      gross: result.gross,
      totalDeductions: result.totalDeductions,
      net: result.net,
      currency: result.currency,
      employeeCode: emp.code || "",
    },
    // Deliberately narrow: confirming a payslip is genuine must not hand a
    // stranger the salary. HR can widen this later if a bank requires it.
    disclose: ["period"],
    issuedBy: ctx.user.id,
  });

  const pdf: any = await generatePayslipPdf({
    org,
    employee: {
      ...emp,
      _departmentName: dept ? dept.name : null,
      _managerName: manager ? `${manager.firstName} ${manager.lastName || ""}`.trim() : null,
      _officeName: office ? office.name : null,
    },
    slip,
    verification,
  });
  await storage.putBuffer("payslips", pdf.fileName, pdf.buffer, "application/pdf");
  // payslipRecord() carries no `emailedAt`: repo.update merges, so a re-generate
  // must not wipe the stamp of a payslip the employee already received. The
  // stamp is written below, only when an email is actually sent.
  const fields = {
    employeeId: emp.id, month, year, result, filename: pdf.fileName, verification,
    period: {
      payableDays: prorated ? payableDays : null,
      daysInMonth: prorated ? exit.daysInMonth : null,
      lastWorkingDay: exit.lastWorkingDay,
      prorated,
    },
  };
  const saved: any = existing
    ? await ctx.data.payslips.update(existing.id, payslipRecord(fields))
    : await ctx.data.payslips.create(payslipInsertRecord(fields));

  // Re-generating is how HR corrects a payslip. The old copy may already be in
  // the employee's inbox, so its code must stop verifying as genuine; it now
  // says it was superseded. Best effort: the new payslip is already saved.
  if (existing?.verifyCode && existing.verifyCode !== verification.code) {
    try {
      await revokeVerification(existing.verifyCode, `Superseded by a corrected payslip for ${MONTHS[month]} ${year}.`, {
        orgId: ctx.orgId, byUserId: ctx.user.id,
      });
    } catch (err: any) {
      logger.warn({ err, payslipId: existing.id }, "old payslip verification not revoked");
    }
  }

  // File the payslip into the employee's documents as well.
  //
  // Offer and relieving letters already did this, but payslips did not, so an
  // employee's document record had every letter we ever issued them and none
  // of their payslips, and "all my documents in one place" wasn't true. Keyed
  // on month+year so a re-run replaces rather than duplicates.
  const slipTitle = `Payslip, ${MONTHS[month]} ${year}`;
  const existingDoc = await ctx.data.documents.findOne(
    (d) => d.employeeId === emp.id && d.category === "PAYSLIP" && d.payslipMonth === month && d.payslipYear === year
  );
  const docRow = {
    employeeId: emp.id,
    title: slipTitle,
    description: `Net ${result.currency} ${result.net.toLocaleString(rules.locale || "en-IN")}`,
    category: "PAYSLIP",
    visibility: "PRIVATE",
    departmentIds: [],
    tags: ["payslip", String(year), MONTHS[month]],
    storage: "payslips",
    filename: pdf.fileName,
    originalName: `${slipTitle.replace(/[^\w-]+/g, "_")}.pdf`,
    mimeType: "application/pdf",
    payslipMonth: month,
    payslipYear: year,
    verifyCode: verification.code,
    verifyUrl: verification.url,
    uploadedBy: ctx.user.id,
    system: true,
  };
  if (existingDoc) await ctx.data.documents.update(existingDoc.id, docRow);
  else await ctx.data.documents.create(docRow);

  await notifyEmployee(ctx.repos, emp.id, { type: "PAYSLIP", title: `Payslip ready: ${MONTHS[month]} ${year}`, body: `Your payslip for ${MONTHS[month]} ${year} is available to download.`, link: "mypayslips" });

  let emailed = false;
  if (email) {
    const r = await sendTenantMail(org, {
      to: emp.email,
      subject: `${org.name} - Payslip for ${MONTHS[month]} ${year}`,
      html: `<div style="font-family:Arial">Hi ${emp.firstName},<br/><br/>Please find attached your payslip for
        <b>${MONTHS[month]} ${year}</b>. Net pay: <b>${money(result.net, result.currency, rules.locale)}</b>.<br/><br/>Regards,<br/>${org.name} HR</div>`,
      attachments: [{ filename: pdf.fileName, content: pdf.buffer }],
    });
    // Only stamp emailedAt when the provider actually accepted it. This used to be set
    // unconditionally, so a payslip written to the dev outbox, or one SES rejected,
    // still recorded "emailed" and the UI showed the badge for mail nobody received.
    emailed = !!r.delivered;
    if (emailed) {
      await ctx.data.payslips.update(saved.id, { emailedAt: new Date().toISOString() });
    } else {
      // Not an error the caller should fail on (mail is best effort), but it must be
      // visible: a silent non-send is indistinguishable from a delivered one otherwise.
      logger.warn(
        { to: emp.email, payslipId: saved.id, mode: (r as any).mode, error: (r as any).error },
        "payslip email not delivered"
      );
    }
  }
  return { payslip: { ...saved, monthName: MONTHS[month] }, emailed, emailError: (emailed ? null : "not delivered") };
}

/* ── Endpoints ────────────────────────────────────────────────────────────── */

/** Generate one payslip from the generate dialog, and record it as a single-payslip pay run. */
export async function generatePayslip(ctx: RequestContext, body: Record<string, any>) {
  const e = await inScopeEmployee(ctx, body.employeeId);
  const month = clampMonth(body.month);
  const year = Number(body.year) || new Date().getFullYear();
  const out = await createPayslip(ctx, e, month, year, body, !!body.email);

  // A single generation IS a payroll run, and until now it was the one way of
  // producing a payslip that left no trace in the run history, so an org that
  // never used the bulk upload was told "generate a payslip to get started"
  // after generating payslips all year.
  const run = await ctx.data.payRuns.create({
    source: "SINGLE",
    file: null,
    periods: [`${MONTHS[month]} ${year}`],
    processed: 1,
    succeeded: 1,
    failed: 0,
    netTotal: round2(Number(out.payslip.net) || 0),
    emailed: out.emailed ? 1 : 0,
    runBy: ctx.user.id,
  });
  return { ...out, payRunId: run.id };
}

/**
 * Everything the generate-payslip form needs BEFORE anybody types a number:
 * whether this person left part-way through the month, how many days they are
 * owed, what each recurring component comes to once scaled, and what is already
 * on record for the period.
 *
 * This exists because the alternative is HR doing the arithmetic. Until now the
 * form offered a full month's structure whatever the separation said, so the
 * only way to pay somebody correctly for their final month was to know the
 * proration rule, apply it by hand, and type the results in, every time. The
 * numbers here are a starting point: every one of them is editable, and the
 * commit re-derives its own from the body it is sent.
 */
export async function payslipContext(ctx: RequestContext, query: { employeeId?: unknown; month?: unknown; year?: unknown }) {
  const emp = await inScopeEmployee(ctx, String(query.employeeId || ""));

  const month = clampMonth(query.month);
  const year = Number(query.year) || new Date().getFullYear();
  const org = await currentOrg(ctx);
  const rules = await resolveRuleset(ctx.repos, org);

  const separation = governingSeparation(await ctx.data.separations.where({ employeeId: emp.id }).list());
  const exit = resolveExitContext({ separation, employee: emp, month, year });

  // Full-month figures beside the scaled ones, so the form can show what was
  // reduced and by how much rather than presenting a smaller number with no
  // explanation. Both come from buildEarnings, so neither can drift from what
  // the commit will actually compute.
  const full = buildEarnings(emp, {});
  const scaled = buildEarnings(emp, {}, {
    proration: exit.partial ? { payableDays: exit.payableDays, daysInMonth: exit.daysInMonth } : null,
  });
  const scaledByKey = new Map(scaled.map((l) => [l.key, l.amount]));
  const recurring = full.map((l) => ({
    key: l.key,
    label: l.label,
    fullMonth: l.amount,
    suggested: scaledByKey.get(l.key) ?? l.amount,
  }));

  /*
   * Leave encashment is SUGGESTED, never applied.
   *
   * The figure comes from the same computeSettlement() the F&F statement uses, so
   * the two documents agree by construction. It is offered rather than added
   * because encashment is frequently settled separately from the final payslip,
   * and quietly paying it twice is a mistake nobody catches until the employee
   * banks it.
   */
  let suggestions: Record<string, number> = {};
  if (separation && exit.lastWorkingDay) {
    try {
      const settlement = await computeSettlement(ctx.repos, separation, emp, { recoveries: separation.recoveries || 0 });
      if (settlement.leaveEncashment > 0) suggestions.leaveEncashment = settlement.leaveEncashment;
    } catch {
      // A suggestion is not worth failing the form over; HR types it instead.
      suggestions = {};
    }
  }

  const existing = await ctx.data.payslips.forPeriod(emp.id, month, year);

  return {
    employee: {
      id: emp.id, code: emp.code || null, status: emp.status || null,
      name: `${emp.firstName} ${emp.lastName || ""}`.trim(),
      joiningDate: emp.joiningDate || null,
    },
    period: { month, year, monthName: MONTHS[month], daysInMonth: exit.daysInMonth },
    exit: {
      ...exit,
      typeLabel: exit.separationType ? typeDef(exit.separationType).label : null,
      noticeDays: separation?.noticeDays ?? null,
    },
    recurring,
    suggestions,
    exitEarningFields: EXIT_EARNING_FIELDS,
    exitDeductionFields: EXIT_DEDUCTION_FIELDS,
    statutoryComponents: statutoryRows(rules, emp.salary?.statutory),
    currency: rules.currency,
    locale: rules.locale,
    // Re-generating replaces rather than duplicates, but the form should say so
    // before HR discovers it.
    existing: existing ? { id: existing.id, net: existing.net, emailedAt: existing.emailedAt ?? null } : null,
  };
}

/**
 * Compute a payslip WITHOUT writing one.
 *
 * Takes the same body as generatePayslip and returns the same lines the commit
 * would produce, by calling the same assembler. Nothing is persisted, no PDF is
 * rendered and no mail is sent, so HR can watch the net move as they enter a
 * severance or a recovery and commit only once it reads correctly.
 */
export async function previewPayslip(ctx: RequestContext, body: Record<string, any>) {
  const emp = await inScopeEmployee(ctx, body.employeeId);
  const month = clampMonth(body.month);
  const year = Number(body.year) || new Date().getFullYear();
  const org = await currentOrg(ctx);
  const rules = await resolveRuleset(ctx.repos, org);

  const { result, exit, payableDays, prorated } = await assemblePayslip(ctx, emp, month, year, body, rules);
  const employerCost = round2(result.employerContributions.reduce((t, l) => t + Number(l.amount || 0), 0));

  return {
    period: { month, year, monthName: MONTHS[month] },
    earnings: result.earnings,
    deductions: result.employeeDeductions,
    employerContributions: result.employerContributions,
    gross: result.gross,
    totalDeductions: result.totalDeductions,
    net: result.net,
    employerCost,
    currency: result.currency,
    locale: rules.locale,
    prorated,
    payableDays,
    daysInMonth: exit.daysInMonth,
    lastWorkingDay: exit.lastWorkingDay,
  };
}

/** History of payroll runs, most recent first. */
export function listPayRuns(ctx: RequestContext) {
  return ctx.data.payRuns.newestFirst();
}

/** Payslips: staff see everyone in scope (optionally one employee), others their own. */
export async function listPayslips(ctx: RequestContext, filter: { employeeId?: string; month?: unknown; year?: unknown }) {
  const emps = await ctx.data.employees.all();
  const names = Object.fromEntries(emps.map((e) => [e.id, `${e.firstName} ${e.lastName || ""}`.trim()]));
  let list = await ctx.data.payslips.all();
  if (!isStaff(ctx.user)) list = list.filter((p) => p.employeeId === ctx.user.employeeId);
  else if (filter.employeeId) list = list.filter((p) => p.employeeId === filter.employeeId);
  // Scoped staff only see payslips for in-scope employees.
  const inScope = await scopedEmployeeIdsFor(ctx); // null = org-wide
  if (inScope) list = list.filter((p) => inScope.has(p.employeeId));
  if (filter.year) list = list.filter((p) => p.year === Number(filter.year));
  if (filter.month) list = list.filter((p) => p.month === clampMonth(filter.month));
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  // Old payslips predate multi-currency, default them to INR so the UI can
  // always format an amount.
  return list.map((p) => ({
    ...p,
    currency: p.currency || "INR",
    employeeName: names[p.employeeId] || "-",
    monthName: MONTHS[p.month],
  }));
}

/**
 * Send, or re-send, a payslip that already exists.
 *
 * Until now the ONLY way to email a payslip was to tick the box while generating
 * it, so a payslip generated without the box, or one whose delivery bounced, or
 * one an employee simply lost, could only be re-sent by generating it all over
 * again. That is a bad instrument for the job: a re-generate recomputes from
 * whatever the salary record says TODAY, so re-sending an old payslip could
 * quietly reissue it at a since-revised salary. This sends the stored PDF, byte
 * for byte, and changes nothing about the payslip itself.
 *
 * `to` overrides the address. It defaults to the employee's own, EXCEPT for
 * someone who has left, where their personal address is preferred: their work
 * mailbox is normally shut off on exit, which is precisely when the request to
 * re-send a payslip arrives.
 */
export async function emailPayslip(ctx: RequestContext, id: string, input: { to?: string }) {
  const p = await ctx.data.payslips.byId(id);
  if (!p) throw notFound("Payslip not found");
  const emp = await ctx.data.employees.byId(p.employeeId);
  if (!emp) throw notFound("Employee not found");
  if (!ctx.inScope(emp)) throw forbidden("Outside your assigned scope");

  const gone = ["EXITED", "ABSCONDING"].includes(String(emp.status));
  const fallback = gone
    ? emp.personalEmail || emp.email || emp.officialEmail
    : emp.email || emp.officialEmail || emp.personalEmail;
  const to = String(input.to || fallback || "").trim();
  if (!to || !to.includes("@")) {
    throw bad("No email address on record for this employee. Add one, or supply an address to send to.");
  }

  if (!(await storage.exists("payslips", p.filename))) {
    throw notFound("The PDF for this payslip is missing from storage. Generate the payslip again to recreate it.");
  }
  const buffer = await storage.getBuffer("payslips", p.filename);
  const org = await currentOrg(ctx);
  const rules = await resolveRuleset(ctx.repos, org);
  const period = `${MONTHS[p.month]} ${p.year}`;
  const currency = p.currency || rules.currency;
  const downloadName = payslipFileName(org, emp, p.month, p.year);

  const r = await sendTenantMail(org, {
    to,
    subject: `${org.name} - Payslip for ${period}`,
    html: `<div style="font-family:Arial">Hi ${emp.firstName},<br/><br/>Please find attached your payslip for
      <b>${period}</b>. Net pay: <b>${money(Number(p.net) || 0, currency, rules.locale)}</b>.<br/><br/>Regards,<br/>${org.name} HR</div>`,
    attachments: [{ filename: downloadName, content: buffer }],
  });

  // Only stamped when the provider actually accepted it, matching the generate
  // path: a payslip written to the dev outbox, or one SES rejected, must not
  // wear an "Emailed" badge for mail nobody received.
  const emailedAt = r.delivered ? new Date().toISOString() : null;
  if (emailedAt) await ctx.data.payslips.update(p.id, { emailedAt });
  else logger.warn({ to, payslipId: p.id, mode: (r as any).mode, error: (r as any).error }, "payslip re-send not delivered");

  await ctx.data.auditLog.create({
    action: "PAYSLIP_EMAILED",
    userId: ctx.user.id,
    employeeId: emp.id,
    meta: { payslipId: p.id, period, to, delivered: !!r.delivered, mode: (r as any).mode, resend: !!p.emailedAt },
  });

  /*
   * A non-delivery is only an ERROR when something actually went wrong.
   *
   * `outbox` is one of the mailer's three supported modes and means "write the
   * message to disk instead of sending it" -- the deployment is configured not to
   * send, and nothing failed. Failing the request there would make the button
   * appear permanently broken on every environment that has not set up SES, which
   * is every developer machine. A real provider rejection still throws, because
   * the whole point of pressing Re-send is to find out whether it went.
   */
  const mode = String((r as any).mode || "");
  if (!r.delivered && mode !== "outbox") {
    throw bad(
      `The payslip could not be delivered to ${to}` +
        `${(r as any).error ? `: ${(r as any).error}` : "."} Check the sending domain under Settings, Sending email.`,
    );
  }
  return {
    ok: true, to, delivered: !!r.delivered, mode, emailedAt,
    ...(r.delivered ? {} : { note: "Mail sending is not configured on this environment, so the message was written to the local outbox instead of being sent." }),
  };
}

/**
 * Withdraw a faulty payslip.
 *
 * Three things go with the row, in this order:
 *   1. its public verification code is REVOKED (not deleted), so a copy that
 *      was already emailed or downloaded stops verifying as genuine and says
 *      the issuer withdrew it, instead of "no such document";
 *   2. the row itself, and its copy in the employee's documents;
 *   3. the PDF in storage, best effort: a leftover file is unreachable once the
 *      row is gone, and must not turn a successful delete into an error.
 * Revoking first means a failure there leaves the payslip in place to retry,
 * never a deleted payslip whose code still says VALID.
 *
 * The pay-run history row is left alone: it records that a run happened.
 */
export async function deletePayslip(ctx: RequestContext, id: string, input: { reason?: unknown }) {
  const p = await ctx.data.payslips.byId(id);
  if (!p) throw notFound("Payslip not found");
  const emp = await ctx.data.employees.byId(p.employeeId);
  if (emp && !ctx.inScope(emp)) throw forbidden("Outside your assigned scope");

  const period = `${MONTHS[p.month]} ${p.year}`;
  const reason = String(input.reason || "").trim().slice(0, 200);
  const revoked = await revokeVerification(
    p.verifyCode,
    reason ? `Payslip for ${period} withdrawn: ${reason}` : `Payslip for ${period} withdrawn by the employer.`,
    { orgId: ctx.orgId, byUserId: ctx.user.id },
  );

  await ctx.data.payslips.remove(p.id);
  // The same payslip is filed in the employee's documents (see createPayslip);
  // left behind, it would keep offering the withdrawn PDF there.
  const doc = await ctx.data.documents.findOne(
    (d) => d.employeeId === p.employeeId && d.category === "PAYSLIP" && d.payslipMonth === p.month && d.payslipYear === p.year,
  );
  if (doc) await ctx.data.documents.remove(doc.id);
  if (p.filename) {
    try {
      await storage.remove("payslips", p.filename);
    } catch (err: any) {
      logger.warn({ err, payslipId: p.id }, "payslip PDF not removed from storage");
    }
  }

  await ctx.data.auditLog.create({
    action: "PAYSLIP_DELETED",
    userId: ctx.user.id,
    employeeId: p.employeeId,
    meta: {
      payslipId: p.id, period, net: p.net, gross: p.gross,
      wasEmailed: !!p.emailedAt, verifyCode: p.verifyCode ?? null, revoked, reason: reason || null,
    },
  });

  return { ok: true, revoked };
}

/**
 * Where a payslip's PDF lives and what to call the download, after checking the
 * caller may read it.
 *
 * The file is named `payslip_<org>_<code>_<YYYY-MM>.pdf`. Recomputed rather than
 * trusted: payslips stored before the naming scheme existed still download under
 * a name a human can file.
 */
export async function payslipDownload(ctx: RequestContext, id: string) {
  const p = await ctx.data.payslips.byId(id);
  if (!p) throw notFound("Payslip not found");
  if (!isStaff(ctx.user) && p.employeeId !== ctx.user.employeeId) throw forbidden();
  const emp = await ctx.data.employees.byId(p.employeeId);
  if (p.employeeId !== ctx.user.employeeId && !ctx.inScope(emp)) throw forbidden("Outside your assigned scope");
  if (!(await storage.exists("payslips", p.filename))) throw notFound("Payslip PDF missing in storage");

  const org = await currentOrg(ctx);
  const downloadName: string = emp ? payslipFileName(org, emp, p.month, p.year) : p.filename;
  return { prefix: "payslips", filename: p.filename as string, downloadName };
}
