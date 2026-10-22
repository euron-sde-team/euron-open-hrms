/** /api/org: the workspace profile, branding images, settings, offices and data export. */
import express from "express";
import multer from "multer";
import { wrap, bad } from "../core/util";
import { staffOnly, settingsAdmin } from "../middleware/guards";
import * as ctrl from "../controllers/organization.controller";

const router = express.Router();
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_LOGO_BYTES } });
const adminOnly = settingsAdmin;

/**
 * multer rejects oversized uploads with its own error class, which the global
 * handler would report as a 500. Turn it into a plain 400 instead.
 */
const uploadLogo = (req, res, next) =>
  upload.single("logo")(req, res, (err) => {
    if (err && err.code === "LIMIT_FILE_SIZE") return next(bad(`The logo must be smaller than ${MAX_LOGO_BYTES / (1024 * 1024)} MB`));
    if (err) return next(bad(err.message || "Upload failed"));
    next();
  });

/** Same limits as the logo, but multer matches on the field name, so it needs its own. */
const uploadSignature = (req, res, next) =>
  upload.single("signature")(req, res, (err) => {
    if (err && err.code === "LIMIT_FILE_SIZE") return next(bad(`The signature must be smaller than ${MAX_LOGO_BYTES / (1024 * 1024)} MB`));
    if (err) return next(bad(err.message || "Upload failed"));
    next();
  });

/** GET /api/org, current organization + its offices. */
router.get("/", wrap(ctrl.get));
/** POST /api/org/logo (multipart "logo", ADMIN), upload the workspace logo. */
router.post("/logo", adminOnly, uploadLogo, wrap(ctrl.uploadLogo));
/** POST /api/org/signature (multipart "signature", ADMIN), the authorised signatory's signature. */
router.post("/signature", adminOnly, uploadSignature, wrap(ctrl.uploadSignature));
/** GET /api/org/signature, stream the processed signature (any authed user). */
router.get("/signature", wrap(ctrl.getSignature));
/** DELETE /api/org/signature, clear it; letters fall back to the name over a rule. */
router.delete("/signature", adminOnly, wrap(ctrl.deleteSignature));
/** GET /api/org/logo, stream the current workspace logo image (any authed user). */
router.get("/logo", wrap(ctrl.getLogo));
/** DELETE /api/org/logo (ADMIN), remove the workspace logo. */
router.delete("/logo", adminOnly, wrap(ctrl.deleteLogo));
/** PUT /api/org (ADMIN), update org profile + branding + settings (stored in org.data). */
router.put("/", adminOnly, wrap(ctrl.update));
/** GET /api/org/export (ADMIN), download a full JSON snapshot of this org's data. */
router.get("/export", adminOnly, wrap(ctrl.exportData));
/** GET /api/org/offices */
router.get("/offices", wrap(ctrl.listOffices));
/** POST /api/org/offices  (staff), add a geo-fenced office. */
router.post("/offices", staffOnly, wrap(ctrl.createOffice));
/** PUT /api/org/offices/:id (staff) */
router.put("/offices/:id", staffOnly, wrap(ctrl.updateOffice));
/** DELETE /api/org/offices/:id (staff) */
router.delete("/offices/:id", staffOnly, wrap(ctrl.deleteOffice));

export default router;
