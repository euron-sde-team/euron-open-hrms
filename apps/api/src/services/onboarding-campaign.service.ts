/**
 * Onboarding campaigns: send one form to a slice of the roster, with a deadline.
 *
 * This is the answer to "everybody's records are half empty and chasing them by hand does
 * not scale". A campaign names an audience, a form and a due date; launching turns that into
 * one case per person, an email each, and a reminder schedule that runs itself.
 *
 * Launching is deliberately a two-step: preview says exactly who would be included and who
 * would be skipped, and launch is a separate call. Emailing several hundred people is not
 * something to discover you have done.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound, isoDate } from "../core/util";
import { enqueue } from "../jobs/queue";
import { resolveAudience, isOverdue } from "./onboarding.service";
import { sweepOrg, readSettings, normalizeSettings } from "../jobs/reminders/onboarding";
import { checkCase, OPEN_STATUSES } from "../domain/onboarding-case";
import { fullName } from "../domain/person";

const AUDIENCE_MODES = ["ALL", "DEPARTMENT", "EMPLOYMENT_TYPE", "INCOMPLETE", "SELECTED"];

function validateAudience(raw: any) {
  const mode = String(raw?.mode || "ALL").toUpperCase();
  if (!AUDIENCE_MODES.includes(mode)) throw bad(`audience.mode must be one of: ${AUDIENCE_MODES.join(", ")}`);
  const out: any = { mode, departmentIds: [], employmentTypes: [], employeeIds: [] };
  if (mode === "DEPARTMENT") {
    out.departmentIds = (Array.isArray(raw.departmentIds) ? raw.departmentIds : []).map(String).filter(Boolean);
    if (!out.departmentIds.length) throw bad("Choose at least one department");
  }
  if (mode === "EMPLOYMENT_TYPE") {
    out.employmentTypes = (Array.isArray(raw.employmentTypes) ? raw.employmentTypes : []).map(String).filter(Boolean);
    if (!out.employmentTypes.length) throw bad("Choose at least one employment type");
  }
  if (mode === "SELECTED") {
    out.employeeIds = (Array.isArray(raw.employeeIds) ? raw.employeeIds : []).map(String).filter(Boolean);
    if (!out.employeeIds.length) throw bad("Choose at least one person");
  }
  return out;
}

/** Live counts for a campaign, computed from its cases rather than stored and left to rot. */
async function statsFor(ctx: RequestContext, campaignId: string) {
  const cases = await ctx.data.onboardingCases.forCampaign(campaignId);
  const s = { total: cases.length, notStarted: 0, inProgress: 0, submitted: 0, approved: 0, overdue: 0, cancelled: 0, expired: 0 };
  for (const c of cases) {
    if (c.status === "NOT_STARTED") s.notStarted++;
    else if (c.status === "IN_PROGRESS" || c.status === "CHANGES_REQUESTED") s.inProgress++;
    else if (c.status === "SUBMITTED") s.submitted++;
    else if (c.status === "APPROVED") s.approved++;
    else if (c.status === "CANCELLED") s.cancelled++;
    else if (c.status === "EXPIRED") s.expired++;
    if (isOverdue(c)) s.overdue++;
  }
  return s;
}

async function campaignOr404(ctx: RequestContext, id: string) {
  const c = await ctx.data.onboardingCampaigns.byId(id);
  if (!c) throw notFound("Campaign not found");
  return c;
}


export async function listCampaigns(ctx: RequestContext) {
  const list = await ctx.data.onboardingCampaigns.newestFirst();
  const out: any[] = [];
  for (const c of list) out.push({ ...c, stats: await statsFor(ctx, c.id) });
  return out;
}

/**
 * Who would this reach? Answered before anything is created, and it names the people who
 * would be SKIPPED as loudly as the ones who would be included: an employee with no portal
 * login cannot follow a deep link, and silently dropping them is how a "everyone was asked"
 * report ends up wrong.
 */
export async function previewCampaign(ctx: RequestContext, rawAudience: any) {
  const audience = validateAudience(rawAudience);
  const employees = await resolveAudience(ctx.repos, audience);

  const users = await ctx.data.users.all();
  const hasLogin = new Set(
    users.filter((u: any) => u.employeeId && u.status !== "DISABLED").map((u: any) => u.employeeId)
  );
  const openCases = new Set(
    (await ctx.data.onboardingCases.all())
      .filter((c: any) => OPEN_STATUSES.includes(c.status) || c.status === "SUBMITTED")
      .map((c: any) => c.employeeId)
  );
  const departments = await ctx.data.departments.all();
  const deptName = new Map<string, string>(departments.map((d: any) => [d.id, d.name]));

  const included: any[] = [];
  const skipped: any[] = [];
  for (const e of employees) {
    const row = {
      id: e.id,
      name: fullName(e),
      code: e.code,
      email: e.officialEmail || e.email,
      department: deptName.get(e.departmentId) || null,
      employmentType: e.employmentType,
    };
    if (!hasLogin.has(e.id)) skipped.push({ ...row, reason: "No portal login. Give them access first, under Employees." });
    else if (openCases.has(e.id)) skipped.push({ ...row, reason: "Already has an onboarding form open." });
    else included.push(row);
  }

  return { audience, included, skipped, counts: { included: included.length, skipped: skipped.length } };
}

/**
 * When chasing happens, in the org's own timezone, and whether an overdue form eventually
 * closes itself. The sweep has always read these off the organisation; until now there was no
 * way to set them, so every tenant silently ran on the 10:00 Asia/Kolkata default and
 * hard-expiry could not be switched on at all.
 */
export async function getReminderSettings(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  return readSettings(org);
}

export async function updateReminderSettings(ctx: RequestContext, input: any) {
  const org: any = await ctx.data.organizations.byId(ctx.orgId);
  const onboarding = normalizeSettings(input);
  const updated = await ctx.data.organizations.update(org.id, {
    reminders: { ...(org.reminders || {}), onboarding },
  });
  await ctx.data.auditLog.create({
    action: "ONBOARDING_REMINDER_SETTINGS_UPDATED",
    userId: ctx.user.id,
    meta: onboarding,
  });
  return readSettings(updated);
}

export async function getCampaign(ctx: RequestContext, id: string) {
  const c = await campaignOr404(ctx, id);
  return { ...c, stats: await statsFor(ctx, c.id) };
}

/** Create a DRAFT campaign. Body: { name, templateId, audience, dueAt, message? } */
export async function createCampaign(ctx: RequestContext, body: any) {
  const name = String(body?.name || "").trim();
  if (!name) throw bad("Give the campaign a name");

  const template = await ctx.data.onboardingTemplates.byId(body?.templateId);
  if (!template) throw notFound("Onboarding form not found");
  if (template.status !== "ACTIVE") throw bad("That form is not active yet. Activate it before sending it to anyone.");

  const audience = validateAudience(body?.audience);

  // A deadline in the past would fire every reminder and the escalation on the first sweep.
  const dueAt = body?.dueAt ? new Date(body.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw bad("That due date is not a date");
  if (dueAt && dueAt.getTime() < Date.now()) throw bad("The deadline is in the past. Pick a date in the future.");

  const created = await ctx.data.onboardingCampaigns.create({
    name,
    description: String(body?.description || "").slice(0, 1000),
    message: String(body?.message || "").slice(0, 1000),
    templateId: template.id,
    templateName: template.name,
    audience,
    status: "DRAFT",
    dueAt,
    createdBy: ctx.user.id,
    stats: {},
  });
  await ctx.data.auditLog.create({
    action: "ONBOARDING_CAMPAIGN_CREATE",
    userId: ctx.user.id,
    meta: { campaignId: created.id, name, templateId: template.id, mode: audience.mode },
  });
  return { ...created, stats: await statsFor(ctx, created.id) };
}

/** Editable only while it is still a draft. */
export async function updateCampaign(ctx: RequestContext, id: string, body: any) {
  const c = await campaignOr404(ctx, id);
  if (c.status !== "DRAFT") throw bad("This campaign has already been launched. Create a new one instead.");

  const patch: any = {};
  if (body?.name !== undefined) patch.name = String(body.name).trim();
  if (body?.description !== undefined) patch.description = String(body.description).slice(0, 1000);
  if (body?.message !== undefined) patch.message = String(body.message).slice(0, 1000);
  if (body?.audience !== undefined) patch.audience = validateAudience(body.audience);
  if (body?.dueAt !== undefined) {
    const d = body.dueAt ? new Date(body.dueAt) : null;
    if (d && Number.isNaN(d.getTime())) throw bad("That due date is not a date");
    if (d && d.getTime() < Date.now()) throw bad("The deadline is in the past. Pick a date in the future.");
    patch.dueAt = d;
  }
  if (body?.templateId !== undefined) {
    const t = await ctx.data.onboardingTemplates.byId(body.templateId);
    if (!t) throw notFound("Onboarding form not found");
    if (t.status !== "ACTIVE") throw bad("That form is not active yet.");
    patch.templateId = t.id;
    patch.templateName = t.name;
  }

  const updated = await ctx.data.onboardingCampaigns.update(c.id, patch);
  return { ...updated, stats: await statsFor(ctx, c.id) };
}

/**
 * Queues the fan-out and returns immediately. The work happens in the job queue, which
 * gives retries and backoff for free and keeps a five-hundred-person send off the request
 * thread. Guarded against a double launch, which would open a second case for everyone.
 */
export async function launchCampaign(ctx: RequestContext, id: string) {
  const c = await campaignOr404(ctx, id);
  if (c.status !== "DRAFT") throw bad(`This campaign is already ${String(c.status).toLowerCase()}.`);
  if (!c.dueAt) throw bad("Set a deadline before launching, otherwise no reminders can be scheduled.");

  await ctx.data.onboardingCampaigns.update(c.id, { status: "LAUNCHING" });
  // `user.orgId` rather than `ctx.orgId`: enqueue() infers its option type as null-only.
  const orgId = ctx.user.orgId;
  await enqueue("onboarding.campaign.launch", { orgId, campaignId: c.id }, { orgId });

  await ctx.data.auditLog.create({
    action: "ONBOARDING_CAMPAIGN_LAUNCH",
    userId: ctx.user.id,
    meta: { campaignId: c.id, name: c.name, dueAt: c.dueAt },
  });
  return { ok: true, status: "LAUNCHING", message: "The campaign is being sent. Refresh in a moment to see progress." };
}

/** Progress per person. */
export async function campaignCases(ctx: RequestContext, id: string) {
  const c = await campaignOr404(ctx, id);

  const cases = await ctx.data.onboardingCases.forCampaign(c.id);
  const employees = await ctx.data.employees.all();
  const byId = new Map<string, any>(employees.map((e: any) => [e.id, e]));

  return cases.map((x: any) => {
    const emp = byId.get(x.employeeId);
    const checks = checkCase(x, emp?.employmentType);
    return {
      id: x.id,
      status: x.status,
      dueAt: x.dueAt,
      overdue: isOverdue(x),
      submittedAt: x.submittedAt,
      remindersSent: x.remindersSent || [],
      employeeId: x.employeeId,
      employeeName: emp ? fullName(emp) : null,
      employeeCode: emp?.code ?? null,
      done: checks.filter((k) => k.status === "COMPLETE" || k.status === "APPROVED").length,
      total: checks.length,
    };
  });
}

/**
 * Who has done what, for the person chasing a campaign. Progress and status only, never the
 * answers themselves, for the same reason as the review-queue export.
 */
export async function exportCampaignCases(ctx: RequestContext, id: string) {
  const c = await campaignOr404(ctx, id);

  const cases = await ctx.data.onboardingCases.forCampaign(c.id);
  const employees = await ctx.data.employees.all();
  const byId = new Map<string, any>(employees.map((e: any) => [e.id, e]));

  const rows: any[][] = [[
    "Name", "Employee code", "Email", "Status", "Sections done", "Sections total",
    "Due", "Overdue", "Submitted", "Reminders sent",
  ]];
  for (const x of cases) {
    const emp: any = byId.get(x.employeeId);
    const checks = checkCase(x, emp?.employmentType);
    rows.push([
      emp ? fullName(emp) : "",
      emp?.code ?? "",
      emp?.officialEmail || emp?.email || "",
      x.status ?? "",
      checks.filter((k) => k.status === "COMPLETE" || k.status === "APPROVED").length,
      checks.length,
      isoDate(x.dueAt),
      isOverdue(x) ? "Yes" : "No",
      isoDate(x.submittedAt),
      (x.remindersSent || []).join(" "),
    ]);
  }

  // People the campaign could not reach are part of the answer to "did everyone get asked",
  // so they are in the file rather than only on a screen somebody has to remember to check.
  for (const sk of c.skipped || []) {
    const emp: any = byId.get(sk.employeeId);
    rows.push([
      emp ? fullName(emp) : sk.employeeId,
      emp?.code ?? "", emp?.officialEmail || emp?.email || "",
      `SKIPPED: ${sk.reason || "not reachable"}`, 0, 0, "", "", "", "",
    ]);
  }

  await ctx.data.auditLog.create({
    action: "ONBOARDING_CAMPAIGN_EXPORTED",
    userId: ctx.user.id,
    meta: { campaignId: c.id, rows: rows.length - 1 },
  });
  return {
    filename: `campaign-${String(c.name || "onboarding").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
    rows,
  };
}

/** Stop chasing; open cases stay open. */
export async function closeCampaign(ctx: RequestContext, id: string) {
  const c = await campaignOr404(ctx, id);
  const updated = await ctx.data.onboardingCampaigns.update(c.id, { status: "CLOSED", closedAt: new Date().toISOString() });
  await ctx.data.auditLog.create({ action: "ONBOARDING_CAMPAIGN_CLOSE", userId: ctx.user.id, meta: { campaignId: c.id } });
  return { ...updated, stats: await statsFor(ctx, c.id) };
}

/** Cancels the campaign AND every case it opened that nobody has started. */
export async function cancelCampaign(ctx: RequestContext, id: string) {
  const c = await campaignOr404(ctx, id);

  // One timestamp for the campaign and every case it cancels, stamped like a case cancelled
  // on its own: without cancelledAt these cases had no record of when they ended.
  const at = new Date().toISOString();
  let cancelled = 0;
  for (const x of await ctx.data.onboardingCases.forCampaign(c.id)) {
    // Somebody mid-form keeps their case: cancelling it would throw away their work to
    // tidy up a list.
    if (x.status !== "NOT_STARTED") continue;
    await ctx.data.onboardingCases.update(x.id, { status: "CANCELLED", cancelledAt: at, cancelledBy: ctx.user.id, cancelReason: "Campaign cancelled" });
    cancelled++;
  }

  const updated = await ctx.data.onboardingCampaigns.update(c.id, { status: "CANCELLED", cancelledAt: at });
  await ctx.data.auditLog.create({ action: "ONBOARDING_CAMPAIGN_CANCEL", userId: ctx.user.id, meta: { campaignId: c.id, casesCancelled: cancelled } });
  return { ...updated, casesCancelled: cancelled, stats: await statsFor(ctx, c.id) };
}

/**
 * Run the deadline sweep for this org right now, ignoring the send-time window. Exists
 * because "did the reminder go out" is otherwise only answerable by waiting a day, and
 * because a tenant occasionally wants to nudge everyone on the spot.
 */
export async function runReminders(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const out = await sweepOrg(org, { force: true });
  await ctx.data.auditLog.create({ action: "ONBOARDING_REMINDERS_RUN", userId: ctx.user.id, meta: out });
  return out;
}
