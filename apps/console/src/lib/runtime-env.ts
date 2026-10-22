/**
 * Runtime configuration (see the tenant app's lib/runtime-env.ts for the why).
 *
 * Precedence: window.__HRMS_ENV (served by /env.js at request time) >
 * NEXT_PUBLIC_* (build time, handy for `next dev`) > the defaults below.
 */

import { nonEmpty } from "@open-hrms/api-client";

export interface ConsoleEnv {
  /** Public API base, including the /api prefix. The console calls /platform/* on it. */
  API_URL: string;
  PRODUCT_NAME: string;
  /** Where the tenant app lives; impersonation opens it in a new tab. */
  TENANT_URL: string;
}

export const DEFAULT_ENV: ConsoleEnv = {
  API_URL: "http://localhost:5005/api",
  PRODUCT_NAME: "Euron Open HRMS",
  TENANT_URL: "http://localhost:3410",
};

declare global {
  // Set by /env.js.
  var __HRMS_ENV: Partial<ConsoleEnv> | undefined;
}

/** Server-side resolution, used by the env.js route and the root layout. */
export function serverEnv(env: Record<string, string | undefined> = process.env): ConsoleEnv {
  return {
    API_URL: nonEmpty(env.API_URL) ?? nonEmpty(env.NEXT_PUBLIC_API_URL) ?? DEFAULT_ENV.API_URL,
    PRODUCT_NAME: nonEmpty(env.PRODUCT_NAME) ?? nonEmpty(env.NEXT_PUBLIC_PRODUCT_NAME) ?? DEFAULT_ENV.PRODUCT_NAME,
    TENANT_URL: nonEmpty(env.TENANT_URL) ?? nonEmpty(env.NEXT_PUBLIC_TENANT_URL) ?? DEFAULT_ENV.TENANT_URL,
  };
}

export function runtimeEnv(): ConsoleEnv {
  // On the server (SSR of a client component) read the process env directly:
  // pages render per request, so this is the same value /env.js serves, and
  // the server and client renders agree (no hydration mismatch on the name).
  if (typeof window === "undefined") return serverEnv();
  const injected = window.__HRMS_ENV;
  return {
    API_URL:
      nonEmpty(injected?.API_URL) ?? nonEmpty(process.env.NEXT_PUBLIC_API_URL) ?? DEFAULT_ENV.API_URL,
    PRODUCT_NAME:
      nonEmpty(injected?.PRODUCT_NAME) ??
      nonEmpty(process.env.NEXT_PUBLIC_PRODUCT_NAME) ??
      DEFAULT_ENV.PRODUCT_NAME,
    TENANT_URL:
      nonEmpty(injected?.TENANT_URL) ?? nonEmpty(process.env.NEXT_PUBLIC_TENANT_URL) ?? DEFAULT_ENV.TENANT_URL,
  };
}

export const apiBase = () => runtimeEnv().API_URL.replace(/\/+$/, "");
export const productName = () => runtimeEnv().PRODUCT_NAME;
export const tenantUrl = () => runtimeEnv().TENANT_URL.replace(/\/+$/, "");
