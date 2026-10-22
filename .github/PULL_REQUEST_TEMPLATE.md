## What and why

<!-- One paragraph: the problem, and how this change solves it. Link the issue. -->

## How it was verified

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] `pnpm test:integration` (if API, database, queue or mail code changed)
- [ ] `pnpm e2e` (if a user flow, the console or infrastructure changed)
- [ ] `make tf-validate` (if Terraform changed)

## Checklist

- [ ] Docs updated (README, `docs/`, configuration reference) for any behavior or config change
- [ ] New migration instead of editing an applied one
- [ ] Every new tenant table is registered as tenant-scoped in `apps/api/src/repo.ts`
- [ ] No secrets, account IDs or real hostnames (`make sanitize` is clean)
- [ ] Security-relevant change? Described the threat and mitigation above
