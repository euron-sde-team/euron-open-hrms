/** AI token access, per-employee AI usage allowance (grant + request more). */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/ai-token.controller";

const router = express.Router();

/** GET /api/ai-tokens, staff: all employees' allowances; employee: own. */
router.get("/", wrap(ctrl.list));
/** POST /api/ai-tokens/grant (staff), set an employee's AI plan / daily limit. */
router.post("/grant", staffOnly, wrap(ctrl.grant));
/** POST /api/ai-tokens/request, employee requests more tokens. */
router.post("/request", wrap(ctrl.request));
/** POST /api/ai-tokens/:id/decide (staff), approve/reject a request. */
router.post("/:id/decide", staffOnly, wrap(ctrl.decide));

export default router;
