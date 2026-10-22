/**
 * Web push client: service worker registration and subscribe / unsubscribe.
 *
 * Nothing here throws. Push is best-effort by design and every one of its
 * preconditions can legitimately be absent:
 *
 *   - the browser may not support service workers or the Push API (older
 *     Safari, iOS before 16.4, any page not on HTTPS or localhost),
 *   - the user may have blocked notifications, which only they can undo from
 *     browser settings, and
 *   - the server may report `available: false` until the developer installs
 *     `web-push`, sets the VAPID keys and runs the migration.
 *
 * Callers therefore get a result object with a machine-readable `reason`, and
 * the UI can say exactly which of those it is instead of "something broke".
 */

import { http } from "@/lib/api";

const SW_URL = "/sw.js";

export interface PushConfig {
  available: boolean;
  publicKey: string;
}

export interface PushStatus {
  /** Service workers + Push API + Notification are all present in this browser. */
  supported: boolean;
  /** The server can actually send (VAPID keys configured, `web-push` installed). */
  available: boolean;
  permission: NotificationPermission | "unsupported";
  /** This browser holds a live subscription. */
  subscribed: boolean;
  endpoint: string | null;
}

export type PushFailure =
  | "unsupported" // browser cannot do push at all
  | "unavailable" // server side is not configured yet
  | "denied" // user blocked notifications, app cannot undo it
  | "dismissed" // permission prompt closed without an answer
  | "error"; // anything else (network, SW registration)

export type PushResult =
  | { ok: true; status: PushStatus }
  | { ok: false; reason: PushFailure; message: string; status: PushStatus };

const UNSUPPORTED_STATUS: PushStatus = {
  supported: false,
  available: false,
  permission: "unsupported",
  subscribed: false,
  endpoint: null,
};

/** True when this browser, on this origin, can do web push at all. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Current notification permission, or "unsupported" outside a capable browser. */
export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported";
}

/**
 * VAPID keys travel as base64url. `atob` needs standard base64 with padding,
 * and PushManager wants the raw bytes.
 */
export function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  // Allocated over an explicit ArrayBuffer: a bare `new Uint8Array(n)` is typed
  // over ArrayBufferLike, which no longer satisfies BufferSource.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Register the worker (idempotent: the browser reuses an existing registration). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  } catch {
    return null;
  }
}

/** What the server says about push. Never throws: a failure reads as unavailable. */
export async function getPushConfig(): Promise<PushConfig> {
  try {
    const cfg = await http.get<PushConfig>("/push/config");
    return { available: !!cfg?.available, publicKey: cfg?.publicKey || "" };
  } catch {
    return { available: false, publicKey: "" };
  }
}

/**
 * Everything the UI needs to render an honest toggle.
 * Reads the existing subscription without prompting for permission.
 */
export async function readPushStatus(known?: PushConfig): Promise<PushStatus> {
  if (!pushSupported()) return UNSUPPORTED_STATUS;

  // `known` lets a caller that already fetched the config avoid a second call.
  const config = known ?? (await getPushConfig());
  let subscription: PushSubscription | null = null;
  try {
    // `getRegistration` rather than `register`: reading state must not install a
    // worker on a page the employee only visited.
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    subscription = reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    subscription = null;
  }

  return {
    supported: true,
    available: config.available,
    permission: Notification.permission,
    subscribed: !!subscription,
    endpoint: subscription?.endpoint ?? null,
  };
}

/**
 * Turn reminders on for THIS device: register the worker, ask for permission,
 * subscribe with the server's VAPID key and record the subscription.
 */
export async function enablePush(): Promise<PushResult> {
  if (!pushSupported()) {
    return {
      ok: false,
      reason: "unsupported",
      message: "This browser cannot show push notifications.",
      status: UNSUPPORTED_STATUS,
    };
  }

  const config = await getPushConfig();
  const status = await readPushStatus(config);

  if (!config.available || !config.publicKey) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Push notifications are not switched on for this workspace yet.",
      status: { ...status, available: false },
    };
  }

  if (Notification.permission === "denied") {
    return {
      ok: false,
      reason: "denied",
      message: "Notifications are blocked for this site in your browser settings.",
      status: { ...status, permission: "denied" },
    };
  }

  try {
    const permission =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        ok: false,
        reason: permission === "denied" ? "denied" : "dismissed",
        message:
          permission === "denied"
            ? "Notifications are blocked for this site in your browser settings."
            : "Notification permission was not granted.",
        status: { ...status, permission },
      };
    }

    const reg = await registerServiceWorker();
    if (!reg) {
      return {
        ok: false,
        reason: "error",
        message: "The notification service worker could not be registered.",
        status,
      };
    }
    // The worker must be active before subscribing, otherwise Safari rejects it.
    await navigator.serviceWorker.ready;

    // Re-subscribing with a different VAPID key throws, so drop a stale
    // subscription first (happens whenever the server's keys are rotated).
    const existing = await reg.pushManager.getSubscription();
    if (existing) await existing.unsubscribe().catch(() => null);

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    });

    await http.post("/push/subscribe", sub.toJSON());
    return {
      ok: true,
      status: {
        supported: true,
        available: true,
        permission: "granted",
        subscribed: true,
        endpoint: sub.endpoint,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Could not enable notifications.",
      status: await readPushStatus(),
    };
  }
}

/**
 * Turn reminders off for this device. The server row is removed first: if the
 * browser-side unsubscribe fails, the worst case is a dead subscription in the
 * browser, not a server that keeps pushing to a device the employee muted.
 */
export async function disablePush(): Promise<PushResult> {
  if (!pushSupported()) {
    return { ok: true, status: UNSUPPORTED_STATUS };
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await http.post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => null);
      await sub.unsubscribe().catch(() => null);
    }
    return { ok: true, status: await readPushStatus() };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Could not turn notifications off.",
      status: await readPushStatus(),
    };
  }
}
