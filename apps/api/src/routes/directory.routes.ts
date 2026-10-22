/** Company directory, org-chart and common org info, visible to everyone. */
import express from "express";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/directory.controller";

const router = express.Router();

/** GET /api/directory, everyone in the org with work contact details. */
router.get("/", wrap(ctrl.list));

/** GET /api/directory/org-chart, reporting hierarchy for everyone to see. */
router.get("/org-chart", wrap(ctrl.orgChart));

/** GET /api/directory/company, org details, HR contacts, offices, headcount, emergency contacts. */
router.get("/company", wrap(ctrl.company));

export default router;
