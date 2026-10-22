/**
 * /api/letters (staff): issue letters as PDFs, filed as private documents and emailed.
 *
 *   POST /offer/bulk                         offer letters for many people
 *   GET  /issuable/:employeeId               what can be issued for this person
 *   POST /issue/:employeeId                  any on-demand letter { kind, ... }
 *   GET  /status                             which letters each person has on file
 *   POST /offer/:employeeId
 *   POST /confirmation/:employeeId
 *   POST /probation-extension/:employeeId
 *   GET  /probation-due                      whose probation ends soon (?withinDays=)
 *   POST /relieving/:employeeId
 *   POST /appraisal/:employeeId
 */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/letter.controller";

const router = express.Router();

router.post("/offer/bulk", staffOnly, wrap(ctrl.offerBulk));
router.get("/issuable/:employeeId", staffOnly, wrap(ctrl.issuable));
router.post("/issue/:employeeId", staffOnly, wrap(ctrl.issue));
router.get("/status", staffOnly, wrap(ctrl.status));
router.post("/offer/:employeeId", staffOnly, wrap(ctrl.offer));
router.post("/confirmation/:employeeId", staffOnly, wrap(ctrl.confirmation));
router.post("/probation-extension/:employeeId", staffOnly, wrap(ctrl.probationExtension));
router.get("/probation-due", staffOnly, wrap(ctrl.probationDue));
router.post("/relieving/:employeeId", staffOnly, wrap(ctrl.relieving));
router.post("/appraisal/:employeeId", staffOnly, wrap(ctrl.appraisal));

// NOTE: the former POST /api/letters/samples route was removed, it was a dev
// seed helper (server/samples.ts) that iterated EVERY organization and emailed
// other tenants' salary/offer/appraisal documents to a caller-supplied address
// (cross-tenant PII leak). Sample generation is now CLI-only: `node server/samples.js`.

export default router;
