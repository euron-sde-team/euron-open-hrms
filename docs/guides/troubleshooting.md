# Troubleshooting

Symptoms, their causes and fixes, drawn from the checks and messages in the code. Messages
are quoted as the API returns or logs them. For local setup problems also see
[quickstart-local.md](quickstart-local.md#troubleshooting).

## Boot and configuration

| Symptom | Cause | Fix |
| --- | --- | --- |
| The API exits at boot with `Insecure configuration:` followed by a list | `NODE_ENV=production` and a secret problem: a secret is missing, still the committed `change-me-*` default, shorter than 32 characters, or two of the three are equal; no key scheme (`PII_MASTER_KEY` missing or not 32 bytes, or `KMS_MODE=aws` without `KMS_KEY_ID`); or `CORS_ORIGINS` is empty | Fix each listed item. Generate secrets with `openssl rand -base64 48` and a master key with `openssl rand -base64 32` |
| `Email flow is not production-ready:` with `MAIL_MODE is 'outbox'` | Production refuses the outbox mailer, which writes files and delivers nothing | Set `MAIL_MODE=ses` (or `smtp` with `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) and `MAIL_FROM` |
| `... APP_WEB_URL points at localhost` or `PORTAL_URL points at localhost` | Emailed links would be dead for real users | Set both to the public web app URL |
| `... MAIL_MODE=ses points at an emulator endpoint` | `SES_ENDPOINT` or `AWS_ENDPOINT_URL` is set in production | Remove the endpoint override |
| `File storage is not production-ready:` with `STORAGE is 'local'` | `STORAGE` is unset or `local`; container disks do not survive a deploy | Set `STORAGE=s3` and `S3_BUCKET` |
| Startup prints `STORAGE="..." is not a valid backend` | A typo, for example a value pasted from `MAIL_MODE` | Use `s3` or `local` |
| These messages appear only as warnings | `NODE_ENV` is not `production` | Expected in development; set `NODE_ENV=production` to enforce |
| `Cannot reach PostgreSQL after retries` | The first connection failed 6 times, 3 s apart | Check `DATABASE_URL`, or in secret mode `DB_HOST` and the security group |
| `DATABASE_SECRET_ARN mode requires DB_HOST, DB_NAME, DB_USER` | Secret mode without the connection details | Set the missing variables, or use `DATABASE_URL` |
| `DB_SSL=verify-full requires DB_SSL_CA_FILE` | Certificate verification without a CA bundle | Point `DB_SSL_CA_FILE` at the RDS CA bundle, or use `DB_SSL=require` |
| `migration failed; refusing to start` | A migration errored during `MIGRATE_ON_BOOT` | Read the error (it names the file), fix forward with a new migration |
| `<file> changed after it was applied; add a new migration instead` | An applied migration file was edited | Restore the original file; put the change in a new `NNNN_*.sql` |
| `KMS_MODE must be "aws" or "local"` | Unrecognised `KMS_MODE` | Use `aws` or `local` |
| `Refusing to seed demo data with NODE_ENV=production.` | The demo seed never runs in production | Seed a non-production environment |

## Storage

| Symptom | Cause | Fix |
| --- | --- | --- |
| Boot log: `FILE STORAGE NOT USABLE: s3://... unreachable: AccessDenied` | The task role or credentials lack bucket permissions | Grant `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on objects and `s3:ListBucket` on the bucket |
| `... PermanentRedirect, wrong region for this bucket` | `S3_REGION` or `AWS_REGION` differs from the bucket's region | Set `S3_REGION` to the bucket's region |
| `... NotFound` or `NoSuchBucket` | The bucket does not exist | Create it, or fix `S3_BUCKET` |
| `404 Payslip PDF missing in storage` for older documents | Files were written with `STORAGE=local` inside a container and lost on redeploy | Use S3; regenerate the affected documents |
| Upload refused with a 400 | The file exceeds the route's upload limit (between 10 and 25 MB depending on the route) | Upload a smaller file |

## Sign-in and sessions

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401 Invalid email or password` | Wrong credentials (the same answer is given for an unknown email) | Use forgot-password |
| `403 Too many failed attempts. This account is temporarily locked...` | 5 failed password or 2FA attempts | Wait 15 minutes; a successful sign-in resets the counter |
| `429 Too many attempts. Please try again later.` | Per-IP limit on `/api/auth`, `/api/signup` or `/api/platform/auth` (`AUTH_RATE_MAX` per 15 min, default 300) | Wait for the window; behind a proxy, check `TRUST_PROXY` so the real client IP is used |
| `403 Please verify your email / accept your invitation before signing in.` | The user is still `INVITED` | Open the verification or invitation email (Mailpit locally); resend from Users |
| `403 This account has been disabled.` | The user was disabled, or the access-revocation sweep disabled them after their exit | Re-enable under Users if the exit was recorded in error |
| `401 Session expired, please sign in again` on a recent token | `credentialsChangedAt` moved: the password was changed or reset, "sign out everywhere" was used, or the account was disabled. Or `JWT_SECRET` was rotated | Sign in again |
| `401 Two-factor verification required` | A 2FA challenge token was used as a session | Complete `/api/auth/login/mfa` |
| `Two-factor session expired; please sign in again` | The 5-minute challenge expired | Start again from the password step |
| `Invalid authentication code` | Wrong TOTP code, or the device clock is off by more than about 30 s | Sync the device clock |
| 2FA asked again on a trusted device | Trust tokens last 30 days and are revoked by re-enrolling 2FA or a password reset | Expected |

## Workspaces

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every request returns `403` with `"code": "WORKSPACE_SUSPENDED"` | An operator suspended (or cancelled) the workspace; it is checked on every request | An operator reactivates it in the console; existing unexpired sessions then work again |
| `403 This workspace is suspended. Contact support.` at sign-in | As above | As above |
| `Suspend the workspace before deleting it.` | Deletion requires a suspended workspace | Suspend first |
| `Type the workspace name exactly to confirm: "<name>"` | The confirmation did not match | Type the exact name |
| `This action requires a full Operator role.` | A `SUPPORT` operator tried a destructive action | An `OPERATOR` performs it |
| `This workspace has no admin to impersonate` | No active user with role `ADMIN` | Use admin reset or create an admin |
| Log: `access revocation skipped: this is the workspace's only administrator` | The only admin has a completed separation or a past last working day | Correct the separation, or make another user an admin first |

## Browser and CORS

| Symptom | Cause | Fix |
| --- | --- | --- |
| API answers `403` with `"code": "CORS_ORIGIN_DENIED"`; the browser reports a CORS failure | The page's origin is not in `CORS_ORIGINS`. Origins match exactly: scheme, host and port, and `localhost` differs from `127.0.0.1` | Add the exact origin. The local Compose file already lists both `localhost` and `127.0.0.1` for the web and console ports |
| The web app calls the wrong API | `API_URL` on the web or console container | Check `/env.js` on the app; it shows the runtime values |
| A 500 response with `{"error": "Server error", "requestId": "..."}` | An unexpected error; its message is never returned to clients | Search the API log for the `requestId` |

## Mail

| Symptom | Cause | Fix |
| --- | --- | --- |
| No email arrives, and the API logs `[mail:outbox] -> ...` | `MAIL_MODE=outbox` writes `.eml` files to `DATA_DIR/outbox` | Use `ses` or `smtp`; locally use `make up`, which sends through SES on the emulator to Mailpit |
| API log `email send failed` | The provider rejected the message (unverified sender, sandbox recipient, outage). The user action still succeeded | Read the logged error; verify `MAIL_FROM`'s identity; request SES production access |
| Locally, nothing in Mailpit | The API is not on the emulator overlay, or the message failed | `make logs SERVICE=api`; check <http://localhost:8025> |
| SES sandbox: only some recipients receive mail | New SES accounts can send only to verified addresses | Request production access for the region |

## Sending domains

| Symptom | Cause | Fix |
| --- | --- | --- |
| Status stays `PENDING` | Records not published yet, published with extra quotes, or SES has not re-checked | Publish exactly the values shown (unquoted in your DNS manager), wait 5 to 60 minutes on AWS, click Check again |
| Status `FAILED`: `DNS records have been missing or incorrect for over 24 hours.` | SES reports DKIM or MAIL FROM failed and the domain is over a day old | Fix the records and Check; the status returns to `VERIFIED` when SES reports success |
| Status `REGION_MISMATCH` | `SES_REGION` or `AWS_REGION` changed after the records were issued; the MX record names the old region | Re-provision, publish the new records, Check |
| `409 EMAIL_DOMAIN_TAKEN: That sending domain is already in use by another workspace.` | One domain belongs to one workspace | Remove it from the other workspace first |
| `409 EMAIL_DOMAIN_TAKEN: That domain is the platform's own sending domain.` | The `MAIL_FROM` domain is reserved | Use a different domain or subdomain |
| `This workspace already has a sending domain. Remove it first to add another.` | One domain per workspace | Remove the current domain |
| `Verify the domain before setting a From address` / `The From address must be on @<domain>` | Sender rules | Verify first; use an address on the verified domain |
| Domain verified but mail still comes from the platform address | No From address on the domain (`NO_FROM_ADDRESS`); a From address is adopted automatically only when a check first verifies the domain | Set the From address in the From address card |
| On the emulator, the domain never verifies | The emulator verifies only after the DKIM records exist in its Route53 | Publish them in the emulator ([sending-domains.md](sending-domains.md#trying-it-on-the-emulator)); it then settles within seconds |

## Background jobs

| Symptom | Cause | Fix |
| --- | --- | --- |
| Log: `queued jobs have no handler in this worker; another replica must own them, or a deploy is missing` | Jobs of a type no running version can handle: a rolling deploy in progress, or, on a shared development database, jobs enqueued by another developer's build | Wait for the rollout; on shared databases expect other processes to claim your jobs |
| Log: `reaped stuck RUNNING jobs` | A task died mid-job | Jobs within their retry budget were requeued; inspect `FAILED` ones |
| Jobs end `FAILED` with `last_error` set | The handler failed `max_attempts` times (default 3) | Read `last_error` in the `jobs` table; fix the cause and re-trigger the action |
| Reminders or the access sweep run on one task only | Expected: sweeps are leader-elected with advisory locks | n/a |

## Local development and tests

| Symptom | Cause | Fix |
| --- | --- | --- |
| `bind: address already in use` on `make up` | Another process holds one of the host ports | Override `HRMS_WEB_PORT`, `HRMS_CONSOLE_PORT`, `HRMS_API_PORT`, `HRMS_PG_PORT`, `HRMS_MAILPIT_PORT`, `HRMS_SMTP_PORT`, `HRMS_FLOCI_PORT` in `deploy/compose/.env` |
| Tests cannot connect after you changed `HRMS_PG_PORT` | `make test-integration` and `make test-matrix` read the port from your shell, not from `.env` | `export HRMS_PG_PORT=<port>` before running them |
| `Refusing to run integration tests against "<db>": the database name must contain "test"` | The integration suite truncates every table, so it only accepts disposable databases | Use `make test-integration`, which targets `hrms_test` |
| `Refusing to run integration tests against remote host` | The test database is not local | Use a local database, or set `ALLOW_REMOTE_TEST_DB=true` deliberately |
| `The Floci stack is not running: make up` | `make test-matrix` needs the emulator | `make up` first |
| `No demo password: run make env && make demo, or set DEMO_PASSWORD` | The browser tests need the demo password | `make up demo`, or export `DEMO_PASSWORD` |
| `[demo] The database already has workspaces. Use --reset to wipe and re-seed.` | The seed only fills an empty database | `make down && make up && make demo` |
