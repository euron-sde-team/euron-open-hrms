/**
 * Daily "you have not clocked in yet" reminder.
 *
 * Why this is not just a cron line:
 *
 *  - Absence is never recorded. There is no attendance row for a day you did not clock
 *    in; `GET /api/attendance` synthesises ABSENT at read time. So nothing in the system
 *    ever observes "X has not clocked in today" unless someone opens the roster page.
 *    This job has to derive it: active roster, minus today's attendance rows, minus
 *    approved leave, minus holidays and weekends.
 *
 *  - Server time is not the employee's time. Everything else in the codebase uses
 *    `todayStr()` (server UTC). A 9am reminder is meaningless without the org's zone, so
 *    the send time and the definition of "today" are both evaluated per organization.
 *
 *  - Multiple replicas would each fire. The sweep is leader-elected with a pg advisory
 *    lock, the same technique `access-sweep.ts` already uses, so exactly one replica sends.
 *
 *  - Retries would duplicate. The queue retries up to 3 times with backoff and
 *    `notifications` has no unique constraint, so every send is guarded by a per
 *    org+employee+date marker written before the channels fan out.
 */
import { systemRepos, repos } from "../../repositories/base.repository";
import { db } from "../../db/kysely";
import { logger } from "../../core/logger";
import { sendTenantMail } from "../../integrations/mail/mailer";
import { clockInReminderEmail } from "../../integrations/mail/templates";
import { sendPushToEmployee } from "../../integrations/push";

// Arbitrary fixed key for the reminder lock. Distinct from access-sweep's 778001.
const REMINDER_LOCK_KEY = 778002;

export interface ReminderSettings {
  enabled: boolean;
  /** "HH:MM" in the org's timezone. */
  time: string;
  /** IANA zone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** 0=Sunday .. 6=Saturday. Days the org expects attendance. */
  workingDays: number[];
  channels: { inApp: boolean; email: boolean; push: boolean };
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false, // opt-in: a daily message to every employee is not a safe default
  time: "10:00",
  timezone: "Asia/Kolkata",
  workingDays: [1, 2, 3, 4, 5],
  channels: { inApp: true, email: false, push: true },
};

export function readReminderSettings(org: any): ReminderSettings {
  const raw = (org?.reminders && org.reminders.clockIn) || {};
  const ch = raw.channels || {};
  return {
    enabled: !!raw.enabled,
    time: /^\d{2}:\d{2}$/.test(raw.time) ? raw.time : DEFAULT_REMINDER_SETTINGS.time,
    timezone: raw.timezone || DEFAULT_REMINDER_SETTINGS.timezone,
    workingDays: Array.isArray(raw.workingDays) && raw.workingDays.length
      ? raw.workingDays.map(Number).filter((d) => d >= 0 && d <= 6)
      : DEFAULT_REMINDER_SETTINGS.workingDays,
    channels: {
      inApp: ch.inApp !== false,
      email: !!ch.email,
      push: ch.push !== false,
    },
  };
}

/** Sanitise a settings payload coming from the API. */
export function normalizeReminderSettings(input: any): ReminderSettings {
  const s = readReminderSettings({ reminders: { clockIn: input || {} } });
  return { ...s, enabled: !!(input && input.enabled) };
}

/**
 * The org's wall-clock date and time. `en-CA` gives an ISO-shaped YYYY-MM-DD, and
 * `weekday: "short"` avoids parsing a localized date back into a Date.
 */
export function localNow(timezone: string, now = new Date()) {
  let date: string, time: string, weekdayName: string;
  try {
    date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
    time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
    weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
  } catch {
    // Unknown zone: fall back to UTC rather than skipping the org entirely.
    date = now.toISOString().slice(0, 10);
    time = now.toISOString().slice(11, 16);
    weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(now);
  }
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  return { date, time, dow };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Who should be reminded right now for one org.
 * Exported so it can be tested without a scheduler and previewed from the API.
 */
export async function whoNeedsReminding(r: any, date: string) {
  const employees = (await r.employees.all()).filter(
    (e: any) => e.status !== "EXITED" && e.status !== "ABSCONDING"
  );

  const attended = new Set(
    (await r.attendance.where({ date }).list()).map((a: any) => a.employeeId)
  );
  const onLeave = new Set(
    (await r.leaveRequests.where({ status: "APPROVED" }).list())
      .filter((l: any) => l.from <= date && date <= l.to)
      .map((l: any) => l.employeeId)
  );
  const holidays = await r.holidays.where({ date }).list();
  if (holidays.length) return { holiday: true, employees: [] as any[] };

  return {
    holiday: false,
    employees: employees.filter((e: any) => !attended.has(e.id) && !onLeave.has(e.id)),
  };
}

/** Dedupe marker, so a queue retry or a second tick in the same minute cannot double-send. */
async function alreadySent(r: any, employeeId: string, date: string) {
  const existing = await r.notifications.findOne(
    (n: any) => n.type === "CLOCK_IN_REMINDER" && n.employeeId === employeeId && n.forDate === date
  );
  return !!existing;
}

/** Run the reminder for a single org. Exported for tests and for a manual "send now". */
export async function remindOrg(org: any, opts: { force?: boolean; now?: Date } = {}) {
  const settings = readReminderSettings(org);
  if (!settings.enabled && !opts.force) return { skipped: "disabled" as const, sent: 0 };

  const { date, time, dow } = localNow(settings.timezone, opts.now);
  if (!opts.force) {
    if (!settings.workingDays.includes(dow)) return { skipped: "non-working-day" as const, sent: 0 };
    // Fire in the minute the org asked for, tolerating a slightly late tick.
    const delta = toMinutes(time) - toMinutes(settings.time);
    if (delta < 0 || delta > 10) return { skipped: "not-due" as const, sent: 0 };
  }

  const r = repos({ orgId: org.id });
  const { holiday, employees } = await whoNeedsReminding(r, date);
  if (holiday) return { skipped: "holiday" as const, sent: 0 };

  let sent = 0;
  for (const e of employees) {
    try {
      if (await alreadySent(r, e.id, date)) continue;

      const user = await r.users.findOne((u: any) => u.employeeId === e.id && u.status !== "DISABLED");
      if (!user) continue; // nobody to notify

      // Written first, so a crash mid-fanout cannot produce a second full send.
      await r.notifications.insert({
        userId: user.id,
        type: "CLOCK_IN_REMINDER",
        title: "You have not clocked in yet",
        body: `Open Attendance to clock in for ${date}.`,
        link: "attendance",
        employeeId: e.id,
        forDate: date,
        readAt: null,
      });

      if (settings.channels.email && (e.officialEmail || e.email)) {
        await sendTenantMail(org, clockInReminderEmail({ org, emp: e, date })).catch(() => null);
      }
      if (settings.channels.push) {
        await sendPushToEmployee(r, e.id, {
          title: "You have not clocked in yet",
          body: `Tap to clock in for ${date}.`,
          url: "/attendance",
        }).catch(() => null);
      }
      sent++;
    } catch (err) {
      logger.warn({ err, employeeId: e.id }, "clock-in reminder failed for employee");
    }
  }
  return { skipped: null, sent, date, candidates: employees.length };
}

/**
 * Leader-elected sweep across every org. Safe to call on an interval from every replica:
 * only the lock holder does any work.
 */
export async function remindAllOrgsIfLeader(now = new Date()) {
  try {
    // The lock must be taken and released on the SAME connection: pg advisory locks are
    // session-scoped, so acquiring on a pooled connection and releasing on another leaks
    // the lock forever. db.connection() pins one, same as access-sweep.ts.
    return await db.connection().execute(async (conn) => {
      const got = await conn
        .selectNoFrom((eb) => eb.fn<boolean>("pg_try_advisory_lock", [eb.lit(REMINDER_LOCK_KEY)]).as("locked"))
        .executeTakeFirst();
      if (!got || !(got as any).locked) {
        logger.debug("clock-in reminder: another replica holds the lock, skipping");
        return { leader: false, sent: 0 };
      }
      try {
        let total = 0;
        const orgs = await systemRepos().organizations.all();
        for (const org of orgs) {
          const out = await remindOrg(org, { now });
          total += out.sent;
        }
        if (total) logger.info({ sent: total }, "clock-in reminders sent");
        return { leader: true, sent: total };
      } finally {
        await conn.selectNoFrom((eb) => eb.fn("pg_advisory_unlock", [eb.lit(REMINDER_LOCK_KEY)]).as("u")).executeTakeFirst();
      }
    });
  } catch (err) {
    logger.error({ err }, "clock-in reminder leader-check failed");
    return { leader: false, sent: 0 };
  }
}
