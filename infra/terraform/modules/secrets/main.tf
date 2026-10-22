# Application signing secrets, generated once and stored in Secrets Manager. ECS
# injects each JSON key into the API container as an environment variable; the
# values never appear in a task definition, a Terraform plan or a log.
#
# The three are distinct on purpose (the API refuses to boot if two are equal):
# tenant sessions, operator sessions and document-verification QR codes can each be
# rotated without touching the others.
resource "random_password" "this" {
  for_each = toset(["JWT_SECRET", "PLATFORM_JWT_SECRET", "DOC_VERIFY_SECRET"])
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV2_AWS_57:These are HMAC signing keys; rotation is an operator procedure (docs/guides/operations.md), not a Lambda.
  name                    = "${var.name_prefix}/app"
  description             = "API signing secrets (tenant JWT, operator JWT, document verification)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({ for k, v in random_password.this : k => v.result })

  # Rotation happens out of band (put a new version by hand or by pipeline). Without
  # this, the next `terraform apply` would quietly roll every secret back.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
