variable "endpoint" {
  description = "Emulator endpoint. http://localhost:4566 from the host, http://floci:4566 inside compose."
  type        = string
  default     = "http://localhost:4566"
}

variable "name_prefix" {
  description = "Must match S3_BUCKET and KMS_KEY_ID in deploy/compose/compose.floci.yaml."
  type        = string
  default     = "hrms-local"
}

variable "mail_domain" {
  description = "Sending domain registered in the emulator's SES (must match MAIL_FROM)."
  type        = string
  default     = "open-hrms.test"
}
