/**
 * Onboarding cases: the employee's own form, and HR's review queue.
 *
 * Nothing in the self-service half can write to `employees`. It only ever stages onto the
 * case; approval (commitCase) is the one place a case reaches the employee record.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden, isoDate } from "../core/util";
import { scopedEmployeeIdsFor } from "./caller-scope";
import { docCategoryLabel } from "../domain/documents";
import * as storage from "../integrations/storage";
import { logger } from "../core/logger";
import { renderCustodyForm, custodyItemsFor } from "../domain/asset-custody";
import { notifyAndEmail, notifyStaff } from "./notification.service";
import { sendTenantMail } from "../integrations/mail/mailer";
import { welcomeEmail } from "../integrations/mail/templates";
import { PORTAL_URL } from "../core/config";
import { checkCase, diffAgainstEmployee, OPEN_STATUSES } from "../domain/onboarding-case";
import * as actions from "../domain/onboarding-actions";
import { sectionOf, type ActorContext } from "../domain/onboarding-actions";
import type { Section } from "../domain/onboarding-template";
import {
  createCase,
  decorateCase,
  commitCase,
  reviewSection,
  allSectionsApproved,
  isOverdue,
  resolveTemplate,
} from "./onboarding.service";
import type { UploadedFile } from "./document.service";

/* ── Helpers ────────────────────────────────────────────────────────────────────────── */

/** The signed-in person's open case, or null. */
async function myOpenCase(ctx: RequestContext) {
  if (!ctx.user.employeeId) return null;
  const mine = await ctx.data.onboardingCases.forEmployee(ctx.user.employeeId);
  const open = mine.filter((c: any) => OPEN_STATUSES.includes(c.status) || c.status === "SUBMITTED");
  // Newest first: a second case is only ever opened after an earlier one was approved or
  // cancelled, so the most recent is always the live one.
  open.sort((a: any, b: any) => (a.createdAt < b.createdAt ? 1 : -1));
  return open[0] || null;
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 *  EMPLOYEE SELF-SERVICE
 *
 *  Thin adapters. Every operation lives in onboarding-actions.ts so the pre-hire flow, which
 *  authenticates with a link token instead of a session, runs exactly the same code. These
 *  functions do one thing each: resolve the case from the session, then delegate.
 * ════════════════════════════════════════════════════════════════════════════════════ */

/** The case, or a 404 with wording that fits somebody who was told to expect a form. */
async function mine(ctx: RequestContext) {
  const row = await myOpenCase(ctx);
  if (!row) throw notFound("You have no onboarding form to complete.");
  return row;
}

/** The signed-in person acts as themselves. `userAgent` is the request's User-Agent header. */
const actorOf = (ctx: RequestContext, userAgent: string): ActorContext => ({
  actorId: ctx.user.id,
  employeeId: ctx.user.employeeId,
  ip: ctx.ip,
  userAgent,
});

const withEmployee = async (ctx: RequestContext, row: any) =>
  decorateCase(row, await ctx.data.employees.byId(ctx.user.employeeId));

/** The form I have been asked to complete. */
export async function getMyCase(ctx: RequestContext) {
  const row = await myOpenCase(ctx);
  if (!row) return { case: null };
  const employee = await ctx.data.employees.byId(ctx.user.employeeId);
  return { case: decorateCase(row, employee), overdue: isOverdue(row) };
}

/** Save one section: { values } | { rows }. */
export async function saveMySection(ctx: RequestContext, key: string, body: any, userAgent: string) {
  const { case: updated, errors } = await actions.saveSection(
    ctx.repos, await mine(ctx), key, body, actorOf(ctx, userAgent)
  );
  // 200 with the errors attached, not 400. The wizard autosaves as somebody types, so a
  // half-typed PAN must be stored and reported, never rejected and lost.
  return { case: await withEmployee(ctx, updated), errors };
}

export async function acknowledgeMyPolicies(ctx: RequestContext, policyIds: any, userAgent: string) {
  const updated = await actions.acknowledgePolicies(ctx.repos, await mine(ctx), policyIds, actorOf(ctx, userAgent));
  return withEmployee(ctx, updated);
}

export async function signMyDeclaration(ctx: RequestContext, fullName: any, userAgent: string) {
  const updated = await actions.signDeclaration(ctx.repos, await mine(ctx), fullName, actorOf(ctx, userAgent));
  return withEmployee(ctx, updated);
}

/** What HR issued me, for the acknowledge block. */
export async function listMyAssets(ctx: RequestContext) {
  return actions.listCaseAssets(ctx.repos, await mine(ctx), ctx.user.employeeId);
}

export async function acknowledgeMyAsset(ctx: RequestContext, assetId: string, body: any, userAgent: string) {
  const { case: updated, acknowledgment } = await actions.acknowledgeAsset(
    ctx.repos, await mine(ctx), assetId, body, actorOf(ctx, userAgent)
  );
  return { case: await withEmployee(ctx, updated), acknowledgment };
}

/** Tell us about something else I was given. */
export async function declareMyAsset(ctx: RequestContext, body: any) {
  const { case: updated, asset } = await actions.declareAsset(ctx.repos, await mine(ctx), body);
  return { case: await withEmployee(ctx, updated), asset };
}

export async function removeMyDeclaredAsset(ctx: RequestContext, entryId: string) {
  const updated = await actions.removeDeclaredAsset(ctx.repos, await mine(ctx), entryId);
  return withEmployee(ctx, updated);
}

/** Upload a document against a section. Fields: sectionKey, category */
export async function attachMyDocument(
  ctx: RequestContext, file: UploadedFile | undefined, category: any, sectionKey: any, userAgent: string
) {
  const { case: updated, document } = await actions.attachDocument(
    ctx.repos, await mine(ctx), file as any, category, sectionKey, actorOf(ctx, userAgent)
  );
  return { case: await withEmployee(ctx, updated), document };
}

/** Hand the form to HR. */
export async function submitMyCase(ctx: RequestContext) {
  const row = await mine(ctx);
  const employee = await ctx.data.employees.byId(ctx.user.employeeId);
  const { case: updated, warnings } = await actions.submitCase(ctx.repos, row, employee?.employmentType);

  const name = `${employee?.firstName || ""} ${employee?.lastName || ""}`.trim() || "An employee";
  await notifyStaff(ctx.repos, {
    type: "ONBOARDING",
    title: "Onboarding form submitted",
    body: `${name} has completed their onboarding form and it is ready to review.`,
    link: "onboarding",
  });
  await ctx.data.auditLog.create({
    action: "ONBOARDING_SUBMITTED",
    userId: ctx.user.id,
    employeeId: employee?.id,
    meta: { caseId: row.id, warnings: warnings.map((w: any) => w.key) },
  });

  return { case: decorateCase(updated, employee), warnings };
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 *  HR REVIEW
 * ════════════════════════════════════════════════════════════════════════════════════ */

/** Raw query-string filters for the review queue, exactly as the client sent them. */
export interface CaseFilters {
  status?: any;
  campaignId?: any;
  overdue?: any;
  departmentId?: any;
}

/** Cases the caller may see, narrowed by status, campaign and overdue. */
async function filteredCases(ctx: RequestContext, filters: CaseFilters) {
  let list = await ctx.data.onboardingCases.all();

  // Department/office-scoped staff see only their own people's cases.
  const inScope = await scopedEmployeeIdsFor(ctx);
  if (inScope) list = list.filter((c: any) => !c.employeeId || inScope.has(c.employeeId));

  if (filters.status) list = list.filter((c: any) => c.status === String(filters.status).toUpperCase());
  if (filters.campaignId) list = list.filter((c: any) => c.campaignId === filters.campaignId);
  if (filters.overdue === "true") list = list.filter((c: any) => isOverdue(c));
  return list;
}

/** The review queue. */
export async function listCases(ctx: RequestContext, filters: CaseFilters) {
  let list = await filteredCases(ctx, filters);

  const employees = await ctx.data.employees.all();
  const byId = new Map<string, any>(employees.map((e: any) => [e.id, e]));
  // A pre-hire has no employees row until approval, so their name lives on the invite. Without
  // this the queue would show a real, actionable case as a blank row.
  const invites = await ctx.data.onboardingInvites.all();
  const inviteById = new Map<string, any>(invites.map((i: any) => [i.id, i]));

  if (filters.departmentId) {
    list = list.filter((c: any) => byId.get(c.employeeId)?.departmentId === filters.departmentId);
  }

  list.sort((a: any, b: any) => {
    // Submitted work first (somebody is waiting on HR), then by deadline.
    const rank = (c: any) => (c.status === "SUBMITTED" ? 0 : OPEN_STATUSES.includes(c.status) ? 1 : 2);
    return rank(a) - rank(b) || String(a.dueAt ?? "").localeCompare(String(b.dueAt ?? ""));
  });

  return list.map((c: any) => {
    const emp: any = byId.get(c.employeeId);
    const inv: any = c.inviteId ? inviteById.get(c.inviteId) : null;
    const checks = checkCase(c, emp?.employmentType ?? inv?.employmentType);
    const done = checks.filter((x) => x.status === "APPROVED" || x.status === "COMPLETE").length;
    return {
      id: c.id,
      status: c.status,
      dueAt: c.dueAt,
      overdue: isOverdue(c),
      campaignId: c.campaignId,
      templateName: c.templateName,
      submittedAt: c.submittedAt,
      createdAt: c.createdAt,
      employeeId: c.employeeId,
      // Belt and braces: an invite deleted out from under its case would otherwise render a
      // nameless row that HR can open and approve without knowing whose it is. Deleting an
      // invite now cancels its case, so this is the fallback for anything already orphaned.
      employeeName: emp
        ? `${emp.firstName} ${emp.lastName || ""}`.trim()
        : inv
          ? `${inv.firstName || ""} ${inv.lastName || ""}`.trim() || inv.personalEmail
          : c.inviteId ? "New joiner (invite removed)" : null,
      employeeCode: emp?.code ?? null,
      departmentId: emp?.departmentId ?? inv?.departmentId ?? null,
      preHire: !c.employeeId,
      sectionsDone: done,
      sectionsTotal: checks.length,
      pendingReview: checks.filter((x) => x.status !== "APPROVED").length,
    };
  });
}

/**
 * The review queue as CSV rows.
 *
 * Deliberately reports STATUS and PROGRESS only, never answers: a spreadsheet of everyone's
 * PAN and bank account is exactly the artefact that ends up on a shared drive. Anyone needing
 * the values reads the case, where access is scoped and logged.
 */
export async function exportCases(ctx: RequestContext, filters: CaseFilters) {
  const list = await filteredCases(ctx, filters);

  const employees = await ctx.data.employees.all();
  const byId = new Map<string, any>(employees.map((e: any) => [e.id, e]));
  const departments = await ctx.data.departments.all();
  const deptName = new Map<string, string>(departments.map((d: any) => [d.id, d.name]));
  const invites = await ctx.data.onboardingInvites.all();
  const inviteById = new Map<string, any>(invites.map((i: any) => [i.id, i]));

  const rows: any[][] = [[
    "Name", "Employee code", "Department", "Form", "Status", "Pre-hire",
    "Sections done", "Sections total", "Due", "Overdue", "Submitted", "Reminders sent",
  ]];
  for (const c of list) {
    const emp: any = byId.get(c.employeeId);
    const inv: any = c.inviteId ? inviteById.get(c.inviteId) : null;
    const checks = checkCase(c, emp?.employmentType ?? inv?.employmentType);
    rows.push([
      emp ? `${emp.firstName} ${emp.lastName || ""}`.trim()
          : inv ? `${inv.firstName || ""} ${inv.lastName || ""}`.trim() || inv.personalEmail : "",
      emp?.code ?? "",
      deptName.get(emp?.departmentId ?? inv?.departmentId) ?? "",
      c.templateName ?? "",
      c.status ?? "",
      c.employeeId ? "No" : "Yes",
      checks.filter((x) => x.status === "APPROVED" || x.status === "COMPLETE").length,
      checks.length,
      isoDate(c.dueAt),
      isOverdue(c) ? "Yes" : "No",
      isoDate(c.submittedAt),
      (c.remindersSent || []).join(" "),
    ]);
  }
  await ctx.data.auditLog.create({
    action: "ONBOARDING_EXPORTED",
    userId: ctx.user.id,
    meta: { rows: rows.length - 1, status: filters.status ?? null, campaignId: filters.campaignId ?? null },
  });
  return rows;
}

/** A case, and its employee once the caller is confirmed to have them in scope. */
async function caseInScope(ctx: RequestContext, id: string) {
  const row = await ctx.data.onboardingCases.byId(id);
  if (!row) throw notFound("Onboarding case not found");
  const employee = row.employeeId ? await ctx.data.employees.byId(row.employeeId) : null;
  if (employee && !ctx.inScope(employee)) throw forbidden("Outside your assigned scope");
  return { row, employee };
}

/** The case plus the diff HR is being asked to approve. */
export async function getCase(ctx: RequestContext, id: string) {
  const { row, employee } = await caseInScope(ctx, id);

  // Documents resolved so the reviewer sees the uploads (and the AI extraction already
  // stored on them) beside the answers they are meant to support.
  const documents: any[] = [];
  for (const d of row.documents || []) {
    const doc = d.documentId ? await ctx.data.documents.byId(d.documentId) : null;
    if (doc) documents.push({ ...d, document: { ...doc, categoryLabel: docCategoryLabel(doc.category) } });
  }

  // By employee for the roster, by CASE for a joiner: their day-one kit is staged against the
  // case, because there is no employee record to hang it on until this very approval.
  const issuedAssets = employee
    ? await ctx.data.assets.where({ employeeId: employee.id }).list()
    : (await ctx.data.assets.all()).filter((a: any) => a.caseId === row.id);

  // For a pre-hire the left-hand "current value" column is empty by definition: there is no
  // record yet. The invite is what identifies them, and what the employee will be built from.
  const invite = row.inviteId ? await ctx.data.onboardingInvites.byId(row.inviteId) : null;

  return {
    ...decorateCase(row, employee),
    employee: employee
      ? { id: employee.id, name: `${employee.firstName} ${employee.lastName || ""}`.trim(), code: employee.code, employmentType: employee.employmentType, departmentId: employee.departmentId }
      : null,
    preHire: !employee,
    invite: invite
      ? {
          id: invite.id,
          name: `${invite.firstName || ""} ${invite.lastName || ""}`.trim() || invite.personalEmail,
          personalEmail: invite.personalEmail,
          designation: invite.designation,
          employmentType: invite.employmentType,
          joiningDate: invite.joiningDate,
        }
      : null,
    diff: diffAgainstEmployee(row, employee || {}),
    documents,
    issuedAssets,
    overdue: isOverdue(row),
  };
}

/** Review one section: { verdict: "APPROVED" | "CHANGES_REQUESTED", note? } */
export async function reviewCaseSection(ctx: RequestContext, id: string, key: string, body: any) {
  const { row, employee } = await caseInScope(ctx, id);
  if (row.status === "APPROVED") throw bad("This case has already been approved.");

  const section = sectionOf(row, key);
  const verdict = String(body?.verdict || "").toUpperCase();
  if (!["APPROVED", "CHANGES_REQUESTED"].includes(verdict)) throw bad("verdict must be APPROVED or CHANGES_REQUESTED");

  const note = String(body?.note || "").trim();
  // A rejection with no reason is a round trip that teaches the person nothing, so the note
  // is required in exactly the case where it carries the information.
  if (verdict === "CHANGES_REQUESTED" && !note) throw bad("Say what needs changing, so they know what to fix");

  const state = reviewSection(row.sections?.[section.key], verdict as any, ctx.user.id, note);
  const sections = { ...row.sections, [section.key]: state };

  // One rejected section reopens the case; the rest keep their verdicts, so a second review
  // only looks at what actually changed.
  const status = verdict === "CHANGES_REQUESTED" ? "CHANGES_REQUESTED" : row.status;
  const updated = await ctx.data.onboardingCases.update(row.id, { sections, status });

  if (verdict === "CHANGES_REQUESTED" && row.employeeId) {
    const org = await ctx.data.organizations.byId(ctx.orgId);
    await notifyAndEmail(
      ctx.repos, org, row.employeeId,
      { type: "ONBOARDING", title: `Your onboarding form needs a change`, body: `${section.title}: ${note}`, link: "onboarding/me" },
      { subject: `Action needed on your onboarding form`, html: `<p>Hi,</p><p>HR has asked for a change to <b>${section.title}</b> on your onboarding form:</p><blockquote>${note}</blockquote><p>Please sign in and update that section.</p>` }
    );
  }

  await ctx.data.auditLog.create({
    action: verdict === "APPROVED" ? "ONBOARDING_SECTION_APPROVED" : "ONBOARDING_SECTION_REJECTED",
    userId: ctx.user.id,
    employeeId: row.employeeId,
    meta: { caseId: row.id, section: section.key, note },
  });

  return decorateCase(updated, employee);
}

/**
 * File an Asset Custody Form against the employee, when the template asked for one.
 *
 * Opt-in per template (`assets.issueCustodyForm`) and silent when there is nothing to
 * certify: a custody form listing no items is filing for its own sake.
 */
async function issueCustodyForm(ctx: RequestContext, caseRow: any, employeeId: string, org: any) {
  const section = (caseRow.templateSnapshot || []).find((s: Section) => s.kind === "ASSETS");
  if (!section?.assets?.issueCustodyForm) return null;

  const employee = await ctx.data.employees.byId(employeeId);
  if (!employee) return null;

  const issued = await ctx.data.assets.where({ employeeId }).list();
  const items = custodyItemsFor(caseRow, issued);
  if (!items.length) return null;

  const rendered = await renderCustodyForm({
    org,
    employee,
    items,
    signedAt: caseRow.declaration?.acceptedAt || caseRow.submittedAt,
    signedName: caseRow.declaration?.fullName || null,
  });
  if (!rendered) return null;

  await storage.putBuffer("letters", rendered.fileName, rendered.buffer, "application/pdf");
  const doc = await ctx.data.documents.create({
    employeeId,
    title: "Asset Custody Form",
    description: "Issued on approval of the onboarding form.",
    category: "OTHER",
    tags: ["onboarding", "assets"],
    visibility: "PRIVATE",
    departmentIds: [],
    storage: "letters",
    filename: rendered.fileName,
    originalName: rendered.fileName,
    mimeType: "application/pdf",
    sizeBytes: rendered.buffer.length,
    uploadedBy: ctx.user.id,
    // Verified by construction: we generated it, nobody uploaded it.
    verified: true,
    verifiedBy: ctx.user.id,
    verifiedAt: new Date().toISOString(),
    caseId: caseRow.id,
  });
  await ctx.data.auditLog.create({
    action: "ASSET_CUSTODY_FORM_ISSUED",
    userId: ctx.user.id,
    employeeId,
    meta: { caseId: caseRow.id, documentId: doc.id, items: items.length },
  });
  return { documentId: doc.id, items: items.length };
}

/**
 * The commit. Refuses until every section carries a verdict, so approval is always a
 * decision somebody made section by section rather than one button that skipped the review.
 */
export async function approveCase(ctx: RequestContext, id: string) {
  const row = await ctx.data.onboardingCases.byId(id);
  if (!row) throw notFound("Onboarding case not found");
  if (row.status === "APPROVED") throw bad("This case has already been approved.");

  const employee = row.employeeId ? await ctx.data.employees.byId(row.employeeId) : null;
  // A pre-hire legitimately has no employee record: approval is what creates it. Only refuse
  // when there is neither a record nor an invite to build one from.
  if (!employee && !row.inviteId) throw bad("This case has no employee record to write to yet.");
  if (employee && !ctx.inScope(employee)) throw forbidden("Outside your assigned scope");

  if (!allSectionsApproved(row)) {
    const pending = (row.templateSnapshot || [])
      .filter((s: Section) => row.sections?.[s.key]?.status !== "APPROVED")
      .map((s: Section) => s.title);
    throw bad(`Approve every section first. Still waiting: ${pending.join(", ")}.`);
  }

  const result = await commitCase(ctx.repos, row, ctx.user.id);
  const org = await ctx.data.organizations.byId(ctx.orgId);

  // Asset Custody Form, when the template asks for one. Generated AFTER the commit, not
  // inside it: a PDF failure must not roll back an approval that already wrote the bank
  // account and verified the documents. Fire-and-forget for the same reason.
  const custodyResult = await issueCustodyForm(ctx, row, result.employeeId, org).catch((err) => {
    logger.error({ err, caseId: row.id }, "asset custody form could not be issued");
    return null;
  });

  if (result.created?.password) {
    // A brand new joiner: approval created the employee AND their login, so this is the first
    // thing they ever receive from us. It goes to their PERSONAL address, because the
    // official one is the credential inside it and they cannot read it yet.
    const invite = row.inviteId ? await ctx.data.onboardingInvites.byId(row.inviteId) : null;
    await sendTenantMail(org, welcomeEmail({
      org,
      employee: result.created.employee,
      password: result.created.password,
      personalEmail: invite?.personalEmail || result.created.employee.personalEmail,
      portalUrl: PORTAL_URL,
    }));
  } else if (employee) {
    await notifyAndEmail(
      ctx.repos, org, employee.id,
      { type: "ONBOARDING", title: "Your onboarding is complete", body: "HR has approved your details. Thank you.", link: "profile" },
      { subject: "Your onboarding is complete", html: `<p>Hi ${employee.firstName},</p><p>Your onboarding form has been reviewed and approved. Your records are now up to date.</p>` }
    );
  }

  // Never return the one-time password to the reviewer's browser; it went to the joiner.
  return { ok: true, ...result, custodyForm: custodyResult, created: result.created ? { employeeId: result.created.employee.id, officialEmail: result.created.officialEmail } : null };
}

/** Cancel a case: { reason } */
export async function cancelCase(ctx: RequestContext, id: string, rawReason: any) {
  const row = await ctx.data.onboardingCases.byId(id);
  if (!row) throw notFound("Onboarding case not found");
  if (row.status === "APPROVED") throw bad("An approved case cannot be cancelled.");

  const reason = String(rawReason || "").trim();
  const updated = await ctx.data.onboardingCases.update(row.id, {
    status: "CANCELLED",
    cancelledAt: new Date().toISOString(),
    cancelledBy: ctx.user.id,
    cancelReason: reason,
  });
  await ctx.data.auditLog.create({
    action: "ONBOARDING_CANCELLED",
    userId: ctx.user.id,
    employeeId: row.employeeId,
    meta: { caseId: row.id, reason },
  });
  return decorateCase(updated);
}

/**
 * Open a case for one person, outside any campaign: { employeeId, templateId?, dueAt? }
 * `created` is false when an open case was reused (the controller answers 200, not 201).
 */
export async function openCase(ctx: RequestContext, body: any) {
  const employee = await ctx.data.employees.byId(body?.employeeId);
  if (!employee) throw notFound("Employee not found");
  if (!ctx.inScope(employee)) throw forbidden("Outside your assigned scope");
  if (employee.status === "EXITED") throw bad("That employee has left the organisation.");

  const template = body?.templateId
    ? await ctx.data.onboardingTemplates.byId(body.templateId)
    : await resolveTemplate(ctx.repos, { employmentType: employee.employmentType, departmentId: employee.departmentId });
  if (!template) throw notFound("Onboarding form not found");
  if (template.status !== "ACTIVE") throw bad("That form is not active yet.");

  const { case: created, reused } = await createCase(ctx.repos, {
    employee,
    template,
    dueAt: body?.dueAt || null,
    actorId: ctx.user.id,
  });
  if (reused) return { created: false, body: { case: decorateCase(created, employee), reused: true } };

  const org = await ctx.data.organizations.byId(ctx.orgId);
  await notifyAndEmail(
    ctx.repos, org, employee.id,
    { type: "ONBOARDING", title: "Please complete your details", body: "HR has asked you to complete your onboarding form.", link: "onboarding/me" },
    { subject: "Please complete your onboarding form", html: `<p>Hi ${employee.firstName},</p><p>Please sign in and complete your onboarding form.</p>` }
  );
  await ctx.data.auditLog.create({
    action: "ONBOARDING_CASE_CREATED",
    userId: ctx.user.id,
    employeeId: employee.id,
    meta: { caseId: created.id, templateId: template.id },
  });

  return { created: true, body: { case: decorateCase(created, employee), reused: false } };
}
