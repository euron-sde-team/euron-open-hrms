output "address" {
  description = "DB hostname."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "DB port."
  value       = aws_db_instance.this.port
}

output "database_name" {
  description = "Database name."
  value       = aws_db_instance.this.db_name
}

output "instance_identifier" {
  description = "RDS instance identifier (CloudWatch dimension)."
  value       = aws_db_instance.this.identifier
}

output "master_user_secret_arn" {
  description = "Secrets Manager secret (JSON username/password) managed and rotated by RDS."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "security_group_id" {
  description = "DB security group; consumers add ingress rules against it."
  value       = aws_security_group.db.id
}

output "master_username" {
  description = "Master username. Stable across RDS-managed password rotation, so it is safe to pass as plain configuration."
  value       = aws_db_instance.this.username
}
