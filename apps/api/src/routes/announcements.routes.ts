/** Company announcements / notice board, HR posts, everyone reads. */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/announcement.controller";

const router = express.Router();

/** GET /api/announcements, everyone in the org. Pinned first, then newest. */
router.get("/", wrap(ctrl.list));
router.post("/", staffOnly, wrap(ctrl.create));
router.put("/:id", staffOnly, wrap(ctrl.update));
router.delete("/:id", staffOnly, wrap(ctrl.remove));

export default router;
