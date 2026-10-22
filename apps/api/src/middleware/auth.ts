/** JWT auth + role-based middleware. */
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { repos, systemRepos } from "../repositories/base.repository";
import { unauth, forbidden, bad, HttpError } from "../core/util";
import { DEV_DEFAULTS } from "../core/config";
import { resolvePermissions, hasPerm, isStaffPerms, userNeedsOrg, resolveScope, employeeInScope } from "../security/rbac";

// ── Password policy ─────────────────────────────────────────────────────────
const COMMON_PASSWORDS = new Set(["password", "password1", "12345678", "123456789", "qwerty123", "admin123", "welcome123", "changeme123", "letmein123", "iloveyou1"]);
/** Enforce a minimum password strength; throws BadRequestError on weak input. */
function assertStrongPassword(pw) {
  const s = String(pw || "");
  if (s.length < 8) throw bad("Password must be at least 8 characters");
  if (s.length > 200) throw bad("Password is too long");
  if (COMMON_PASSWORDS.has(s.toLowerCase())) throw bad("That password is too common; please choose a stronger one");
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(s)).length;
  if (classes < 2) throw bad("Password must include at least two of: lowercase, uppercase, number, symbol");
}

const SECRET = process.env.JWT_SECRET || DEV_DEFAULTS.JWT_SECRET;
/** Audience claim on tenant sessions; the operator plane uses "platform" with its own secret. */
const TENANT_AUD = "tenant";
/**
 * Session lifetime. Revocation does not depend on expiry (credentialsChangedAt and the
 * per-request user and workspace status checks below revoke immediately), so this only
 * bounds how long a stolen token stays useful on an otherwise healthy account.
 */
const SESSION_TTL = process.env.SESSION_TTL || "7d";

// Cost 12 (vs the old 10), stronger against offline cracking of a leaked hash.
const BCRYPT_COST = 12;
const hashPassword = (plain) => bcrypt.hashSync(plain, BCRYPT_COST);
const checkPassword = (plain, hash) => bcrypt.compareSync(plain, hash || "");

function signToken(user, extra = {}) {
  return jwt.sign(
    { uid: user.id, orgId: user.orgId, role: user.role, employeeId: user.employeeId || null, ...extra },
    SECRET,
    { expiresIn: SESSION_TTL as any, audience: TENANT_AUD }
  );
}

/** Roles, highest first. HR ≈ admin for HR operations. */
const ROLES = ["ADMIN", "HR", "MANAGER", "EMPLOYEE", "VENDOR"];
const rank = (r) => ROLES.indexOf(r);

/** Short-lived "password OK, awaiting 2FA code" token (NOT a session token). */
const signMfaChallenge = (user) => jwt.sign({ uid: user.id, stage: "mfa" }, SECRET, { expiresIn: "5m" });
function verifyMfaChallenge(token) {
  try { const p = jwt.verify(token, SECRET) as any; return p.stage === "mfa" ? p : null; } catch { return null; }
}

// ── Trusted-device tokens (skip 2FA for 30 days on a device) ─────────────────
// Fingerprint of the current MFA secret: re-enrolling 2FA changes it, which
// invalidates every previously-trusted device.
const mfaFingerprint = (user) => crypto.createHash("sha256").update(String(user.mfaSecret || "")).digest("hex").slice(0, 12);
const signTrustToken = (user) => jwt.sign({ uid: user.id, kind: "trust", mfv: mfaFingerprint(user) }, SECRET, { expiresIn: "30d" });
/** True if `token` is a valid trust token for `user` (same MFA secret, not password-reset since). */
function verifyTrustToken(token, user) {
  if (!token) return false;
  try {
    const p = jwt.verify(token, SECRET) as any;
    if (p.kind !== "trust" || p.uid !== user.id) return false;
    if (p.mfv !== mfaFingerprint(user)) return false; // 2FA re-enrolled -> trust revoked
    if (user.credentialsChangedAt && p.iat && new Date(user.credentialsChangedAt).getTime() > (p.iat + 1) * 1000) return false; // password reset -> revoked
    return true;
  } catch { return false; }
}

/**
 * Decide whether a user may sign in, given their account status and org status.
 * Lenient by default (missing status = ACTIVE) so pre-SaaS accounts are grandfathered.
 */
function assertCanLogin(user, org) {
  if (user.status === "DISABLED") throw forbidden("This account has been disabled. Contact your administrator.");
  if (user.status === "INVITED") throw forbidden("Please verify your email / accept your invitation before signing in.");
  if (org && (org.status === "SUSPENDED" || org.status === "CANCELLED"))
    throw forbidden("This workspace is suspended. Contact support.");
}

/**
 * What a signed-in user of a suspended or cancelled workspace gets back.
 * Returns null when the workspace may be used.
 */
function workspaceBlock(org): HttpError | null {
  if (!org) return null;
  if (org.status === "SUSPENDED" || org.status === "CANCELLED") {
    return new HttpError(403, "This workspace is suspended. Contact your administrator.", "WORKSPACE_SUSPENDED");
  }
  return null;
}

/**
 * Require a valid token; attaches req.user (the full user row) and req.repos
 * (an org-scoped repository factory bound to that user). Async because it loads
 * the user from Postgres; wrapped so thrown errors reach the error middleware.
 */
async function authRequiredImpl(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(unauth());
  let payload: any;
  try {
    payload = jwt.verify(token, SECRET, { audience: TENANT_AUD });
  } catch {
    return next(unauth("Session expired, please sign in again"));
  }
  // An MFA-challenge token proves the password only; it is never a full session.
  if (payload.stage === "mfa") return next(unauth("Two-factor verification required"));
  const user = await systemRepos().users.byId(payload.uid);
  if (!user) return next(unauth());
  // Session invalidation: password change / reset / logout-all / disable stamp
  // credentialsChangedAt; tokens issued before it are rejected. JWT `iat` is whole-
  // second, so allow 1s of skew (a freshly issued token must never be treated as
  // stale, e.g. login when credentialsChangedAt ≈ now). The re-issuing flows
  // (change-password, logout-all) pin the new token's iat to the stamp so the
  // actor stays signed in while every other token ≥1s older is revoked.
  if (user.credentialsChangedAt && payload.iat && new Date(user.credentialsChangedAt).getTime() > (payload.iat + 1) * 1000)
    return next(unauth("Session expired, please sign in again"));
  if (user.status === "DISABLED") return next(unauth("This account has been disabled."));
  // The workspace is checked on EVERY request, not only at login. Before, a suspended
  // workspace kept working until its users' tokens expired. One primary-key lookup.
  const org = user.orgId ? await systemRepos().organizations.byId(user.orgId) : null;
  if (user.orgId && !org) return next(unauth());
  const blocked = workspaceBlock(org);
  if (blocked) return next(blocked);
  // Resolve RBAC permissions (union of all the user's roles). Built-in roles
  // resolve from code; custom roles come from the org's customRoles (org.data).
  // Resolved per request so role/permission edits take effect immediately.
  const perms = resolvePermissions(user, userNeedsOrg(user) ? org || {} : null);
  user.perms = perms;
  req.user = user;
  req.can = (code) => hasPerm(perms, code);
  // Scoped access: limit admin powers to certain departments/offices (or ALL).
  // `req.inScope(employee)` is the per-record gate; routes call it after lookup.
  const scope = resolveScope(user, perms);
  req.scope = scope;
  req.inScope = (employee) => employeeInScope(scope, employee);
  req.impersonatorId = payload.imp || null; // set when an operator is impersonating
  req.repos = repos({ orgId: user.orgId, userId: user.id });
  next();
}

const authRequired = (req, res, next) => authRequiredImpl(req, res, next).catch(next);

/** Require the user's role to be at least `minRole`. */
function requireRole(minRole) {
  return (req, _res, next) => {
    if (!req.user) return next(unauth());
    if (rank(req.user.role) <= rank(minRole)) return next();
    return next(forbidden(`Requires ${minRole} access`));
  };
}

/** Permission gate middleware: requires the caller to hold `code` (or be superuser). */
/** Route guard: the user needs at least one of the given permissions. */
function requirePermission(...codes) {
  return (req, _res, next) => {
    if (!req.user) return next(unauth());
    if (codes.some((code) => hasPerm(req.user.perms, code))) return next();
    return next(forbidden(codes.length === 1
      ? `Requires the "${codes[0]}" permission`
      : `Requires one of these permissions: ${codes.map((c) => `"${c}"`).join(", ")}`));
  };
}

/** A user is "staff" if their role holds staff.access (or is superuser). */
const isStaff = (user) => !!(user && isStaffPerms(user.perms));

export {
  hashPassword, checkPassword, signToken, authRequired, requireRole, requirePermission, isStaff, assertCanLogin, assertStrongPassword,
  signMfaChallenge, verifyMfaChallenge, signTrustToken, verifyTrustToken, ROLES, rank, workspaceBlock, TENANT_AUD,
};
