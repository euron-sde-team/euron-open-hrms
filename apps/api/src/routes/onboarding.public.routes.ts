/**
 * PUBLIC self-onboarding for a pre-hire candidate: no login, just the token in their link.
 *
 * The same case-backed flow the signed-in roster uses (see onboarding-portal.service.ts);
 * the employee record is created only when HR approves.
 *
 * Two things stay deliberately different because the caller is unauthenticated:
 *  - a dedicated rate limiter, since anyone on the internet holding a link can call this;
 *  - policies are served from here, because a candidate cannot reach /api/content/policies.
 *
 *   GET    /:token
 *   GET    /:token/policies
 *   PATCH  /:token/sections/:key                 { values } | { rows }
 *   POST   /:token/acknowledge                   { policyIds: [] }
 *   POST   /:token/declare                       { fullName }
 *   GET    /:token/assets
 *   POST   /:token/assets/:assetId/acknowledge
 *   POST   /:token/assets/declared
 *   DELETE /:token/assets/declared/:entryId
 *   POST   /:token/documents                     multipart: file, sectionKey, category
 *   POST   /:token/submit                        hands the form to HR
 */
import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/onboarding-portal.controller";

const router = express.Router();

// Unauthenticated and holding a credential: throttle per IP so a leaked or guessed link
// cannot be used to hammer uploads or enumerate tokens.
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.ONBOARDING_PUBLIC_RATE_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
});
router.use(publicLimiter);

// 10MB, half what the authenticated document library allows: these are photos of ID cards and
// scanned certificates, and a generous cap on an unauthenticated path is just storage cost.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get("/:token", wrap(ctrl.get));
router.get("/:token/policies", wrap(ctrl.policies));
router.patch("/:token/sections/:key", wrap(ctrl.saveSection));
router.post("/:token/acknowledge", wrap(ctrl.acknowledge));
router.post("/:token/declare", wrap(ctrl.declare));
router.get("/:token/assets", wrap(ctrl.assets));
router.post("/:token/assets/:assetId/acknowledge", wrap(ctrl.acknowledgeAsset));
router.post("/:token/assets/declared", wrap(ctrl.declareAsset));
router.delete("/:token/assets/declared/:entryId", wrap(ctrl.removeDeclaredAsset));
router.post("/:token/documents", upload.single("file"), wrap(ctrl.attachDocument));
router.post("/:token/submit", wrap(ctrl.submit));

export default router;
