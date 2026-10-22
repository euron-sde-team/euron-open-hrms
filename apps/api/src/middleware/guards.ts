/**
 * Route guards shared by every router. Fine-grained checks use `requirePermission`
 * (middleware/auth.ts); these name the common gates once.
 */
import { forbidden } from "../core/util";
import { isStaff, requirePermission } from "./auth";

/** Any staff role (ADMIN, HR, or a custom role holding staff.access). */
export const staffOnly = (req, _res, next) => (isStaff(req.user) ? next() : next(forbidden("Staff access required")));

/** Workspace settings: ADMIN, or a custom role holding settings.manage. */
export const settingsAdmin = requirePermission("settings.manage");
