/**
 * /api/documents: the searchable document library, KYC status, uploads and verification.
 *
 *   GET    /meta                 categories, KYC set and visibility options for the UI
 *   GET    /                     the library (?q=&category=&departmentId=&employeeId=&tag=&visibility=&verified=)
 *   GET    /kyc-status           which required KYC documents are missing
 *   POST   /                     multipart upload: title, category, description, tags, employeeId?, visibility, departmentIds
 *   GET    /extraction/config    what AI reading is available
 *   PATCH  /:id                  staff: retitle, recategorise, re-scope, retag
 *   GET    /:id/download
 *   DELETE /:id                  staff, or owner of own upload
 *   POST   /:id/verify           staff: { verified, note }, mark a KYC/bank doc verified
 */
import express from "express";
import multer from "multer";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/document.controller";

const router = express.Router();
// Files are buffered in memory then handed to the storage layer (local disk or S3).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.get("/meta", wrap(ctrl.meta));
router.get("/", wrap(ctrl.list));
router.get("/kyc-status", wrap(ctrl.kycStatus));
router.post("/", upload.single("file"), wrap(ctrl.upload));
router.get("/extraction/config", wrap(ctrl.extractionConfig));
router.patch("/:id", wrap(ctrl.update));
router.get("/:id/download", wrap(ctrl.download));
router.delete("/:id", wrap(ctrl.remove));
router.post("/:id/verify", wrap(ctrl.verify));

export default router;
