/**
 * Operator impersonation hand-off, defined once for both sides.
 *
 * The console asks the API to mint a tenant token (audited server-side), then
 * opens `${TENANT_URL}/login#imp=<token>` in a new tab. The token travels in the
 * URL FRAGMENT on purpose: fragments are never sent to a server, so it does not
 * land in access logs, proxies or Referer headers. The tenant app reads it once,
 * stores it as its session and strips it from the address bar.
 */

export const IMPERSONATION_PARAM = "imp";

/** Console side: the URL that starts an impersonated tenant session. */
export function buildImpersonationUrl(tenantBaseUrl: string, token: string): string {
  const base = tenantBaseUrl.replace(/\/+$/, "");
  return `${base}/login#${IMPERSONATION_PARAM}=${encodeURIComponent(token)}`;
}

/** Tenant side: the token in a location hash, or null. Never throws. */
export function readImpersonationToken(hash: string): string | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of fragment.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq) !== IMPERSONATION_PARAM) continue;
    const value = part.slice(eq + 1);
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null; // malformed escape: ignore rather than store garbage as a token
    }
  }
  return null;
}

/**
 * Tenant side: consume the hand-off from the current location. Returns the
 * token and removes the fragment so it is not bookmarked, shared or left in
 * history. Returns null when there is nothing to consume.
 */
export function consumeImpersonationHash(win: Window = window): string | null {
  const token = readImpersonationToken(win.location.hash);
  if (!token) return null;
  win.history.replaceState(null, "", win.location.pathname + win.location.search);
  return token;
}
