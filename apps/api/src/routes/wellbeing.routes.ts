/** Employee health & mental well-being, pulse check-ins, aggregate, resources. */
import express from "express";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/wellbeing.controller";

const router = express.Router();

/** GET /api/wellbeing/resources, everyone (EAP number per-org). */
router.get("/resources", wrap(ctrl.resources));
/** PUT /api/wellbeing/support { eapPhone }, HR sets the EAP helpline number. */
router.put("/support", wrap(ctrl.setSupport));
/** GET /api/wellbeing/me, my recent check-ins + today's. */
router.get("/me", wrap(ctrl.me));
/** POST /api/wellbeing/checkin, { mood, stress, workload, note, anonymous } (1 to 5 scales). */
router.post("/checkin", wrap(ctrl.checkin));
/**
 * GET /api/wellbeing/pulse, anonymised org well-being pulse for HR (last 14 days):
 * average mood/stress/workload, participation, and any non-anonymous flags.
 */
router.get("/pulse", wrap(ctrl.pulse));

export default router;
