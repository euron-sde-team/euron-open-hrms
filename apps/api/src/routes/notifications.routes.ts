/** In-app notifications, per-user feed + unread badge. */
import express from "express";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/notification-feed.controller";

const router = express.Router();

/** GET /api/notifications?unread=1&limit=50, the caller's own notifications, newest first. */
router.get("/", wrap(ctrl.list));

/** GET /api/notifications/count, unread count for the nav badge (polled frequently). */
router.get("/count", wrap(ctrl.count));

/** POST /api/notifications/:id/read */
router.post("/:id/read", wrap(ctrl.markRead));

/** POST /api/notifications/read-all, mark all of the caller's notifications read. */
router.post("/read-all", wrap(ctrl.markAllRead));

export default router;
