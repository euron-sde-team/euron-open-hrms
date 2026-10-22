/**
 * Employee separation / offboarding, type-aware flows.
 *
 *  Resignation (employee): PENDING_MANAGER -> PENDING_HR -> NOTICE_PERIOD ->
 *                          IN_CLEARANCE -> COMPLETED   (withdraw before accept)
 *  Termination/Retirement/End-of-contract (HR): NOTICE_PERIOD -> IN_CLEARANCE -> COMPLETED
 *  Absconding (HR): ABSCONDING (warning letters) -> ABSCONDED
 *
 * The rules live in services/separation.service.ts.
 */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/separation.controller";

const router = express.Router();

/** GET /api/separation, staff: all (?status=); employee: own. */
router.get("/", wrap(ctrl.list));
/** GET /api/separation/config, exit-interview questionnaire, selectable letters and the notice-period options (for the UI). */
router.get("/config", wrap(ctrl.config));
/** GET /api/separation/analytics, attrition analytics (staff). */
router.get("/analytics", staffOnly, wrap(ctrl.analytics));
/** POST /api/separation, HR initiates an INVOLUNTARY separation (termination/absconding/retirement/EOC). */
router.post("/", staffOnly, wrap(ctrl.initiate));
/** POST /api/separation/resign, employee submits a resignation. */
router.post("/resign", wrap(ctrl.resign));
/** POST /api/separation/:id/manager-approve, L1: reporting manager approves -> HR review. */
router.post("/:id/manager-approve", wrap(ctrl.managerApprove));
/** POST /api/separation/:id/manager-decline, manager declines (off-ramp). */
router.post("/:id/manager-decline", wrap(ctrl.managerDecline));
/** POST /api/separation/:id/accept, HR (L2) accepts a resignation; notice period begins. */
router.post("/:id/accept", staffOnly, wrap(ctrl.accept));
/** POST /api/separation/:id/decline, HR declines a pending resignation. */
router.post("/:id/decline", staffOnly, wrap(ctrl.decline));
/** POST /api/separation/:id/withdraw, employee withdraws before HR accepts. */
router.post("/:id/withdraw", wrap(ctrl.withdraw));
/** POST /api/separation/:id/absconding-letter, issue the next warning letter (staff). */
router.post("/:id/absconding-letter", staffOnly, wrap(ctrl.abscondingLetter));
/** POST /api/separation/:id/confirm-absconded, finalize an absconding case (staff). No relieving letter. */
router.post("/:id/confirm-absconded", staffOnly, wrap(ctrl.confirmAbsconded));
/** POST /api/separation/:id/exit-interview { responses }, employee (own) or staff submits. */
router.post("/:id/exit-interview", wrap(ctrl.exitInterview));
/** GET /api/separation/:id/settlement?recoveries=, light F&F estimate (staff). */
router.get("/:id/settlement", staffOnly, wrap(ctrl.settlement));
/** POST /api/separation/:id/settlement-statement { recoveries }, generate the F&F PDF (staff). */
router.post("/:id/settlement-statement", staffOnly, wrap(ctrl.settlementStatement));
/** PUT /api/separation/:id, update clearance / lastWorkingDay / status / handover (staff). */
router.put("/:id", staffOnly, wrap(ctrl.update));
/** POST /api/separation/:id/issue-letter { kind } (staff), issue one terminal letter without finalising the exit. */
router.post("/:id/issue-letter", staffOnly, wrap(ctrl.issueLetter));
/** POST /api/separation/:id/complete, finalize: issue type documents + mark EXITED (staff). */
router.post("/:id/complete", staffOnly, wrap(ctrl.complete));

export default router;
