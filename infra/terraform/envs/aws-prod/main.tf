# ─────────────────────────────────────────────────────────────────────────────
# aws-prod: production. Multi-AZ database, NAT per AZ, deletion protection,
# CloudFront + WAF in front, three AZs.
#
# Everything is in ../../modules/deployment; this file only picks the sizes.
#   make aws-deploy ENV=aws-prod
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

  az_count                   = 3
  single_nat_gateway         = false
  enable_interface_endpoints = true

  enable_cdn = var.enable_cdn
  enable_waf = true

  db_instance_class        = var.db_instance_class
  db_multi_az              = true
  db_backup_retention_days = 14
  deletion_protection      = true

  kms_deletion_window_days    = 30
  secret_recovery_window_days = 30

  api_min_count = 2
  api_max_count = 6
  web_min_count = 2
  web_max_count = 6

  log_retention_days      = 365
  flow_log_retention_days = 365
  alarm_email             = var.alarm_email
  api_extra_environment   = var.api_extra_environment
}
