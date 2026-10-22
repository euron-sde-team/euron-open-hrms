# ADR 0002: Resolve the tenant from the user row, and scope every query in the repository

## Status

Accepted.

## Context

All workspaces share one database. A single forgotten `WHERE org_id = ...` in any query
would leak or corrupt another organisation's HR data, and with dozens of routers a
"remember the filter in every handler" rule does not hold up. The system also needs
administrative changes (suspending a workspace, disabling a user, changing a role,
"sign out everywhere") to take effect immediately, not when a token expires.

## Decision

1. **Tenant resolution.** Tenant sessions are JWTs (`aud: "tenant"`) carrying the user id.
   On every request `authRequired` verifies the token, reloads the user row, rejects tokens
   issued before the user's `credentialsChangedAt`, rejects disabled users, reloads the
   workspace row, and answers `403 WORKSPACE_SUSPENDED` for suspended or cancelled
   workspaces. The workspace used for scoping is `user.orgId` from the row, never a value
   from the URL, a header, the body, or the token's own `orgId` claim.
2. **Scoped repository.** The request gets `repos({ orgId: user.orgId })`. Every store in it
   adds `org_id = $orgId` to every read, update and delete, and overwrites `org_id` on
   insert. A table registry marks each collection `tenant: true` or `false`.
3. **Explicit cross-workspace access.** Code that must cross workspaces (sign-in lookup,
   the operator plane, sweeps, seeding) uses `systemRepos()`, which is visibly different at
   the call site.
4. **Test the property, not examples.** An integration test sweeps every parameterised
   tenant route with another workspace's ids and asserts nothing leaks or changes; a unit
   test fails if a table with an `orgId` column is not registered as tenant-scoped.

## Consequences

Positive:

- Service code cannot express an unscoped tenant query; isolation is structural.
- Revocation is immediate for every administrative action.
- Permissions are resolved per request from the current role definitions, so role edits
  apply at once.

Trade-offs:

- Two primary-key lookups (user, workspace) on every authenticated request.
- Isolation is enforced in the application only. A bug inside the repository layer, or a
  direct query that bypasses it, is not caught by the database. Row-level security is on
  the roadmap as a second layer ([multi-tenancy.md](../multi-tenancy.md#why-there-is-no-row-level-security-yet)).
- A context without an `orgId` is unscoped. Request handlers cannot produce one, but code
  that builds contexts by hand must not either.
- JWT revocation relies on per-request reloads rather than a token deny-list; the token
  itself remains cryptographically valid until expiry.

## Alternatives considered

- **Workspace from the subdomain or a header.** Requires every request to prove membership
  anyway, and gives an attacker a parameter to tamper with.
- **Trusting the `orgId` claim in the token.** Saves one lookup, but a suspension or a
  user moved between workspaces would not take effect until expiry.
- **Database per tenant or schema per tenant.** Strong isolation, but multiplies
  migrations, connections and operational work by the number of workspaces, and makes the
  operator plane's fleet views expensive.
- **Postgres row-level security only.** Needs a per-request session variable on a pinned
  connection and bypass policies for every legitimate cross-workspace path; deferred, not
  rejected.
