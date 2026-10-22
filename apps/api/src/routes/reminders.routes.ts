/** Reminders / "My Work", a personal to-do layer, per user, per organization. */
import express from "express";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/reminder.controller";

const router = express.Router();

// GET /api/reminders?status=OPEN|DONE
router.get("/", wrap(ctrl.list));
// GET /api/reminders/count, open + due-today counts, for the nav badge.
router.get("/count", wrap(ctrl.count));
// GET /api/reminders/today, open items due today or overdue.
router.get("/today", wrap(ctrl.today));
// POST /api/reminders { title, note?, dueDate?, priority?, link? }
router.post("/", wrap(ctrl.create));
// PUT /api/reminders/:id, edit fields.
router.put("/:id", wrap(ctrl.update));
// POST /api/reminders/:id/toggle, flip OPEN <-> DONE.
router.post("/:id/toggle", wrap(ctrl.toggle));
// DELETE /api/reminders/:id
router.delete("/:id", wrap(ctrl.remove));

export default router;
