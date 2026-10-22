/** /api/salary: salary structures, payslips, pay runs and the org's payroll rules. */
import express from "express";
import multer from "multer";
import { wrap } from "../core/util";
import { requirePermission } from "../middleware/auth";
import * as ctrl from "../controllers/salary.controller";

// employees.routes.ts still imports these from here; they live in the service now.

const router = express.Router();
const staffOnly = requirePermission("payroll.manage");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* ── Salary structures (CTC → monthly breakup) ─────────────────────────────── */

/**
 * GET /api/salary/structures
 * The org's templates, seeded with the India default on first use.
 * Readable by any staff member: the compensation editor needs it to render.
 */
router.get("/structures", wrap(ctrl.listStructures));
/** PUT /api/salary/structures  { structures: [...] } */
router.put("/structures", staffOnly, wrap(ctrl.saveStructures));
/** POST /api/salary/structures/preview  { annualCtc, structureId?, employmentType? } */
router.post("/structures/preview", wrap(ctrl.previewStructure));
/** GET /api/salary/structure/:employeeId */
router.get("/structure/:employeeId", wrap(ctrl.employeeSalary));
/** PUT /api/salary/structure/:employeeId (staff) */
router.put("/structure/:employeeId", staffOnly, wrap(ctrl.updateEmployeeSalary));

/* ── Payslips and pay runs ─────────────────────────────────────────────────── */

/** POST /api/salary/payslip (staff), generate one payslip. */
router.post("/payslip", staffOnly, wrap(ctrl.generatePayslip));
/** GET /api/salary/payslip-context?employeeId=&month=&year=  (staff) */
router.get("/payslip-context", staffOnly, wrap(ctrl.payslipContext));
/** POST /api/salary/payslip/preview (staff), compute a payslip WITHOUT writing one. */
router.post("/payslip/preview", staffOnly, wrap(ctrl.previewPayslip));
/** POST /api/salary/payslips/bulk (staff, multipart "file"), bulk payslips from a spreadsheet. */
router.post("/payslips/bulk", staffOnly, upload.single("file"), wrap(ctrl.bulkPayslips));
/**
 * POST /api/salary/payslips/commit (staff, multipart "file"): generate the
 * payslips that POST /payslips/preview just reported on.
 * Body/query: sheet?, month?, year?, email?, skipInvalid?
 */
router.post("/payslips/commit", staffOnly, upload.single("file"), wrap(ctrl.commitSheet));
/** GET /api/salary/payruns, history of payroll runs (staff). */
router.get("/payruns", staffOnly, wrap(ctrl.payRuns));
/** GET /api/salary/payslips?employeeId=&month=&year= */
router.get("/payslips", wrap(ctrl.listPayslips));

/* ── Payroll rules ─────────────────────────────────────────────────────────── */

/** GET /api/salary/countries, country packs available for the settings UI. */
router.get("/countries", staffOnly, wrap(ctrl.countries));
/** GET /api/salary/ruleset/:country, PREVIEW a country's statutory ruleset without saving it. */
router.get("/ruleset/:country", staffOnly, wrap(ctrl.ruleset));
/** GET /api/salary/profile, the org's effective statutory ruleset (seed-on-read). */
router.get("/profile", staffOnly, wrap(ctrl.profile));
/** PUT /api/salary/profile (staff), save the org's payroll rules in ONE call. */
router.put("/profile", staffOnly, wrap(ctrl.updateProfile));

/** POST /api/salary/payslips/preview (staff, multipart "file"), dry run over a salary-master workbook. */
router.post("/payslips/preview", staffOnly, upload.single("file"), wrap(ctrl.previewSheet));

/** GET /api/salary/professional-tax/states, the PT schedule catalogue. */
router.get("/professional-tax/states", staffOnly, wrap(ctrl.ptStates));
/** PUT /api/salary/professional-tax { state } (staff), set the org's PT state. */
router.put("/professional-tax", staffOnly, wrap(ctrl.setPtState));
/** GET /api/salary/gratuity/:employeeId?lastWorkingDay=, statutory gratuity. */
router.get("/gratuity/:employeeId", staffOnly, wrap(ctrl.gratuity));

/** POST /api/salary/payslips/:id/email  (staff)   { to?: string }, send or re-send a stored payslip. */
router.post("/payslips/:id/email", staffOnly, wrap(ctrl.emailPayslip));
/** DELETE /api/salary/payslips/:id (staff), withdraw a faulty payslip. */
router.delete("/payslips/:id", staffOnly, wrap(ctrl.deletePayslip));
/** GET /api/salary/payslips/:id/download */
router.get("/payslips/:id/download", wrap(ctrl.downloadPayslip));
/**
 * GET /api/salary/template, download the bulk-payslip Excel template.
 *
 * staffOnly is NOT optional here: the sample rows are seeded from real employees,
 * so without it any authenticated employee could read colleagues' compensation.
 */
router.get("/template", staffOnly, wrap(ctrl.template));

export default router;
