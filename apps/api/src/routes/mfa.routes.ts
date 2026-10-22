/** Two-factor auth (TOTP) management for the signed-in user. */
import express from "express";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/mfa.controller";

const router = express.Router();

/** GET /api/mfa/status */
router.get("/status", wrap(ctrl.status));

/** POST /api/mfa/enroll, generate a pending secret + otpauth URL + scannable QR. */
router.post("/enroll", wrap(ctrl.enroll));

/** POST /api/mfa/enroll/verify { code }, confirm a code, then enable 2FA. */
router.post("/enroll/verify", wrap(ctrl.verifyEnrollment));

/** POST /api/mfa/disable { password, code }, requires both to turn 2FA off. */
router.post("/disable", wrap(ctrl.disable));

export default router;
