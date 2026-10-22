/**
 * Sign-in, two-factor sign-in, sessions and password recovery.
 *
 * Most of this runs before anyone is authenticated, so those functions take plain inputs
 * and look the account up platform-wide (sign-in is by email with no workspace picker).
 * Once the account is known, its workspace is reached through `systemContext(orgId)`, the
 * same scoped repositories a request in that workspace would get.
 */
import { systemContext, type RequestContext } from "../core/context";
import { bad, unauth, forbidden } from "../core/util";
import {
  checkPassword, hashPassword, signToken, assertCanLogin, assertStrongPassword,
  signMfaChallenge, verifyMfaChallenge, signTrustToken, verifyTrustToken,
} from "../middleware/auth";
import * as totp from "../security/totp";
import { createToken, consumeToken, invalidateUserTokens } from "../security/tokens";
import { sendTenantMail } from "../integrations/mail/mailer";
import { resetEmail } from "../integrations/mail/templates";
import { publicUser } from "../domain/user-view";
import { systemRepos } from "../repositories/base.repository";
import { createRepositories } from "../repositories";

const nowIso = () => new Date().toISOString();
/** Platform-wide repositories: logins are looked up across every workspace. */
const platform = () => createRepositories(systemRepos());

const LOCKED = "Too many failed attempts. This account is temporarily locked; please try again later.";
const isLocked = (user) => !!(user.lockedUntil && new Date(user.lockedUntil) > new Date());

/**
 * First successful sign-in completes onboarding: an invited employee whose record
 * is still ONBOARDING flips to ACTIVE once they log in with their invite creds.
 * No-op for users without an employee record or already-active employees.
 */
async function completeOnboardingOnLogin(ctx: RequestContext, user) {
  if (!user.employeeId) return;
  try {
    const emp = await ctx.data.employees.byId(user.employeeId);
    if (emp && emp.status === "ONBOARDING") {
      await ctx.data.employees.update(emp.id, { status: "ACTIVE" });
      await ctx.data.auditLog.create({ action: "ONBOARDING_COMPLETE", employeeId: emp.id, userId: user.id, meta: { via: "first-login" } });
    }
  } catch (_e) { /* never block login on this */ }
}

const MAX_FAILED = 5, LOCK_MIN = 15;
async function recordFailedLogin(user) {
  const fails = (user.failedLogins || 0) + 1;
  const patch = fails >= MAX_FAILED
    ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MIN * 60000).toISOString() }
    : { failedLogins: fails };
  try { await systemContext(user.orgId).data.users.update(user.id, patch); } catch (_e) { /* never block login flow on this */ }
}

/**
 * The checks and bookkeeping shared by both sign-in steps once the credential is accepted:
 * the account and workspace must be allowed in, and a successful sign-in clears the
 * failed-attempt counter.
 */
async function admit(user) {
  const ctx = systemContext(user.orgId);
  const org = await ctx.data.organizations.byId(user.orgId);
  assertCanLogin(user, org); // blocks INVITED/DISABLED users and SUSPENDED/CANCELLED orgs
  if (user.failedLogins || user.lockedUntil) await ctx.data.users.update(user.id, { failedLogins: 0, lockedUntil: null });
  return { ctx, org };
}

/** Password sign-in. Returns a session, or an MFA challenge when two-factor is on. */
export async function login(input: { email?: unknown; password?: unknown; trustToken?: unknown }) {
  const email = String(input.email || "").toLowerCase().trim();
  const password = String(input.password || "");
  if (!email || !password) throw bad("Email and password are required");
  const user = await platform().users.findByEmail(email);
  // Per-account lockout after repeated failed attempts (complements the IP rate limiter).
  if (user && isLocked(user)) throw forbidden(LOCKED);
  if (!user || !checkPassword(password, user.passwordHash)) {
    if (user) await recordFailedLogin(user);
    throw unauth("Invalid email or password");
  }
  const { ctx, org } = await admit(user);
  // Two-factor: if enabled, password alone is not enough -- unless this device is
  // trusted (a valid 30-day trust token), in which case skip the code.
  if (user.mfaEnabled && !verifyTrustToken(input.trustToken, user)) {
    return { mfaRequired: true, mfaToken: signMfaChallenge(user) };
  }
  await completeOnboardingOnLogin(ctx, user);
  return { token: signToken(user), user: await publicUser(user, org, ctx.repos) };
}

/** Second sign-in step when 2FA is enabled. */
export async function loginWithMfa(input: { mfaToken?: unknown; code?: unknown; trustDevice?: unknown }) {
  const ch = verifyMfaChallenge(input.mfaToken);
  if (!ch) throw unauth("Two-factor session expired; please sign in again");
  const user = await platform().users.byId(ch.uid);
  if (!user || !user.mfaEnabled) throw unauth("Invalid session");
  // Per-account lockout also guards the 2FA step: a 6-digit code is otherwise
  // brute-forceable, and the IP limiter alone doesn't stop a distributed attack.
  if (isLocked(user)) throw forbidden(LOCKED);
  if (!totp.verify(user.mfaSecret, input.code)) {
    await recordFailedLogin(user);
    throw bad("Invalid authentication code");
  }
  const { ctx, org } = await admit(user);
  await completeOnboardingOnLogin(ctx, user);
  const out: any = { token: signToken(user), user: await publicUser(user, org, ctx.repos) };
  if (input.trustDevice) out.trustToken = signTrustToken(user); // remember this device 30 days
  return out;
}

/** The signed-in user's public view. */
export async function me(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const view = await publicUser(ctx.user, org, ctx.repos);
  return { user: view, impersonated: !!ctx.impersonatorId };
}

/** Mark the first-run product tour as seen for this user. */
export async function completeTour(ctx: RequestContext) {
  if (!ctx.user.tourSeenAt) await ctx.data.users.update(ctx.user.id, { tourSeenAt: nowIso() });
  return { ok: true };
}

/** A fresh token for the caller whose iat matches a just-written credentialsChangedAt. */
const tokenPinnedTo = (user, stamp: Date) => signToken(user, { iat: Math.ceil(stamp.getTime() / 1000) });

export async function changePassword(ctx: RequestContext, currentPassword: unknown, newPassword: unknown) {
  if (!checkPassword(String(currentPassword || ""), ctx.user.passwordHash))
    throw bad("Current password is incorrect");
  assertStrongPassword(newPassword);
  // Stamp credentialsChangedAt so every OTHER outstanding session is invalidated
  // (authRequired rejects tokens issued before this time). The caller keeps their
  // session via a fresh token whose iat is pinned to match the new stamp.
  const stamp = new Date();
  const updated = await ctx.data.users.update(ctx.user.id, { passwordHash: hashPassword(String(newPassword)), credentialsChangedAt: stamp.toISOString() });
  return { ok: true, token: tokenPinnedTo(updated || ctx.user, stamp) };
}

/**
 * Revoke every session for the caller (e.g. lost device). Bumps credentialsChangedAt so
 * all existing tokens (including this one) stop validating; the response returns a fresh
 * token to keep the current client signed in. No password needed, the caller already
 * holds a valid session.
 */
export async function logoutAll(ctx: RequestContext) {
  const stamp = new Date();
  const updated = await ctx.data.users.update(ctx.user.id, { credentialsChangedAt: stamp.toISOString() });
  return { ok: true, token: tokenPinnedTo(updated || ctx.user, stamp) };
}

/** Always returns the same generic response (no account enumeration). */
export async function forgotPassword(rawEmail: unknown) {
  const email = String(rawEmail || "").toLowerCase().trim();
  const user = email ? await platform().users.findByEmail(email) : null;
  if (user && user.status !== "DISABLED") {
    const token = await createToken({ type: "PASSWORD_RESET", orgId: user.orgId, userId: user.id, email });
    const org = await systemContext(user.orgId).data.organizations.byId(user.orgId);
    await sendTenantMail(org, resetEmail({ to: email, name: user.name, token }));
  }
  return { ok: true, message: "If an account exists for that email, a reset link has been sent." };
}

/**
 * Single-use token; stamps credentialsChangedAt to invalidate all old sessions.
 * Does not auto-login (OWASP).
 */
export async function resetPassword(input: { token?: unknown; password?: unknown }) {
  const password = String(input.password || "");
  assertStrongPassword(password);
  const tok = await consumeToken("PASSWORD_RESET", input.token);
  if (!tok) throw bad("This reset link is invalid or has expired.");
  const user = await platform().users.byId(tok.userId);
  if (!user) throw bad("Account not found.");
  await systemContext(user.orgId).data.users.update(user.id, {
    passwordHash: hashPassword(password),
    credentialsChangedAt: nowIso(),
  });
  await invalidateUserTokens("PASSWORD_RESET", user.id);
  return { ok: true, message: "Your password has been reset. Please sign in." };
}

/** A staff/manager invited by an admin sets their password and activates. */
export async function acceptInvite(input: { token?: unknown; name?: unknown; password?: unknown }) {
  const password = String(input.password || "");
  assertStrongPassword(password);
  const tok = await consumeToken("USER_INVITE", input.token);
  if (!tok) throw bad("This invitation is invalid or has expired.");
  const sys = platform();
  const user = await sys.users.byId(tok.userId);
  if (!user) throw bad("Invitation not found.");
  const ctx = systemContext(user.orgId);
  const patch: any = { passwordHash: hashPassword(password), status: "ACTIVE", emailVerifiedAt: nowIso(), credentialsChangedAt: nowIso() };
  if (input.name) patch.name = String(input.name).trim();
  await ctx.data.users.update(user.id, patch);
  const fresh = await sys.users.byId(user.id);
  const org = await ctx.data.organizations.byId(user.orgId);
  return { token: signToken(fresh), user: await publicUser(fresh, org, ctx.repos) };
}
