/**
 * Bearer token persistence. localStorage, keyed per app, so the tenant app and
 * the operator console can be signed in side by side in one browser.
 *
 * Every accessor is SSR-safe: client components are also rendered on the
 * server, where there is no window.
 */
export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

export function createTokenStore(key: string): TokenStore {
  const storage = () => (typeof window === "undefined" ? null : window.localStorage);
  return {
    get: () => storage()?.getItem(key) ?? null,
    set: (token) => storage()?.setItem(key, token),
    clear: () => storage()?.removeItem(key),
  };
}
