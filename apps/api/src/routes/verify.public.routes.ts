/**
 * PUBLIC document verification. Mounted OUTSIDE authRequired on purpose, the
 * entire point is that a bank, landlord or next employer can check a document
 * without an account.
 *
 * Because it is public and unauthenticated, three things are deliberate:
 *   - Codes carry 60 bits of entropy, so the endpoint cannot be enumerated.
 *   - Only fields the issuer explicitly disclosed are returned.
 *   - It is rate limited, so it cannot be used as an oracle to grind codes.
 */
import express from "express";
import rateLimit from "express-rate-limit";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/verification.controller";

const router = express.Router();

// Generous for humans, useless for a grinder.
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Please wait a minute and try again." },
});

/**
 * GET /api/verify/:code[?digest=]
 *
 * Pass `digest` (printed on the document) to also prove the copy in hand
 * matches what was issued; without it we can only confirm the code is real.
 */
router.get("/:code", verifyLimiter, wrap(ctrl.verify));

/** GET /api/verify/:code/qr, the QR image, for re-rendering or sharing. */
router.get("/:code/qr", verifyLimiter, wrap(ctrl.qr));

export default router;
