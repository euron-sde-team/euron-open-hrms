/**
 * Onboarding cases: the employee's own form, and HR's review queue.
 *
 * Two audiences in one router, deliberately.
 *
 *   /me/*   the signed-in person filling their own form in. This is the entry point for the
 *           EXISTING roster: a campaign emails a deep link, they sign in normally, and 2FA,
 *           lockout and session rules all apply, which they would not if the link carried
 *           its own credential.
 *
 *   /*      HR reviewing what came back. Reads need staff access; approving needs
 *           onboarding.review, because approval is what writes a bank account and statutory
 *           identifiers onto the employee record.
 *
 * Nothing in the /me half can write to `employees`. It only ever stages onto the case.
 *
 *   GET    /me                                  the form I have been asked to complete
 *   PATCH  /me/sections/:key                    { values } | { rows }
 *   POST   /me/acknowledge                      { policyIds: [] }
 *   POST   /me/declare                          { fullName }
 *   GET    /me/assets                           what HR issued me
 *   POST   /me/assets/:assetId/acknowledge
 *   POST   /me/assets/declared                  something else I was given
 *   DELETE /me/assets/declared/:entryId
 *   POST   /me/documents                        multipart: file, sectionKey, category
 *   POST   /me/submit                           hand the form to HR
 *
 *   GET    /                                    ?status=&departmentId=&campaignId=&overdue=
 *   GET    /export.csv                          status and progress only, never answers
 *   GET    /:id                                 the case plus the diff to approve
 *   POST   /:id/sections/:key/review            { verdict, note? }
 *   POST   /:id/approve                         the commit
 *   POST   /:id/cancel                          { reason }
 *   POST   /                                    { employeeId, templateId?, dueAt? }
 */
import express from "express";
import multer from "multer";
import { wrap } from "../core/util";
import { requirePermission } from "../middleware/auth";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/onboarding-case.controller";

const router = express.Router();
const canReview = requirePermission("onboarding.review");

// Smaller than the 25MB the authenticated document library allows: these are photos of ID
// cards and scanned certificates, and a generous cap on a high-volume intake path is just
// storage cost nobody notices until the bill.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* ── Employee self-service ── */
router.get("/me", wrap(ctrl.getMine));
router.patch("/me/sections/:key", wrap(ctrl.saveMySection));
router.post("/me/acknowledge", wrap(ctrl.acknowledgeMine));
router.post("/me/declare", wrap(ctrl.declareMine));
router.get("/me/assets", wrap(ctrl.myAssets));
router.post("/me/assets/:assetId/acknowledge", wrap(ctrl.acknowledgeMyAsset));
router.post("/me/assets/declared", wrap(ctrl.declareMyAsset));
router.delete("/me/assets/declared/:entryId", wrap(ctrl.removeMyDeclaredAsset));
router.post("/me/documents", upload.single("file"), wrap(ctrl.attachMyDocument));
router.post("/me/submit", wrap(ctrl.submitMine));

/* ── HR review ── */
router.get("/", staffOnly, wrap(ctrl.list));
// Declared before GET /:id so "export.csv" is not swallowed as an id.
router.get("/export.csv", staffOnly, wrap(ctrl.exportCsv));
router.get("/:id", staffOnly, wrap(ctrl.get));
router.post("/:id/sections/:key/review", canReview, wrap(ctrl.reviewSection));
router.post("/:id/approve", canReview, wrap(ctrl.approve));
router.post("/:id/cancel", canReview, wrap(ctrl.cancel));
router.post("/", requirePermission("onboarding.manage"), wrap(ctrl.open));

export default router;
