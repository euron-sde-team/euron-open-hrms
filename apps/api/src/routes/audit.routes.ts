/** Audit log viewer (staff), who did what, newest first. */
import express from "express";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/audit.controller";

const router = express.Router();

/** GET /api/audit/actions, distinct action types in this org (for the filter dropdown). */
router.get("/actions", wrap(ctrl.actions));

/**
 * GET /api/audit?page=&pageSize=&action=&q=, paginated org audit trail, newest
 * first, with actor names. Returns { items, total, page, pageSize, pages }.
 */
router.get("/", wrap(ctrl.list));

export default router;
