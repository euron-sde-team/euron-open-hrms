/**
 * Letter template editing.
 *
 * Gated by settings.manage: letter copy is a legal artefact of the organisation, and an
 * appointment letter's terms are not something every HR user should be able to rewrite.
 *
 *   GET    /                 every kind with its current template
 *   GET    /tokens           the palette shown beside the editor
 *   GET    /:kind
 *   PUT    /:kind            save this organisation's wording
 *   DELETE /:kind            go back to the built-in wording
 *   POST   /:kind/preview    render the PDF (unsaved `template` and `employeeId` optional)
 */
import express from "express";
import { wrap } from "../core/util";
import { requirePermission } from "../middleware/auth";
import * as ctrl from "../controllers/letter-template.controller";

const router = express.Router();
// Letter templates are HR documents: documents.manage (which HR has) or settings.manage.
const manage = requirePermission("documents.manage", "settings.manage");

router.get("/", manage, wrap(ctrl.list));
router.get("/tokens", manage, wrap(ctrl.tokens));
router.get("/:kind", manage, wrap(ctrl.get));
router.put("/:kind", manage, wrap(ctrl.save));
router.delete("/:kind", manage, wrap(ctrl.reset));
router.post("/:kind/preview", manage, wrap(ctrl.preview));

export default router;
