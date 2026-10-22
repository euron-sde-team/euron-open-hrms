# Testing

Euron Open HRMS has five layers of automated checks. Each one proves something different;
this page says what, and how to run it.

| Layer | Command | Needs | Proves |
| --- | --- | --- | --- |
| Static checks | `make lint typecheck` | Node 22, pnpm | Code style and types across every package |
| Unit tests | `make test` | Node 22, pnpm | Pure logic: payroll, leave, onboarding, security primitives, front-end helpers |
| Integration tests | `make test-integration` | Docker (a disposable Postgres) | The real API in-process against a real database |
| Option matrix | `make test-matrix` | The local stack (`make up`) | The integration suite under all 12 storage, mail and key backends |
| Browser end-to-end | `make e2e` | The local stack, Playwright Chromium | User journeys through the real web app, console, API, emulator and mail |
| Infrastructure | `make tf-validate tf-lint tf-security sanitize` | Docker (or local tools) | Terraform validity, lint, policy, and no secrets in the tree |

Install dependencies once:

```bash
corepack enable
pnpm install
```

## Unit tests

```bash
make test        # = pnpm test, every package through Turborepo
```

No database and no network. API unit tests live in `apps/api/test/unit`:

| Suite | Covers |
| --- | --- |
| `engine.test.ts` | The gross-to-net engine and the country pack registry |
| `payroll-india.test.ts` | Per-state professional tax and statutory gratuity |
| `salary-structure.test.ts`, `ctc-convention.test.ts` | CTC to monthly breakup, both CTC conventions |
| `exit-pay.test.ts`, `payslip-input.test.ts` | Proration for joining and leaving months; preview and commit input assembly |
| `import-roundtrip.test.ts` | The employee import template and parser agree |
| `leave-holidays.test.ts` | The holiday calendar and leave entitlements |
| `onboarding.test.ts` | The onboarding template and case engine, with emphasis on what must not happen (a template field writing to compensation, an update wiping an identifier) |
| `verification.test.ts` | Document verification: digest canonicalisation, signing, tamper cases, disclosure |
| `document-extract.test.ts` | AI extraction: Aadhaar Verhoeff checksum, field specs, guards (disabled, excluded types, size), a provider round trip against a local stub |
| `security.test.ts` | PII envelopes (round trip, fresh IVs, refusal of moved, tampered or wrong-key ciphertext), the tenant scoping registry, every production boot guard, session audience and suspension codes, log redaction of onboarding tokens, AWS client settings |
| `hardening.test.ts` | CSV formula-injection defence, workspace-local dates for reminders, name rendering |
| `core.test.ts` | RBAC, validation, repository serialisation, TOTP, sending-domain DNS records, sender resolution, last-admin guards, identity, leave rules, local storage and the outbox mailer |

The front ends and packages have their own unit tests (`apps/web/test`, `apps/console/test`,
`packages/*/test`): runtime configuration (`/env.js`), the impersonation hand-off, the API
client and downloads, navigation and permission helpers, and the UI components.

## Integration tests

```bash
make test-integration
```

This starts the Compose Postgres if needed (`scripts/test-db.sh`) and runs
`pnpm test:integration` with `TEST_DATABASE_URL=postgres://hrms:hrms@localhost:5442/hrms_test`.
The global setup creates and migrates `hrms_test`; the suite never touches `hrms`. A guard
refuses any database whose name does not contain `test`, or a non-local host (unless
`ALLOW_REMOTE_TEST_DB=true`), because the tests truncate every table. Files share the
database, so they run one at a time, each seeding its own state.

By default the suite runs with `STORAGE=local`, `MAIL_MODE=outbox` and `KMS_MODE=local`, so
it needs nothing but Postgres.

| Suite | Proves |
| --- | --- |
| `api.int.test.ts` | The HTTP API end to end: the main endpoints of every area |
| `security.int.test.ts` | 2FA enrolment and challenge flow; lockout of both factors after 5 misses; suspension takes effect on the next request with the same token and reactivation restores it; tenant and operator tokens are rejected on each other's plane; `SUPPORT` cannot suspend; CORS allowlist (403, not 500); malformed JSON is a 400; security headers; identity numbers are ciphertext in Postgres and plaintext to an authorised reader; one wrapped data key per workspace; purge destroys the key |
| `isolation.int.test.ts` | The tenant isolation sweep: every parameterised route on every authenticated tenant router, called by another workspace's admin with this workspace's ids (over 1000 requests), leaks nothing and changes nothing. See [multi-tenancy.md](../architecture/multi-tenancy.md#the-isolation-sweep) |
| `hardening.int.test.ts` | Regressions from the hardening pass: requests without a body, letter scope, audit attribution, CSV export defanging, separation edge cases |
| `hr-operations.int.test.ts` | Documents, holidays, leave, payroll, employee lifecycle, and authorisation across them |
| `identity.int.test.ts` | Login email uniqueness rules |
| `import.int.test.ts`, `import-routes.int.test.ts` | Bulk employee import: template, dry-run preview of a messy sheet, commit, authorisation, route reachability |
| `onboarding-case.int.test.ts` | One onboarding case from opening to commit: filling in, documents, assets, policies, submit, HR review, template edit safety |
| `onboarding-prehire.int.test.ts` | Pre-hire onboarding through the public link, across several sittings, with the employee created only on approval, idempotently |
| `onboarding-campaign.int.test.ts` | Campaign audience preview, launch, fan-out through the queue, the request email, status, the deadline sweep, escalation, cancel |
| `sending-domains.int.test.ts` | The full workspace sending-domain lifecycle through SES. Runs only with `MAIL_MODE=ses` and an emulator endpoint (the matrix); see [sending-domains.md](sending-domains.md#how-it-is-tested) |

Queue-driven behaviour is tested by asserting the job was enqueued and then running its
handler directly, because on a shared database any running API could claim the job first.

## Option matrix

```bash
make up
make test-matrix
```

`scripts/test-matrix.sh` runs the whole integration suite once per combination:

| Dimension | Values |
| --- | --- |
| `STORAGE` | `local` (disk), `s3` (S3 on the emulator, bucket `hrms-local-documents`) |
| `MAIL_MODE` | `outbox` (`.eml` files), `smtp` (Mailpit on `localhost:1025`), `ses` (SES on the emulator, relayed to Mailpit) |
| `KMS_MODE` | `local` (a fresh random `PII_MASTER_KEY` per run), `aws` (KMS on the emulator, `alias/hrms-local`) |

That is 2 x 3 x 2 = 12 runs. It prints one line per combination and exits non-zero if any
failed, ending with `All 12 combinations passed.` on success. The `ses` rows also run the
sending-domain suite, which verifies a real SES identity on the emulator and reads delivered
mail back from Mailpit.

What it proves: every backend a deployment can choose behaves the same through the whole API,
including encryption of personal data under both key schemes and document storage in both
places.

## Browser end-to-end tests

```bash
pnpm exec playwright install --with-deps chromium   # once
make e2e                                            # = make up demo, then pnpm e2e
```

Playwright drives Chromium against the running local stack, one worker, in file order,
because the suites share the demo database. Set `E2E_HEADED=1` to watch. Reports go to
`e2e/playwright-report`.

| Spec | Journey |
| --- | --- |
| `01-auth.spec.ts` | A signed-out visitor is sent to sign-in; a wrong password shows a message; an admin lands on the dashboard with the HR navigation; an employee sees their own balances and no staff settings |
| `02-signup.spec.ts` | A company signs up, verifies its email (read from Mailpit) and gets a provisioned workspace |
| `03-documents.spec.ts` | A generated payslip verifies publicly from its code |
| `04-onboarding.spec.ts` | A candidate opens the emailed onboarding link and sees their form |
| `05-operator.spec.ts` | The operator sees the fleet; suspending a workspace locks its signed-in users out immediately and reactivating restores them |
| `06-impersonation.spec.ts` | An operator impersonates into a workspace and the web app shows the support banner |

What it proves: the front ends, the API, Postgres, S3, KMS and SES on the emulator, and mail
delivery work together as a user experiences them.

## Infrastructure checks

```bash
make tf-fmt        # terraform fmt -recursive
make tf-validate   # init -backend=false + validate for local-floci, aws-dev, aws-prod (no credentials)
make tf-lint       # tflint over every module and environment
make tf-security   # checkov policy scan
make sanitize      # scan committable files for credentials and cloud identifiers
```

`make tf-validate` uses a local `terraform` when installed, otherwise the pinned
`hashicorp/terraform` image. `tf-lint` and `tf-security` run in containers. Checkov
exceptions are written inline next to the resource with the reason (for example, Multi-AZ and
deletion protection are inputs that `aws-prod` enables). `make up` itself applies the
production modules to the emulator on every start, which is the most frequent infrastructure
test of all.

`make sanitize` scans exactly the files git would commit (tracked plus untracked but not
ignored) for credentials, private keys, real account or resource identifiers and committed
environment files.

## Continuous integration

The repository runs `.github/workflows/checks.yml` on pushes to `main` and on pull requests:
lint, typecheck and unit tests. The full pipeline is in `.github/workflows-full/` and is not
active upstream; enable it in a fork by moving the files into `.github/workflows/`:

| Workflow | Runs |
| --- | --- |
| `ci.yml` | Lint, typecheck, unit tests, build, the sanitization check, integration tests on Postgres 16 |
| `security.yml` | gitleaks, CodeQL, `pnpm audit` |
| `terraform.yml` | `fmt` and `validate` for every environment, tflint, checkov |
| `docker.yml` | Multi-architecture image builds for api, web and console |
| `e2e.yml` | The stack on the emulator, the option matrix, then the browser tests |
