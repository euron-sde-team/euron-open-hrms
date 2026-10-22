# Operations

Day-two procedures for a deployment built with `make aws-deploy`. Resource names below use
`<prefix>` for your `name_prefix` and `<env>` for `aws-dev` or `aws-prod`.

## Backups and point-in-time recovery

| What | How it is protected |
| --- | --- |
| Database | RDS automated backups, retained 3 days (`aws-dev`) or 14 days (`aws-prod`), backup window 03:00 to 04:00 UTC. Automated backups give point-in-time restore within the retention window. Snapshots are encrypted with the deployment's KMS key and carry the instance tags. With deletion protection on (`aws-prod`), destroying the instance takes a final snapshot `<prefix>-db-final` |
| Files | The documents bucket is versioned. Superseded versions (a regenerated payslip, a replaced logo) are kept 90 days, then expire. Current versions never expire: HR records have statutory retention periods you decide. Incomplete multipart uploads are aborted after 1 day |
| Keys | The KMS key has a deletion window (7 days dev, 30 days prod), so a scheduled deletion can be cancelled |
| Secrets | Secrets Manager recovery window: none in dev, 30 days in prod |

To restore the database to a point in time, RDS creates a **new** instance:

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier <prefix>-db \
  --target-db-instance-identifier <prefix>-db-restore \
  --restore-time 2026-01-15T09:30:00Z \
  --db-subnet-group-name <prefix>-db \
  --vpc-security-group-ids <db security group id>
```

Inspect or export from the restored instance. Pointing the services at it means changing the
database inputs in Terraform, so treat a full cut-over as a planned change.

A restored database is only useful with the same KMS key: each workspace's data key in
`org_data_keys` is wrapped by it. Never delete the key while backups that depend on it are
still within retention.

## Migrations

Migrations are plain SQL files in `db/migrations`, named `NNNN_description.sql`, applied by
`db/migrate.ts`:

- forward-only, in filename order, each file in its own transaction;
- under a Postgres advisory lock, so concurrent runners are safe (the second waits, then
  finds nothing to do);
- recorded in `schema_migrations` with a SHA-256 checksum. **Never edit an applied
  migration**: the runner stops with `<file> changed after it was applied; add a new
  migration instead`. Add a new file.

Two ways to run them:

| Mode | How | When |
| --- | --- | --- |
| On boot (default) | `MIGRATE_ON_BOOT=true`; the API applies pending migrations before it serves, and refuses to start if one fails | Most deployments |
| Explicit step | Set `migrate_on_boot = false` in the deployment module call, then `make aws-migrate ENV=<env>` before rolling out | When you want migrations reviewed and run separately |

Locally:

```bash
pnpm db:migrate            # apply pending migrations (uses DATABASE_URL)
pnpm db:migrate --status   # list applied and pending, change nothing
```

During a rolling deploy, tasks of the previous version keep serving against the new schema
until they are replaced. Write migrations that the previous version tolerates: add columns
and tables first, remove them in a later release.

## Secret rotation

The three application secrets live in one Secrets Manager secret, `<prefix>/app`, as JSON
keys. ECS injects them when a task starts, and Terraform ignores later changes to the value,
so rotation is: write a new version, then restart the services.

```bash
aws secretsmanager get-secret-value --secret-id <prefix>/app --query SecretString --output text > /tmp/app-secret.json
# edit ONE key in /tmp/app-secret.json; keep the other two unchanged, 32+ characters, all distinct
aws secretsmanager put-secret-value --secret-id <prefix>/app --secret-string file:///tmp/app-secret.json
rm /tmp/app-secret.json
aws ecs update-service --cluster <prefix> --service api --force-new-deployment
```

What rotating each one does:

| Secret | Effect |
| --- | --- |
| `JWT_SECRET` | Every tenant session, every pending 2FA challenge and every trusted-device token becomes invalid. Every user signs in again and repeats 2FA on every device. Operator impersonation sessions end too |
| `PLATFORM_JWT_SECRET` | Every operator session ends; operators sign in again. Tenant users are unaffected |
| `DOC_VERIFY_SECRET` | **Every document issued so far stops verifying**: the public check recomputes the HMAC with the current secret, so old records report `TAMPERED`. Rotate only after a confirmed compromise, and expect to reissue documents that third parties still need to verify |
| Database password | Rotated by RDS in its managed secret. The API reads the password for every new connection (cached 60 seconds), so no restart is needed |
| `PII_MASTER_KEY` (local key scheme only) | Cannot be rotated in place: existing wrapped data keys can only be unwrapped with the old key, and there is no re-wrap tool. Changing it makes every sealed field unreadable |

The boot guard refuses to start if two of the three application secrets are equal, or if one
is shorter than 32 characters.

## KMS key rotation

The customer-managed key has automatic rotation enabled with a 365-day period. KMS keeps
previous key material, so data keys wrapped before a rotation still unwrap, and nothing in
the application changes. The per-workspace data keys themselves are not rotated by the
application.

## Scaling

The API is safe to run as many tasks as you need:

| Concern | Why it is safe |
| --- | --- |
| Background jobs | Every task runs a worker; claims use `FOR UPDATE SKIP LOCKED`, so a job runs on one task |
| Periodic sweeps | Each sweep takes an advisory lock (`pg_try_advisory_lock`); one task runs it, the others skip that tick |
| Migrations | Advisory-locked |
| Sessions | Stateless JWTs plus a database reload per request |
| Data-key cache | Per task, 10-minute expiry; each task asks KMS on its own |
| Rate limits | In memory per task: with N API tasks, the effective per-IP budget is up to N times `AUTH_RATE_MAX`. Use the WAF rate rule (with `enable_cdn`) for a deployment-wide limit |

Autoscaling tracks average CPU at 60 percent between the minimum and maximum task counts
([deploy-aws.md](deploy-aws.md#sizing)). To change the counts, edit `api_min_count`,
`api_max_count`, `web_min_count` and `web_max_count` in `envs/<env>/main.tf` and redeploy.

**Connection pool sizing.** Each API task opens up to `PG_POOL_MAX` connections (default 10),
the migration runner one more, and each one-off task its own pool. Keep
`api_max_count x PG_POOL_MAX` plus headroom for one-off tasks and maintenance below the
database's `max_connections`, which depends on the instance class. The connections alarm
fires at 80 percent of a configured ceiling of 200 (an input of the `observability` module),
so adjust that input if your instance allows a different number.

## Alarms and dashboard

Every alarm notifies the SNS topic `<prefix>-alarms` on both alarm and recovery. Set
`alarm_email` to subscribe an address, and confirm the subscription email AWS sends. Missing
data is treated as not breaching. Each alarm needs two consecutive breaching periods.

| Alarm | Condition |
| --- | --- |
| `<prefix>-<service>-5xx` (api, web, console) | More than 25 target 5xx responses in 5 minutes |
| `<prefix>-<service>-unhealthy` | Any target failing load-balancer health checks for a minute |
| `<prefix>-<service>-cpu` | Average CPU above 85 percent over 5 minutes |
| `<prefix>-<service>-memory` | Average memory above 85 percent over 5 minutes |
| `<prefix>-db-cpu` | Database CPU above 80 percent over 5 minutes |
| `<prefix>-db-storage` | Free storage below 5 GiB |
| `<prefix>-db-connections` | Connections above 80 percent of the configured ceiling (200) |

The CloudWatch dashboard `<prefix>` shows requests and errors for all apps, latency p50 and
p99, the database, and CPU and memory per service. Container Insights (enhanced) is on for
the cluster, and RDS Performance Insights (7-day retention) and Enhanced Monitoring (60 s)
are on for the database.

Health endpoints: `GET /up` (liveness; the load balancer and the container health check use
it) and `GET /api/ready` (verifies the database).

## Logs

| Log | Where | Retention |
| --- | --- | --- |
| API, web, console, migrate | `/hrms/<prefix>/<service>`, JSON (pino) for the API | 14 days dev, 365 days prod; encrypted with the KMS key |
| VPC flow logs | `/hrms/<prefix>/vpc-flow` | 30 days (365 in aws-prod) |
| PostgreSQL | Exported by RDS to CloudWatch; statements slower than 1 s are logged | Log group created by RDS, not managed by this Terraform: set its retention yourself |
| ALB access logs | Off unless you pass `alb_access_logs_bucket` to the deployment module | Your bucket's policy |

Follow the API log:

```bash
aws logs tail /hrms/<prefix>/api --follow --format short
```

Useful API log messages:

| Message | Meaning |
| --- | --- |
| `file storage ready: s3://...` | Storage check passed at boot |
| `FILE STORAGE NOT USABLE: ...` | The bucket is unreachable; uploads and downloads will fail. The message names the cause |
| `migrations up to date` | Boot-time migrations finished |
| `job queue worker started` | Lists the job types this task can run |
| `reaped stuck RUNNING jobs` | A task died mid-job; the jobs were requeued or failed |
| `queued jobs have no handler in this worker` | Jobs of a type no running version handles |
| `access revocation skipped: this is the workspace's only administrator` | The sweep refused to disable a workspace's last admin; fix the separation record |
| `email send failed` | The mail provider rejected a message; the user action that triggered it still succeeded |

Unexpected errors are logged with the request id that the client received in its 500
response.

## Purging a workspace

Deleting a workspace is permanent. In the operator console (role `OPERATOR`):

1. Optionally export it: the workspace's export produces a JSON snapshot of all its data,
   with sealed fields decrypted. Store it as the most sensitive file you hold, or not at all.
2. Remove its sending domain in the workspace's settings (impersonate if needed), so the
   SES identity is deleted.
3. Suspend the workspace.
4. Delete it, typing the workspace name exactly.

The API deletes every row the workspace owns, its queued jobs, then its data key
(crypto-shredding every sealed field, including in backups), then the workspace row, and
keeps a fleet-level `TENANT_DELETE` audit entry. It does **not** delete files in the
documents bucket or unsealed data in database backups; handle both under your retention
policy. Details: [multi-tenancy.md](../architecture/multi-tenancy.md#deleting-a-workspace).

## Routine checks

- Alarm topic subscription confirmed and delivering.
- Boot log shows `file storage ready` after every deploy.
- No growing set of `FAILED` jobs:

  ```sql
  SELECT type, count(*) FROM jobs WHERE status = 'FAILED' GROUP BY type;
  ```

- SES reputation metrics and the suppression list (bounces and complaints are suppressed by
  the configuration set).
- Statutory payroll defaults reviewed at the start of each tax year
  ([payroll-engine.md](../architecture/payroll-engine.md#country-packs)).
