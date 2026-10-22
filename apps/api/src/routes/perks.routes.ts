/** Perks, goodies & coupon distribution + family-benefit enrolment. */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/perk.controller";

const router = express.Router();

// ── Goodies & coupons ───────────────────────────────────────────────────────
/** GET /api/perks, staff: all (?type&employeeId); employee: own. */
router.get("/", wrap(ctrl.list));
/** POST /api/perks (staff), distribute a goodie or coupon. */
router.post("/", staffOnly, wrap(ctrl.distribute));
/** POST /api/perks/:id/claim, employee claims a perk. */
router.post("/:id/claim", wrap(ctrl.claim));

// ── Family benefits ─────────────────────────────────────────────────────────
/** GET /api/perks/family, staff: all; employee: own enrolment. */
router.get("/family", wrap(ctrl.listFamily));
/** POST /api/perks/family, employee enrols / updates dependents. */
router.post("/family", wrap(ctrl.enrolFamily));

export default router;
