import { createApiClient } from "@open-hrms/api-client";
import { apiBase } from "@/lib/runtime-env";

export { apiError, apiErrorCode, isWorkspaceSuspendedError } from "@open-hrms/api-client";

/**
 * The tenant app's API client. One instance for the whole app, so the
 * suspended-workspace listener in the auth provider sees every request.
 */
const client = createApiClient({ tokenKey: "hrms.token", baseURL: apiBase });

export const { api, http, tokenStore, downloadFile } = client;

/** Subscribe to the 403 WORKSPACE_SUSPENDED answer (see AuthProvider). */
export const onWorkspaceSuspended = client.onWorkspaceSuspended;
