/**
 * PUBLIC company self-signup (no auth).
 * The person who signs up creates the workspace and becomes its first ADMIN
 * (Super-Admin model, as in Zoho People). The admin email must be verified
 * before they can sign in: org starts PENDING_VERIFICATION, user starts INVITED.
 */
import express from "express";
import { wrap } from "../core/util";
import * as ctrl from "../controllers/signup.controller";

const router = express.Router();

/** GET /api/signup/countries, PUBLIC country list for the signup form (no auth). */
router.get("/countries", wrap(ctrl.countries));

/** POST /api/signup { companyName, adminName, email, password, phone?, country? } */
router.post("/", wrap(ctrl.create));

/** POST /api/signup/verify { token }, activate the workspace + admin, return a JWT. */
router.post("/verify", wrap(ctrl.verify));

/** POST /api/signup/resend { email }, resend the verification email (non-enumerating). */
router.post("/resend", wrap(ctrl.resend));

export default router;
