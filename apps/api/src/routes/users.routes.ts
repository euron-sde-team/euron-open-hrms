/**
 * Workspace user management: invite teammates, list users, resend invites,
 * enable/disable accounts, and assign roles (built-in or custom). Gated by the
 * `users.manage` permission. Distinct from employees: these are login accounts.
 */
import express from "express";
import { wrap } from "../core/util";
import { requirePermission } from "../middleware/auth";
import * as ctrl from "../controllers/user.controller";

const router = express.Router();
const usersGate = requirePermission("users.manage");

/** GET /api/users, workspace login accounts (excludes vendor logins), each with its linked employee. */
router.get("/", usersGate, wrap(ctrl.list));

/**
 * POST /api/users/:id/create-employee, give an existing login an employee record.
 * Idempotent: 201 when a record was created, 200 with the existing one otherwise.
 */
router.post("/:id/create-employee", usersGate, wrap(ctrl.createEmployee));

/**
 * POST /api/users/invite { email, name, role, sendInvite? }, add a teammate.
 * Both modes email the user; neither returns a password in the response.
 */
router.post("/invite", usersGate, wrap(ctrl.invite));

/** POST /api/users/:id/resend-invite, re-send an outstanding invite. */
router.post("/:id/resend-invite", usersGate, wrap(ctrl.resendInvite));

/** POST /api/users/:id/status { status: ACTIVE|DISABLED }. */
router.post("/:id/status", usersGate, wrap(ctrl.setStatus));

/** POST /api/users/:id/role { role }, assign a role (built-in or custom). */
router.post("/:id/role", usersGate, wrap(ctrl.setRole));

/**
 * PUT /api/users/:id/roles { roleKeys: string[] }, set ADDITIONAL roles beyond
 * the user's primary role. A user's permissions are the union of all their roles.
 */
router.put("/:id/roles", usersGate, wrap(ctrl.setRoles));

/**
 * PUT /api/users/:id/scope { scopeType: "ALL"|"DEPARTMENT"|"OFFICE", scopeIds: string[] }
 * Limit a user's admin powers to specific departments/offices. ALL = org-wide.
 */
router.put("/:id/scope", usersGate, wrap(ctrl.setScope));

export default router;
