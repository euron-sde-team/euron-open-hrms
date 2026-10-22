variable "name_prefix" {
  description = "Prefix for every resource name, e.g. \"hrms-prod\"."
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR. Split into /20 public subnets (low half) and /20 private subnets (high half)."
  type        = string
  default     = "10.40.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to span (2 or 3)."
  type        = number
  default     = 3
  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3."
  }
}

variable "single_nat_gateway" {
  description = "One shared NAT gateway (cheaper, dev) instead of one per AZ (resilient, prod)."
  type        = bool
  default     = true
}

variable "logs_kms_key_arn" {
  description = "CMK that encrypts the flow-log group (its key policy must allow CloudWatch Logs). Null uses CloudWatch's default encryption."
  type        = string
  default     = null
}

variable "flow_log_retention_days" {
  description = "Retention for VPC flow logs (REJECT + ACCEPT) in CloudWatch Logs. 0 disables flow logs."
  type        = number
  default     = 30
}

variable "enable_interface_endpoints" {
  description = "Create KMS and Secrets Manager interface endpoints so those calls never leave the VPC."
  type        = bool
  default     = true
}
