output "documents_bucket" {
  description = "S3_BUCKET for the local stack."
  value       = module.storage.bucket_name
}

output "kms_key_alias" {
  description = "KMS_KEY_ID for the local stack."
  value       = module.kms.alias_name
}

output "mail_from" {
  description = "MAIL_FROM address registered in the emulator's SES."
  value       = module.email.from_address
}
