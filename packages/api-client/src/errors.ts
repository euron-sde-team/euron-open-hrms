import type { AxiosError } from "axios";
import { WORKSPACE_SUSPENDED, type ApiErrorBody } from "@open-hrms/types";

/** Pull a human-readable message out of an axios error. */
export function apiError(e: unknown): string {
  const err = e as AxiosError<ApiErrorBody> | undefined;
  return (
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    "Something went wrong"
  );
}

/** The machine-readable `code` on an API error, when the server sent one (e.g. "LEAVE_RULE"). */
export function apiErrorCode(e: unknown): string | undefined {
  return (e as AxiosError<ApiErrorBody> | undefined)?.response?.data?.code;
}

/** HTTP status of an API error, if it got as far as a response. */
export function apiErrorStatus(e: unknown): number | undefined {
  return (e as AxiosError | undefined)?.response?.status;
}

/**
 * True for the 403 a suspended or cancelled workspace returns on every request.
 * Checked on status AND code: a plain 403 (missing permission) is not this.
 */
export function isWorkspaceSuspendedError(e: unknown): boolean {
  return apiErrorStatus(e) === 403 && apiErrorCode(e) === WORKSPACE_SUSPENDED;
}
