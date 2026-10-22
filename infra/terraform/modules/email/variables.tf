variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "domain" {
  description = "Sending domain verified in SES, e.g. \"mail.example.com\". Mail is sent as no-reply@<domain>."
  type        = string
}

variable "mail_from_subdomain" {
  description = "Custom MAIL FROM subdomain (bounces), so SPF aligns with the sending domain."
  type        = string
  default     = "bounce"
}

variable "manage_dns" {
  description = "Create the DKIM, MAIL FROM and DMARC records in route53_zone_id. A boolean rather than a null check on the zone id, which may be unknown until apply."
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = "Hosted zone that serves the domain (with manage_dns). Otherwise publish the `dns_records` output by hand."
  type        = string
  default     = null
}

variable "dmarc_policy" {
  description = "DMARC policy to publish (none, quarantine, reject). Null skips the record, e.g. when the domain already has one."
  type        = string
  default     = "none"
  validation {
    condition     = var.dmarc_policy == null || contains(["none", "quarantine", "reject"], coalesce(var.dmarc_policy, "none"))
    error_message = "dmarc_policy must be none, quarantine, reject or null."
  }
}

variable "dmarc_report_address" {
  description = "Aggregate-report address for DMARC. Defaults to dmarc-reports@<domain>."
  type        = string
  default     = null
}
