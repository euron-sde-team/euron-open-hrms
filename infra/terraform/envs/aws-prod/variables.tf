variable "region" {
  description = "AWS region."
  type        = string
}

variable "environment" {
  description = "Environment tag."
  type        = string
  default     = "prod"
}

variable "extra_tags" {
  description = "Tags added to every resource."
  type        = map(string)
  default     = {}
}

variable "name_prefix" {
  description = "Prefix for every resource name; bucket names derive from it, so make it globally unique (e.g. \"acme-hrms-prod\")."
  type        = string
}

variable "domain" {
  description = "Base domain: app.<domain>, api.<domain>, console.<domain>."
  type        = string
}

variable "route53_zone_id" {
  description = "Hosted zone for the domain (automatic certificates and DNS)."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "Existing regional certificate, when the zone is not in Route53."
  type        = string
  default     = null
}

variable "mail_domain" {
  description = "SES sending domain (defaults to domain)."
  type        = string
  default     = null
}

variable "image_tag" {
  description = "Image tag to deploy (make aws-deploy passes the git commit)."
  type        = string
}

variable "product_name" {
  description = "Product name shown in the apps and emails."
  type        = string
  default     = "Euron Open HRMS"
}

variable "enable_cdn" {
  description = "CloudFront (+ WAF) in front of the load balancer."
  type        = bool
  default     = true
}

variable "alarm_email" {
  description = "Alarm notification address."
  type        = string
  default     = null
}

variable "api_extra_environment" {
  description = "Extra API environment (e.g. AI document extraction settings). Never secrets."
  type        = map(string)
  default     = {}
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}
