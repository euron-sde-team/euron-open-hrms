# Quickstart: run Euron Open HRMS locally

This guide starts the complete stack on your machine: the tenant web app, the operator
console, the API, PostgreSQL, a mail catcher, and an AWS emulator provisioned by the same
Terraform modules that build production. You do not need an AWS account.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Docker with Compose v2 | `make up` uses `docker compose ... up --wait` |
| GNU Make and `openssl` | `make env` generates local secrets with `openssl rand` |
| About 6 GB of free disk | For the images and volumes |
| Free host ports | 3410, 3420, 5005, 5442, 8025, 1025, 4576 (all bound to `127.0.0.1`; see [Port clashes](#port-clashes)) |
| Node 22 and pnpm 9 | Only to run tests or the apps outside Docker. The repository pins Node 22 in `.nvmrc` and `pnpm@9.15.0` in `package.json` |

To install pnpm through Corepack (ships with Node):

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install
```

## Start the stack

From the repository root:

```bash
make up
```

This does three things:

1. `make env` writes `deploy/compose/.env` with random, local-only secrets (once; it never
   overwrites an existing file).
2. Builds the `api`, `web` and `console` images and starts every service.
3. A one-shot `terraform` container applies `infra/terraform/envs/local-floci` to the
   emulator (documents bucket with SSE-KMS, the KMS key `alias/hrms-local`, secrets, a
   Route53 zone and the platform SES identity `open-hrms.test` with DKIM), then the API
   starts, applies database migrations and begins serving.

When it finishes it prints the URLs. Then seed demo data:

```bash
make demo
```

`make demo` creates two workspaces and an operator, and prints the logins and the shared
password. The password is `HRMS_DEMO_PASSWORD` from `deploy/compose/.env`:

```bash
grep HRMS_DEMO_PASSWORD deploy/compose/.env
```

## Sign in

| Who | Where | Email |
| --- | --- | --- |
| Acme Robotics admin (India workspace) | <http://localhost:3410> | `maya.kapoor@acme-robotics.example.com` |
| Acme HR | <http://localhost:3410> | `leela.krishnan@acme-robotics.example.com` |
| Acme manager | <http://localhost:3410> | `arjun.mehta@acme-robotics.example.com` |
| Acme employee | <http://localhost:3410> | `rohan.das@acme-robotics.example.com` |
| Globex Labs admin (US workspace) | <http://localhost:3410> | `elena.fischer@globex-labs.example.com` |
| Operator | <http://localhost:3420> | `operator@example.com` |

Every demo account uses the same password. The seed refuses to run when
`NODE_ENV=production`, and does nothing if workspaces already exist.

## What runs where

| Service | URL or port | What it is |
| --- | --- | --- |
| web | <http://localhost:3410> | Tenant app for HR, managers and employees |
| console | <http://localhost:3420> | Operator console |
| api | <http://localhost:5005> | API; `GET /up` for liveness, `GET /api/ready` for database readiness |
| mailpit | <http://localhost:8025> | Every email the stack sends (SMTP on 1025) |
| postgres | `localhost:5442` | PostgreSQL 16, database `hrms`, user and password `hrms` |
| floci | <http://localhost:4576> | AWS emulator: S3, KMS, Secrets Manager, Route53, SES |

The API runs with `NODE_ENV=development`. The production boot guards still run and print
warnings (the local stack uses an emulator endpoint and localhost links, both of which
production refuses on purpose).

Useful commands:

```bash
make ps                 # service status
make logs SERVICE=api   # tail one service (api, web, console, floci, terraform, ...)
```

## How mail works locally

The API sends with `MAIL_MODE=ses` through the emulator's SES API, exactly as it does on
AWS. The emulator relays every message it accepts to Mailpit over SMTP, so you read mail at
<http://localhost:8025>: sign-up verification, password resets, invitations, onboarding
links and payslip emails.

The platform sender is `no-reply@open-hrms.test`. Workspaces can add their own sending
domain under Settings; on the emulator a domain verifies only once its DKIM records exist in
the emulator's Route53, just as on AWS. See
[sending-domains.md](sending-domains.md#trying-it-on-the-emulator).

## Things to try

- Sign up a new company at <http://localhost:3410/signup>, then open the verification email
  in Mailpit.
- As the Acme admin, generate a payslip, download it, and check its code at
  `/verify/<code>`.
- As the operator, suspend a workspace in the console, and watch a signed-in user of that
  workspace get locked out on their next click; reactivate it and they continue.

## Stop and reset

```bash
make down
```

This stops every container and deletes the volumes: the database, the emulator's data and
the local Terraform state. The next `make up` starts from scratch. `deploy/compose/.env` is
kept; delete it if you want new secrets.

## Troubleshooting

### Port clashes

Every host port can be overridden in `deploy/compose/.env`:

```bash
cat >> deploy/compose/.env <<'EOF'
HRMS_WEB_PORT=3510
HRMS_CONSOLE_PORT=3520
HRMS_API_PORT=5105
HRMS_PG_PORT=5542
HRMS_MAILPIT_PORT=8125
HRMS_SMTP_PORT=1125
HRMS_FLOCI_PORT=4676
EOF
make down && make up
```

The API's `CORS_ORIGINS`, `APP_WEB_URL` and the front ends' `API_URL` are derived from
these variables in `compose.yaml`, so they stay consistent. The URLs `make up` prints, and
the ports the test targets use, read the same variable names from your shell environment,
not from the file; export them there too if you override them.

### Other problems

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `run make env first` from Compose | `deploy/compose/.env` is missing or incomplete | `make env` (or delete the file and run it again) |
| The API container restarts and its log ends with `Cannot reach PostgreSQL after retries` | Postgres did not become healthy | `make logs SERVICE=postgres` |
| The API never starts and `terraform` exited non-zero | Provisioning the emulator failed | `make logs SERVICE=terraform`, then `make down && make up` |
| `[demo] The database already has workspaces` | The seed only runs on an empty database | `make down && make up && make demo` |
| No email in Mailpit | Check the API log for `email send failed` | `make logs SERVICE=api` |

More in [troubleshooting.md](troubleshooting.md).

## Next steps

- Run the stack against real AWS resources: [local-with-aws.md](local-with-aws.md)
- Deploy to AWS: [deploy-aws.md](deploy-aws.md)
- Run the test suites: [testing.md](testing.md)
- Understand the system: [HLD.md](../architecture/HLD.md)
