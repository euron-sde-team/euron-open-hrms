/** /api/employees: the roster, hiring, bulk edit and import, portal access, and removal. */
import express from "express";
import multer from "multer";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/employee.controller";

const router = express.Router();

// Uploaded sheets are parsed in memory; nothing touches disk.
const uploadSheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** GET /api/employees, staff: all; employee: only self. Supports ?departmentId=&type=&q= */
router.get("/", wrap(ctrl.list));

/** GET /api/employees/my-team, direct reports of the logged-in employee (manager view). */
router.get("/my-team", wrap(ctrl.myTeam));

/* ══════════════════════════════════════════════════════════════════════════
   Bulk onboarding
   These must stay above `GET /:id`, or Express matches "import" as an :id.
   ══════════════════════════════════════════════════════════════════════════ */

/** GET /api/employees/employment-types, the catalogue, with statutory rules. */
router.get("/employment-types", wrap(ctrl.employmentTypes));

/**
 * GET /api/employees/import/template (staff), the .xlsx to fill in, pre-populated with
 * this org's real departments, offices and designations.
 */
router.get("/import/template", staffOnly, wrap(ctrl.importTemplate));

/**
 * POST /api/employees/import/preview (staff, multipart "file"), dry run. Nothing is
 * written and nothing is held server-side; the caller sends the raw rows back to commit.
 */
router.post("/import/preview", staffOnly, uploadSheet.single("file"), wrap(ctrl.importPreview));

/**
 * POST /api/employees/import/error-report (staff), .xlsx of just the failed
 * rows, with their problems spelled out, so HR can fix and re-upload those.
 */
router.post("/import/error-report", staffOnly, wrap(ctrl.importErrorReport));

/** GET /api/employees/:id */
router.get("/:id", wrap(ctrl.get));

/**
 * POST /api/employees  (staff), onboard a new employee (or reactivate an exited one).
 * Body: { firstName, lastName, email, phone, departmentId, employmentType,
 *         designation, joiningDate, managerId, salary{basic,hra,allowances,deductions},
 *         bank, sendInvite(bool) }
 */
router.post("/", staffOnly, wrap(ctrl.create));

/**
 * POST /api/employees/import (staff), commit a bulk onboarding.
 * Body: { rows: rawRows[], sendInvite?: boolean, skipInvalid?: boolean }
 * All-or-nothing by default (422 with the problems); skipInvalid imports the good rows.
 */
router.post("/import", staffOnly, wrap(ctrl.importCommit));

/** PUT /api/employees/:id (staff) */
router.put("/:id", staffOnly, wrap(ctrl.update));

/**
 * POST /api/employees/bulk-update (staff)
 * Body: { updates: [{ id, ...fields }] }. Per-row: reports which rows saved and which failed.
 */
router.post("/bulk-update", staffOnly, wrap(ctrl.bulkUpdate));

/**
 * POST /api/employees/:id/login-email  (staff)
 * Body: { email? }  omit to adopt the employee's official address.
 */
router.post("/:id/login-email", staffOnly, wrap(ctrl.loginEmail));

/**
 * POST /api/employees/:id/portal-access { role }  (staff)
 * Grant, change or withdraw (`role: "NONE"`) an employee's login.
 */
router.post("/:id/portal-access", staffOnly, wrap(ctrl.portalAccess));

/** POST /api/employees/:id/resend-invite (staff), (re)create login + email creds. */
router.post("/:id/resend-invite", staffOnly, wrap(ctrl.resendInvite));

/**
 * GET /api/employees/:id/delete-impact (staff)
 * What removing this person would actually cost, before choosing archive or purge.
 */
router.get("/:id/delete-impact", staffOnly, wrap(ctrl.deleteImpact));

/** DELETE /api/employees/:id (staff), archive by default; ?hard=1 to purge. */
router.delete("/:id", staffOnly, wrap(ctrl.remove));

export default router;
