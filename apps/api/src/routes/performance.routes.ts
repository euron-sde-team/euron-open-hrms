/** Performance: PIP (improvement program) + appraisal cycles + appraisals. */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/performance.controller";

const router = express.Router();

// ── PIP ─────────────────────────────────────────────────────────────────────
router.get("/pips", wrap(ctrl.listPips));
router.post("/pips", staffOnly, wrap(ctrl.createPip));
router.post("/pips/:id/checkin", staffOnly, wrap(ctrl.pipCheckin));
router.put("/pips/:id", staffOnly, wrap(ctrl.updatePip));

// ── Appraisal cycles ────────────────────────────────────────────────────────
router.get("/cycles", wrap(ctrl.listCycles));
/** Open a cycle → auto-creates a PENDING_SELF appraisal for every active employee. */
router.post("/cycles", staffOnly, wrap(ctrl.openCycle));
router.post("/cycles/:id/close", staffOnly, wrap(ctrl.closeCycle));

// ── Appraisals ──────────────────────────────────────────────────────────────
router.get("/appraisals", wrap(ctrl.listAppraisals));
/** Employee submits self-review. */
router.post("/appraisals/:id/self", wrap(ctrl.selfReview));
/** Manager / HR review: rating + recommended hike. */
router.post("/appraisals/:id/review", wrap(ctrl.managerReview));

export default router;
