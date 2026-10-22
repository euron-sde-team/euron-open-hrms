/**
 * HR onboarding invites: send a self-onboarding link to a candidate's personal email.
 *
 *   GET    /invites
 *   POST   /invites              one candidate, or { invites: [...] } for a batch
 *   PUT    /invites/:id          correct an invite that is not yet completed
 *   POST   /invites/:id/resend
 *   DELETE /invites/:id          also cancels the case the invite opened
 */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/onboarding-invite.controller";

// PORTAL_URL now lives in config.ts (a leaf module); re-exported here so the route files
// that already import it from this module keep working.

const router = express.Router();

router.get("/invites", staffOnly, wrap(ctrl.list));
router.post("/invites", staffOnly, wrap(ctrl.create));
router.put("/invites/:id", staffOnly, wrap(ctrl.update));
router.post("/invites/:id/resend", staffOnly, wrap(ctrl.resend));
router.delete("/invites/:id", staffOnly, wrap(ctrl.remove));

export default router;
