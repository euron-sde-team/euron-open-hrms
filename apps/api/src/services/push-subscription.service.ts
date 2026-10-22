/**
 * Web push subscription management, plus the clock-in reminder settings.
 *
 * Every operation here tolerates the `push_subscriptions` table not existing yet (the
 * migration is developer-run), so the app keeps working and simply reports push as
 * unavailable rather than 500-ing.
 */
import type { RequestContext } from "../core/context";
import { bad } from "../core/util";
import { pushAvailable, publicKey } from "../integrations/push";
import {
  readReminderSettings,
  normalizeReminderSettings,
  remindOrg,
  whoNeedsReminding,
  localNow,
} from "../jobs/reminders/clockin";

const missingTable = (err: any) => /relation .*push_subscriptions.* does not exist/i.test(err?.message || "");

/** What the browser needs in order to subscribe. */
export function pushConfig() {
  return { available: pushAvailable(), publicKey: publicKey() };
}

/**
 * Save the browser's PushSubscription { endpoint, keys: { p256dh, auth } }.
 *
 * Upserts on `endpoint`: re-subscribing the same browser must not create a second row,
 * or the employee gets duplicate notifications. `created` tells the caller which happened.
 */
export async function subscribe(ctx: RequestContext, input: { endpoint?: any; keys?: any }, userAgent: unknown) {
  const { endpoint, keys } = input;
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw bad("A complete push subscription is required");
  if (!ctx.user.employeeId) throw bad("Only employees can subscribe to reminders");

  const fields = {
    employeeId: ctx.user.employeeId,
    userId: ctx.user.id,
    p256dh: keys.p256dh,
    auth: keys.auth,
    userAgent: String(userAgent || "").slice(0, 200),
  };
  try {
    const existing = await ctx.data.pushSubscriptions.findByEndpoint(endpoint);
    if (existing) {
      const updated = await ctx.data.pushSubscriptions.update(existing.id, fields);
      return { created: false, body: { ok: true, id: updated!.id, updated: true } };
    }
    const created = await ctx.data.pushSubscriptions.create({
      employeeId: fields.employeeId,
      userId: fields.userId,
      endpoint,
      p256dh: fields.p256dh,
      auth: fields.auth,
      userAgent: fields.userAgent,
    });
    return { created: true, body: { ok: true, id: created.id } };
  } catch (err: any) {
    if (missingTable(err)) throw bad("Push notifications are not enabled on this server yet");
    throw err;
  }
}

export async function unsubscribe(ctx: RequestContext, endpoint: unknown) {
  if (!endpoint) throw bad("endpoint is required");
  try {
    const existing = await ctx.data.pushSubscriptions.findByEndpoint(endpoint);
    if (existing) await ctx.data.pushSubscriptions.remove(existing.id);
  } catch {
    // table absent: nothing to remove
  }
  return { ok: true };
}

/** Current clock-in reminder settings for the org. */
export async function getReminderSettings(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  return { clockIn: readReminderSettings(org), pushAvailable: pushAvailable() };
}

/** Update them. Stored in organizations.data, no schema change. */
export async function updateReminderSettings(ctx: RequestContext, body: any) {
  const org = (await ctx.data.organizations.byId(ctx.orgId))!;
  const clockIn = normalizeReminderSettings(body?.clockIn ?? body);
  const updated = await ctx.data.organizations.update(org.id, {
    reminders: { ...(org.reminders || {}), clockIn },
  });
  return { clockIn: readReminderSettings(updated) };
}

/**
 * Who would be reminded right now, without sending.
 * Makes the feature auditable before anyone switches it on.
 */
export async function previewReminders(ctx: RequestContext) {
  const org = (await ctx.data.organizations.byId(ctx.orgId))!;
  const settings = readReminderSettings(org);
  const { date, time, dow } = localNow(settings.timezone);
  const { holiday, employees } = await whoNeedsReminding(ctx.repos, date);
  return {
    localDate: date,
    localTime: time,
    isWorkingDay: settings.workingDays.includes(dow),
    holiday,
    count: employees.length,
    employees: employees.slice(0, 100).map((e: any) => ({
      id: e.id, code: e.code, name: `${e.firstName} ${e.lastName || ""}`.trim(),
    })),
  };
}

/** Fire the reminder immediately (staff-triggered). */
export async function sendRemindersNow(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  return remindOrg(org, { force: true });
}
