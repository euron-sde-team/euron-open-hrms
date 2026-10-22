/**
 * Roles & permissions API. Built-in roles are read-only (defined in rbac.js);
 * custom roles are per-org and live in org.data.customRoles. Reading is open to
 * staff (for the user-role dropdown); mutations require the `roles.manage` permission.
 */
import express from "express";
import { wrap } from "../core/util";
import { requirePermission } from "../middleware/auth";
import { staffOnly } from "../middleware/guards";
import * as ctrl from "../controllers/role.controller";

const router = express.Router();
const rolesGate = requirePermission("roles.manage");

/** GET /api/roles/catalog, grouped permission catalog for the UI. */
router.get("/catalog", staffOnly, wrap(ctrl.catalog));

/** GET /api/roles, built-in + custom roles. */
router.get("/", staffOnly, wrap(ctrl.list));

/** POST /api/roles { name, permissions[] }, create a custom role. */
router.post("/", rolesGate, wrap(ctrl.create));

/** PUT /api/roles/:key, update a custom role. */
router.put("/:key", rolesGate, wrap(ctrl.update));

/** DELETE /api/roles/:key, delete a custom role (blocked if assigned). */
router.delete("/:key", rolesGate, wrap(ctrl.remove));

export default router;
