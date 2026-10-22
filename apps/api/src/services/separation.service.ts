/**
 * Employee separation / offboarding, type-aware flows.
 *
 *  Resignation (employee): PENDING_MANAGER -> PENDING_HR -> NOTICE_PERIOD ->
 *                          IN_CLEARANCE -> COMPLETED   (withdraw before accept)
 *  Termination/Retirement/End-of-contract (HR): NOTICE_PERIOD -> IN_CLEARANCE -> COMPLETED
 *  Absconding (HR): ABSCONDING (warning letters) -> ABSCONDED
 *
 * Terminal documents are issued per type (separation-config.documentsFor).
 */
import type { RequestContext } from "../core/context";
import type { Repositories } from "../repositories";
import { issueVerification, type VerifiableKind } from "../security/verification";
import { bad, notFound, forbidden } from "../core/util";
import { PORTAL_URL } from "../core/config";
import { isStaff } from "../middleware/auth";
import { LETTER_GENERATORS, abscondingLetter, settlementStatement } from "../domain/letters";
import { notifyEmployee, notifyStaff, notifyAndEmail } from "./notification.service";
import { separationEmail, letterIssuedEmail } from "../integrations/mail/templates";
import {
  typeDef, isType, documentsFor, isActive, classOf, EXIT_INTERVIEW_QUESTIONS,
  SELECTABLE_DOCUMENTS, SELECTABLE_KEYS, isForCause,
  NOTICE_MODES, defaultNoticeDays, resolveNotice, type ResolvedNotice,
} from "../domain/separation-config";
import { computeSettlement } from "../domain/settlement";
import { revokeForEmployee } from "../jobs/access-sweep";
import { assertEmployeeNotLastAdmin } from "./org-guard.service";
import storage from "../integrations/storage";
import { managerOf, isManagerOf, reassignReportsOnExit } from "../domain/manager";
import { fullName } from "../domain/person";

/** A request body as the routes receive it: loosely typed, possibly missing. */
type Body = Record<string, any>;

const nowIso = () => new Date().toISOString();
const todayStr = () => new Date().toISOString().slice(0, 10);

const CLEARANCE = ["it", "finance", "hr", "assets", "knowledgeTransfer"];
const emptyClearance = () => Object.fromEntries(CLEARANCE.map((k) => [k, false]));

/**
 * The separation and employee statuses a decided exit implies.
 *
 * Both follow from ONE fact: has the last working day arrived. Somebody released
 * without notice, or recorded after the fact, has left, so their employee record
 * says EXITED and the separation moves to clearance; somebody serving notice is
 * still employed and says so. Deriving both from the same predicate is the point:
 * the previous code stored an `immediate` flag and then set NOTICE_PERIOD anyway,
 * so the flag and the status disagreed and every consumer of employee.status
 * (payroll proration, the directory, clock-in reminders, letter suggestions) read
 * the wrong one.
 */
function statusesFor(lastWorkingDay: string, waived = false) {
  const past = waived || (lastWorkingDay && lastWorkingDay <= todayStr());
  return past
    ? { separation: "IN_CLEARANCE", employee: "EXITED", exited: true }
    : { separation: "NOTICE_PERIOD", employee: "NOTICE_PERIOD", exited: false };
}

/**
 * Read the notice period out of a request body, against the employee's contract.
 *
 * `body` is passed explicitly so a caller can supply a default the request did not
 * carry (the accept flow falls back to the last working day the employee proposed)
 * without having to fabricate a request.
 */
async function noticeFrom(ctx: RequestContext, employee, body: Body = {}): Promise<ResolvedNotice> {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  return resolveNotice({
    // `immediate` and `waiveNotice` are the pre-existing booleans; honoured so an
    // older client, and the two existing UI checkboxes, keep meaning what they say.
    mode: body.noticeMode ?? (body.immediate || body.waiveNotice ? "SKIP" : undefined),
    noticeDays: body.noticeDays,
    lastWorkingDay: body.lastWorkingDay,
    employee,
    org,
  });
}

/** The fields a resolved notice contributes to a separation row. */
const noticeFields = (n: ResolvedNotice) => ({
  lastWorkingDay: n.lastWorkingDay,
  noticeDays: n.noticeDays,
  noticeMode: n.mode,
  noticeSource: n.source,
  noticeWaived: n.waived,
  immediate: n.waived,
});

/** How a served (or waived) notice period reads in the employee's email. */
const servedLine = (notice: ResolvedNotice) =>
  notice.waived
    ? "You are released with immediate effect and no notice period applies."
    : `Your notice period of ${notice.noticeDays} day${notice.noticeDays === 1 ? "" : "s"} has begun.`;

/**
 * Tell an employee about a step in their separation, in the portal and by email.
 *
 * Every transition here used to raise an in-app notification only, so an employee who was
 * not signed in learned nothing: no word that their resignation had been accepted, no notice
 * that their exit was complete, no copy of their letters. `email` defaults to true and the
 * caller passes `{ email: false }` (in the request body) to suppress it, so the default is
 * that people are told.
 */
async function tell(ctx: RequestContext, body: Body | undefined, employeeId, payload, mail: any = {}) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const e = await ctx.data.employees.byId(employeeId);
  if (!e) return notifyEmployee(ctx.repos, employeeId, payload);
  const wants = body?.email !== false && mail.email !== false;
  return notifyAndEmail(ctx.repos, org, employeeId, payload, wants ? {
    email: true,
    ...separationEmail({
      org, name: e.firstName, to: undefined,
      heading: mail.heading || payload.title,
      message: mail.message || payload.body,
      rows: mail.rows,
      portalUrl: PORTAL_URL,
    }),
    attachments: mail.attachments,
  } : null);
}

async function withMeta(ctx: RequestContext, s) {
  const e = await ctx.data.employees.byId(s.employeeId);
  return { ...s, typeLabel: typeDef(s.type).label, employeeName: e ? fullName(e) : "-", employeeCode: e ? e.code : "", managerId: managerOf(e) };
}

/**
 * The employee a separation (or a resignation) is about, or a 404.
 *
 * The row can be missing: a purged employee leaves its separation behind, and a login can
 * keep an employeeId whose record is gone. Dereferencing null here was a 500.
 */
async function employeeOf(ctx: RequestContext, employeeId: string) {
  const e = await ctx.data.employees.byId(employeeId);
  if (!e) throw notFound("Employee not found");
  return e;
}

async function loadSeparation(ctx: RequestContext, id: string) {
  const s = await ctx.data.separations.byId(id);
  if (!s) throw notFound("Separation not found");
  return s;
}

/**
 * Exit paperwork is exactly what a future employer will want to check, so each letter
 * carries its own verification block. Joining and leaving dates and designation ARE the
 * thing being verified, so those are disclosed; the reason for leaving never is.
 *
 * Module scope because both the on-demand issue flow and completion use it, and two copies
 * would eventually disagree about which letters are verifiable.
 */
const VERIFIABLE: Record<string, VerifiableKind> = {
  RELIEVING_LETTER: "RELIEVING_LETTER",
  EXPERIENCE_LETTER: "EXPERIENCE_CERTIFICATE",
  EXPERIENCE_CERTIFICATE: "EXPERIENCE_CERTIFICATE",
  TERMINATION_LETTER: "TERMINATION_LETTER",
};

/** The verification block for one exit letter, or null for a letter that carries none. */
async function verificationFor(ctx: RequestContext, kind: string, org, e, dept, lastWorkingDay: string) {
  if (!VERIFIABLE[kind]) return null;
  return issueVerification({
    kind: VERIFIABLE[kind],
    orgId: org.id,
    orgName: org.name,
    employeeId: e.id,
    subjectName: fullName(e),
    subjectCode: e.code || null,
    facts: {
      designation: e.designation || "",
      department: dept ? dept.name : "",
      joiningDate: e.joiningDate || "",
      lastWorkingDay,
      employeeCode: e.code || "",
    },
    disclose: ["designation", "department", "joiningDate", "lastWorkingDay"],
    issuedBy: ctx.user.id,
  });
}

/** "RELIEVING_LETTER" -> "Relieving Letter". */
const letterTitle = (kind: string) => kind.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

/** Persist a generated letter PDF as a document row (returns the row). */
async function storeLetter(ctx: RequestContext, tx: Repositories, employee, letter, category, title, verification: any = null) {
  await storage.putBuffer("letters", letter.fileName, letter.buffer, "application/pdf");
  return tx.documents.create({
    employeeId: employee.id, title, category, visibility: "PRIVATE", storage: "letters",
    filename: letter.fileName, originalName: `${category}_${employee.code}.pdf`, uploadedBy: ctx.user.id,
    verifyCode: verification?.code ?? null,
    verifyUrl: verification?.url ?? null,
    verifyDigest: verification?.digest ?? null,
  });
}

/**
 * Validate a caller-supplied set of terminal letters.
 *
 * Choosing the paperwork is HR's call, with one guard: a termination for misconduct should
 * not quietly produce an experience certificate vouching for the person's service. It is
 * still permitted, because circumstances vary and the organisation is accountable for its
 * own letters, but it has to be asked for explicitly and it is recorded in the audit log.
 *
 * Returns undefined when no choice was supplied, which leaves the type's default in place.
 */
function validateDocumentChoice(sep, body) {
  if (!Array.isArray(body?.documents)) return undefined;
  const chosen: string[] = [...new Set<string>(body.documents.map((d: unknown) => String(d)))];
  for (const d of chosen) {
    if (!SELECTABLE_KEYS.includes(d)) throw bad(`"${d}" is not a letter that can be issued on exit`);
  }
  const merged = { ...sep, ...(body.type ? { type: body.type } : {}), ...(body.subReason ? { subReason: body.subReason } : {}) };
  if (isForCause(merged) && chosen.includes("EXPERIENCE_LETTER") && !body.acknowledgeForCause) {
    throw bad(
      "This is a termination for misconduct, so an experience certificate is excluded by default. " +
      "Confirm explicitly to issue one anyway."
    );
  }
  return chosen;
}

/** Staff: all (optionally one status); employee: own. */
export async function listSeparations(ctx: RequestContext, status?: unknown) {
  const emps = await ctx.data.employees.all();
  const byId = Object.fromEntries(emps.map((e) => [e.id, e]));
  let list = await ctx.data.separations.all();
  if (!isStaff(ctx.user)) {
    // Employees see their own; managers also see resignations awaiting their approval.
    const myEmp = ctx.user.employeeId;
    const myReports = new Set(emps.filter((e) => isManagerOf(e, myEmp)).map((e) => e.id));
    list = list.filter((s) => s.employeeId === myEmp || (s.status === "PENDING_MANAGER" && myReports.has(s.employeeId)));
  } else {
    // Scoped staff only see separations for in-scope employees.
    list = list.filter((s) => ctx.inScope(byId[s.employeeId]));
  }
  if (status) list = list.filter((s) => s.status === status);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return list.map((s) => {
    const e = byId[s.employeeId];
    return { ...s, typeLabel: typeDef(s.type).label, employeeName: e ? fullName(e) : "-", employeeCode: e ? e.code : "", managerId: managerOf(e) };
  });
}

/**
 * Exit-interview questionnaire, selectable letters and the notice-period options (for the UI).
 *
 * `orgNoticeDays` / `fallbackNoticeDays` let the exit dialog LABEL the default
 * ("Use contractual notice, 60 days") before anything is submitted. The server
 * still resolves the real figure itself on every write; this is a hint, so the
 * form cannot decide payroll-relevant dates on its own.
 */
export async function separationConfig(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  return {
    exitInterviewQuestions: EXIT_INTERVIEW_QUESTIONS,
    selectableDocuments: SELECTABLE_DOCUMENTS,
    noticeModes: NOTICE_MODES,
    orgNoticeDays: Number.isFinite(Number(org?.noticePeriodDays)) ? Number(org!.noticePeriodDays) : null,
    fallbackNoticeDays: defaultNoticeDays(null, null),
  };
}

/** Attrition analytics (staff). */
export async function attritionAnalytics(ctx: RequestContext) {
  const [seps, emps] = await Promise.all([ctx.data.separations.all(), ctx.data.employees.all()]);
  const exits = seps.filter((s) => ["COMPLETED", "ABSCONDED"].includes(s.status));
  const byClass = { VOLUNTARY: 0, INVOLUNTARY: 0, OTHER: 0 };
  const byType = {};
  const byReason = {};
  const byMonth = {};
  let tenureDaysTotal = 0, tenureN = 0;
  const empById = Object.fromEntries(emps.map((e) => [e.id, e]));
  for (const s of exits) {
    byClass[classOf(s.type)] = (byClass[classOf(s.type)] || 0) + 1;
    byType[s.type] = (byType[s.type] || 0) + 1;
    const reason = s.subReason || s.type;
    byReason[reason] = (byReason[reason] || 0) + 1;
    const when = (s.completedAt || s.lastWorkingDay || s.createdAt || "").slice(0, 7); // YYYY-MM
    if (when) byMonth[when] = (byMonth[when] || 0) + 1;
    const e = empById[s.employeeId];
    if (e && e.joiningDate && s.lastWorkingDay) {
      const d = ((new Date(s.lastWorkingDay) as any) - (new Date(e.joiningDate) as any)) / 86400000;
      if (d > 0) { tenureDaysTotal += d; tenureN++; }
    }
  }
  const headcount = emps.filter((e) => e.status !== "EXITED").length;
  const totalExits = exits.length;
  return {
    totalExits, headcount,
    attritionRate: headcount ? Math.round((totalExits / (headcount + totalExits)) * 1000) / 10 : 0,
    byClass, byType, byReason,
    byMonth: Object.fromEntries(Object.entries(byMonth).sort()),
    avgTenureMonths: tenureN ? Math.round((tenureDaysTotal / tenureN / 30.44) * 10) / 10 : 0,
    openCases: seps.filter((s) => isActive(s)).length,
  };
}

/** HR initiates an INVOLUNTARY separation (termination/absconding/retirement/EOC). */
export async function initiateSeparation(ctx: RequestContext, body: Body) {
  const e = await ctx.data.employees.byId(body.employeeId);
  if (!e) throw notFound("Employee not found");
  // Separating the only administrator ends with their login revoked and nobody able to
  // administer the workspace. Refuse at the start rather than midway through an exit.
  await assertEmployeeNotLastAdmin(ctx.repos, e.id, "start their separation");
  if (await ctx.data.separations.hasActive(e.id))
    throw bad("An active separation already exists for this employee");
  const type = isType(body.type) && body.type !== "RESIGNATION" ? body.type : "TERMINATION";
  const def = typeDef(type);
  const subReason = (def.subReasons || []).includes(body.subReason) ? body.subReason : null;
  const absconding = type === "ABSCONDING";

  // Notice period: stated in days, as a date to serve until, taken from the
  // contract on record, or skipped outright. Absconding has no notice by
  // definition, so it is never resolved for it.
  const notice = absconding ? null : await noticeFrom(ctx, e, body || {});
  const statuses = notice ? statusesFor(notice.lastWorkingDay, notice.waived) : null;

  // HR may choose the exit paperwork up front; omitting it keeps the type's default.
  const documents = validateDocumentChoice({ type, subReason }, body);

  const s = await ctx.data.transaction(async (tx) => {
    const created = await tx.separations.create({
      employeeId: e.id, type, subReason,
      reason: body.reason || "", initiatedBy: "HR",
      successorId: body.successorId || null,
      ...(notice ? noticeFields(notice) : { lastWorkingDay: null, immediate: true }),
      status: absconding ? "ABSCONDING" : statuses!.separation,
      warningsSent: 0, clearance: emptyClearance(), documentIds: [], relievingDocId: null,
      ...(documents !== undefined ? { documents } : {}),
    });
    await tx.employees.update(e.id, { status: absconding ? "ABSCONDING" : statuses!.employee });
    // Someone marked EXITED drops out of the org chart immediately, so their
    // reports have to be re-parented now rather than at completion, or they
    // vanish from the hierarchy along with their manager.
    if (statuses?.exited) await reassignReportsOnExit(tx, e.id, { successorId: body.successorId || null });
    return created;
  });
  await ctx.data.auditLog.create({
    action: "SEPARATION_INITIATE", userId: ctx.user.id,
    meta: {
      employeeId: e.id, type, subReason,
      ...(notice ? { noticeMode: notice.mode, noticeDays: notice.noticeDays, noticeSource: notice.source, lastWorkingDay: notice.lastWorkingDay, waived: notice.waived } : {}),
    },
  });
  if (notice) {
    await tell(ctx, body, e.id,
      { type: "SEPARATION", title: `Separation initiated (${def.label})`, body: `HR has initiated your separation. Last working day: ${notice.lastWorkingDay}.`, link: "myseparation" },
      {
        heading: "Your separation has been initiated",
        message: `Your separation has been initiated by the HR team. ${servedLine(notice)}`,
        rows: [
          ["Type", def.label],
          ["Last working day", notice.lastWorkingDay],
          ["Notice period", notice.waived ? "Waived" : `${notice.noticeDays} days`],
        ],
      });
  }
  return withMeta(ctx, s);
}

/**
 * An employee submits a resignation. Routes to the reporting manager first
 * (PENDING_MANAGER); if none, straight to HR (PENDING_HR).
 */
export async function resign(ctx: RequestContext, body: Body) {
  // Every role reaches this now: administrators and HR staff have employee records, so
  // "only employees can resign" no longer excludes them from resigning.
  if (!ctx.user.employeeId) throw forbidden("Your account has no employee record, so there is nothing to resign from. Ask HR to create one.");
  const e = await employeeOf(ctx, ctx.user.employeeId);
  // A sole administrator resigning through the portal would lock the workspace on exit.
  await assertEmployeeNotLastAdmin(ctx.repos, e.id, "submit your resignation");
  if (await ctx.data.separations.hasActive(e.id))
    throw bad("You already have an active separation request");
  const managerId = managerOf(e);
  const status = managerId ? "PENDING_MANAGER" : "PENDING_HR";
  const s = await ctx.data.separations.create({
    employeeId: e.id, type: "RESIGNATION", subReason: null,
    reason: body.reason || "", initiatedBy: "EMPLOYEE",
    proposedLastWorkingDay: body.lastWorkingDay || null, lastWorkingDay: null,
    status, clearance: emptyClearance(), documentIds: [], relievingDocId: null,
  });
  await ctx.data.auditLog.create({ action: "SEPARATION_RESIGN", userId: ctx.user.id, meta: { status } });
  if (managerId) await tell(ctx, body, managerId, { type: "SEPARATION", title: "Resignation needs your approval", body: `${fullName(e)} (your report) has submitted a resignation for your review.`, link: "myseparation" }, { heading: "A resignation needs your approval", message: `${fullName(e)}, who reports to you, has submitted a resignation. Please review it in the HR portal.`, rows: [["Employee", fullName(e)], ["Proposed last working day", body.lastWorkingDay || "Not stated"]] });
  else await notifyStaff(ctx.repos, { type: "SEPARATION", title: "Resignation submitted", body: `${fullName(e)} has submitted a resignation request.`, link: "separation" });
  return withMeta(ctx, s);
}

/** Authorize a manager action: the acting user is the employee's reporting manager, or staff. */
async function assertManagerOrStaff(ctx: RequestContext, s) {
  if (isStaff(ctx.user)) return;
  const e = await ctx.data.employees.byId(s.employeeId);
  const managerId = managerOf(e);
  if (!managerId || managerId !== ctx.user.employeeId) throw forbidden("Only the reporting manager or HR can do this");
}

/** L1: the reporting manager approves -> HR review. */
export async function managerApprove(ctx: RequestContext, id: string, body: Body) {
  const s = await loadSeparation(ctx, id);
  if (s.status !== "PENDING_MANAGER") throw bad("This request is not awaiting manager approval");
  await assertManagerOrStaff(ctx, s);
  const updated = await ctx.data.separations.update(s.id, { status: "PENDING_HR", managerApprovedBy: ctx.user.id, managerApprovedAt: nowIso(), managerNote: body.note || "" });
  await ctx.data.auditLog.create({ action: "SEPARATION_MANAGER_APPROVE", userId: ctx.user.id, meta: { separationId: s.id } });
  await notifyStaff(ctx.repos, { type: "SEPARATION", title: "Resignation approved by manager", body: `A resignation has been approved by the reporting manager and needs HR action.`, link: "separation" });
  return withMeta(ctx, updated);
}

/** The manager declines (off-ramp). */
export async function managerDecline(ctx: RequestContext, id: string, body: Body) {
  const s = await loadSeparation(ctx, id);
  if (s.status !== "PENDING_MANAGER") throw bad("This request is not awaiting manager approval");
  await assertManagerOrStaff(ctx, s);
  const updated = await ctx.data.separations.update(s.id, { status: "DECLINED", declineReason: body.reason || "", declinedBy: ctx.user.id, declinedAt: nowIso() });
  await tell(ctx, body, s.employeeId, { type: "SEPARATION", title: "Resignation declined", body: `Your resignation was not approved by your manager${body.reason ? `: ${body.reason}` : "."} Please speak with them.`, link: "myseparation" }, { heading: "Your resignation was not approved", message: `Your reporting manager has not approved your resignation${body.reason ? `. Reason given: ${body.reason}` : ""}. Please speak with them.` });
  return withMeta(ctx, updated);
}

/** HR (L2) accepts a resignation; notice period begins. */
export async function acceptResignation(ctx: RequestContext, id: string, body: Body) {
  const s = await loadSeparation(ctx, id);
  if (!["PENDING_HR", "PENDING_MANAGER", "REQUESTED"].includes(s.status)) throw bad("This request cannot be accepted in its current state");
  const employee = await ctx.data.employees.byId(s.employeeId);

  /*
   * The employee's PROPOSED last working day is the default, not the answer.
   *
   * HR gets the same four choices here as when they start an exit: accept the
   * date the employee asked for, set a different one, serve the contractual
   * notice from today, or waive notice entirely. Only the last of those used to
   * exist (a `waiveNotice` boolean that jumped the last working day to today),
   * which meant "you proposed 30 days, we require 60" had to be typed as a raw
   * date every time.
   */
  const notice = await noticeFrom(ctx, employee, {
    ...body,
    // With no mode stated, an unaccompanied proposed date is what the employee
    // asked for, so accepting with an empty form honours their request rather
    // than silently starting a fresh contractual notice from today.
    lastWorkingDay: body.lastWorkingDay ?? (body.noticeMode ? undefined : s.proposedLastWorkingDay),
  });
  const statuses = statusesFor(notice.lastWorkingDay, notice.waived);

  const updated = await ctx.data.transaction(async (tx) => {
    const u = await tx.separations.update(s.id, {
      status: statuses.separation,
      ...noticeFields(notice),
      acceptedBy: ctx.user.id, acceptedAt: nowIso(),
    });
    await tx.employees.update(s.employeeId, { status: statuses.employee });
    if (statuses.exited) await reassignReportsOnExit(tx, s.employeeId, { successorId: s.successorId });
    return u;
  });
  await ctx.data.auditLog.create({
    action: "SEPARATION_ACCEPT", userId: ctx.user.id,
    meta: { separationId: s.id, lastWorkingDay: notice.lastWorkingDay, noticeMode: notice.mode, noticeDays: notice.noticeDays, waived: notice.waived },
  });
  await tell(ctx, body, s.employeeId,
    { type: "SEPARATION", title: "Resignation accepted", body: `Your resignation has been accepted. Your last working day is ${notice.lastWorkingDay}.`, link: "myseparation" },
    {
      heading: "Your resignation has been accepted",
      message: `Your resignation has been accepted. ${servedLine(notice)} Your exit clearance steps are listed in the portal.`,
      rows: [["Last working day", notice.lastWorkingDay], ["Notice period", notice.waived ? "Waived" : `${notice.noticeDays} days`]],
    });
  return withMeta(ctx, updated);
}

/** HR declines a pending resignation. */
export async function declineResignation(ctx: RequestContext, id: string, body: Body) {
  const s = await loadSeparation(ctx, id);
  if (!["PENDING_HR", "PENDING_MANAGER", "REQUESTED"].includes(s.status)) throw bad("Only a pending resignation can be declined");
  const updated = await ctx.data.separations.update(s.id, { status: "DECLINED", declineReason: body.reason || "", declinedBy: ctx.user.id, declinedAt: nowIso() });
  await tell(ctx, body, s.employeeId, { type: "SEPARATION", title: "Resignation declined", body: `Your resignation request was not accepted${body.reason ? `: ${body.reason}` : "."} Please speak with HR.`, link: "myseparation" }, { heading: "Your resignation was not accepted", message: `Your resignation request has not been accepted${body.reason ? `. Reason given: ${body.reason}` : ""}. Please speak with the HR team.` });
  return withMeta(ctx, updated);
}

/** The employee withdraws before HR accepts. */
export async function withdrawResignation(ctx: RequestContext, id: string) {
  const s = await loadSeparation(ctx, id);
  if (s.employeeId !== ctx.user.employeeId) throw forbidden("You can only withdraw your own resignation");
  if (!["PENDING_MANAGER", "PENDING_HR", "REQUESTED"].includes(s.status)) throw bad("This resignation can no longer be withdrawn");
  const updated = await ctx.data.separations.update(s.id, { status: "WITHDRAWN", withdrawnAt: nowIso() });
  await notifyStaff(ctx.repos, { type: "SEPARATION", title: "Resignation withdrawn", body: `An employee has withdrawn their resignation request.`, link: "separation" });
  return withMeta(ctx, updated);
}

/** Issue the next absconding warning letter (staff). */
export async function issueAbscondingLetter(ctx: RequestContext, id: string, body: Body) {
  const s = await loadSeparation(ctx, id);
  if (s.type !== "ABSCONDING" || s.status !== "ABSCONDING") throw bad("Not an active absconding case");
  const def = typeDef("ABSCONDING");
  const sent = s.warningsSent || 0;
  if (sent >= def.warnings) throw bad("All warning letters have already been issued");
  const e = await employeeOf(ctx, s.employeeId);
  const dept = e.departmentId ? await ctx.data.departments.byId(e.departmentId) : null;
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const seq = sent + 1;
  const letter = await abscondingLetter({ org, employee: e, dept, sequence: seq, daysAbsent: body.daysAbsent });
  const updated = await ctx.data.transaction(async (tx) => {
    const doc = await storeLetter(ctx, tx, e, letter, "ABSCONDING_LETTER", `Absconding Warning ${seq} - ${fullName(e)}`);
    const ids = [...(s.documentIds || []), doc.id];
    return tx.separations.update(s.id, { warningsSent: seq, documentIds: ids });
  });
  await ctx.data.auditLog.create({ action: "SEPARATION_ABSCOND_WARN", userId: ctx.user.id, meta: { separationId: s.id, sequence: seq } });
  return withMeta(ctx, updated);
}

/** Finalize an absconding case (staff). No relieving letter. */
export async function confirmAbsconded(ctx: RequestContext, id: string) {
  const s = await loadSeparation(ctx, id);
  if (s.type !== "ABSCONDING" || s.status !== "ABSCONDING") throw bad("Not an active absconding case");
  const updated = await ctx.data.transaction(async (tx) => {
    await tx.employees.update(s.employeeId, { status: "EXITED" });
    // EXITED people are filtered out of the org chart, so their reports would drop out of
    // the hierarchy with them. Hand them to the named successor when there is one.
    await reassignReportsOnExit(tx, s.employeeId, { successorId: s.successorId });
    return tx.separations.update(s.id, { status: "ABSCONDED", completedAt: nowIso(), lastWorkingDay: s.lastWorkingDay || todayStr() });
  });
  await revokeForEmployee(ctx.repos, s.employeeId); // access revocation
  await ctx.data.auditLog.create({ action: "SEPARATION_ABSCONDED", userId: ctx.user.id, meta: { separationId: s.id } });
  return withMeta(ctx, updated);
}

/** { responses }, the employee (own) or staff submits the exit interview. */
export async function submitExitInterview(ctx: RequestContext, id: string, body: Body | undefined) {
  const s = await loadSeparation(ctx, id);
  if (!isStaff(ctx.user) && s.employeeId !== ctx.user.employeeId) throw forbidden("You can only fill your own exit interview");
  const responses = (body && body.responses && typeof body.responses === "object") ? body.responses : {};
  const exitInterview = { responses, submittedAt: nowIso(), submittedBy: ctx.user.id };
  const updated = await ctx.data.separations.update(s.id, { exitInterview });
  await ctx.data.auditLog.create({ action: "SEPARATION_EXIT_INTERVIEW", userId: ctx.user.id, meta: { separationId: s.id } });
  if (!isStaff(ctx.user)) await notifyStaff(ctx.repos, { type: "SEPARATION", title: "Exit interview submitted", body: `${fullName(await ctx.data.employees.byId(s.employeeId))} completed their exit interview.`, link: "separation" });
  return withMeta(ctx, updated);
}

/** A light F&F estimate (staff). `recoveries` overrides the stored figure. */
export async function settlementEstimate(ctx: RequestContext, id: string, recoveriesInput?: unknown) {
  const s = await loadSeparation(ctx, id);
  const e = await employeeOf(ctx, s.employeeId);
  const recoveries = recoveriesInput != null ? Number(recoveriesInput) : (s.recoveries || 0);
  return computeSettlement(ctx.repos, s, e, { recoveries });
}

/** Generate the F&F statement PDF (staff). */
export async function issueSettlementStatement(ctx: RequestContext, id: string, body: Body | undefined) {
  const s = await loadSeparation(ctx, id);
  const e = await employeeOf(ctx, s.employeeId);
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const dept = e.departmentId ? await ctx.data.departments.byId(e.departmentId) : null;
  const recoveries = body && body.recoveries != null ? Number(body.recoveries) : (s.recoveries || 0);
  const settlement = await computeSettlement(ctx.repos, s, e, { recoveries });
  const letter = await settlementStatement({ org, employee: e, dept, settlement, lastWorkingDay: s.lastWorkingDay });
  const updated = await ctx.data.transaction(async (tx) => {
    const doc = await storeLetter(ctx, tx, e, letter, "FNF_STATEMENT", `F&F Settlement - ${fullName(e)}`);
    return tx.separations.update(s.id, { recoveries, documentIds: [...(s.documentIds || []), doc.id] });
  });
  return { ...(await withMeta(ctx, updated)), settlement };
}

/** Update clearance / lastWorkingDay / status / handover (staff). */
export async function updateSeparation(ctx: RequestContext, id: string, body: Body) {
  const s = await loadSeparation(ctx, id);
  const patch: any = {};
  if (body.lastWorkingDay) patch.lastWorkingDay = body.lastWorkingDay;
  if (body.reason !== undefined) patch.reason = body.reason;
  if (body.noticeDays !== undefined) {
    const n = Number(body.noticeDays);
    if (Number.isFinite(n) && n >= 0) patch.noticeDays = Math.min(Math.round(n), 365);
  }
  if (body.clearance) patch.clearance = { ...s.clearance, ...body.clearance };
  if (body.successorId !== undefined) patch.successorId = body.successorId || null; // knowledge transfer
  if (body.handoverNotes !== undefined) patch.handoverNotes = String(body.handoverNotes || "");
  if (body.recoveries !== undefined) patch.recoveries = Math.max(0, Number(body.recoveries) || 0);
  if (body.status && ["NOTICE_PERIOD", "IN_CLEARANCE", "CANCELLED"].includes(body.status)) patch.status = body.status;
  // The exit paperwork can be revised for as long as the separation is open.
  const documents = validateDocumentChoice(s, body);
  if (documents !== undefined) {
    patch.documents = documents;
    await ctx.data.auditLog.create({
      action: "SEPARATION_DOCUMENTS",
      userId: ctx.user.id,
      meta: { separationId: s.id, documents, forCauseOverride: !!body.acknowledgeForCause },
    });
  }

  /*
   * Moving the last working day moves the employee's status with it.
   *
   * The two are one fact expressed twice, and letting them drift is how somebody
   * whose exit was pulled forward to today stayed ACTIVE in the directory, or
   * somebody granted an extension stayed EXITED and dropped out of payroll. Only
   * the open, decided states are touched: a completed or cancelled separation has
   * already had its say, and re-deriving the status from a date would undo it.
   */
  if (patch.lastWorkingDay && ["NOTICE_PERIOD", "IN_CLEARANCE"].includes(String(patch.status || s.status))) {
    const next = statusesFor(patch.lastWorkingDay, false);
    const employee = await ctx.data.employees.byId(s.employeeId);
    if (employee && employee.status !== next.employee) {
      await ctx.data.employees.update(s.employeeId, { status: next.employee });
      // Re-parent only on the way OUT. Coming back off an exit does not restore
      // the old reporting lines, because HR has since pointed those reports
      // somewhere deliberate and silently reversing that would be worse.
      if (next.exited) await reassignReportsOnExit(ctx.repos, s.employeeId, { successorId: patch.successorId ?? s.successorId });
    }
    // Keep the separation's own status in step unless the caller stated one.
    if (body.status === undefined) patch.status = next.separation;
    patch.noticeWaived = next.exited && !s.noticeDays ? true : !!s.noticeWaived;
  }

  return withMeta(ctx, await ctx.data.separations.update(s.id, patch));
}

/**
 * Issue one terminal letter now, without finalising the exit: { kind } (staff).
 *
 * Letters were previously produced only by completion, so somebody serving notice who needed
 * their relieving or experience letter in hand (for a visa, a background check, or simply to
 * take with them on their last day) could not be given one until the whole separation had
 * been closed out. Each issue is filed and verifiable exactly as it would be at completion.
 */
export async function issueLetter(ctx: RequestContext, id: string, body: Body | undefined) {
  const s = await loadSeparation(ctx, id);
  const kind = String(body?.kind || "");
  if (!SELECTABLE_KEYS.includes(kind)) throw bad(`"${kind}" is not a letter that can be issued on exit`);
  if (kind === "EXPERIENCE_LETTER" && isForCause(s) && !body?.acknowledgeForCause) {
    throw bad(
      "This is a termination for misconduct, so an experience certificate is excluded by default. " +
      "Confirm explicitly to issue one anyway."
    );
  }
  const gen = LETTER_GENERATORS[kind];
  if (!gen) throw bad("That letter cannot be generated");

  const e = await ctx.data.employees.byId(s.employeeId);
  if (!e) throw notFound("Employee not found");
  if (!ctx.inScope(e)) throw forbidden("Outside your assigned scope");
  const org = (await ctx.data.organizations.byId(ctx.orgId))!;
  const dept = e.departmentId ? await ctx.data.departments.byId(e.departmentId) : null;
  const lastWorkingDay = s.lastWorkingDay || body?.lastWorkingDay || todayStr();

  const verification = await verificationFor(ctx, kind, org, e, dept, lastWorkingDay);

  const letter = await gen({
    org, employee: e, dept, lastWorkingDay, reason: s.reason, subReason: s.subReason,
    forCause: isForCause(s), noticePeriodDays: s.noticeDays ?? null, verification,
  });
  const title = `${letterTitle(kind)} - ${fullName(e)}`;
  const updated = await ctx.data.transaction(async (tx) => {
    const doc = await storeLetter(ctx, tx, e, letter, kind, title, verification);
    return { doc, sep: await tx.separations.update(s.id, { documentIds: [...(s.documentIds || []), doc.id] }) };
  });
  await ctx.data.auditLog.create({
    action: "SEPARATION_LETTER_ISSUED",
    userId: ctx.user.id,
    meta: { separationId: s.id, kind, documentId: updated.doc.id },
  });
  // Sent by default with the PDF attached; pass email:false to file it silently.
  const mailed = body?.email === false ? null : await notifyAndEmail(
    ctx.repos, org, e.id,
    { type: "DOCUMENT", title: `${title.split(" - ")[0]} issued`, body: "A letter has been issued to you.", link: "mydocs" },
    { email: true, ...letterIssuedEmail({
      org, name: e.firstName, to: undefined,
      letterLabel: title.split(" - ")[0],
      filename: letter.fileName, buffer: letter.buffer, portalUrl: PORTAL_URL,
    }) }
  );
  return { ok: true, documentId: updated.doc.id, kind, mail: mailed, separation: await withMeta(ctx, updated.sep) };
}

/** Finalize: issue the type's documents + mark EXITED (staff). */
export async function completeSeparation(ctx: RequestContext, id: string, body: Body) {
  const s = await loadSeparation(ctx, id);
  if (["COMPLETED", "ABSCONDED"].includes(s.status)) throw bad("Already completed");
  if (!["NOTICE_PERIOD", "IN_CLEARANCE", "INITIATED"].includes(s.status)) throw bad("This separation is not ready to complete");
  const pending = CLEARANCE.filter((k) => !(s.clearance || {})[k]);
  if (pending.length && !body.force) throw bad(`Pending clearance: ${pending.join(", ")}. Complete them or pass force=true.`);

  const e = await employeeOf(ctx, s.employeeId);
  const org = (await ctx.data.organizations.byId(ctx.orgId))!;
  const dept = e.departmentId ? await ctx.data.departments.byId(e.departmentId) : null;
  const def = typeDef(s.type);
  const forCause = s.type === "TERMINATION" && (def.forCauseReasons || []).includes(s.subReason);

  // Generate all PDFs (side effects) BEFORE the row-mutation transaction.
  const kinds = documentsFor(s);
  const generated: { kind: string; letter: any; verification: any }[] = [];
  for (const kind of kinds) {
    const gen = LETTER_GENERATORS[kind];
    if (!gen) continue;
    const verification = await verificationFor(ctx, kind, org, e, dept, s.lastWorkingDay || "");
    const letter = await gen({ org, employee: e, dept, lastWorkingDay: s.lastWorkingDay, reason: s.reason, subReason: s.subReason, forCause, noticePeriodDays: s.noticeDays ?? null, verification });
    generated.push({ kind, letter, verification });
  }

  const { docIds, updated } = await ctx.data.transaction(async (tx) => {
    const docIds: string[] = [];
    for (const g of generated) {
      const title = letterTitle(g.kind) + ` - ${fullName(e)}`;
      const doc = await storeLetter(ctx, tx, e, g.letter, g.kind, title, g.verification);
      docIds.push(doc.id);
    }
    await tx.employees.update(e.id, { status: "EXITED" });
    // Same reason as confirm-absconded: keep this person's reports attached to the tree.
    await reassignReportsOnExit(tx, e.id, { successorId: s.successorId });
    const updated = await tx.separations.update(s.id, {
      status: "COMPLETED", completedAt: nowIso(),
      relievingDocId: docIds[0] || null, documentIds: [...(s.documentIds || []), ...docIds],
    });
    return { docIds, updated };
  });
  await revokeForEmployee(ctx.repos, e.id); // access revocation: disable the login on exit
  await ctx.data.auditLog.create({ action: "SEPARATION_COMPLETE", userId: ctx.user.id, meta: { separationId: s.id, type: s.type, documents: kinds } });
  /*
   * The exit letters go WITH the message, not behind a login.
   *
   * Access is revoked moments earlier (revokeForEmployee above), so by the time this lands
   * the person can no longer sign in to fetch the documents the notification points at. A
   * relieving letter is also the single most forwarded document HR issues: a future employer
   * or a bank asks for it, and a link into a portal they were just locked out of is useless.
   */
  const notice = await tell(ctx, body, e.id, {
    type: "SEPARATION",
    title: "Exit completed",
    body: `Your separation has been finalized.${docIds.length ? " Your exit documents are available under My Documents." : ""}`,
    link: "mydocs",
  }, {
    heading: "Your exit is complete",
    message: `Your separation from ${org.name} is now complete.${generated.length ? " Your exit documents are attached to this email." : ""}`,
    rows: [["Last working day", s.lastWorkingDay || "-"]],
    attachments: generated.map((g) => ({
      filename: g.letter.fileName,
      content: g.letter.buffer,
      contentType: "application/pdf",
    })),
  });
  return { ...(await withMeta(ctx, updated)), documentIds: docIds, relievingDocumentId: docIds[0] || null, notice };
}
