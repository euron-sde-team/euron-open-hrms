/**
 * Lightweight pg-backed background job queue (no Redis).
 *
 * A single worker polls the `jobs` table, atomically claims due jobs
 * (FOR UPDATE SKIP LOCKED, so it is safe even if multiple workers run), runs the
 * registered handler, and on failure retries with exponential backoff up to
 * maxAttempts before marking the job FAILED.
 */
import { randomUUID as uuid } from "crypto";
import { db } from "../db/kysely";
import { logger, captureError } from "../core/logger";

const handlers = {};
let timer: NodeJS.Timeout | null = null;
let stopping = false;
let inFlight = 0; // jobs currently executing in this process (for graceful drain)
let lastReap = 0;
const pollMs = Number(process.env.QUEUE_POLL_MS || 1500);
// A job stuck in RUNNING longer than this had its worker die mid-run; reclaim it.
const STUCK_MS = Number(process.env.QUEUE_STUCK_MS || 5 * 60 * 1000);
const REAP_EVERY_MS = 60 * 1000;
// How long a job may sit QUEUED with no handler in this worker before it is worth saying so.
// Generous, because a rolling deploy legitimately leaves new job types unclaimed for a while.
const UNROUTABLE_AFTER_MS = Number(process.env.QUEUE_UNROUTABLE_MS || 10 * 60 * 1000);

function registerHandler(type, fn) {
  handlers[type] = fn;
}

/** Job types this worker can run. Also what claimOne() filters on. */
const registeredTypes = () => Object.keys(handlers);

/**
 * Look up a handler without going through the queue.
 *
 * For tests. Delivery through the `jobs` table is a race between every worker on the
 * database, so a test that waits for "the" worker to drain a fan-out is really waiting on
 * whichever process wins, which on a shared dev database is the deployed API. Tests assert
 * the job was ENQUEUED (the caller's actual contract) and run the handler themselves.
 */
const getHandler = (type: string) => handlers[type];

/** Enqueue a job. Returns the job id. */
async function enqueue(type, payload = {}, { orgId = null, runAt = new Date(), maxAttempts = 3 } = {}) {
  const id = uuid();
  await db.insertInto("jobs").values({
    id, type, status: "QUEUED", org_id: orgId, run_at: runAt,
    attempts: 0, max_attempts: maxAttempts, last_error: null,
    payload: JSON.stringify(payload), created_at: new Date(), updated_at: new Date(),
  }).execute();
  return id;
}

/**
 * Atomically claim the next due job THIS worker can actually run (null if none).
 *
 * The type filter is not a nicety, it is what makes a multi-worker queue version-safe.
 * `SKIP LOCKED` means any process pointed at this database is a consumer, so a worker that
 * claims a type it has no handler for destroys the job on behalf of one that could have run
 * it: it burns the retry budget and marks it FAILED. That happens in two real situations.
 *
 *  - A rolling deploy. The v1 replica is still polling while v2 starts enqueueing a new job
 *    type, and v1 eats it.
 *  - A shared dev database. Every developer's laptop and the deployed dev API poll the same
 *    `jobs` table, so a feature branch's jobs are claimed by whichever process wins the race,
 *    usually the deployed one, which does not have the branch's handlers.
 *
 * Filtering by the registry makes a worker ignore what it cannot do and leave it for one that
 * can. Jobs nobody can run stay QUEUED rather than dying, and are reported by reapStuckJobs().
 */
async function claimOne() {
  const known = Object.keys(handlers);
  // Nothing registered yet: claim nothing rather than claim-and-fail. Guards the boot window
  // and keeps Kysely from emitting an empty `IN ()`.
  if (!known.length) return null;
  return db.transaction().execute(async (trx) => {
    const job = await trx
      .selectFrom("jobs").selectAll()
      .where("status", "=", "QUEUED").where("run_at", "<=", new Date())
      .where("type", "in", known)
      .orderBy("run_at", "asc").limit(1).forUpdate().skipLocked()
      .executeTakeFirst();
    if (!job) return null;
    await trx.updateTable("jobs").set({ status: "RUNNING", attempts: job.attempts + 1, updated_at: new Date() }).where("id", "=", job.id).execute();
    return { ...job, attempts: job.attempts + 1 };
  });
}

/**
 * Reclaim jobs orphaned in RUNNING by a crashed worker: if not retry-exhausted,
 * requeue them; otherwise mark FAILED. Multi-replica safe (a plain UPDATE filtered
 * by a stale updated_at; whoever runs it first flips the rows).
 */
async function reapStuckJobs() {
  const cutoff = new Date(Date.now() - STUCK_MS);
  const requeued = await db.updateTable("jobs")
    .set({ status: "QUEUED", last_error: "reclaimed: worker died mid-run", run_at: new Date(), updated_at: new Date() })
    .where("status", "=", "RUNNING").where("updated_at", "<", cutoff)
    .where((eb) => eb("attempts", "<", eb.ref("max_attempts")))
    .executeTakeFirst();
  const failed = await db.updateTable("jobs")
    .set({ status: "FAILED", last_error: "reclaimed but retry budget exhausted", updated_at: new Date() })
    .where("status", "=", "RUNNING").where("updated_at", "<", cutoff)
    .where((eb) => eb("attempts", ">=", eb.ref("max_attempts")))
    .executeTakeFirst();
  const n = Number(requeued?.numUpdatedRows || 0) + Number(failed?.numUpdatedRows || 0);
  if (n) logger.warn({ requeued: Number(requeued?.numUpdatedRows || 0), failed: Number(failed?.numUpdatedRows || 0) }, "reaped stuck RUNNING jobs");
}

/**
 * Report jobs sitting QUEUED that this worker has no handler for.
 *
 * The price of claiming only what we can run is that work nobody can run waits quietly
 * instead of failing loudly, and a queue that silently stops doing a whole job type is
 * exactly the failure this feature was bitten by. These are only WARNED, never failed: on a
 * shared database another replica may be the one that owns the type, and failing it here
 * would recreate the theft the type filter exists to prevent.
 */
async function reportUnroutableJobs() {
  const stale = new Date(Date.now() - UNROUTABLE_AFTER_MS);
  const rows = await db
    .selectFrom("jobs").select(["type"]).distinct()
    .where("status", "=", "QUEUED").where("run_at", "<", stale)
    .execute();
  const known = new Set(Object.keys(handlers));
  const orphaned = rows.map((r: any) => r.type).filter((t: string) => !known.has(t));
  if (orphaned.length) {
    logger.warn(
      { types: orphaned, staleFor: `${Math.round(UNROUTABLE_AFTER_MS / 60000)}m` },
      "queued jobs have no handler in this worker; another replica must own them, or a deploy is missing",
    );
  }
}

async function runOne() {
  const job: any = await claimOne();
  if (!job) return false;
  inFlight++;
  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
    const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
    await handler(payload, job);
    await db.updateTable("jobs").set({ status: "DONE", last_error: null, updated_at: new Date() }).where("id", "=", job.id).execute();
  } catch (e: any) {
    const exhausted = job.attempts >= job.max_attempts;
    const backoffMs = Math.min(60000, 1000 * 2 ** job.attempts); // 2s, 4s, 8s...
    await db.updateTable("jobs").set({
      status: exhausted ? "FAILED" : "QUEUED",
      last_error: String((e && e.message) || e).slice(0, 500),
      run_at: new Date(Date.now() + backoffMs),
      updated_at: new Date(),
    }).where("id", "=", job.id).execute();
    captureError(e, { job: { id: job.id, type: job.type, attempt: job.attempts, exhausted } });
  } finally {
    inFlight--;
  }
  return true;
}

async function tick() {
  if (stopping) return;
  try {
    // Periodically reclaim jobs orphaned by a crashed worker (cheap, throttled).
    const now = Date.now();
    if (now - lastReap > REAP_EVERY_MS) {
      lastReap = now;
      await reapStuckJobs().catch((e) => captureError(e, { where: "queue.reap" }));
      await reportUnroutableJobs().catch((e) => captureError(e, { where: "queue.unroutable" }));
    }
    let processed = 0;
    while (await runOne()) if (++processed >= 25) break; // drain, capped per tick
  } catch (e: any) {
    captureError(e, { where: "queue.tick" });
  }
  if (!stopping) timer = setTimeout(tick, pollMs);
}

function startWorker() {
  if (timer) return;
  stopping = false;
  // Log what this worker can run. When a job type goes unhandled the first question is always
  // "which build is this process", and the answer is right here rather than three hours away.
  logger.info({ types: registeredTypes() }, "job queue worker started");
  tick();
}

async function stopWorker() {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  // Graceful drain: wait (bounded) for any in-flight job to finish writing its
  // terminal status so SIGTERM doesn't orphan a RUNNING job against a closing pool.
  const deadline = Date.now() + Number(process.env.QUEUE_DRAIN_MS || 10000);
  while (inFlight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (inFlight > 0) logger.warn({ inFlight }, "queue shutdown: drain timed out with jobs still running");
}

export { enqueue, registerHandler, registeredTypes, getHandler, startWorker, stopWorker };
