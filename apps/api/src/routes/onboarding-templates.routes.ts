/**
 * Onboarding form templates: the builder's API.
 *
 * Gated by settings.manage rather than onboarding.manage, matching letter-templates.routes.ts
 * and for the same reason. A template decides which statutory identifiers are collected and
 * which of them are mandatory before somebody can be paid; that is an organisation-level
 * decision, not something every HR user should be able to rewrite between sends.
 *
 *   GET    /meta                 the builder's palette
 *   GET    /                     newest first (?status=)
 *   GET    /resolve              which template a person would get (?employmentType=&departmentId=)
 *   GET    /:id
 *   POST   /                     a template, or { presetKey }; created DRAFT
 *   PUT    /:id                  merged over the stored template; bumps `version`
 *   POST   /:id/status           { status }
 *   POST   /:id/default          make this the fallback form
 *   POST   /:id/duplicate
 *   DELETE /:id                  refused once the form has been sent
 */
import express from "express";
import { wrap } from "../core/util";
import { requirePermission } from "../middleware/auth";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/onboarding-template.controller";

const router = express.Router();
// Onboarding forms are part of running onboarding: onboarding.manage (which HR has) or settings.manage.
const manage = requirePermission("onboarding.manage", "settings.manage");

router.get("/meta", staffOnly, wrap(ctrl.meta));
router.get("/", staffOnly, wrap(ctrl.list));
router.get("/resolve", staffOnly, wrap(ctrl.resolve));
router.get("/:id", staffOnly, wrap(ctrl.get));
router.post("/", manage, wrap(ctrl.create));
router.put("/:id", manage, wrap(ctrl.update));
router.post("/:id/status", manage, wrap(ctrl.setStatus));
router.post("/:id/default", manage, wrap(ctrl.makeDefault));
router.post("/:id/duplicate", manage, wrap(ctrl.duplicate));
router.delete("/:id", manage, wrap(ctrl.remove));

export default router;
