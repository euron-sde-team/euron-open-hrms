/**
 * Web push (VAPID).
 *
 * Deliberately degrades instead of throwing. Two things are outside this codebase's
 * control and may legitimately be absent in a given environment:
 *
 *   1. the `web-push` package (a new dependency), and
 *   2. the `push_subscriptions` table (a schema change only the developer may apply).
 *
 * If either is missing, `pushAvailable()` reports false and sends become no-ops, so the
 * clock-in reminder still delivers over in-app and email rather than failing the job.
 * Nothing here is on a request's critical path.
 */
import { logger } from "../core/logger";

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:support@example.com";

let webpush: any = null;
let triedRequire = false;

function lib() {
  if (triedRequire) return webpush;
  triedRequire = true;
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    logger.debug("web push disabled: VAPID keys not configured");
    return null;
  }
  try {
    // Lazily required so a missing optional dependency cannot break boot.
     
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional dependency, loaded only when web push is configured
    webpush = require("web-push");
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  } catch {
    logger.debug("web push disabled: the 'web-push' package is not installed");
    webpush = null;
  }
  return webpush;
}

/** True when push can actually be sent (keys present AND package installed). */
export function pushAvailable(): boolean {
  return !!lib();
}

/** The key the browser needs to subscribe. Safe to expose; it is the public half. */
export function publicKey(): string {
  return PUBLIC_KEY;
}

/**
 * Deliver to every device an employee has registered.
 * Subscriptions the browser has expired (404/410) are pruned as we go, which is the
 * only way a push subscription store stays healthy over time.
 */
export async function sendPushToEmployee(
  repos: any,
  employeeId: string,
  payload: { title: string; body: string; url?: string }
): Promise<number> {
  const wp = lib();
  if (!wp || !repos.pushSubscriptions) return 0;

  let subs: any[] = [];
  try {
    subs = await repos.pushSubscriptions.find((s: any) => s.employeeId === employeeId);
  } catch {
    // Table not migrated yet.
    return 0;
  }

  let delivered = 0;
  for (const s of subs) {
    try {
      await wp.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      delivered++;
    } catch (err: any) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        await repos.pushSubscriptions.remove(s.id).catch(() => null);
      } else {
        logger.debug({ err, employeeId }, "push delivery failed");
      }
    }
  }
  return delivered;
}
