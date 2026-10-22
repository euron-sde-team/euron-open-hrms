/**
 * TOTP (RFC 6238) for 2FA, implemented with Node crypto, no dependency.
 * Standard: SHA-1, 30s period, 6 digits. Compatible with Google Authenticator,
 * Authy, 1Password, etc. Secrets are base32 (RFC 4648).
 */
import crypto from "crypto";
import { PRODUCT_NAME } from "../core/product";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32encode(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function base32decode(s) {
  s = String(s).replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0; const out: number[] = [];
  for (const c of s) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
}

/** Generate a new base32 secret (160-bit). */
export const generateSecret = () => base32encode(crypto.randomBytes(20));

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuf).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

/** Verify a code against a secret, allowing +/- `window` 30s steps for clock skew.
 *  Default ±1 step (~90s), enough for normal clock skew while keeping the set of
 *  simultaneously-valid codes small (3 of 1e6) to limit brute-force surface. */
export function verify(secretBase32, token, window = 1) {
  const t = String(token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(t)) return false;
  const buf = base32decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) if (crypto.timingSafeEqual(Buffer.from(hotp(buf, counter + w)), Buffer.from(t))) return true;
  return false;
}

/** Current 6-digit code for a secret (used by tests; clients compute their own). */
export const generate = (secretBase32) => hotp(base32decode(secretBase32), Math.floor(Date.now() / 1000 / 30));

/** otpauth:// URL for QR codes / authenticator apps. */
export function otpauthURL(secret, label, issuer = PRODUCT_NAME) {
  const l = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${l}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
