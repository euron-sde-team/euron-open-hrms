output "bucket_name" {
  description = "Documents bucket name (S3_BUCKET)."
  value       = aws_s3_bucket.documents.bucket
}

output "bucket_arn" {
  description = "Documents bucket ARN, for IAM policies."
  value       = aws_s3_bucket.documents.arn
}
