#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The API integration suite under every runtime option:
#
#   STORAGE    local  | s3     documents on disk, or in S3 (emulated)
#   MAIL_MODE  outbox | smtp | ses   .eml files, SMTP to Mailpit, or SES (emulated,
#                                    relayed to Mailpit; also runs the sending-domain suite)
#   KMS_MODE   local  | aws    personal-data keys wrapped by a master key, or by KMS
#
# 2 x 3 x 2 = 12 runs against the Floci stack (`make up` first). Exits non-zero if any
# combination fails; prints a table either way.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PG_PORT="${HRMS_PG_PORT:-5442}"
FLOCI="http://localhost:${HRMS_FLOCI_PORT:-4576}"
export TEST_DATABASE_URL="postgres://hrms:hrms@localhost:${PG_PORT}/hrms_test"
export MAILPIT_URL="http://localhost:${HRMS_MAILPIT_PORT:-8025}"

curl -sf "$FLOCI/" >/dev/null || { echo "The Floci stack is not running: make up"; exit 1; }

results=()
failed=0
for storage in local s3; do
  for mail in outbox smtp ses; do
    for keys in local aws; do
      env_args=(STORAGE="$storage" MAIL_MODE="$mail" KMS_MODE="$keys" PII_MASTER_KEY="$(openssl rand -base64 32)")
      if [[ "$storage" == s3 || "$mail" == ses || "$keys" == aws ]]; then
        env_args+=(AWS_ENDPOINT_URL="$FLOCI" AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test)
      fi
      [[ "$storage" == s3 ]] && env_args+=(S3_BUCKET=hrms-local-documents)
      [[ "$keys" == aws ]] && env_args+=(KMS_KEY_ID=alias/hrms-local)
      [[ "$mail" == smtp ]] && env_args+=(SMTP_HOST=localhost SMTP_PORT="${HRMS_SMTP_PORT:-1025}" SMTP_SECURE=false)
      [[ "$mail" == ses ]] && env_args+=("MAIL_FROM=Euron Open HRMS <no-reply@open-hrms.test>" SES_CONFIGURATION_SET=hrms-local-mail)
      label="storage=$storage mail=$mail keys=$keys"
      printf "%-40s " "$label"
      out=$(env "${env_args[@]}" pnpm -s test:integration 2>&1)
      summary=$(echo "$out" | grep -E "^\s+Tests " | tail -1 | sed -E 's/^\s+//')
      if echo "$out" | grep -qE "Test Files .*failed|Tests .*failed|Error:"; then
        failed=1; echo "FAIL  $summary"
        echo "$out" | grep -E "FAIL|AssertionError" | head -10 | sed 's/^/      /'
      else
        echo "ok    $summary"
      fi
      results+=("$label|$summary")
    done
  done
done
echo
[[ $failed -eq 0 ]] && echo "All 12 combinations passed." || echo "Some combinations failed."
exit $failed
