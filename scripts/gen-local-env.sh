#!/usr/bin/env bash
# Write deploy/compose/.env with random, local-only secrets (once; never overwrites).
set -euo pipefail
f="$(cd "$(dirname "$0")/.." && pwd)/deploy/compose/.env"
if [[ -f "$f" ]]; then
  echo "deploy/compose/.env exists (delete it to regenerate)"
  exit 0
fi
rand() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$1"; }
umask 077
cat > "$f" <<ENV
HRMS_JWT_SECRET=$(rand 64)
HRMS_PLATFORM_JWT_SECRET=$(rand 64)
HRMS_DOC_VERIFY_SECRET=$(rand 64)
HRMS_DEMO_PASSWORD=Demo-$(rand 10)
ENV
echo "wrote deploy/compose/.env"
