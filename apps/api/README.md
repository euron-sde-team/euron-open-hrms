# @open-hrms/api

The HRMS API: the tenant plane (`/api/*`), the operator plane (`/api/platform/*`) and the
background job worker, in one Express service.

## Layers

Requests flow through four layers. Each one has a single job, and calls only the layer
below it.

```
HTTP ──▶ routes/        URL + guards. No logic.
          │
          ▼
        controllers/    Read params/body/query, call ONE service function, write the response.
          │             The only layer that sees Express's req/res.
          ▼
        services/       Business rules and orchestration. Takes a RequestContext and plain
          │             inputs, returns plain data, throws HttpError for rule violations.
          ▼
        repositories/   The only code that reads or writes the database. Tenant scoping and
                        personal-data sealing happen here, so no caller can forget them.
```

Beside them:

| Folder | Holds | Rule |
| --- | --- | --- |
| `domain/` | Pure business rules: payroll engine and country packs, leave rules, onboarding templates, letter tokens, holiday calendars | No I/O. Plain inputs, plain outputs, unit-tested in isolation |
| `integrations/` | Mail (SES, SMTP, outbox), per-workspace SES sending domains, S3 storage, web push, AI document extraction | Talk to the outside world; services call them |
| `security/` | RBAC, TOTP, sign-in tokens, document verification, PII envelope encryption | |
| `middleware/` | `authRequired`, `requirePermission`, `staffOnly`, operator-plane auth | |
| `core/` | Config and boot guards, errors (`HttpError`), logging, validation, request context | |
| `jobs/` | The Postgres job queue, its handlers, leader-elected sweeps and reminders | |
| `pdf/` | Payslip, letter and signature rendering | |
| `db/` | Kysely connection, generated types, rotation-safe connection config | |
| `demo/` | The demo seed (refuses to run in production) | |

## Conventions

**Routes** (`routes/<domain>.routes.ts`) list endpoints and guards, nothing else:

```ts
router.get("/", wrap(ctrl.list));
router.post("/", staffOnly, wrap(ctrl.create));
```

**Controllers** (`controllers/<domain>.controller.ts`) are a few lines per endpoint:

```ts
export const create = async (req, res) => {
  res.status(201).json(await departments.createDepartment(contextFrom(req), req.body || {}));
};
```

**Services** (`services/<domain>.service.ts`) export named functions taking a
`RequestContext` first. `ctx.data` holds one repository per collection, already scoped to the
caller's workspace; `ctx.can()` and `ctx.inScope()` answer permission and department/office
scope questions. Wrap multi-step writes in `ctx.data.transaction(async (tx) => ...)`.

**Repositories** (`repositories/<entity>.repository.ts`) extend `Repository` and add the
queries their domain needs (`findByName`, `countActiveInDepartment`). Services never build
SQL or reach past a repository.

The reference implementation is departments: `routes/departments.routes.ts` →
`controllers/department.controller.ts` → `services/department.service.ts` →
`repositories/department.repository.ts`.

## Commands

```bash
pnpm dev                 # tsx watch on src/index.ts
pnpm build               # esbuild bundles: dist/index.js, dist/migrate.js, dist/cli.js
pnpm test                # unit tests (no database)
pnpm demo:seed           # demo workspaces (DEMO_PASSWORD to choose the password)
pnpm operator:create --email you@example.com
```

Integration tests run from the repository root: `make test-integration`, or
`make test-matrix` for every storage, mail and key backend.
