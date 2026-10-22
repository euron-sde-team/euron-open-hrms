/** /api/reports: dashboard numbers, reporting structure, weekly digest and CSV exports. */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/report.controller";

const router = express.Router();

/** GET /api/reports/dashboard, headline numbers for the current org. */
router.get("/dashboard", wrap(ctrl.dashboard));
/** GET /api/reports/reporting, reporting structure (manager -> direct reports). */
router.get("/reporting", wrap(ctrl.reporting));

// ── Weekly performance & productivity reporting ────────────────────────────
/** GET /api/reports/weekly, productivity digest for managers / HR / CXO (staff). */
router.get("/weekly", staffOnly, wrap(ctrl.weekly));
/**
 * POST /api/reports/weekly/send, generate the weekly digest and email it to the
 * workspace's admins and HR plus its configured report recipients
 * (Settings, Organization, `reportRecipients`). `extraRecipients` in the body adds
 * one-off addresses for this send.
 */
router.post("/weekly/send", staffOnly, wrap(ctrl.sendWeekly));

// ── Downloadable CSV reports (HR head) ─────────────────────────────────────
router.get("/export/employees.csv", staffOnly, wrap(ctrl.employeesCsv));
router.get("/export/payroll.csv", staffOnly, wrap(ctrl.payrollCsv));
router.get("/export/attendance.csv", staffOnly, wrap(ctrl.attendanceCsv));
router.get("/export/vendor-bills.csv", staffOnly, wrap(ctrl.vendorBillsCsv));
router.get("/export/reimbursements.csv", staffOnly, wrap(ctrl.reimbursementsCsv));

export default router;
