# ADR 0008: Layered API: routes, controllers, services, repositories

## Status

Accepted. The route modules are being moved onto this structure; `apps/api/README.md`
names the reference implementation.

## Context

The API grew as route files that parsed requests, applied business rules and built queries
in one place. That made the rules hard to unit-test without HTTP, made the same rule easy
to implement twice in two routes, and left tenant scoping and personal-data sealing as
something each handler had to remember. Background jobs and the CLI also need the same
business operations without a request object.

## Decision

Requests flow through four layers. Each layer calls only the one below it.

| Layer | Folder | Does | Must not |
| --- | --- | --- | --- |
| Routes | `routes/` | Declare URLs and guards (`authRequired`, `staffOnly`, `requirePermission`) | Contain logic |
| Controllers | `controllers/` | Read params, body and query; call one service function; write the response | Apply business rules or touch the database |
| Services | `services/` | Business rules and orchestration; take a `RequestContext` and plain inputs, return plain data, throw `HttpError` | See Express `req` or `res`, or build SQL |
| Repositories | `repositories/` | Read and write one collection; add domain queries (`findByEmail`, `countActiveInDepartment`) | Be bypassed |

Beside them, `domain/` holds pure business rules with no I/O (payroll engine, leave rules,
onboarding templates, letter tokens), `integrations/` talks to the outside world, and
`security/` holds RBAC, TOTP, tokens, verification and PII encryption.

The `RequestContext` (`core/context.ts`) carries the workspace id, the user, `can(code)`,
`inScope(employee)`, the impersonator id, and `data`: one repository per collection,
already scoped to the workspace. Jobs and the CLI build the same context with
`systemContext(orgId)`. Multi-step writes use `ctx.data.transaction(async (tx) => ...)`.

## Consequences

Positive:

- Tenant scoping and field sealing live in exactly one layer, so services cannot forget
  them ([ADR 0002](0002-jwt-tenant-resolution-and-scoped-repository.md),
  [ADR 0005](0005-pii-envelope-encryption.md)).
- Services and domain rules are callable from routes, jobs, the CLI and tests alike.
- Domain rules (payroll, leave) are unit-tested without a database.
- Route files read as an inventory of endpoints and guards, which is also what the
  isolation sweep parses.

Trade-offs:

- More files per feature, and some controllers are only a few lines.
- During the migration both shapes coexist, so contributors must follow the reference
  implementation rather than the nearest old route file.
- Shared helpers that still take a raw store (`ctx.repos`) are a transitional escape hatch.

## Alternatives considered

- **Fat route handlers.** Fewest files, but untestable rules and per-handler scoping.
- **Active record models.** Convenient, but spreads persistence across the codebase and
  makes the single scoping point harder to guarantee.
- **A full ORM with its own unit of work.** More machinery than the hot-column model needs;
  Kysely keeps queries explicit and typed.
