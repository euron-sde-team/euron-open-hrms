/**
 * Onboarding campaigns: send one form to a slice of the roster, with a deadline.
 *
 * Launching is deliberately a two-step: /preview says exactly who would be included and who
 * would be skipped, and /launch is a separate call. Emailing several hundred people is not
 * something to discover you have done.
 *
 *   GET  /
 *   POST /preview                { audience, templateId? }
 *   GET  /reminder-settings
 *   PUT  /reminder-settings
 *   GET  /:id
 *   POST /                       { name, templateId, audience, dueAt, message? }
 *   PUT  /:id                    editable only while it is still a draft
 *   POST /:id/launch             queues the fan-out
 *   GET  /:id/cases              progress per person
 *   GET  /:id/cases.csv
 *   POST /:id/close              stop chasing; open cases stay open
 *   POST /:id/cancel             also cancels every case nobody has started
 *   POST /run-reminders          run the deadline sweep for this org now
 */
import express from "express";
import { wrap } from "../core/util";
import { requirePermission } from "../middleware/auth";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/onboarding-campaign.controller";

const router = express.Router();
const manage = requirePermission("onboarding.manage");

router.get("/", staffOnly, wrap(ctrl.list));
router.post("/preview", staffOnly, wrap(ctrl.preview));
// Declared before GET /:id so the path is not swallowed as a campaign id.
router.get("/reminder-settings", staffOnly, wrap(ctrl.getReminderSettings));
router.put("/reminder-settings", manage, wrap(ctrl.updateReminderSettings));
router.get("/:id", staffOnly, wrap(ctrl.get));
router.post("/", manage, wrap(ctrl.create));
router.put("/:id", manage, wrap(ctrl.update));
router.post("/:id/launch", manage, wrap(ctrl.launch));
router.get("/:id/cases", staffOnly, wrap(ctrl.cases));
router.get("/:id/cases.csv", staffOnly, wrap(ctrl.casesCsv));
router.post("/:id/close", manage, wrap(ctrl.close));
router.post("/:id/cancel", manage, wrap(ctrl.cancel));
router.post("/run-reminders", manage, wrap(ctrl.runReminders));

export default router;
