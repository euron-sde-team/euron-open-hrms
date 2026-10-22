output "key_arn" {
  description = "KMS key ARN."
  value       = aws_kms_key.this.arn
}

output "key_id" {
  description = "KMS key id."
  value       = aws_kms_key.this.key_id
}

output "alias_name" {
  description = "Alias, usable as KMS_KEY_ID."
  value       = aws_kms_alias.this.name
}
