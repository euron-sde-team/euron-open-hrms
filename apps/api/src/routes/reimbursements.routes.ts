/** Reimbursement claims, submit (with receipt), approve / reject / mark paid. */
import express from "express";
import multer from "multer";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/reimbursement.controller";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/** GET /api/reimbursements, staff: all; manager(?scope=team): reports'; employee: own. */
router.get("/", wrap(ctrl.list));
/** POST /api/reimbursements (multipart, file=receipt) { category, amount, expenseDate, description, employeeId? } */
router.post("/", upload.single("receipt"), wrap(ctrl.submit));
/** POST /api/reimbursements/:id/decide  { decision: APPROVED|REJECTED|PAID } (staff or manager; PAID is staff-only) */
router.post("/:id/decide", wrap(ctrl.decide));
/** GET /api/reimbursements/:id/receipt */
router.get("/:id/receipt", wrap(ctrl.receipt));
/** DELETE /api/reimbursements/:id, applicant cancels a pending claim. */
router.delete("/:id", wrap(ctrl.cancel));

export default router;
