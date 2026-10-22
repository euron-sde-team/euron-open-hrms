output "secret_arn" {
  description = "ARN of the JSON secret holding JWT_SECRET, PLATFORM_JWT_SECRET and DOC_VERIFY_SECRET."
  value       = aws_secretsmanager_secret.app.arn
}

output "keys" {
  description = "JSON keys inside the secret, for ECS `secrets` valueFrom references."
  value       = sort(keys(random_password.this))
}
