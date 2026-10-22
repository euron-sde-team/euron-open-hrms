/**
 * Vendors / consultants / providers, onboarding + billing.
 * HR onboards a vendor (optionally creating a VENDOR login). The vendor signs in
 * and raises bills/invoices (with an invoice attachment); HR approves / rejects /
 * marks them paid as part of accounts-payable / payroll processing.
 */
import express from "express";
import multer from "multer";
import { wrap } from "../core/util";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/vendor.controller";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── HR: manage vendors ─────────────────────────────────────────────────────
router.get("/", staffOnly, wrap(ctrl.list));
router.post("/", staffOnly, wrap(ctrl.create));
router.put("/:id", staffOnly, wrap(ctrl.update));
router.post("/:id/invite", staffOnly, wrap(ctrl.invite));

// ── Bills ──────────────────────────────────────────────────────────────────
/** GET /api/vendors/bills, HR: all (filter ?status=&vendorId=). */
router.get("/bills", staffOnly, wrap(ctrl.listBills));
/** GET /api/vendors/my-bills, the signed-in vendor's bills. */
router.get("/my-bills", wrap(ctrl.myBills));
/** GET /api/vendors/me, vendor's own profile. */
router.get("/me", wrap(ctrl.me));
/** POST /api/vendors/bills (multipart invoice), vendor raises a bill (HR may pass vendorId). */
router.post("/bills", upload.single("invoice"), wrap(ctrl.raiseBill));
/** POST /api/vendors/bills/:id/decide  { decision: APPROVED|REJECTED|PAID, note } (HR). */
router.post("/bills/:id/decide", staffOnly, wrap(ctrl.decideBill));
/** GET /api/vendors/bills/:id/invoice, download invoice attachment. */
router.get("/bills/:id/invoice", wrap(ctrl.invoice));

export default router;
