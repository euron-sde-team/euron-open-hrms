# ADR 0004: The operator plane lives in the same API, behind a separate identity plane

## Status

Accepted.

## Context

The people who run a deployment need fleet tools: list workspaces with headline metrics,
create a workspace, suspend and reactivate one, impersonate a workspace admin for support,
send an admin a password reset, export or permanently delete a workspace, manage operator
accounts. These operations touch the same tables and domain code as the tenant API
(provisioning, starter content, the purge, the mailer).

Operator credentials are the most powerful credentials in the system, so whatever the
packaging, an operator session must never be obtainable from a tenant session, and the
reverse.

## Decision

Serve the operator plane from the same Express application under `/api/platform`, with an
identity plane that shares nothing with the tenant plane:

| | Tenant | Operator |
| --- | --- | --- |
| Accounts | `users` | `platform_admins` |
| Secret | `JWT_SECRET` | `PLATFORM_JWT_SECRET` (boot refuses equal values) |
| Audience | `tenant` | `platform` |
| Lifetime | 7 days (configurable) | 12 hours |
| Middleware | `authRequired` | `platformAuthRequired` |
| Data access | Repositories scoped to one workspace | System repositories, target workspace named explicitly |

Within the plane, `OPERATOR` holds every capability and `SUPPORT` is read-mostly;
destructive routes require `OPERATOR`. Operator actions are audited, and the console is a
separate front-end app with its own token store.

## Consequences

Positive:

- One image, one deployment, one set of migrations; operator features reuse tenant domain
  code instead of duplicating it.
- Cross-plane token use is impossible by construction and is tested in both directions.
- Impersonation is a first-class, audited feature rather than a database edit.

Trade-offs:

- The operator API is reachable on the public API hostname. Protection is cryptographic
  (separate secret and audience), plus TOTP, the credential rate limiter and roles, not
  network isolation. Deployments that want network isolation can add a WAF rule or a
  load-balancer condition for `/api/platform*`; the modules do not do this.
- A vulnerability in shared middleware or dependencies affects both planes.
- Operator 2FA is available but not enforced, and there is no per-account lockout for
  operators (see [threat-model.md](../threat-model.md)).

## Alternatives considered

- **A separate operator service with its own database credentials.** Stronger isolation
  and an independent attack surface, but duplicates provisioning and purge logic or forces
  a shared library plus a second deployment.
- **Operators as a special tenant role.** Simplest to build, but merges the most powerful
  credential into the tenant plane, so any tenant-plane privilege escalation would reach
  every workspace.
- **No operator UI; database and CLI only.** Avoids an attack surface, but pushes support
  work into ad-hoc SQL with no audit trail.
