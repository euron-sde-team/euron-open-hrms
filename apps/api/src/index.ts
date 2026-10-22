/** Euron Open HRMS API server: tenant plane (/api), operator plane (/api/platform), job worker. */
// Pin the process timezone to UTC before ANY other import so all Date math and
// pg timestamp handling are UTC-consistent regardless of the host's local TZ.
process.env.TZ = "UTC";
import "dotenv/config";
import { assertSecrets, assertEmailFlow, assertStorage } from "./core/config";
import { assertConnection, pool } from "./db/kysely";
import { systemRepos } from "./repositories/base.repository";
import { logger, captureError } from "./core/logger";
import * as storage from "./integrations/storage";
import { startWorker, stopWorker } from "./jobs/queue";
import { registerAllHandlers } from "./jobs/handlers";
import { createApp } from "./app";
import { migrate } from "../../../db/migrate";
import { revokeExitedAccessIfLeader } from "./jobs/access-sweep";
import { remindAllOrgsIfLeader } from "./jobs/reminders/clockin";
import { sweepAllOrgsIfLeader } from "./jobs/reminders/onboarding";

const app = createApp();
const PORT = Number(process.env.PORT || 5005);
let server: import("http").Server | null = null;

async function boot() {
  // Refuse to start in production on missing / default signing secrets, or an
  // email flow that would ship dead links / never deliver (locks out new tenants).
  try { assertSecrets(); assertEmailFlow(); assertStorage(); }
  catch (e: any) { logger.error(e.message); process.exit(1); }

  // Retry the first DB connection: a remote RDS can be briefly slow/unreachable
  // at boot, and one timeout shouldn't kill startup.
  const tries = 6;
  let connected = false;
  for (let i = 1; i <= tries && !connected; i++) {
    try { await assertConnection(); connected = true; }
    catch (e: any) {
      logger.warn({ attempt: i, err: e && e.message }, "DB not reachable yet, retrying...");
      if (i < tries) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!connected) {
    logger.error("Cannot reach PostgreSQL after retries. Is DATABASE_URL correct and the DB reachable?");
    process.exit(1);
  }
  // Apply pending migrations before serving. Safe with many replicas booting at once:
  // the runner holds a Postgres advisory lock, so one applies and the rest find nothing
  // to do. Deployments that prefer an explicit step leave this off and run the migrate
  // task (or `pnpm db:migrate`) first.
  if (process.env.MIGRATE_ON_BOOT === "true") {
    try {
      const applied = await migrate({ log: (line) => logger.info(line.trim()) });
      logger.info({ applied: applied.length }, "migrations up to date");
    } catch (e: any) {
      logger.error({ err: e.message }, "migration failed; refusing to start");
      process.exit(1);
    }
  }
  await storage.ensureBucket(); // creates the S3 bucket when STORAGE=s3 (no-op locally)
  const orgCount = await systemRepos().organizations.count();
  if (orgCount === 0) logger.warn("No workspaces yet. Sign up in the web app, or run `pnpm demo:seed` for demo data.");

  // Storage is where every issued letter, payslip and uploaded document lives. Report at
  // boot whether it actually works, so a credentials problem is not discovered weeks later
  // as a failed download.
  storage.checkReachable().then((r) => {
    if (r.ok) logger.info({ storage: storage.MODE }, `file storage ready: ${r.detail}`);
    else {
      logger.error({ storage: storage.MODE }, `FILE STORAGE NOT USABLE: ${r.detail}`);
      console.error(`\n  File storage is NOT usable: ${r.detail}\n  Uploads and document downloads will fail until this is fixed.\n`);
    }
  });

  // Register BEFORE the worker polls. Relying on `import "./jobs/handlers"` for its side
  // effects raced the worker: it could claim a job before that module finished evaluating,
  // and the job failed with "No handler registered" for a handler that plainly exists.
  registerAllHandlers();
  startWorker(); // background job queue

  // Access revocation: disable logins for exited / past-LWD employees (on boot + every 6h).
  // Leader-gated by a pg advisory lock so only one replica sweeps at a time.
  revokeExitedAccessIfLeader();
  setInterval(revokeExitedAccessIfLeader, 6 * 60 * 60 * 1000).unref();

  // Daily clock-in reminders. Ticked every 5 minutes rather than scheduled per org:
  // each org has its own timezone and send time, so the sweep asks "is it that org's
  // reminder minute right now" instead of trying to hold N cron entries in sync. Also
  // leader-gated, and every send is deduped per employee per local date.
  setInterval(remindAllOrgsIfLeader, 5 * 60 * 1000).unref();

  // Onboarding deadline reminders + escalation. Same leader-gated, per-org-timezone sweep,
  // on its own advisory lock (778003). Ticked every 15 minutes rather than every 5: a
  // deadline is a date, not a minute, and the send-time window tolerates a late tick.
  // The sweep only decides and enqueues; the queue worker above does the sending.
  setInterval(sweepAllOrgsIfLeader, 15 * 60 * 1000).unref();

  server = app.listen(PORT, () => {
    logger.info({ port: PORT, storage: storage.MODE }, "API listening");
    console.log(`\n  API -> http://localhost:${PORT}  [storage: ${storage.MODE}]\n`);
  });
}

async function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  await stopWorker();
  const s = server;
  if (s) await new Promise((r) => s.close(r));
  try { await pool.end(); } catch (_e) { /* ignore */ }
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => captureError(err, { where: "unhandledRejection" }));

// Transient network/socket errors on the remote DB connection (RDS dropping idle
// sockets) can surface as an unhandled 'error' event and crash the process. These
// are recoverable -- the pool reconnects on the next query -- so log and keep
// running. Any other uncaught error is genuinely fatal: exit so it can restart.
const RECOVERABLE = ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "EADDRNOTAVAIL", "EAI_AGAIN"];
// pg's "Connection terminated unexpectedly" carries no err.code, so match by message.
const RECOVERABLE_MSG = /connection terminated|terminating connection/i;
process.on("uncaughtException", (err) => {
  captureError(err, { where: "uncaughtException" });
  if (err && (RECOVERABLE.includes((err as any).code) || RECOVERABLE_MSG.test(err.message || ""))) return; // network blip -> stay up
  process.exit(1);
});

boot();
