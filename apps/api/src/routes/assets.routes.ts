/** Asset provisioning & submission, laptops, devices, access cards, etc. */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/asset.controller";

const router = express.Router();

/** GET /api/assets, staff: all (?employeeId&caseId&status); employee: own. */
router.get("/", wrap(ctrl.list));
/** POST /api/assets (staff), provision an asset to an employee or an onboarding case. */
router.post("/", staffOnly, wrap(ctrl.provision));
/** POST /api/assets/:id/acknowledge, employee confirms receipt. */
router.post("/:id/acknowledge", wrap(ctrl.acknowledge));
/** POST /api/assets/:id/submit, employee submits/returns the asset. */
router.post("/:id/submit", wrap(ctrl.submit));
/** POST /api/assets/:id/return (staff), accept return / mark lost. */
router.post("/:id/return", staffOnly, wrap(ctrl.accept));
router.put("/:id", staffOnly, wrap(ctrl.update));

export default router;
