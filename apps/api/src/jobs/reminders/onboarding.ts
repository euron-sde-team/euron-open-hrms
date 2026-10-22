/**
 * Onboarding deadline reminders and escalation.
 *
 * Built the same way as reminders/clockin.ts, and for the same four reasons: server time is
 * not the employee's time, several replicas would each fire, queue retries would duplicate,
 * and nothing in the system otherwise observes "this deadline is approaching".
 *
 * The one structural difference is that this sweep DECIDES rather than SENDS. It works out
 * who is due, writes the marker, and enqueues a job per case. A campaign across five hundred
 * people would otherwise mean five hundred SMTP round trips inside one tick; instead the
 * sweep does five hundred cheap inserts and the existing queue worker drains them 25 at a
 * time with backoff and retries.
 */
import { systemRepos, repos } from "../../repositories/base.repository";
import { db } from "../../db/kysely";
import { logger } from "../../core/logger";
import { enqueue } from "../queue";
import { localNow } from "./clockin";
import { OPEN_STATUSES } from "../../domain/onboarding-case";

// Distinct from access-sweep (778001) and clock-in (778002).
const ONBOARDING_LOCK_KEY = 778003;

export interface OnboardingReminderSettings {
  enabled: boolean;
  /** "HH:MM" in the org's timezone. */
  time: string;
  timezone: string;
  /** 0=Sunday .. 6=Saturday. */
  workingDays: number[];
  /** Days past the deadline before the case is closed off. 0 = never expire. */
  expireAfterDays: number;
  channels: { inApp: boolean; email: boolean };
}

export const DEFAULT_SETTINGS: OnboardingReminderSettings = {
  // Opt-OUT, unlike clock-in reminders. A person only has an open case because somebody
  // deliberately sent them a form with a deadline on it; chasing that deadline is the
  // feature, not an extra someone has to go and switch on.
  enabled: true,
  time: "10:00",
  timezone: "Asia/Kolkata",
  workingDays: [1, 2, 3, 4, 5],
  // Default is never. Locking somebody out of a compliance form they are already late on
  // achieves nothing except making HR do it by hand.
  expireAfterDays: 0,
  channels: { inApp: true, email: true },
};

/**
 * Is this a real wall-clock time?
 *
 * Shape alone is not enough: "25:99" matches /^\d{2}:\d{2}$/ but converts to 1599 minutes,
 * past any minute a clock can produce, so the send window would never match and the org's
 * reminders would go quiet with nothing to show for it. A silently-never-fires bug is far
 * more expensive than a rejected setting.
 */
const isClockTime = (v: unknown) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(v ?? ""));
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
};

export function readSettings(org: any): OnboardingReminderSettings {
  const raw = (org?.reminders && org.reminders.onboarding) || {};
  const ch = raw.channels || {};
  return {
    enabled: raw.enabled !== false,
    time: isClockTime(raw.time) ? raw.time : DEFAULT_SETTINGS.time,
    timezone: raw.timezone || DEFAULT_SETTINGS.timezone,
    workingDays: Array.isArray(raw.workingDays) && raw.workingDays.length
      ? raw.workingDays.map(Number).filter((d: number) => d >= 0 && d <= 6)
      : DEFAULT_SETTINGS.workingDays,
    expireAfterDays: Number.isFinite(Number(raw.expireAfterDays)) ? Math.max(0, Number(raw.expireAfterDays)) : 0,
    channels: { inApp: ch.inApp !== false, email: ch.email !== false },
  };
}

export function normalizeSettings(input: any): OnboardingReminderSettings {
  const s = readSettings({ reminders: { onboarding: input || {} } });
  return { ...s, enabled: !!(input && input.enabled !== false) };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Marker key for one offset, e.g. -3 -> "T-3", 1 -> "T+1". */
export const offsetKey = (offset: number) => `T${offset < 0 ? "" : "+"}${offset}`;

export interface DueVerdict {
  /** Offsets that have come due and were never sent. */
  due: number[];
  /** The one to actually send: the latest due offset. Null when nothing is due. */
  send: number | null;
  /** True once the case is far enough past due to tell the manager. */
  escalate: boolean;
}

/**
 * Which reminders a case has earned, given the clock.
 *
 * Pure, so the offset arithmetic can be tested without a database or a scheduler.
 *
 * Only ONE reminder is ever sent per run, even when several came due at once. A case that
 * sat unswept over a long weekend, or was created with a deadline already in the past, has
 * three or four offsets due simultaneously; sending all of them would land four emails in
 * somebody's inbox in the same second, which reads as a broken system and trains people to
 * filter the sender. The earlier ones are still marked, so they never fire later.
 */
export function dueReminders(
  caseRow: { dueAt?: any; reminderOffsets?: number[]; remindersSent?: string[]; escalateAfterDays?: number },
  now = new Date()
): DueVerdict {
  const out: DueVerdict = { due: [], send: null, escalate: false };
  if (!caseRow.dueAt) return out;

  const due = new Date(caseRow.dueAt).getTime();
  const sent = new Set(caseRow.remindersSent || []);
  const offsets = (caseRow.reminderOffsets?.length ? caseRow.reminderOffsets : [-3, -1, 1]).slice().sort((a, b) => a - b);

  for (const o of offsets) {
    if (now.getTime() >= due + o * 86400000 && !sent.has(offsetKey(o))) out.due.push(o);
  }
  if (out.due.length) out.send = out.due[out.due.length - 1];

  const escalateAfter = Number(caseRow.escalateAfterDays ?? 3);
  if (escalateAfter > 0 && !sent.has("ESCALATED") && now.getTime() >= due + escalateAfter * 86400000) {
    out.escalate = true;
  }

  return out;
}

/**
 * Sweep one organisation. Exported so it can be tested, and driven manually from the API
 * ("send reminders now") without waiting for the tick.
 */
export async function sweepOrg(org: any, opts: { force?: boolean; now?: Date } = {}) {
  const settings = readSettings(org);
  if (!settings.enabled && !opts.force) return { skipped: "disabled" as const, queued: 0, escalated: 0, expired: 0 };

  const now = opts.now || new Date();
  const { time, dow } = localNow(settings.timezone, now);

  if (!opts.force) {
    if (!settings.workingDays.includes(dow)) return { skipped: "non-working-day" as const, queued: 0, escalated: 0, expired: 0 };
    // Fire in the org's chosen minute, tolerating a late tick. Without this a 15-minute
    // interval would mean reminders arriving at 03:00 local time.
    const delta = toMinutes(time) - toMinutes(settings.time);
    if (delta < 0 || delta > 20) return { skipped: "not-due" as const, queued: 0, escalated: 0, expired: 0 };
  }

  const r = repos({ orgId: org.id });
  const open = (await r.onboardingCases.all()).filter(
    (c: any) => OPEN_STATUSES.includes(c.status) && c.dueAt
  );

  let queued = 0;
  let escalated = 0;
  let expired = 0;

  for (const c of open) {
    try {
      const verdict = dueReminders(c, now);
      if (!verdict.due.length && !verdict.escalate) continue;

      // Marker written BEFORE anything is enqueued, so a crash between the two produces a
      // missed reminder rather than a duplicated one. Same trade-off clockin.ts takes, and
      // the right way round: nobody minds a nudge that did not arrive.
      const marks = verdict.due.map(offsetKey);
      if (verdict.escalate) marks.push("ESCALATED");
      await r.onboardingCases.update(c.id, {
        remindersSent: [...(c.remindersSent || []), ...marks],
      });

      if (verdict.send !== null) {
        await enqueue("onboarding.reminder", { orgId: org.id, caseId: c.id, offset: verdict.send }, { orgId: org.id });
        queued++;
      }
      if (verdict.escalate) {
        await enqueue("onboarding.escalate", { orgId: org.id, caseId: c.id }, { orgId: org.id });
        escalated++;
      }
    } catch (err) {
      logger.warn({ err, caseId: c.id }, "onboarding reminder failed for case");
    }
  }

  // Expiry is opt-in and separate from reminders: a tenant that wants a hard cut-off gets
  // one, and the default leaves the form open so a late person can still finish it.
  if (settings.expireAfterDays > 0) {
    const cutoff = now.getTime() - settings.expireAfterDays * 86400000;
    for (const c of open) {
      if (new Date(c.dueAt).getTime() < cutoff) {
        await r.onboardingCases.update(c.id, { status: "EXPIRED", expiredAt: now.toISOString() });
        expired++;
      }
    }
  }

  return { skipped: null, queued, escalated, expired, candidates: open.length };
}

/**
 * Leader-elected sweep across every org. Safe to call on an interval from every replica:
 * only the lock holder does any work.
 */
export async function sweepAllOrgsIfLeader(now = new Date()) {
  try {
    // Taken and released on the SAME pinned connection: advisory locks are session-scoped,
    // so acquiring on one pooled connection and releasing on another leaks it forever.
    return await db.connection().execute(async (conn) => {
      const got = await conn
        .selectNoFrom((eb) => eb.fn<boolean>("pg_try_advisory_lock", [eb.lit(ONBOARDING_LOCK_KEY)]).as("locked"))
        .executeTakeFirst();
      if (!got || !(got as any).locked) {
        logger.debug("onboarding reminders: another replica holds the lock, skipping");
        return { leader: false, queued: 0 };
      }
      try {
        let queued = 0;
        let escalated = 0;
        let expired = 0;
        for (const org of await systemRepos().organizations.all()) {
          const out = await sweepOrg(org, { now });
          queued += out.queued;
          escalated += out.escalated;
          expired += out.expired;
        }
        if (queued || escalated || expired) {
          logger.info({ queued, escalated, expired }, "onboarding reminders swept");
        }
        return { leader: true, queued, escalated, expired };
      } finally {
        await conn.selectNoFrom((eb) => eb.fn("pg_advisory_unlock", [eb.lit(ONBOARDING_LOCK_KEY)]).as("u")).executeTakeFirst();
      }
    });
  } catch (err) {
    logger.error({ err }, "onboarding reminder leader-check failed");
    return { leader: false, queued: 0 };
  }
}
