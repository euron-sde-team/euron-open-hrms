/**
 * Operator (platform) authentication, a SEPARATE identity plane from tenants.
 * Different secret and a fixed `aud: "platform"` claim, so a tenant JWT can never
 * satisfy platformAuthRequired (and vice-versa). Operator creds are the crown
 * jewels; keep this plane isolated and audited.
 */
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { systemRepos } from "../repositories/base.repository";
import { unauth, forbidden } from "../core/util";
import { DEV_DEFAULTS } from "../core/config";

const SECRET = process.env.PLATFORM_JWT_SECRET || DEV_DEFAULTS.PLATFORM_JWT_SECRET;

const hashPw = (plain) => bcrypt.hashSync(plain, 12); // cost 12: stronger against offline cracking
const checkPw = (plain, hash) => bcrypt.compareSync(plain, hash || "");
const signPlatformToken = (admin) =>
  jwt.sign({ pid: admin.id, role: (admin.role || "OPERATOR"), aud: "platform" }, SECRET, { expiresIn: "12h" });

/** Short-lived "password OK, awaiting 2FA" token for the operator MFA step. */
const signPlatformMfaChallenge = (admin) =>
  jwt.sign({ pid: admin.id, stage: "mfa", aud: "platform" }, SECRET, { expiresIn: "5m" });
function verifyPlatformMfaChallenge(token) {
  try { const p = jwt.verify(token, SECRET, { audience: "platform" }) as any; return p.stage === "mfa" ? p : null; } catch { return null; }
}

async function platformAuthImpl(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(unauth());
  let payload;
  try {
    payload = jwt.verify(token, SECRET, { audience: "platform" }) as any;
  } catch {
    return next(unauth("Operator session expired, please sign in again"));
  }
  // An MFA-challenge token proves the password only; it is never a full session.
  if (payload.stage === "mfa") return next(unauth("Two-factor verification required"));
  const admin = await systemRepos().platformAdmins.byId(payload.pid);
  if (!admin || admin.status === "DISABLED") return next(unauth());
  req.admin = admin;
  next();
}
const platformAuthRequired = (req, res, next) => platformAuthImpl(req, res, next).catch(next);

/**
 * Gate an operator route to a minimum role. OPERATOR is the full role; SUPPORT is
 * read-mostly and is blocked from destructive/sensitive actions (suspend, delete,
 * impersonate, admin-reset, operator management).
 */
function requireOperatorRole(...allowed: string[]) {
  return (req, _res, next) => {
    if (!req.admin) return next(unauth());
    const role = req.admin.role || "OPERATOR";
    if (allowed.includes(role)) return next();
    return next(forbidden("This action requires a full Operator role."));
  };
}

export {
  signPlatformToken, platformAuthRequired, hashPw, checkPw, SECRET,
  signPlatformMfaChallenge, verifyPlatformMfaChallenge, requireOperatorRole,
};
