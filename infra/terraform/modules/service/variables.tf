variable "name_prefix" {
  description = "Deployment prefix, e.g. \"hrms-prod\"."
  type        = string
}

variable "name" {
  description = "Application name: api, web, console or migrate."
  type        = string
}

variable "image" {
  description = "Full image reference, e.g. <account>.dkr.ecr.<region>.amazonaws.com/hrms-prod/api:<tag>."
  type        = string
}

variable "command" {
  description = "Container command. Null keeps the image's default."
  type        = list(string)
  default     = null
}

variable "environment" {
  description = "Plain environment variables."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Secrets injected as environment variables: [{ name, valueFrom = \"<secret arn>:<json key>::\" }]."
  type        = list(object({ name = string, valueFrom = string }))
  default     = []
}

variable "create_service" {
  description = "false creates only the task definition (one-off tasks such as migrations)."
  type        = bool
  default     = true
}

variable "cluster_arn" {
  description = "ECS cluster ARN."
  type        = string
}

variable "vpc_id" {
  description = "VPC of the tasks."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets the tasks run in."
  type        = list(string)
}

variable "container_port" {
  description = "Port the container listens on."
  type        = number
  default     = 8080
}

variable "attach_to_load_balancer" {
  description = "Route traffic to this service through the shared listener (listener_arn, lb_security_group_id, host_headers)."
  type        = bool
  default     = true
}

variable "listener_arn" {
  description = "Shared HTTPS listener."
  type        = string
  default     = null
}

variable "lb_security_group_id" {
  description = "Load balancer security group (ingress source)."
  type        = string
  default     = null
}

variable "listener_priority" {
  description = "Unique priority of this service's host rule on the listener."
  type        = number
  default     = 100
}

variable "host_headers" {
  description = "Host names routed to this service."
  type        = list(string)
  default     = []
}

variable "health_check_path" {
  description = "Load balancer health check path."
  type        = string
  default     = "/"
}

variable "container_health_command" {
  description = "Optional container-level health check command."
  type        = list(string)
  default     = null
}

variable "connect_to_database" {
  description = "Open the database security group to these tasks. false for apps that never touch the database."
  type        = bool
  default     = false
}

variable "db_security_group_id" {
  description = "Database security group (with connect_to_database)."
  type        = string
  default     = null
}

variable "db_port" {
  description = "Database port."
  type        = number
  default     = 5432
}

variable "kms_key_arn" {
  description = "CMK that encrypts the injected secrets."
  type        = string
}

variable "logs_kms_key_arn" {
  description = "CMK for the log group. Null uses CloudWatch's default encryption."
  type        = string
  default     = null
}

variable "has_task_policy" {
  description = "Attach task_policy_json to the task role."
  type        = bool
  default     = false
}

variable "task_policy_json" {
  description = "IAM policy for the task role (with has_task_policy)."
  type        = string
  default     = null
}

variable "cpu" {
  description = "Fargate CPU units."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Fargate memory (MiB)."
  type        = number
  default     = 1024
}

variable "cpu_architecture" {
  description = "ARM64 (Graviton, cheaper) or X86_64."
  type        = string
  default     = "ARM64"
}

variable "min_count" {
  description = "Minimum (and initial) task count."
  type        = number
  default     = 1
}

variable "max_count" {
  description = "Maximum task count under autoscaling. Equal to min_count disables scaling."
  type        = number
  default     = 1
}

variable "cpu_target_percent" {
  description = "Average CPU the autoscaler aims for."
  type        = number
  default     = 60
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 30
}
