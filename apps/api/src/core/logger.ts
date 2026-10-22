/**
 * Structured logging (pino) + pluggable error tracking.
 *
 * Error tracking is optional: if SENTRY_DSN is set AND @sentry/node is installed,
 * exceptions are reported to Sentry; otherwise they are logged structurally. This
 * mirrors the mailer/storage "works locally, real service when configured" pattern.
 */
import pino from "pino";
import { PRODUCT_ID } from "./product";

/**
 * Mask credentials that travel in URL paths: a candidate's self-onboarding link is
 * a bearer token in the path, so access logs must never keep it.
 */
export function redactUrl(url: string): string {
  return String(url || "").replace(/(\/api\/onboarding\/public\/)[^/?#]+/, "$1[redacted]");
}

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { app: PRODUCT_ID },
  redact: [
    "req.headers.authorization", "req.headers.cookie",
    // Secrets/tokens can appear in request bodies (reset/verify/invite/login flows).
    "*.password", "*.newPassword", "*.currentPassword", "*.passwordHash",
    "*.token", "*.mfaToken", "*.trustToken", "*.mfaSecret", "*.mfaPending",
    "req.body.password", "req.body.newPassword", "req.body.currentPassword", "req.body.token", "req.body.code",
  ],
});

let sentry: any = null;
if (process.env.SENTRY_DSN) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional dependency, loaded only when SENTRY_DSN is set
    sentry = require("@sentry/node");
    sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "development",
      release: process.env.RELEASE || process.env.GIT_SHA || undefined,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    });
    logger.info("error tracking: Sentry enabled");
  } catch (_e) {
    logger.warn("SENTRY_DSN is set but @sentry/node is not installed (add it with `pnpm --filter @open-hrms/api add @sentry/node`); falling back to log-only");
  }
}

/** Log an error structurally and forward it to Sentry when configured. */
export function captureError(err, context = {}) {
  logger.error({ err, ...context }, err && err.message ? err.message : "error");
  if (sentry) { try { sentry.captureException(err, { extra: context }); } catch (_e) { /* never throw from logging */ } }
}

export const sentryEnabled = !!sentry;
