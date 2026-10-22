# Full CI pipeline (opt-in)

These workflows are the complete quality pipeline for Euron Open HRMS. They are kept
here, outside `.github/workflows/`, so they do **not** run on the upstream repository.
Only the fast [`checks`](../workflows/checks.yml) workflow (lint, typecheck, unit tests)
runs there.

| Workflow | What it runs |
| --- | --- |
| [`ci.yml`](ci.yml) | Lint, typecheck, unit tests, build, sanitization check, API integration tests on Postgres 16 |
| [`security.yml`](security.yml) | gitleaks, CodeQL (JavaScript/TypeScript), `pnpm audit` |
| [`terraform.yml`](terraform.yml) | `terraform fmt` and `validate` for every environment, tflint, checkov |
| [`docker.yml`](docker.yml) | Multi-arch image builds for api, web and console |
| [`e2e.yml`](e2e.yml) | The full stack on the local AWS emulator: the integration suite under every storage, mail and key backend, then the browser tests |

To enable them in your fork, move them into `.github/workflows/`:

```bash
git mv .github/workflows-full/*.yml .github/workflows/
```

Every gate is also runnable locally:
`make lint typecheck test test-integration test-matrix e2e tf-validate tf-lint tf-security sanitize`.
