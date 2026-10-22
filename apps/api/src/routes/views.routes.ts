/** Saved Views, recallable filter presets, per user, per resource (Shopify-style). */
import express from "express";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/saved-view.controller";

const router = express.Router();

// GET /api/views?resource=leave, the caller's own saved views.
router.get("/", wrap(ctrl.list));

// POST /api/views { resource, name, filters }
router.post("/", wrap(ctrl.create));

// DELETE /api/views/:id, owner only.
router.delete("/:id", wrap(ctrl.remove));

export default router;
