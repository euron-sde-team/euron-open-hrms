/**
 * Background job handlers. Registered once at boot. Each handler receives the job payload
 * and runs to completion (or throws to trigger a retry).
 *
 * Every import here is STATIC. A dynamic `await import()` inside a worker can fail silently
 * under cluster mode, which produces the worst possible outcome: the queue marks the job
 * done while nothing actually happened.
 */
import { registerHandler, enqueue } from "./queue";
import { repos } from "../repositories/base.repository";
import { notify, notifyEmployee, notifyStaff } from "../services/notification.service";
import { sendTenantMail } from "../integrations/mail/mailer";
import { logger } from "../core/logger";
import {
  onboardingRequestEmail,
  onboardingReminderEmail,
  onboardingOverdueEmail,
  onboardingEscalationEmail,
} from "../integrations/mail/templates";
import {
  createCase,
  resolveTemplate,
  resolveAudience,
} from "../services/onboarding.service";
import { checkCase, OPEN_STATUSES } from "../domain/onboarding-case";
import { PORTAL_URL } from "../core/config";
import { isoDate } from "../core/util";

/**
 * Register every background job handler.
 *
 * Called explicitly from index.ts before startWorker(), NOT relied on as an import side
 * effect. Importing this module for its side effects is a race: the worker can begin
 * polling and claim a job before the module has finished evaluating, and the job then dies
 * with "No handler registered" even though the handler exists. Retries papered over it for
 * whichever handlers happened to register first, which is why it looked intermittent.
 *
 * Idempotent, so a double call is harmless.
 */
export function registerAllHandlers() {
  /** Fan out an announcement to every (non-vendor) user in the org as a notification. */
  registerHandler("announcement.broadcast", async (payload) => {
    const r = repos({ orgId: payload.orgId });
    const users = await r.users.find((u) => u.role !== "VENDOR");
    for (const u of users) {
      await notify(r, u.id, {
        type: "ANNOUNCEMENT",
        title: payload.title || "New announcement",
        body: payload.body || "",
        link: "announcements",
      });
    }
  });

  /* ── Onboarding campaigns ───────────────────────────────────────────────────────────── */

  /**
   * Launch a campaign: turn an audience rule into one case per person.
   *
   * Fans out rather than doing the work inline, so a five-hundred-person campaign is five
   * hundred small retryable jobs instead of one long one that loses everything on a blip.
   */
  registerHandler("onboarding.campaign.launch", async (payload) => {
    const r = repos({ orgId: payload.orgId });
    const campaign = await r.onboardingCampaigns.byId(payload.campaignId);
    if (!campaign) throw new Error(`campaign ${payload.campaignId} not found`);
    if (campaign.status === "CANCELLED") return;

    const employees = await resolveAudience(r, campaign.audience);
    const users = await r.users.all();
    const hasLogin = new Set(
      users
        .filter((u: any) => u.employeeId && u.status !== "DISABLED")
        .map((u: any) => u.employeeId),
    );

    let queued = 0;
    const skipped: any[] = [];
    for (const e of employees) {
      // Somebody with no portal login cannot follow a deep link, and an email telling them to
      // sign in would be worse than silence. Reported rather than dropped.
      if (!hasLogin.has(e.id)) {
        skipped.push({ employeeId: e.id, reason: "no portal login" });
        continue;
      }
      await enqueue(
        "onboarding.case.create",
        { orgId: payload.orgId, campaignId: campaign.id, employeeId: e.id },
        { orgId: payload.orgId },
      );
      queued++;
    }

    await r.onboardingCampaigns.update(campaign.id, {
      status: "RUNNING",
      launchedAt: new Date().toISOString(),
      stats: { ...(campaign.stats || {}), queued, skipped: skipped.length },
      skipped,
    });
    logger.info(
      { campaignId: campaign.id, queued, skipped: skipped.length },
      "onboarding campaign launched",
    );
  });

  /** Open one case and send the request email. Idempotent: createCase reuses an open case. */
  registerHandler("onboarding.case.create", async (payload) => {
    const r = repos({ orgId: payload.orgId });
    const employee = await r.employees.byId(payload.employeeId);
    if (!employee) return; // removed between launch and fan-out

    const campaign = payload.campaignId
      ? await r.onboardingCampaigns.byId(payload.campaignId)
      : null;
    if (campaign?.status === "CANCELLED") return;

    const template = campaign?.templateId
      ? await r.onboardingTemplates.byId(campaign.templateId)
      : await resolveTemplate(r, employee);

    const { case: created, reused } = await createCase(r, {
      employee,
      template,
      dueAt: campaign?.dueAt || null,
      campaignId: campaign?.id || null,
      actorId: campaign?.createdBy || "system",
    });
    if (reused) return; // they were already mid-form; a second email would just confuse

    const org = await r.organizations.byId(payload.orgId);
    await notifyEmployee(r, employee.id, {
      type: "ONBOARDING",
      title: "Please complete your employee details",
      body: created.dueAt
        ? `Due by ${isoDate(created.dueAt)}.`
        : "",
      link: "onboarding/me",
    });
    await sendTenantMail(
      org,
      onboardingRequestEmail({
        org,
        employee,
        dueAt: created.dueAt,
        portalUrl: PORTAL_URL,
        message: campaign?.message,
      }),
      { employeeId: employee.id },
    );
  });

  /** Send one reminder. The sweep already decided this is due and wrote the marker. */
  registerHandler("onboarding.reminder", async (payload) => {
    const r = repos({ orgId: payload.orgId });
    const c = await r.onboardingCases.byId(payload.caseId);
    if (!c || !OPEN_STATUSES.includes(c.status)) return; // finished between sweep and send

    const employee = c.employeeId ? await r.employees.byId(c.employeeId) : null;
    if (!employee) return;

    // Name what is still outstanding, so the reminder is actionable rather than a nag.
    const remaining = checkCase(c, employee.employmentType)
      .filter(
        (x) =>
          x.status !== "COMPLETE" && x.status !== "APPROVED" && !x.optional,
      )
      .map((x) => x.title);

    const org = await r.organizations.byId(payload.orgId);
    const overdue = Number(payload.offset) > 0;

    await notifyEmployee(r, employee.id, {
      type: "ONBOARDING",
      title: overdue
        ? "Your employee details are overdue"
        : "Your employee details are due soon",
      body: remaining.length ? `Still to do: ${remaining.join(", ")}.` : "",
      link: "onboarding/me",
    });

    const mail = overdue ? onboardingOverdueEmail : onboardingReminderEmail;
    await sendTenantMail(
      org,
      mail({ org, employee, dueAt: c.dueAt, portalUrl: PORTAL_URL, remaining }),
      { employeeId: employee.id },
    );
  });

  /** Tell the reporting manager, if they have one, and HR always. */
  registerHandler("onboarding.escalate", async (payload) => {
    const r = repos({ orgId: payload.orgId });
    const c = await r.onboardingCases.byId(payload.caseId);
    if (!c || !OPEN_STATUSES.includes(c.status)) return;

    const employee = c.employeeId ? await r.employees.byId(c.employeeId) : null;
    if (!employee) return;

    const managerId = employee.managerId || employee.reportsTo;
    const manager = managerId ? await r.employees.byId(managerId) : null;
    const org = await r.organizations.byId(payload.orgId);
    const who = `${employee.firstName} ${employee.lastName || ""}`.trim();

    if (manager) {
      await notifyEmployee(r, manager.id, {
        type: "ONBOARDING",
        title: `${who}'s details are overdue`,
        body: "Their employee details are still incomplete past the deadline.",
        link: "onboarding",
      });
      await sendTenantMail(
        org,
        onboardingEscalationEmail({
          org,
          manager,
          employee,
          dueAt: c.dueAt,
          portalUrl: PORTAL_URL,
        }),
        { employeeId: manager.id },
      );
    }

    // HR is told either way, and this is not a nicety. Escalation used to fire into a manager
    // check: somebody with no reporting line (a founder, a first hire, anyone mid-reorg) had
    // their escalation written to the audit log and told to nobody at all, which is the exact
    // population most likely to be missing from the roster in the first place. HR is the
    // backstop that always exists.
    await notifyStaff(r, {
      type: "ONBOARDING",
      title: `${who}'s onboarding is overdue`,
      body: manager
        ? `Past the deadline. ${manager.firstName} ${manager.lastName || ""}`.trim() + " has been told as their manager."
        : "Past the deadline, and they have no reporting manager to chase them.",
      link: "onboarding",
    });

    await r.auditLog.insert({
      action: "ONBOARDING_ESCALATED",
      employeeId: employee.id,
      meta: { caseId: c.id, managerId: manager?.id || null, notifiedHr: true, dueAt: c.dueAt },
    });
  });
} // end registerAllHandlers

export {};
