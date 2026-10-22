# ADR 0003: Postgres as the job queue, advisory locks for leader election

## Status

Accepted.

## Context

The API has background work of two kinds:

- **Jobs**: one-off units triggered by a user action, such as fanning out an announcement or
  expanding an onboarding campaign into hundreds of cases and emails. They must survive a
  task restart, retry on failure and not run twice concurrently.
- **Sweeps**: periodic scans across all workspaces (revoking access after an exit, daily
  clock-in reminders in each workspace's time zone, onboarding deadline reminders). They
  must run on exactly one task at a time, however many API tasks are running.

The deployment already depends on PostgreSQL. Adding Redis or a managed queue would add a
service to provision, secure, monitor, pay for and emulate locally.

## Decision

- **Queue.** A `jobs` table (`db/migrations/0004_jobs.sql`) and a worker in every API task
  (`apps/api/src/jobs/queue.ts`). A worker claims the oldest due `QUEUED` job of a type it
  has a handler for with `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction, marks it
  `RUNNING`, runs it, and records `DONE`, or requeues it with exponential backoff (capped at
  60 s) until `max_attempts`, then `FAILED`. A reaper requeues jobs left `RUNNING` by a
  crashed task. Shutdown drains in-flight jobs.
- **Type-filtered claims.** A worker only claims job types it has registered. During a
  rolling deploy an old task leaves new job types for the new task instead of failing them.
  Jobs nobody can run stay queued and are reported in the logs.
- **Sweeps.** Each sweep takes a Postgres advisory lock with `pg_try_advisory_lock` on one
  pinned connection; a task that does not get it skips that tick. Lock keys: 778001
  (access revocation), 778002 (clock-in reminders), 778003 (onboarding deadlines). The
  migration runner uses a blocking `pg_advisory_lock(727101)`.
- **Sweeps decide, jobs do.** The onboarding sweep only decides what is due and enqueues
  jobs; the queue does the sending, with its retries.

## Consequences

Positive:

- No extra infrastructure; the queue is transactional with the data it acts on and covered
  by the same backups.
- Any number of API tasks can run; work is shared and sweeps run once.
- Local development and the test suites exercise the real queue.

Trade-offs:

- Polling (every 1.5 s by default) adds a small constant query load and up to one poll
  interval of latency.
- Throughput is bounded by Postgres; this suits HR workloads (fan-outs of hundreds or
  thousands), not high-volume event streams.
- Every process pointed at the same database is a consumer. On a shared development
  database, another developer's process can claim your jobs; the type filter limits the
  damage, and tests run handlers directly rather than waiting on "the" worker.
- A handler that never returns occupies that task's worker until the task restarts.
- Session-level advisory locks require the lock and unlock to use the same connection,
  which the code enforces by pinning one.

## Alternatives considered

- **Redis with BullMQ.** Mature features (delays, rate limiting, dashboards), at the cost
  of another stateful service and repeatable-job semantics that need care across replicas.
- **SQS plus EventBridge Scheduler.** Managed and scalable, but AWS-specific, harder to run
  locally, and not transactional with the database writes that create the work.
- **A dedicated worker service.** Cleaner separation of load, but another deployable;
  revisit if background work starts to compete with request latency.
