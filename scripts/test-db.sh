#!/usr/bin/env bash
# Make sure a disposable Postgres is reachable for the integration tests. Uses the
# compose Postgres (started on its own if the stack is down); the test suite creates and
# migrates its own `hrms_test` database inside it and never touches `hrms`.
set -euo pipefail
cd "$(dirname "$0")/.."
compose=(docker compose --env-file deploy/compose/.env -f deploy/compose/compose.yaml)
[[ -f deploy/compose/.env ]] || scripts/gen-local-env.sh >/dev/null
"${compose[@]}" up -d --wait postgres >/dev/null
