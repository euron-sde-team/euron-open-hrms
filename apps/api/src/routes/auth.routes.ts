/** /api/auth: sign-in (with optional two-factor), sessions, and password recovery. */
import express from "express";
import { wrap } from "../core/util";
import { authRequired } from "../middleware/auth";
import * as ctrl from "../controllers/auth.controller";

const router = express.Router();

/** POST /api/auth/login  { email, password } */
router.post("/login", wrap(ctrl.login));

/** POST /api/auth/login/mfa { mfaToken, code }, second step when 2FA is enabled. */
router.post("/login/mfa", wrap(ctrl.loginMfa));

/** GET /api/auth/me */
router.get("/me", authRequired, wrap(ctrl.me));

/** POST /api/auth/tour-complete, mark the first-run product tour as seen for this user. */
router.post("/tour-complete", authRequired, wrap(ctrl.tourComplete));

/** POST /api/auth/change-password  { currentPassword, newPassword } */
router.post("/change-password", authRequired, wrap(ctrl.changePassword));

/**
 * POST /api/auth/logout-all, revoke every session for the caller (e.g. lost
 * device). The response carries a fresh token to keep the current client signed in.
 */
router.post("/logout-all", authRequired, wrap(ctrl.logoutAll));

/**
 * POST /api/auth/forgot-password { email }
 * Always returns the same generic response (no account enumeration).
 */
router.post("/forgot-password", wrap(ctrl.forgotPassword));

/**
 * POST /api/auth/reset-password { token, password }
 * Single-use token; stamps credentialsChangedAt to invalidate all old sessions.
 * Does not auto-login (OWASP).
 */
router.post("/reset-password", wrap(ctrl.resetPassword));

/**
 * POST /api/auth/accept-invite { token, name?, password }
 * A staff/manager invited by an admin sets their password and activates.
 */
router.post("/accept-invite", wrap(ctrl.acceptInvite));

export default router;
