/**
 * Service worker.
 *
 * Push notifications only. There is deliberately NO fetch handler: caching a
 * logged-in HR app offline would serve one employee's stale pages to the next
 * person who signs in on the same device, and Next.js already fingerprints its
 * assets. The worker exists so the browser has somewhere to deliver a push.
 *
 * Payload contract (apps/api/src/push.ts, sendPushToEmployee):
 *   { "title": string, "body": string, "url"?: string, "tag"?: string }
 */

// Runtime config (the product name) comes from the same /env.js the pages
// load, so a white-labelled deployment needs no rebuild here either. Best
// effort: a failed import leaves the fallback below.
try {
  importScripts("/env.js");
} catch {
  /* offline or blocked: fall back to the default name */
}
const PRODUCT_NAME = (self.__HRMS_ENV && self.__HRMS_ENV.PRODUCT_NAME) || "Euron Open HRMS";

// Take over immediately, so a redeployed worker starts delivering without
// waiting for every tab to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A non-JSON push (test tools, other senders) still deserves to show something.
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || PRODUCT_NAME;
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Same tag for the same kind of reminder, so a retry replaces the previous
    // notification instead of stacking a second copy in the tray.
    tag: payload.tag || "open-hrms",
    renotify: false,
    data: { url: payload.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer a tab that is already on the target page, then any tab of this
      // app: reusing a signed-in tab avoids a cold reload and a second session.
      const exact = clients.find((c) => c.url === target.href);
      const anyTab = clients.find((c) => new URL(c.url).origin === target.origin);
      const existing = exact || anyTab;

      if (existing) {
        await existing.focus();
        if (!exact && "navigate" in existing) {
          await existing.navigate(target.href).catch(() => null);
        }
        return;
      }
      await self.clients.openWindow(target.href);
    })()
  );
});
