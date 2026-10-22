/**
 * Error envelope every API route uses: `{ error, code? }` with an HTTP status.
 */
export interface ApiErrorBody {
  error?: string;
  message?: string;
  /** Machine-readable reason, e.g. "LEAVE_RULE" or "WORKSPACE_SUSPENDED". */
  code?: string;
}

/**
 * Sent with HTTP 403 on every tenant request once the workspace is suspended or
 * cancelled. Not a logout: the session is valid, the workspace is not.
 */
export const WORKSPACE_SUSPENDED = "WORKSPACE_SUSPENDED";
