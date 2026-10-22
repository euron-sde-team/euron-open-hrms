/** /api/leave: leave types, balances, requests and decisions, coverage and the company leave rules. */
import express from "express";
import { wrap } from "../core/util";
import { requirePermission } from "../middleware/auth";
import * as ctrl from "../controllers/leave.controller";

const router = express.Router();

/** GET /api/leave/types, each with whether the company's leave rules apply to it. */
router.get("/types", wrap(ctrl.listTypes));

// Leave types, leave rules and coverage are HR work: leave.manage (which HR has) or, for
// roles set up before it existed, settings.manage.
const leaveConfig = requirePermission("leave.manage", "settings.manage");

/** GET /api/leave/catalogue, the standard Indian leave set, for reference. */
router.get("/catalogue", wrap(ctrl.catalogue));
/** GET /api/leave/entitlements?employeeId=, what this person actually gets. */
router.get("/entitlements", wrap(ctrl.entitlements));
/** POST /api/leave/types/seed-standard (staff), add the standard Indian leave types this org is missing. */
router.post("/types/seed-standard", leaveConfig, wrap(ctrl.seedStandardTypes));
/** POST /api/leave/types (staff), add a leave type. */
router.post("/types", leaveConfig, wrap(ctrl.createType));
/** PUT /api/leave/types/:id (staff) */
router.put("/types/:id", leaveConfig, wrap(ctrl.updateType));
/** DELETE /api/leave/types/:id (staff), blocked if requests reference it. */
router.delete("/types/:id", leaveConfig, wrap(ctrl.removeType));

// ── Minimum-coverage leave guard (opt-in per tenant + per department) ────────

/** GET /api/leave/coverage, config: master switch + per-department policy (staff). */
router.get("/coverage", wrap(ctrl.coverage));
/** PUT /api/leave/coverage { enabled, departments:[{id,enabled,minPresent,mode}] } (settings.manage). */
router.put("/coverage", leaveConfig, wrap(ctrl.setCoverage));
/** GET /api/leave/coverage/check?from&to&employeeId?, preview the coverage impact of dates. */
router.get("/coverage/check", wrap(ctrl.checkCoverage));

// ── Company leave rules: monthly paid-leave limit, notice for long leave ─────

/** GET /api/leave/rules */
router.get("/rules", wrap(ctrl.rules));
/** PUT /api/leave/rules (settings.manage) { monthlyLimit?, advanceNotice?, workingDaysOnly? } */
router.put("/rules", leaveConfig, wrap(ctrl.setRules));
/** GET /api/leave/rules/check?leaveTypeId&from&to&employeeId?, how a request would fare before it is sent. */
router.get("/rules/check", wrap(ctrl.checkRules));
/** GET /api/leave/rules/allowance?employeeId=&month=YYYY-MM, how much of the monthly limit is taken. */
router.get("/rules/allowance", wrap(ctrl.allowance));

/** GET /api/leave/balance?employeeId= */
router.get("/balance", wrap(ctrl.balance));
/** GET /api/leave/requests, staff: all; manager(?scope=team): reports'; employee: own. */
router.get("/requests", wrap(ctrl.listRequests));
/** POST /api/leave/requests/bulk { ids, decision, note?, force? } */
router.post("/requests/bulk", wrap(ctrl.bulkDecide));
/** GET /api/leave/requests/export.csv?status= */
router.get("/requests/export.csv", wrap(ctrl.exportCsv));
/** POST /api/leave/requests { leaveTypeId, from, to, reason, employeeId?, force? } */
router.post("/requests", wrap(ctrl.apply));
/** POST /api/leave/requests/:id/decide { decision: APPROVED|REJECTED, note? } (staff or the employee's manager) */
router.post("/requests/:id/decide", wrap(ctrl.decide));
/** POST /api/leave/requests/:id/cancel, cancel an APPROVED leave and restore the balance. */
router.post("/requests/:id/cancel", wrap(ctrl.cancel));
/** DELETE /api/leave/requests/:id, applicant can cancel a pending request. */
router.delete("/requests/:id", wrap(ctrl.withdraw));

export default router;
