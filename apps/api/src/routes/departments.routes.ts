/** /api/departments: list for everyone, changes for staff. */
import express from "express";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/department.controller";

const router = express.Router();

router.get("/", wrap(ctrl.list));
router.post("/", staffOnly, wrap(ctrl.create));
router.put("/:id", staffOnly, wrap(ctrl.update));
router.delete("/:id", staffOnly, wrap(ctrl.remove));

export default router;
