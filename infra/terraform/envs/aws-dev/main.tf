# ─────────────────────────────────────────────────────────────────────────────
# aws-dev: a full, cheaper copy of production. Single NAT, single-AZ database,
# no deletion protection, no CDN.
#
# Everything is in ../../modules/deployment; this file only picks the sizes.
#   make aws-deploy ENV=aws-dev
# ─────────────────────────────────────────────────────────────────────────────
module "hrms" {
  source    = "../../modules/deployment"
  providers = { aws = aws, aws.us_east_1 = aws.us_east_1 }

  name_prefix     = var.name_prefix
  domain          = var.domain
  route53_zone_id = var.route53_zone_id
  certificate_arn = var.certificate_arn
  mail_domain     = var.mail_domain
  product_name    = var.product_name
  image_tag       = var.image_tag

  az_count                   = 2
  single_nat_gateway         = true
  enable_interface_endpoints = false

  enable_cdn = var.enable_cdn
  enable_waf = true

  db_instance_class        = var.db_instance_class
  db_multi_az              = false
  db_backup_retention_days = 3
  deletion_protection      = false

  kms_deletion_window_days    = 7
  secret_recovery_window_days = 0

  api_min_count = 1
  api_max_count = 2
  web_min_count = 1
  web_max_count = 2

  log_retention_days    = 14
  alarm_email           = var.alarm_email
  api_extra_environment = var.api_extra_environment
}
