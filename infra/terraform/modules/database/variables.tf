variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "vpc_id" {
  description = "VPC id."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the DB subnet group (2+ AZs)."
  type        = list(string)
}

variable "kms_key_arn" {
  description = "CMK for storage, Performance Insights and the master-password secret."
  type        = string
}

variable "database_name" {
  description = "Initial database name."
  type        = string
  default     = "hrms"
}

variable "master_username" {
  description = "Master user name. The password is generated and rotated by RDS in Secrets Manager."
  type        = string
  default     = "hrms_admin"
}

variable "engine_version" {
  description = "PostgreSQL major (or major.minor) version."
  type        = string
  default     = "16"
}

variable "instance_class" {
  description = "Instance class. Graviton (t4g/m7g/r7g) recommended."
  type        = string
  default     = "db.t4g.medium"
}

variable "allocated_storage" {
  description = "Initial gp3 storage in GiB."
  type        = number
  default     = 50
}

variable "max_allocated_storage" {
  description = "Storage autoscaling ceiling in GiB."
  type        = number
  default     = 500
}

variable "multi_az" {
  description = "Synchronous standby in a second AZ."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Automated backup retention."
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Block accidental deletion."
  type        = bool
  default     = true
}

variable "monitoring_interval" {
  description = "Enhanced Monitoring granularity in seconds (0 disables): 1, 5, 10, 15, 30 or 60."
  type        = number
  default     = 60
}

variable "skip_final_snapshot" {
  description = "Skip the final snapshot on destroy (throwaway envs only)."
  type        = bool
  default     = false
}
