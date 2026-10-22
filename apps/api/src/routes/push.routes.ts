/**
 * Web push subscription management, plus the clock-in reminder settings.
 *
 * Every route here tolerates the `push_subscriptions` table not existing yet (the
 * migration is developer-run), so the app keeps working and simply reports push as
 * unavailable rather than 500-ing.
 */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/push-subscription.controller";

const router = express.Router();

/** GET /api/push/config, what the browser needs in order to subscribe. */
router.get("/config", wrap(ctrl.config));

/**
 * POST /api/push/subscribe
 * Body: the browser's PushSubscription JSON { endpoint, keys: { p256dh, auth } }.
 * Upserts on `endpoint` (see the service).
 */
router.post("/subscribe", wrap(ctrl.subscribe));

/** POST /api/push/unsubscribe  { endpoint } */
router.post("/unsubscribe", wrap(ctrl.unsubscribe));

/** GET /api/push/reminders, current clock-in reminder settings for the org. */
router.get("/reminders", staffOnly, wrap(ctrl.getReminders));

/** PUT /api/push/reminders, update them. Stored in organizations.data, no schema change. */
router.put("/reminders", staffOnly, wrap(ctrl.updateReminders));

/**
 * GET /api/push/reminders/preview, who would be reminded right now, without sending.
 * Makes the feature auditable before anyone switches it on.
 */
router.get("/reminders/preview", staffOnly, wrap(ctrl.previewReminders));

/** POST /api/push/reminders/send-now, fire the reminder immediately (staff-triggered). */
router.post("/reminders/send-now", staffOnly, wrap(ctrl.sendRemindersNow));

export default router;
