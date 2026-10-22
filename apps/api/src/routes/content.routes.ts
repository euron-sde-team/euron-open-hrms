/** Leave calendar (holidays), company policies, and company benefits. */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/content.controller";

const router = express.Router();

// ── Holidays (leave calendar) ──────────────────────────────────────────────
router.get("/holidays", wrap(ctrl.listHolidays));
/** GET /api/content/holidays/states, the state list for the calendar picker. */
router.get("/holidays/states", wrap(ctrl.holidayStates));
/** GET /api/content/holidays/preview?year=&state=&includeRestricted=, the calendar without saving it. */
router.get("/holidays/preview", staffOnly, wrap(ctrl.previewHolidays));
/**
 * POST /api/content/holidays/import (staff)
 * Body: { year, state, includeRestricted?, replaceYear? }
 */
router.post("/holidays/import", staffOnly, wrap(ctrl.importHolidays));
router.post("/holidays", staffOnly, wrap(ctrl.createHoliday));
router.put("/holidays/:id", staffOnly, wrap(ctrl.updateHoliday));
router.delete("/holidays/:id", staffOnly, wrap(ctrl.deleteHoliday));

// ── Policies ───────────────────────────────────────────────────────────────
router.get("/policies", wrap(ctrl.listPolicies));
router.get("/policies/:id", wrap(ctrl.getPolicy));
router.post("/policies", staffOnly, wrap(ctrl.createPolicy));
router.put("/policies/:id", staffOnly, wrap(ctrl.updatePolicy));
router.delete("/policies/:id", staffOnly, wrap(ctrl.deletePolicy));

// ── Benefits ───────────────────────────────────────────────────────────────
router.get("/benefits", wrap(ctrl.listBenefits));
router.post("/benefits", staffOnly, wrap(ctrl.createBenefit));
router.put("/benefits/:id", staffOnly, wrap(ctrl.updateBenefit));
router.delete("/benefits/:id", staffOnly, wrap(ctrl.deleteBenefit));

// ── Starter content ────────────────────────────────────────────────────────
/** GET /api/content/starter?year=&state=&includeRestricted=, the pack catalogue plus a dry run. */
router.get("/starter", staffOnly, wrap(ctrl.starterCatalogue));
/** POST /api/content/starter/apply (staff) Body: { packs?: PackId[], year?, state?, includeRestricted? } */
router.post("/starter/apply", staffOnly, wrap(ctrl.applyStarter));

export default router;
