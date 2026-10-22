# Contributing

Thanks for helping improve Euron Open HRMS. This guide covers the workflow, the bar a
change has to clear, and the conventions the codebase follows.

## Ground rules

- **Open an issue first** for anything larger than a bug fix or a docs tweak, so we can
  agree on the approach before you invest time.
- **One concern per pull request.** A refactor and a feature are two PRs.
- **Security issues go through private reporting**, never a public issue. See
  [SECURITY.md](SECURITY.md).
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Development setup

Requirements: Docker, Node 22+, pnpm 9 (`corepack enable`).

```bash
pnpm install
make up          # Postgres, the AWS emulator (provisioned by Terraform), Mailpit, api, web, console
make demo        # two demo workspaces and an operator account
make test        # unit tests across every package
```

[docs/guides/quickstart-local.md](docs/guides/quickstart-local.md) walks through the local
stack in detail.

## Before you open a pull request

Each of these must pass:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
make test-integration            # API against a real Postgres
make e2e                         # when you touched a user flow, the console or infrastructure
make tf-validate tf-lint tf-security   # when you touched infra/terraform
scripts/check-sanitization.sh    # no credentials, account ids or resource ids
```

## Conventions

**Layers (api).** Routes declare endpoints and guards; controllers read the request and
write the response; services hold the business rules; repositories are the only code that
touches the database. [apps/api/README.md](apps/api/README.md) has the rules and the
reference implementation.

**Tenant isolation is structural.** Every collection is registered in
`apps/api/src/repositories/base.repository.ts` with `tenant: true` (or deliberately not), and
every read and write goes through a repository scoped to the caller's workspace. A new
tenant table that is not registered fails the unit tests, and every new parameterised
route is covered by the isolation sweep automatically.

**Personal data is sealed at rest.** A new field holding identity numbers, bank details or
similar belongs in `ENCRYPTED_FIELDS` (`apps/api/src/security/pii.ts`).

**Configuration is validated.** A new environment variable is documented in
[docs/guides/configuration.md](docs/guides/configuration.md) in the same PR, and
security-relevant ones are enforced at boot in `apps/api/src/core/config.ts`.

**Database changes are new migrations.** Add `db/migrations/NNNN_description.sql` and update
`apps/api/src/db/types.ts`. Never edit an applied migration: the runner refuses to start
when a checksum changes.

**Comments explain why.** The code says what it does. Comments are for the constraint, the
incident, or the trade-off that made it this way.

**Style.** Prettier and ESLint settle formatting. TypeScript strict mode everywhere.

## Commit messages

Imperative mood with an optional scope: `payroll: cap ESI at the wage ceiling`,
`web: show the suspended-workspace screen`. Explain the *why* in the body when it is not
obvious.

## Architecture decisions

A change that alters a documented decision (tenancy, encryption, queue, deployment
topology, layering) needs a new ADR in [docs/architecture/adr/](docs/architecture/adr/),
using the existing ones as a template.
