import { createApiClient } from "@open-hrms/api-client";
import { apiBase } from "@/lib/runtime-env";

export { apiError, apiErrorCode } from "@open-hrms/api-client";

/**
 * The operator console's API client. A separate token key from the tenant
 * app, so an operator can be signed in to both (for example while
 * impersonating) without one session clobbering the other.
 */
export const { api, http, tokenStore, downloadFile } = createApiClient({
  tokenKey: "hrms.admin.token",
  baseURL: apiBase,
});
