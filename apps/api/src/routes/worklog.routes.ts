/** Daily work / productivity log, onsite / offsite / client / remote work. */
import express from "express";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/worklog.controller";

const router = express.Router();

/** GET /api/worklogs, staff: all; manager(?scope=team): team; employee: own. ?from=&to= */
router.get("/", wrap(ctrl.list));
/** POST /api/worklogs, log a day's work. */
router.post("/", wrap(ctrl.create));
/** DELETE /api/worklogs/:id */
router.delete("/:id", wrap(ctrl.remove));
/** GET /api/worklogs/summary, per-employee productivity rollup over a date window (staff/manager). */
router.get("/summary", wrap(ctrl.summary));

export default router;
