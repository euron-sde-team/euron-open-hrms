/**
 * Runs before each integration file, BEFORE the API modules load: the pool, the mailer,
 * storage and the KMS client read their configuration at import time.
 *
 * Runtime options come from the environment so one suite covers every backend:
 *   STORAGE    local | s3        (s3 needs an S3 endpoint, e.g. the local emulator)
 *   MAIL_MODE  outbox | smtp | ses
 *   KMS_MODE   local | aws       (aws needs KMS_KEY_ID and an endpoint)
 */
import os from "node:os";
import path from "node:path";
import { assertDisposableDatabase } from "./guard";

process.env.TZ = "UTC";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = assertDisposableDatabase(process.env.TEST_DATABASE_URL);
process.env.STORAGE ??= "local";
process.env.MAIL_MODE ??= "outbox";
process.env.KMS_MODE ??= "local";
process.env.LOG_LEVEL ??= "silent";
process.env.DATA_DIR ??= path.join(os.tmpdir(), `open-hrms-it-${process.pid}`);
process.env.AUTH_RATE_MAX ??= "100000";
process.env.ONBOARDING_PUBLIC_RATE_MAX ??= "100000";
