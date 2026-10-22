/**
 * Runtime configuration.
 *
 * Next inlines NEXT_PUBLIC_* at BUILD time, but one Docker image is shipped
 * for every environment. So the server renders `/env.js` from its own env at
 * request time (see app/env.js/route.ts), the root layout loads it before any
 * client code runs, and everything reads configuration through this getter.
 *
 * Precedence: window.__HRMS_ENV (runtime) > NEXT_PUBLIC_* (build time, handy
 * for `next dev`) > the defaults below.
 */

import { nonEmpty } from "@open-hrms/api-client";

export interface RuntimeEnv {
  /** Public API base, including the /api prefix. */
  API_URL: string;
  /** Product name shown in titles, the shells, the tour and notifications. */
  PRODUCT_NAME: string;
}

export const DEFAULT_ENV: RuntimeEnv = {
  API_URL: "http://localhost:5005/api",
  PRODUCT_NAME: "Euron Open HRMS",
};

declare global {
  // Set by /env.js. Declared on globalThis so the service worker can read it too.
  var __HRMS_ENV: Partial<RuntimeEnv> | undefined;
}


/** Server-side resolution, used by the env.js route and by server components. */
export function serverEnv(env: Record<string, string | undefined> = process.env): RuntimeEnv {
  return {
    API_URL: nonEmpty(env.API_URL) ?? nonEmpty(env.NEXT_PUBLIC_API_URL) ?? DEFAULT_ENV.API_URL,
    PRODUCT_NAME: nonEmpty(env.PRODUCT_NAME) ?? nonEmpty(env.NEXT_PUBLIC_PRODUCT_NAME) ?? DEFAULT_ENV.PRODUCT_NAME,
  };
}

export function runtimeEnv(): RuntimeEnv {
  // On the server (SSR of a client component) read the process env directly:
  // pages render per request, so this is the same value /env.js serves, and
  // the server and client renders agree (no hydration mismatch on the name).
  if (typeof window === "undefined") return serverEnv();
  const injected = window.__HRMS_ENV;
  return {
    API_URL:
      nonEmpty(injected?.API_URL) ??
      nonEmpty(process.env.NEXT_PUBLIC_API_URL) ??
      DEFAULT_ENV.API_URL,
    PRODUCT_NAME:
      nonEmpty(injected?.PRODUCT_NAME) ??
      nonEmpty(process.env.NEXT_PUBLIC_PRODUCT_NAME) ??
      DEFAULT_ENV.PRODUCT_NAME,
  };
}

/** API base without a trailing slash. */
export const apiBase = () => runtimeEnv().API_URL.replace(/\/+$/, "");

export const productName = () => runtimeEnv().PRODUCT_NAME;

/**
 * Split a product name for the two-tone wordmark: everything but the last word
 * in full weight, the last word muted ("Acme People" + "HRMS"). A one-word name
 * has no tail.
 */
export function splitProductName(name: string): { lead: string; tail: string } {
  const trimmed = name.trim();
  const i = trimmed.lastIndexOf(" ");
  return i < 0 ? { lead: trimmed, tail: "" } : { lead: trimmed.slice(0, i), tail: trimmed.slice(i + 1) };
}
