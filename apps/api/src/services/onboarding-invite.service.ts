/** HR onboarding invites: send a self-onboarding link to a candidate's personal email. */
import { randomUUID as uuid } from "crypto";
import type { RequestContext } from "../core/context";
import { bad, notFound } from "../core/util";
import { PORTAL_URL } from "../core/config";
import { sendTenantMail } from "../integrations/mail/mailer";
import { inviteEmail } from "../integrations/mail/templates";
import { EMPLOYMENT_TYPE_VALUES } from "../domain/employment";
import { templateGapReason } from "../domain/onboarding-template";

// Share the one catalogue rather than a hardcoded copy. The old inline list had drifted
// badly: it omitted PERMANENT, FREELANCER, TEMPORARY and VENDOR (the current types) while
// still listing PART_TIME, CONTRACT and OUTSOURCED (now flagged legacy). The onboarding
// picker offers the current types, so choosing "Permanent", the commonest case of all,
// was rejected with a 400. `employees.routes.ts` already validates against this same list.
const TYPES = EMPLOYMENT_TYPE_VALUES;

function inviteLink(token) {
  return `${PORTAL_URL}/onboard?token=${token}`;
}
const withMetaM = (inv, deptById) => ({
  ...inv,
  departmentName: inv.departmentId && deptById[inv.departmentId] ? deptById[inv.departmentId].name : null,
  link: inviteLink(inv.token),
});
async function withMeta(ctx: RequestContext, inv) {
  const dept = inv.departmentId ? await ctx.data.departments.byId(inv.departmentId) : null;
  return { ...inv, departmentName: dept ? dept.name : null, link: inviteLink(inv.token) };
}

/** Every invite, newest first, with its department name and link. */
export async function listInvites(ctx: RequestContext) {
  const depts = await ctx.data.departments.all();
  const deptById = Object.fromEntries(depts.map((d) => [d.id, d]));
  const list = await ctx.data.onboardingInvites.newestFirst();
  return list.map((inv) => withMetaM(inv, deptById));
}

/** Validate one candidate row. Returns an error string, or null when it is good. */
function validateInvite(
  b: any,
  refs: { deptIds: Set<string>; empIds: Set<string>; templates: any[] }
): string | null {
  if (!String(b.personalEmail || "").trim()) return "Candidate personal email is required";
  if (!TYPES.includes(b.employmentType)) return `employmentType must be one of: ${TYPES.join(", ")}`;
  if (b.departmentId && !refs.deptIds.has(b.departmentId)) return "Unknown department";
  if (b.reportsTo && !refs.empIds.has(b.reportsTo)) return "Unknown manager in reportsTo";
  // The link is only worth as much as the form behind it. This used to be checked when the
  // candidate opened the link, which meant a missing form was reported as a 400 to the one
  // person who could not act on it, days later and outside the product. Checked here, the
  // send fails in front of the HR user who can fix it, and no dead link is ever emailed.
  return templateGapReason(refs.templates, {
    employmentType: b.employmentType,
    departmentId: b.departmentId || null,
  });
}

function inviteRecord(b: any, userId: string) {
  return {
    token: uuid(),
    personalEmail: String(b.personalEmail || "").toLowerCase().trim(),
    firstName: b.firstName || "",
    lastName: b.lastName || "",
    departmentId: b.departmentId || null,
    employmentType: b.employmentType,
    designation: b.designation || "",
    joiningDate: b.joiningDate || new Date().toISOString().slice(0, 10),
    reportsTo: b.reportsTo || null,
    // Compensation HR agreed at offer time. `annualCtc` + `salaryStructureId` is
    // the way in; the breakup is computed on approval so a structure edited in
    // between is reflected, exactly as an unlaunched campaign picks up form edits.
    //
    // `salaryBasic` is kept because invites created before this feature carry it,
    // and their links must keep working.
    salaryBasic: Number(b.salaryBasic) > 0 ? Number(b.salaryBasic) : null,
    annualCtc: Number(b.annualCtc) > 0 ? Number(b.annualCtc) : null,
    salaryStructureId: b.salaryStructureId || null,
    status: "SENT",
    employeeId: null,
    createdBy: userId,
  };
}

const sendInviteMail = (org, invite) =>
  sendTenantMail(org, inviteEmail({ org, personalEmail: invite.personalEmail, link: inviteLink(invite.token), firstName: invite.firstName }));

/**
 * Create one invite or a batch of them.
 *
 * Two shapes:
 *  - one candidate object (the original contract, unchanged) -> { invite, mail }
 *  - { invites: [ ...same shape ] }                          -> { created, failed, skipped }
 *
 * The batch form exists because inviting a joining class meant reopening the dialog once
 * per person. It is deliberately per-row tolerant: one bad row reports itself and the rest
 * still go out, which is the only useful behaviour when pasting a list of 30 people.
 * Sends are sequential on purpose, matching the bulk offer-letter route, so a large batch
 * cannot open a burst of SMTP connections.
 */
export async function createInvites(ctx: RequestContext, rawBody: any) {
  const body = rawBody || {};
  const batch: any[] | null = Array.isArray(body) ? body : Array.isArray(body.invites) ? body.invites : null;

  // Referential checks are done once for the whole batch rather than per row.
  const [depts, emps, existing, templates] = await Promise.all([
    ctx.data.departments.all(),
    ctx.data.employees.all(),
    ctx.data.onboardingInvites.all(),
    ctx.data.onboardingTemplates.all(),
  ]);
  const refs = {
    deptIds: new Set<string>(depts.map((d) => String(d.id))),
    empIds: new Set<string>(emps.map((e) => String(e.id))),
    templates,
  };
  const org = await ctx.data.organizations.byId(ctx.orgId);

  // ── single (unchanged contract) ──
  if (!batch) {
    const err = validateInvite(body, refs);
    if (err) throw bad(err);
    const invite = await ctx.data.onboardingInvites.create(inviteRecord(body, ctx.user.id));
    const mail = await sendInviteMail(org, invite);
    return { invite: await withMeta(ctx, invite), mail };
  }

  // ── batch ──
  if (!batch.length) throw bad("Provide at least one candidate");
  if (batch.length > 200) throw bad("Up to 200 candidates per request");

  const openByEmail = new Set(
    existing.filter((i) => i.status !== "COMPLETED").map((i) => String(i.personalEmail || "").toLowerCase())
  );
  const seenInBatch = new Set<string>();
  const created: any[] = [];
  const failed: any[] = [];
  const skipped: any[] = [];

  for (let i = 0; i < batch.length; i++) {
    const row = batch[i] || {};
    const email = String(row.personalEmail || "").toLowerCase().trim();
    const err = validateInvite(row, refs);
    if (err) {
      failed.push({ index: i, personalEmail: email, error: err });
      continue;
    }
    if (seenInBatch.has(email)) {
      skipped.push({ index: i, personalEmail: email, reason: "Duplicate row in this batch" });
      continue;
    }
    if (openByEmail.has(email)) {
      skipped.push({ index: i, personalEmail: email, reason: "Already has an open invite" });
      continue;
    }
    seenInBatch.add(email);

    try {
      const invite = await ctx.data.onboardingInvites.create(inviteRecord(row, ctx.user.id));
      const mail = await sendInviteMail(org, invite);
      created.push({ ...(await withMeta(ctx, invite)), mail });
    } catch (e: any) {
      failed.push({ index: i, personalEmail: email, error: e?.message || "Could not create invite" });
    }
  }

  return { created, failed, skipped, sent: created.length };
}

/**
 * Correct an invite that has not been completed.
 *
 * An invite that sits unaccepted through a reorg had no way to be corrected: the only
 * options were resend and delete, and deleting invalidates a link the candidate may
 * already hold. Editing is limited to invites that are not yet completed.
 */
export async function updateInvite(ctx: RequestContext, id: string, rawBody: any) {
  const inv = await ctx.data.onboardingInvites.byId(id);
  if (!inv) throw notFound("Invite not found");
  if (inv.status === "COMPLETED") throw bad("This onboarding is already complete");

  const b = rawBody || {};
  const patch: any = {};
  for (const k of ["firstName", "lastName", "designation", "joiningDate"]) {
    if (b[k] !== undefined) patch[k] = b[k];
  }
  if (b.employmentType !== undefined) {
    if (!TYPES.includes(b.employmentType)) throw bad(`employmentType must be one of: ${TYPES.join(", ")}`);
    patch.employmentType = b.employmentType;
  }
  if (b.departmentId !== undefined) {
    if (b.departmentId && !(await ctx.data.departments.byId(b.departmentId))) throw bad("Unknown department");
    patch.departmentId = b.departmentId || null;
  }
  if (b.reportsTo !== undefined) {
    if (b.reportsTo && !(await ctx.data.employees.byId(b.reportsTo))) throw bad("Unknown manager in reportsTo");
    patch.reportsTo = b.reportsTo || null;
  }
  if (b.salaryBasic !== undefined) {
    patch.salaryBasic = Number(b.salaryBasic) > 0 ? Number(b.salaryBasic) : null;
  }
  if (b.annualCtc !== undefined) {
    patch.annualCtc = Number(b.annualCtc) > 0 ? Number(b.annualCtc) : null;
  }
  if (b.salaryStructureId !== undefined) patch.salaryStructureId = b.salaryStructureId || null;

  const updated = await ctx.data.onboardingInvites.update(inv.id, patch);
  return withMeta(ctx, updated);
}

/** Email the link again. */
export async function resendInvite(ctx: RequestContext, id: string) {
  const inv = await ctx.data.onboardingInvites.byId(id);
  if (!inv) throw notFound("Invite not found");
  if (inv.status === "COMPLETED") throw bad("This onboarding is already complete");

  // A candidate who has already opened the link has their form snapshotted on the case, so
  // only an untouched invite still depends on a template resolving right now. Resending one
  // that cannot open just puts a second dead link in the same inbox.
  if (!(await ctx.data.onboardingCases.inviteHasCase(inv.id))) {
    const gap = templateGapReason(await ctx.data.onboardingTemplates.all(), {
      employmentType: inv.employmentType,
      departmentId: inv.departmentId,
    });
    if (gap) throw bad(gap);
  }

  const org = await ctx.data.organizations.byId(ctx.orgId);
  const mail = await sendInviteMail(org, inv);
  return { ok: true, mail };
}

/**
 * Withdraw an invite.
 *
 * Also cancels the onboarding case the invite opened, if the candidate had started one.
 * Without this the case outlives the invite that identified it: the candidate's name lives on
 * the invite until they are hired, so the review queue was left showing a nameless
 * "Unassigned" row that HR can open, read and approve but never work out who it belongs to.
 * Cancelled rather than deleted, so an accidental removal is still auditable.
 */
export async function deleteInvite(ctx: RequestContext, id: string) {
  const inv = await ctx.data.onboardingInvites.byId(id);
  if (!inv) throw notFound("Invite not found");

  let casesCancelled = 0;
  for (const c of await ctx.data.onboardingCases.forInvite(inv.id)) {
    if (c.status === "APPROVED") continue; // already a real employee; leave the record alone
    await ctx.data.onboardingCases.update(c.id, {
      status: "CANCELLED",
      cancelledAt: new Date().toISOString(),
      cancelledBy: ctx.user.id,
      cancelReason: "Invite withdrawn",
    });
    casesCancelled++;
  }

  await ctx.data.onboardingInvites.remove(inv.id);
  await ctx.data.auditLog.create({
    action: "ONBOARDING_INVITE_DELETED",
    userId: ctx.user.id,
    meta: { inviteId: inv.id, personalEmail: inv.personalEmail, casesCancelled },
  });
  return { ok: true, casesCancelled };
}
