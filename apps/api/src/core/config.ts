/**
 * Boot-time configuration guard.
 *
 * Fails fast in production when a security-critical secret is missing or left at
 * its committed `change-me-*` default. The fallback defaults in auth.ts /
 * platformAuth.ts exist only so local dev runs with zero setup; shipping them to
 * production means anyone who has read the repo can forge tokens. This refuses to
 * boot in that state.
 */

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * The tenant web app's origin, NOT this API server. Every emailed link must land on the
 * Next.js client (which proxies /api here), otherwise the page 404s.
 *
 * Defined in this leaf module rather than in a route file. It used to live in
 * routes/onboarding.routes.ts, and background jobs importing it from there created an
 * import cycle (job module -> route module -> ...) that left four of the five queue
 * handlers silently unregistered: the module evaluated, but only its first
 * registerHandler call took effect. Config belongs in config.
 */
export const PORTAL_URL = (
  process.env.PORTAL_URL || process.env.APP_WEB_URL || "http://localhost:3410"
).replace(/\/$/, "");

// Secrets that MUST be set (and non-default) in production. `def` is the known
// committed fallback we must reject.
export const DEV_DEFAULTS = {
  JWT_SECRET: "change-me-open-hrms-local-tenant-secret",
  PLATFORM_JWT_SECRET: "change-me-open-hrms-local-platform-secret",
  DOC_VERIFY_SECRET: "change-me-open-hrms-local-doc-verify-secret",
  /** Seed for the development-only PII master key (local key scheme without PII_MASTER_KEY). */
  PII_MASTER_KEY_SEED: "change-me-open-hrms-local-pii-master-key",
} as const;

const REQUIRED_SECRETS = [
  { env: "JWT_SECRET", def: DEV_DEFAULTS.JWT_SECRET, min: 32 },
  { env: "PLATFORM_JWT_SECRET", def: DEV_DEFAULTS.PLATFORM_JWT_SECRET, min: 32 },
  // Signs the QR codes on payslips and letters. It used to fall back to JWT_SECRET
  // and then to a constant, so a deployment could ship forgeable documents silently.
  { env: "DOC_VERIFY_SECRET", def: DEV_DEFAULTS.DOC_VERIFY_SECRET, min: 32 },
];

/**
 * Validate required secrets. Throws (caller exits) in production on any problem.
 * Outside production it only warns, so local dev still runs on the defaults.
 */
export function assertSecrets(env = process.env): string[] {
  const problems: string[] = [];
  for (const { env: key, def, min } of REQUIRED_SECRETS) {
    const v = env[key];
    if (!v) problems.push(`${key} is not set`);
    else if (v === def) problems.push(`${key} is still the committed default ("change-me-…"), rotate it`);
    else if (v.length < min) problems.push(`${key} is too short (<${min} chars); use a long random value`);
  }
  const distinct = new Set(REQUIRED_SECRETS.map(({ env: key }) => env[key]).filter(Boolean));
  if (distinct.size < REQUIRED_SECRETS.filter(({ env: key }) => env[key]).length)
    problems.push("JWT_SECRET, PLATFORM_JWT_SECRET and DOC_VERIFY_SECRET must all be different values");
  // Personal-data encryption: production needs a real key-encryption key.
  const scheme = String(env.KMS_MODE || (env.KMS_KEY_ID ? "aws" : "local")).toLowerCase();
  if (scheme === "aws" || scheme === "kms") {
    if (!env.KMS_KEY_ID) problems.push("KMS_MODE=aws but KMS_KEY_ID is not set");
  } else if (!env.PII_MASTER_KEY) {
    problems.push("PII_MASTER_KEY is not set (32 random bytes, base64), or set KMS_MODE=aws with KMS_KEY_ID");
  } else if (Buffer.from(env.PII_MASTER_KEY, "base64").length !== 32) {
    problems.push("PII_MASTER_KEY must decode to exactly 32 bytes (openssl rand -base64 32)");
  }
  // A browser-facing API with credentials must name its origins. Open CORS is a dev convenience.
  if (!String(env.CORS_ORIGINS || "").trim()) problems.push("CORS_ORIGINS is not set (comma-separated web and console origins)");
  if (problems.length) {
    const msg = `Insecure configuration:\n  - ${problems.join("\n  - ")}`;
    if (IS_PROD) throw new Error(msg);
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== "test") console.warn(`\n⚠️  ${msg}\n   (allowed in non-production; set NODE_ENV=production to enforce)\n`);
  }
  return problems;
}

/**
 * Validate the transactional EMAIL flow (signup verify / password reset / staff
 * invite). These emails carry links into the CLIENT app and must actually be
 * delivered, or new tenants/users get locked out. In production:
 *  - APP_WEB_URL must be set to a real (non-localhost) frontend URL, else every
 *    emailed link is dead. (Hard fail.)
 *  - MAIL_MODE must be a real sender (smtp/ses) with its config, else mail is only
 *    written to data/outbox and never delivered. (Hard fail, silent lockout.)
 * Outside production these only warn so local dev keeps working on defaults.
 */
export function assertEmailFlow(env = process.env): string[] {
  const problems: string[] = [];

  const web = env.APP_WEB_URL || env.APP_BASE_URL;
  if (!web) problems.push("APP_WEB_URL is not set, emailed verify/reset/invite links won't point at the app");
  else if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(web)) problems.push(`APP_WEB_URL points at localhost (${web}); emailed links will be dead for real users`);
  else if (!/^https?:\/\//i.test(web)) problems.push(`APP_WEB_URL must be an absolute http(s) URL (got "${web}")`);

  // Onboarding/welcome emails build their "Portal" link from PORTAL_URL, which
  // falls back to APP_WEB_URL. Validate the resolved value too, so a deploy that
  // sets APP_WEB_URL but leaves PORTAL_URL pointing at localhost is caught here.
  const portal = env.PORTAL_URL || env.APP_WEB_URL || env.APP_BASE_URL;
  if (portal && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(portal))
    problems.push(`PORTAL_URL points at localhost (${portal}); onboarding/welcome email links will be dead for real employees`);

  const mode = (env.MAIL_MODE || "outbox").toLowerCase();
  if (mode === "outbox") {
    problems.push("MAIL_MODE is 'outbox', emails are written to disk, NOT delivered; set MAIL_MODE=smtp or ses");
  } else if (mode === "smtp") {
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) problems.push("MAIL_MODE=smtp but SMTP_HOST/SMTP_USER/SMTP_PASS are incomplete");
  } else if (mode === "ses") {
    if (!env.SES_REGION && !env.AWS_REGION) problems.push("MAIL_MODE=ses but no SES_REGION/AWS_REGION set");
    if (env.SES_ENDPOINT || env.AWS_ENDPOINT_URL) problems.push("MAIL_MODE=ses points at an emulator endpoint (SES_ENDPOINT/AWS_ENDPOINT_URL); mail would not be delivered");
  } else {
    problems.push(`MAIL_MODE "${mode}" is not recognised (use outbox | smtp | ses)`);
  }
  if (!env.MAIL_FROM) problems.push("MAIL_FROM is not set, a verified sender address is required for delivery");

  if (problems.length) {
    const msg = `Email flow is not production-ready:\n  - ${problems.join("\n  - ")}`;
    if (IS_PROD) throw new Error(msg);
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== "test") console.warn(`\n⚠️  ${msg}\n   (allowed in non-production; set NODE_ENV=production to enforce)\n`);
  }
  return problems;
}

/**
 * File-storage guard. Documents, payslips and letters belong in object storage
 * (S3, or an S3-compatible endpoint). Local disk is a dev-only convenience, flagged
 * in production. When STORAGE=s3,
 * fail fast on a missing bucket or missing credentials rather than letting the
 * S3 client silently receive `undefined` and error on the first upload.
 */
export function assertStorage(env = process.env): string[] {
  const problems: string[] = [];
  const mode = (env.STORAGE || "local").toLowerCase();

  if (mode === "local") {
    problems.push("STORAGE is 'local', files are written to disk, not S3; set STORAGE=s3");
  } else if (mode === "s3") {
    if (!env.S3_BUCKET) problems.push("STORAGE=s3 but S3_BUCKET is not set");
    if (!env.S3_REGION && !env.AWS_REGION) problems.push("STORAGE=s3 but no S3_REGION/AWS_REGION set");
    // Credentials come from the standard chain; on ECS that is the task role, which
    // cannot be detected from the environment, so it is not checked here.
  } else {
    problems.push(`STORAGE "${mode}" is not recognised (use local | s3)`);
  }

  if (problems.length) {
    const msg = `File storage is not production-ready:\n  - ${problems.join("\n  - ")}`;
    if (IS_PROD) throw new Error(msg);
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== "test") console.warn(`\n⚠️  ${msg}\n   (allowed in non-production; set NODE_ENV=production to enforce)\n`);
  }
  return problems;
}
