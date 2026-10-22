/** Two-factor auth (TOTP) management for the signed-in user. */
import QRCode from "qrcode";
import type { RequestContext } from "../core/context";
import { bad } from "../core/util";
import { checkPassword } from "../middleware/auth";
import * as totp from "../security/totp";

export function mfaStatus(ctx: RequestContext) {
  return { enabled: !!ctx.user.mfaEnabled };
}

/** Generate a pending secret + otpauth URL + scannable QR. */
export async function startEnrollment(ctx: RequestContext) {
  if (ctx.user.mfaEnabled) throw bad("Two-factor is already enabled");
  const secret = totp.generateSecret();
  await ctx.data.users.update(ctx.user.id, { mfaPending: secret });
  const otpauth = totp.otpauthURL(secret, ctx.user.email);
  // QR is rendered here (not via a 3rd-party service) so the TOTP secret in the
  // otpauth URL never leaves our backend. Returned as a PNG data-URI for <img>.
  const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 200 });
  return { secret, otpauth, qr };
}

/** Confirm a code against the pending secret, then enable 2FA. */
export async function confirmEnrollment(ctx: RequestContext, code: unknown) {
  const pending = ctx.user.mfaPending;
  if (!pending) throw bad("Start enrollment first");
  if (!totp.verify(pending, code)) throw bad("Invalid code, please try again");
  await ctx.data.users.update(ctx.user.id, { mfaEnabled: true, mfaSecret: pending, mfaPending: null });
  await ctx.data.auditLog.create({ action: "MFA_ENABLE", userId: ctx.user.id, meta: {} });
  return { ok: true };
}

/** Turning 2FA off requires both the password and a current code. */
export async function disableMfa(ctx: RequestContext, input: { password?: unknown; code?: unknown }) {
  if (!ctx.user.mfaEnabled) throw bad("Two-factor is not enabled");
  if (!checkPassword(String(input.password || ""), ctx.user.passwordHash)) throw bad("Password is incorrect");
  if (!totp.verify(ctx.user.mfaSecret, input.code)) throw bad("Invalid authentication code");
  await ctx.data.users.update(ctx.user.id, { mfaEnabled: false, mfaSecret: null, mfaPending: null });
  await ctx.data.auditLog.create({ action: "MFA_DISABLE", userId: ctx.user.id, meta: {} });
  return { ok: true };
}
