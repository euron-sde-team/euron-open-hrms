# Configuration reference

Every environment variable the API, the migration runner, the two front ends and the local
Compose stack read, with defaults and meaning. The list was taken from the source
(`apps/api/src`, `db/`, `apps/web`, `apps/console`, `deploy/compose`).

**Required in production** means the API refuses to boot with `NODE_ENV=production` when
the variable is missing or invalid (see
[security.md](../architecture/security.md#production-boot-guards)). On AWS, the Terraform
in `infra/terraform/modules/deployment` sets every required value for you.

## API

### Runtime and HTTP

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `NODE_ENV` | unset | set to `production` | `production` turns the boot guards from warnings into failures and blocks the demo seed. `test` silences the warnings |
| `PORT` | `5005` (the image sets `8080`) | | HTTP port |
| `TZ` | forced to `UTC` | | `index.ts` sets `TZ=UTC` before any import; the image and Terraform also set it |
| `LOG_LEVEL` | `info` | | pino level (`debug`, `info`, `warn`, `error`, `silent`) |
| `PRODUCT_NAME` | `Euron Open HRMS` | | Product name in emails, PDF metadata and the authenticator-app issuer |
| `TRUST_PROXY` | `1` | | Proxy hops to trust for the client IP (Express `trust proxy`). Terraform sets `1` behind the ALB, `2` with CloudFront |
| `CORS_ORIGINS` | empty (CORS open) | **required** | Comma-separated browser origins allowed to call the API: the web app and the console. Others get `403 CORS_ORIGIN_DENIED` |
| `SESSION_TTL` | `7d` | | Tenant session lifetime, in `jsonwebtoken` notation (`12h`, `7d`) |
| `AUTH_RATE_MAX` | `300` | | Requests per IP per 15 minutes on `/api/auth`, `/api/signup` and `/api/platform/auth` |
| `ONBOARDING_PUBLIC_RATE_MAX` | `300` | | Requests per IP per 15 minutes on `/api/onboarding/public` |

### Links in emails and documents

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `APP_WEB_URL` | unset | **required**, absolute, not localhost | Public URL of the tenant web app. Used for verify, reset and invite links and for document verification URLs |
| `APP_BASE_URL` | unset | | Fallback for `APP_WEB_URL` in the email guard and the verification URL. Compose and Terraform set it to the API URL |
| `PORTAL_URL` | `APP_WEB_URL`, then `http://localhost:3410` | must not be localhost | Base of onboarding and welcome links |

Document verification URLs are `<APP_WEB_URL or APP_BASE_URL>/verify/<code>`, falling back
to `http://localhost:3010` when neither is set.

### Signing secrets

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `JWT_SECRET` | committed development value | **required**: 32+ characters, not the default | Signs tenant sessions, 2FA challenges and trusted-device tokens |
| `PLATFORM_JWT_SECRET` | committed development value | **required**, same rules | Signs operator sessions |
| `DOC_VERIFY_SECRET` | committed development value | **required**, same rules | HMAC key for document verification records |

The three must all differ. On AWS they come from the Secrets Manager secret
`<name_prefix>/app`. Rotation effects: [operations.md](operations.md#secret-rotation).

### Database

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | `postgresql://hrms:hrms@localhost:5432/hrms` when neither mode is configured | one of the two modes | Static connection URL. Takes precedence over the secret mode |
| `DATABASE_SECRET_ARN` | unset | | Secret mode: ARN of the RDS-managed master secret. The password is read for every new connection (cached 60 s), so RDS rotation needs no restart. Requires `DB_HOST`, `DB_NAME`, `DB_USER` |
| `DB_HOST` | | secret mode | Database host |
| `DB_PORT` | `5432` | | Database port |
| `DB_NAME` | | secret mode | Database name |
| `DB_USER` | | secret mode | Database user |
| `DB_SSL` | `require` | | Secret mode TLS: `disable`, `require` (encrypt, no certificate check), `verify-full` |
| `DB_SSL_CA_FILE` | | with `verify-full` | Path to the CA bundle (for RDS, the RDS CA bundle) |
| `PG_POOL_MAX` | `10` | | Connections per API process |
| `PG_IDLE_TIMEOUT_MS` | `30000` | | Idle connection recycling |
| `PG_CONNECT_TIMEOUT_MS` | `10000` | | Connection timeout |
| `MIGRATE_ON_BOOT` | off | | Exactly `true` applies pending migrations at boot (advisory-locked). Terraform sets `true` by default (`migrate_on_boot`) |
| `MIGRATIONS_DIR` | `db/migrations` next to the runner | | Migration files; the image sets `/app/db/migrations` |

`AWS_REGION` selects the Secrets Manager region in secret mode.

### File storage

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `STORAGE` | `s3` in the storage module | **required: `s3`** | `s3` or `local`. The boot guard treats an unset value as `local` and refuses it in production, so set `STORAGE=s3` explicitly. Any other value is reported loudly |
| `S3_BUCKET` | | **required** with `s3` | Documents bucket; created at boot if missing (useful on emulators) |
| `S3_REGION` | `AWS_REGION` | `S3_REGION` or `AWS_REGION` required with `s3` | Bucket region |
| `S3_ENDPOINT` | `AWS_ENDPOINT_URL` | | S3-compatible endpoint; switches to path-style addressing |
| `DATA_DIR` | `./data` (the image sets `/tmp/data`) | | Local files when `STORAGE=local`, and the outbox when `MAIL_MODE=outbox` |

### Mail

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `MAIL_MODE` | `outbox` | **required: `smtp` or `ses`** | `outbox` writes `.eml` files under `DATA_DIR/outbox` and delivers nothing; `smtp`; `ses` (SES v2, raw MIME) |
| `MAIL_FROM` | `<PRODUCT_NAME> <no-reply@example.com>` | **required** | Platform sender. Its domain is reserved: no workspace can claim it as a sending domain |
| `SMTP_HOST` | | **required** with `smtp` | |
| `SMTP_PORT` | `587` | | |
| `SMTP_SECURE` | `false` | | Exactly `true` for implicit TLS |
| `SMTP_USER`, `SMTP_PASS` | | **required** with `smtp` | |
| `SES_REGION` | `AWS_REGION` | `SES_REGION` or `AWS_REGION` required with `ses` | Read on every call by the sending-domain code, so records and checks always agree on one region |
| `SES_ENDPOINT` | `AWS_ENDPOINT_URL` | **must be unset** with `ses` | Emulator endpoint |
| `SES_CONFIGURATION_SET` | unset | | Configuration set attached to every workspace sending identity the API creates. Terraform sets it to the deployment's set |

### Personal-data keys

| Variable | Default | Production | Meaning |
| --- | --- | --- | --- |
| `KMS_MODE` | `aws` when `KMS_KEY_ID` is set, else `local` | | `aws` (alias `kms`) or `local` |
| `KMS_KEY_ID` | | **required** with `aws` | Key id, ARN or alias, for example `alias/acme-hrms-prod` |
| `KMS_REGION` | `AWS_REGION` | | KMS region |
| `KMS_ENDPOINT` | `AWS_ENDPOINT_URL` | | Emulator endpoint |
| `PII_MASTER_KEY` | derived from a committed development seed | **required** with `local`: exactly 32 bytes, base64 | Local key-encryption key. Generate with `openssl rand -base64 32`. Losing it loses every sealed field |

### AWS (shared)

| Variable | Default | Meaning |
| --- | --- | --- |
| `AWS_REGION` | `AWS_DEFAULT_REGION`, then `us-east-1` | Region for every service without a service-specific override |
| `AWS_DEFAULT_REGION` | | Fallback for `AWS_REGION` |
| `AWS_ENDPOINT_URL` | unset | One endpoint for S3, SES and KMS (the local emulator). Service-specific `S3_ENDPOINT`, `SES_ENDPOINT`, `KMS_ENDPOINT` win |
| Credentials | standard AWS SDK chain | Environment (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), shared profile (`AWS_PROFILE`), or the ECS task role. There are no per-service key variables |

### Background jobs

| Variable | Default | Meaning |
| --- | --- | --- |
| `QUEUE_POLL_MS` | `1500` | Poll interval of the job worker |
| `QUEUE_STUCK_MS` | `300000` (5 min) | A `RUNNING` job older than this is reclaimed |
| `QUEUE_UNROUTABLE_MS` | `600000` (10 min) | Warn about `QUEUED` jobs no local handler can run after this long |
| `QUEUE_DRAIN_MS` | `10000` | How long shutdown waits for in-flight jobs |

### Error tracking

| Variable | Default | Meaning |
| --- | --- | --- |
| `SENTRY_DSN` | unset | Enables Sentry, if `@sentry/node` is installed (it is not bundled by default) |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` | Sentry tracing sample rate |
| `RELEASE`, `GIT_SHA` | unset | Release name reported to Sentry |

### Web push

| Variable | Default | Meaning |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | unset | Both set enables web push notifications; otherwise push is disabled and everything else keeps working |
| `VAPID_SUBJECT` | `mailto:support@example.com` | VAPID contact |

Web push also needs the `web-push` package at runtime, which the API bundle marks as
external; without it push degrades to disabled.

### AI document extraction

Off unless you enable it. Read [security.md](../architecture/security.md#ai-document-extraction) first.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_DOC_EXTRACTION` | off | Exactly `true` enables it |
| `AI_DOC_PROVIDER` | `gemini` | `gemini` or `openai`. OpenAI is used only when named here |
| `GEMINI_API_KEY` | | Needed for `gemini` |
| `OPENAI_API_KEY` | | Needed for `openai` |
| `AI_DOC_MODEL` | `gemini-2.5-flash` | Gemini model |
| `AI_DOC_MODEL_OPENAI` | `gpt-4o-mini` | OpenAI model |
| `AI_DOC_EXCLUDE` | empty | Comma-separated categories never sent to a model: `PAN`, `AADHAAR`, `VOTER_ID`, `PASSPORT`, `DRIVING_LICENCE`, `BANK`, `EDUCATION`, `EXPERIENCE` |
| `AI_DOC_MAX_BYTES` | `8388608` (8 MB) | Larger files are skipped |
| `AI_DOC_GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com` | Override for a gateway you operate |
| `AI_DOC_OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for a gateway you operate |

On AWS, non-secret settings go in `api_extra_environment`. The provider keys are secrets
and must not; the Terraform does not provision a secret for them.

### Demo seed and CLI

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEMO_PASSWORD` | random, printed once | Password of every demo account (`make demo` passes `HRMS_DEMO_PASSWORD`) |

## Web app and operator console

Both front ends read their configuration at request time and serve it to the browser as
`/env.js`, so one image runs in every environment. Precedence: the runtime variable, then
the `NEXT_PUBLIC_*` variant (useful for `next dev`), then the default.

| Variable | App | Default | Meaning |
| --- | --- | --- | --- |
| `API_URL` | both | `http://localhost:5005/api` | Public API base, including `/api`. The browser calls it directly, so its origin must be allowed by the API's `CORS_ORIGINS` |
| `PRODUCT_NAME` | both | `Euron Open HRMS` | Name shown in titles and the UI |
| `TENANT_URL` | console | `http://localhost:3410` | The tenant web app, used to open impersonation sessions |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_PRODUCT_NAME`, `NEXT_PUBLIC_TENANT_URL` | as above | | Build-time fallbacks |
| `PORT`, `HOSTNAME` | both | image: `8080`, `0.0.0.0` | Next.js standalone server |

## Local Compose stack (`deploy/compose`)

`make env` writes `deploy/compose/.env` (mode 600, never overwritten) with random values for
the secrets. Every other variable is an optional override.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HRMS_JWT_SECRET` | generated | API `JWT_SECRET` |
| `HRMS_PLATFORM_JWT_SECRET` | generated | API `PLATFORM_JWT_SECRET` |
| `HRMS_DOC_VERIFY_SECRET` | generated | API `DOC_VERIFY_SECRET` |
| `HRMS_DEMO_PASSWORD` | generated | Demo account password used by `make demo` and the browser tests |
| `HRMS_PRODUCT_NAME` | `Euron Open HRMS` | Product name for the API and both front ends |
| `HRMS_LOG_LEVEL` | `info` | API log level |
| `HRMS_WEB_PORT` | `3410` | Host port of the web app |
| `HRMS_CONSOLE_PORT` | `3420` | Host port of the console |
| `HRMS_API_PORT` | `5005` | Host port of the API |
| `HRMS_PG_PORT` | `5442` | Host port of Postgres |
| `HRMS_MAILPIT_PORT` | `8025` | Host port of the Mailpit UI |
| `HRMS_SMTP_PORT` | `1025` | Host port of Mailpit's SMTP listener |
| `HRMS_FLOCI_PORT` | `4576` | Host port of the AWS emulator |

The Compose file derives the API's `CORS_ORIGINS`, `APP_WEB_URL`, `PORTAL_URL` and
`APP_BASE_URL`, and the front ends' `API_URL` and `TENANT_URL`, from the port variables.
`make up-aws` additionally reads `deploy/compose/.env.aws` (see
[local-with-aws.md](local-with-aws.md)).

## Test runners

| Variable | Used by | Default | Meaning |
| --- | --- | --- | --- |
| `TEST_DATABASE_URL` | integration tests | set by `make test-integration` | Must name a database containing `test` on a local host |
| `ALLOW_REMOTE_TEST_DB` | integration tests | unset | `true` permits a non-local test database host |
| `MAILPIT_URL` | integration and browser tests | `http://localhost:8025` | Where tests read delivered mail |
| `WEB_URL`, `CONSOLE_URL`, `API_URL` | browser tests | `http://localhost:3410`, `:3420`, `:5005/api` | Targets |
| `E2E_HEADED` | browser tests | unset | Any value runs the browser headed |
| `DEMO_PASSWORD` | browser tests | `HRMS_DEMO_PASSWORD` from `deploy/compose/.env` | Demo password |
