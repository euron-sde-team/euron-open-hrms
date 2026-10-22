/**
 * Account-lifecycle tokens: email verification, password reset, user invites.
 *
 * Security model (OWASP Forgot-Password cheat sheet):
 *   - The raw token is a 256-bit CSPRNG value, sent only in the emailed link.
 *   - Only a SHA-256 HASH of it is stored, so a DB leak does not yield usable links.
 *   - Single-use (consumed on success) and time-boxed per type.
 */
import crypto from "crypto";
import { systemRepos, readRow, TABLES } from "../repositories/base.repository";
import { db } from "../db/kysely";

// Time-to-live per token type (ms). Reset is short; verify/invite are longer.
export const TTL = {
  EMAIL_VERIFY: 48 * 60 * 60 * 1000, // 48h
  PASSWORD_RESET: 45 * 60 * 1000, // 45 min
  USER_INVITE: 7 * 24 * 60 * 60 * 1000, // 7 days
};

const rawToken = () => crypto.randomBytes(32).toString("base64url");
export const hashToken = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

/** Create a token row (hash stored) and return the RAW token for the email link. */
export async function createToken({ type, orgId = null, userId = null, email = null, data = {} }: { type: string; orgId?: string | null; userId?: string | null; email?: string | null; data?: Record<string, any> }) {
  const raw = rawToken();
  const expiresAt = new Date(Date.now() + (TTL[type] || 60 * 60 * 1000));
  await systemRepos().authTokens.insert({
    type,
    tokenHash: hashToken(raw),
    orgId,
    userId,
    email: email ? String(email).toLowerCase() : null,
    expiresAt,
    usedAt: null,
    data,
  });
  return raw;
}

/**
 * Validate + consume a token of the given type. Returns the token row on success
 * (single-use: marks it used), or null for invalid / wrong-type / expired / used.
 *
 * Atomic: a SINGLE conditional UPDATE claims the row only while it is still
 * unused and unexpired, so two concurrent requests with the same valid token
 * cannot both succeed (the loser updates 0 rows). RETURNING gives us the row.
 */
export async function consumeToken(type, raw) {
  if (!raw) return null;
  const now = new Date();
  const row = await db
    .updateTable("auth_tokens")
    .set({ used_at: now })
    .where("token_hash", "=", hashToken(raw))
    .where("type", "=", type)
    .where("used_at", "is", null)
    .where("expires_at", ">", now)
    .returningAll()
    .executeTakeFirst();
  return row ? readRow(TABLES.authTokens, row) : null;
}

/** Invalidate all outstanding tokens of a type for a user (e.g. after a reset). */
export async function invalidateUserTokens(type, userId) {
  if (!userId) return;
  await db
    .updateTable("auth_tokens")
    .set({ used_at: new Date() })
    .where("type", "=", type)
    .where("user_id", "=", userId)
    .where("used_at", "is", null)
    .execute();
}
