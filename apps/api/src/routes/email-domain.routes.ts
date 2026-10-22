/**
 * /api/email-domain: the workspace's own sending domain (one per workspace). A tenant
 * brings their domain, publishes DNS, verifies via SES, and once VERIFIED its HRMS email
 * goes out from that brand domain. See services/sending-domain.service.ts.
 *
 * Gated by settings.manage.
 */
import express from "express";
import { wrap } from "../core/util";
import { requirePermission } from "../middleware/auth";
import * as ctrl from "../controllers/sending-domain.controller";

const router = express.Router();
const manage = requirePermission("settings.manage");

/** GET /api/email-domain, the org's sending domain (or null). */
router.get("/", manage, wrap(ctrl.get));
/** POST /api/email-domain { domain }, register + provision a sending domain. */
router.post("/", manage, wrap(ctrl.add));
/** POST /api/email-domain/reprovision, rebuild the identity + DNS records in the CURRENT region. */
router.post("/reprovision", manage, wrap(ctrl.reprovision));
/** POST /api/email-domain/check, re-read SES status and update verification state. */
router.post("/check", manage, wrap(ctrl.check));
/** PUT /api/email-domain/sender { fromAddress, fromName?, replyTo? }, set the From identity. */
router.put("/sender", manage, wrap(ctrl.setSender));
/** POST /api/email-domain/test, send a test email (always to the caller) through the tenant sender. */
router.post("/test", manage, wrap(ctrl.sendTest));
/** DELETE /api/email-domain, remove the sending domain (SES + org.data). Reverts to platform default. */
router.delete("/", manage, wrap(ctrl.remove));

export default router;
