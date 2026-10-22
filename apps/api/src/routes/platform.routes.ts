/**
 * Operator console API (SaaS vendor's internal plane). Manages customer
 * workspaces: list, suspend/reactivate, support-impersonate a tenant admin
 * (audited), and headline metrics. NOT org-scoped; takes orgId explicitly.
 */
import express from "express";
import { wrap } from "../core/util";
import { platformAuthRequired, requireOperatorRole } from "../middleware/platform-auth";
import * as ctrl from "../controllers/platform.controller";

const router = express.Router();
const operatorOnly = requireOperatorRole("OPERATOR");

/** POST /api/platform/auth/login { email, password }, step 1 (password). */
router.post("/auth/login", wrap(ctrl.login));
/** POST /api/platform/auth/login/mfa { mfaToken, code }, step 2 (TOTP). */
router.post("/auth/login/mfa", wrap(ctrl.loginMfa));

router.use(platformAuthRequired);

/** GET /api/platform/me */
router.get("/me", wrap(ctrl.me));

// ── Operator's own MFA (TOTP) ────────────────────────────────────────────────
/** POST /api/platform/mfa/enroll, returns a secret + otpauth URL + QR (not yet enabled). */
router.post("/mfa/enroll", wrap(ctrl.enrollMfa));
/** POST /api/platform/mfa/enroll/verify { code }, confirm + enable. */
router.post("/mfa/enroll/verify", wrap(ctrl.verifyMfaEnrollment));
/** POST /api/platform/mfa/disable { password, code }, turn off (needs both factors). */
router.post("/mfa/disable", wrap(ctrl.disableMfa));
/** GET /api/platform/mfa/status */
router.get("/mfa/status", wrap(ctrl.mfaStatus));

// ── Workspaces ───────────────────────────────────────────────────────────────
/** GET /api/platform/tenants, all customer workspaces with headline counts. */
router.get("/tenants", wrap(ctrl.listTenants));
/** GET /api/platform/tenants/:orgId, detail + metrics for one workspace. */
router.get("/tenants/:orgId", wrap(ctrl.getTenant));
/** POST /api/platform/tenants/:orgId/suspend (OPERATOR only) */
router.post("/tenants/:orgId/suspend", operatorOnly, wrap(ctrl.suspendTenant));
/** POST /api/platform/tenants/:orgId/reactivate (OPERATOR only) */
router.post("/tenants/:orgId/reactivate", operatorOnly, wrap(ctrl.reactivateTenant));
/** POST /api/platform/tenants/:orgId/impersonate, a tenant-admin token carrying the operator id (audited). */
router.post("/tenants/:orgId/impersonate", operatorOnly, wrap(ctrl.impersonate));
/** GET /api/platform/metrics, fleet headline numbers + health. */
router.get("/metrics", wrap(ctrl.metrics));
/** POST /api/platform/tenants, operator manually creates a workspace + first ADMIN. */
router.post("/tenants", operatorOnly, wrap(ctrl.createTenant));

// ── Starter content (operator-side backfill) ───────────────────────────────
/** GET /api/platform/tenants/:orgId/starter-content, dry run, writes nothing. */
router.get("/tenants/:orgId/starter-content", wrap(ctrl.planStarterContent));
/** POST /api/platform/tenants/:orgId/starter-content, apply packs to a tenant. */
router.post("/tenants/:orgId/starter-content", operatorOnly, wrap(ctrl.applyStarterContent));

/** GET /api/platform/tenants/:orgId/users, a tenant's login accounts. */
router.get("/tenants/:orgId/users", wrap(ctrl.listTenantUsers));
/** GET /api/platform/tenants/:orgId/activity, that tenant's recent audit trail. */
router.get("/tenants/:orgId/activity", wrap(ctrl.tenantActivity));
/** GET /api/platform/activity, fleet-wide recent operator actions across all tenants. */
router.get("/activity", wrap(ctrl.fleetActivity));
/** GET /api/platform/tenants/:orgId/export, download a full JSON snapshot of a tenant's data. */
router.get("/tenants/:orgId/export", wrap(ctrl.exportTenant));
/** POST /api/platform/tenants/:orgId/admin-reset, email a password-reset link to the tenant's admin. */
router.post("/tenants/:orgId/admin-reset", operatorOnly, wrap(ctrl.resetTenantAdmin));
/** DELETE /api/platform/tenants/:orgId, PERMANENTLY purge a workspace and ALL its data. Irreversible. */
router.delete("/tenants/:orgId", operatorOnly, wrap(ctrl.deleteTenant));

// ── Operator (platform admin) management ────────────────────────────────────
/** GET /api/platform/admins, list operator accounts. */
router.get("/admins", wrap(ctrl.listOperators));
/** POST /api/platform/admins { email, name, password, role? }, create an operator. */
router.post("/admins", operatorOnly, wrap(ctrl.createOperator));
/** POST /api/platform/admins/:id/status { status: ACTIVE|DISABLED } */
router.post("/admins/:id/status", operatorOnly, wrap(ctrl.setOperatorStatus));

export default router;
