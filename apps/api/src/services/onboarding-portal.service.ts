/**
 * PUBLIC self-onboarding for a pre-hire candidate: no login, just the token in their link.
 *
 * This used to be a single long form that, on submit, created the employee, the login and the
 * welcome email in one shot. That worked, but it meant candidates got a materially worse
 * process than the existing roster: no save-and-resume, no document upload, no HR review, and
 * previous employment stored as one free-text string. Worse, it wrote straight into
 * `employees`, so whatever a stranger typed became the record.
 *
 * It is now the same case-backed flow the roster uses. Every function resolves a case from the
 * token and delegates to onboarding-actions.ts, which is the identical code path the
 * signed-in /me routes use. The employee record is created only when HR approves, by
 * commitCase().
 *
 * Policies are served from here, because a candidate cannot reach /api/content/policies.
 */
import { systemContext, type RequestContext } from "../core/context";
import { systemRepos } from "../repositories/base.repository";
import { createRepositories } from "../repositories";
import { bad, notFound } from "../core/util";
import { notifyStaff } from "./notification.service";
import * as actions from "../domain/onboarding-actions";
import { createCase, decorateCase, hashCaseToken, isOverdue, resolveTemplate } from "./onboarding.service";
import type { UploadedFile } from "./document.service";

/* ── Token resolution ───────────────────────────────────────────────────────────────── */

interface PortalSession {
  caseRow: any;
  invite: any;
  org: any;
  /** The invite's workspace. The candidate has no user, so this is a system context. */
  ctx: RequestContext;
}

/** What the controller knows about the anonymous caller, recorded against signatures. */
export interface CandidateRequest {
  ip?: string;
  userAgent: string;
}

/**
 * Resolve a link token to a live case, opening one on first use.
 *
 * Hash lookup first, which covers every case that already exists. Falling back to the invite
 * is what makes links emailed before this existed keep working: the case is created on the
 * spot, keyed on the hash of the token the candidate is already holding, so the same link
 * keeps resolving forever after.
 */
async function resolve(token: string): Promise<PortalSession> {
  const raw = String(token || "");
  if (!raw) throw notFound("This onboarding link is not valid.");

  // Unauthenticated callers have no workspace yet: look the token up across all of them,
  // then scope everything after that to the invite's own organisation.
  const sys = createRepositories(systemRepos());
  let caseRow = await sys.onboardingCases.byTokenHash(hashCaseToken(raw));

  const invite = caseRow?.inviteId
    ? await sys.onboardingInvites.byId(caseRow.inviteId)
    : await sys.onboardingInvites.byToken(raw);
  if (!invite) throw notFound("This onboarding link is not valid.");

  const ctx = systemContext(invite.orgId);
  const org = await ctx.data.organizations.byId(invite.orgId);

  if (!caseRow) {
    if (invite.status === "COMPLETED") throw bad("This onboarding has already been completed.");
    const template = await resolveTemplate(ctx.repos, invite);
    const created = await createCase(ctx.repos, {
      invite,
      template,
      rawToken: raw, // keep the link they already have working
      actorId: invite.createdBy || "system",
    });
    caseRow = created.case;
  }

  return { caseRow, invite, org, ctx };
}

/** Everything a screen needs, in the shape the signed-in wizard already consumes. */
const view = (s: PortalSession, caseRow = s.caseRow) => ({
  case: decorateCase(caseRow),
  overdue: isOverdue(caseRow),
  org: { name: s.org.name },
  invite: {
    firstName: s.invite.firstName,
    lastName: s.invite.lastName || "",
    personalEmail: s.invite.personalEmail,
    designation: s.invite.designation,
    employmentType: s.invite.employmentType,
    joiningDate: s.invite.joiningDate,
  },
  completed: s.invite.status === "COMPLETED" || caseRow.status === "APPROVED",
});

/** A candidate acts as themselves; there is no user id to attribute it to. */
const actorOf = (s: PortalSession, who: CandidateRequest): actions.ActorContext => ({
  actorId: `invite:${s.invite.id}`,
  employeeId: null,
  ip: who.ip,
  userAgent: who.userAgent,
});

/* ── Read ───────────────────────────────────────────────────────────────────────────── */

export async function getPortal(token: string) {
  return view(await resolve(token));
}

/**
 * The ACKNOWLEDGMENT section renders these; a candidate cannot reach the authenticated
 * content API, so the same list is served here, scoped to the invite's organisation.
 */
export async function portalPolicies(token: string) {
  const s = await resolve(token);
  const policies = await s.ctx.data.policies.all();
  return policies.map((p: any) => ({
    id: p.id, title: p.title, category: p.category, version: p.version, content: p.content,
  }));
}

/* ── Write ──────────────────────────────────────────────────────────────────────────── */

/** Save one section: { values } | { rows }. */
export async function saveSection(token: string, key: string, body: any, who: CandidateRequest) {
  const s = await resolve(token);
  const { case: updated, errors } = await actions.saveSection(
    s.ctx.repos, s.caseRow, key, body, actorOf(s, who)
  );
  return { ...view(s, updated), errors };
}

export async function acknowledgePolicies(token: string, policyIds: any, who: CandidateRequest) {
  const s = await resolve(token);
  const updated = await actions.acknowledgePolicies(s.ctx.repos, s.caseRow, policyIds, actorOf(s, who));
  return view(s, updated);
}

export async function signDeclaration(token: string, fullName: any, who: CandidateRequest) {
  const s = await resolve(token);
  const updated = await actions.signDeclaration(s.ctx.repos, s.caseRow, fullName, actorOf(s, who));
  return view(s, updated);
}

/**
 * `issued` is what HR staged against this CASE, typically the day-one laptop, since there is
 * no employee record to provision against until approval.
 */
export async function listAssets(token: string) {
  const s = await resolve(token);
  return actions.listCaseAssets(s.ctx.repos, s.caseRow, null);
}

export async function acknowledgeAsset(token: string, assetId: string, body: any, who: CandidateRequest) {
  const s = await resolve(token);
  const { case: updated, acknowledgment } = await actions.acknowledgeAsset(
    s.ctx.repos, s.caseRow, assetId, body, actorOf(s, who)
  );
  return { ...view(s, updated), acknowledgment };
}

export async function declareAsset(token: string, body: any) {
  const s = await resolve(token);
  const { case: updated, asset } = await actions.declareAsset(s.ctx.repos, s.caseRow, body);
  return { ...view(s, updated), asset };
}

export async function removeDeclaredAsset(token: string, entryId: string) {
  const s = await resolve(token);
  const updated = await actions.removeDeclaredAsset(s.ctx.repos, s.caseRow, entryId);
  return view(s, updated);
}

/** Upload a document against a section. Fields: sectionKey, category */
export async function attachDocument(
  token: string, file: UploadedFile | undefined, category: any, sectionKey: any, who: CandidateRequest
) {
  const s = await resolve(token);
  const { case: updated, document } = await actions.attachDocument(
    s.ctx.repos, s.caseRow, file as any, category, sectionKey, actorOf(s, who)
  );
  return { ...view(s, updated), document };
}

/**
 * Hands the form to HR. Note what this does NOT do any more: no employee, no login, no
 * welcome email. Those happen on approval, so nothing a stranger typed reaches the roster
 * before somebody has read it.
 */
export async function submit(token: string) {
  const s = await resolve(token);
  const { case: updated, warnings } = await actions.submitCase(s.ctx.repos, s.caseRow, s.invite.employmentType);

  const name = `${s.invite.firstName || ""} ${s.invite.lastName || ""}`.trim() || "A new joiner";
  await notifyStaff(s.ctx.repos, {
    type: "ONBOARDING",
    title: "New joiner form submitted",
    body: `${name} has completed their onboarding form and it is ready to review.`,
    link: "onboarding",
  });
  await s.ctx.data.auditLog.create({
    action: "ONBOARDING_SUBMITTED",
    meta: { caseId: updated.id, inviteId: s.invite.id, preHire: true, warnings: warnings.map((w: any) => w.key) },
  });

  return { ...view(s, updated), warnings };
}
