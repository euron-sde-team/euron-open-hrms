# ─────────────────────────────────────────────────────────────────────────────
# One complete deployment: network, data, keys, mail, and the three applications.
#
#   https://app.<domain>      tenant web app (HR, managers, employees)
#   https://api.<domain>      API: tenant plane /api, operator plane /api/platform
#   https://console.<domain>  operator console
#
# envs/aws-dev and envs/aws-prod call this module with different sizes and safety
# switches; everything else is identical by construction.
# ─────────────────────────────────────────────────────────────────────────────
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region    = data.aws_region.current.region
  account   = data.aws_caller_identity.current.account_id
  hostnames = { app = "app.${var.domain}", api = "api.${var.domain}", console = "console.${var.domain}" }
  urls      = { for k, h in local.hostnames : k => "https://${h}" }
  images    = { for k, url in module.ecr.repository_urls : k => "${url}:${var.image_tag}" }
  # The API sees one proxy hop (the ALB), or two with CloudFront in front.
  trust_proxy = var.enable_cdn ? "2" : "1"
  mail_domain = coalesce(var.mail_domain, var.domain)
}

# ─── Foundation ──────────────────────────────────────────────────────────────

module "network" {
  source                     = "../network"
  name_prefix                = var.name_prefix
  cidr_block                 = var.vpc_cidr
  az_count                   = var.az_count
  single_nat_gateway         = var.single_nat_gateway
  enable_interface_endpoints = var.enable_interface_endpoints
  flow_log_retention_days    = var.flow_log_retention_days
  logs_kms_key_arn           = module.kms.key_arn
}

module "kms" {
  source                  = "../kms"
  name_prefix             = var.name_prefix
  deletion_window_in_days = var.kms_deletion_window_days
  admin_principal_arns    = var.kms_admin_principal_arns
}

module "secrets" {
  source                  = "../secrets"
  name_prefix             = var.name_prefix
  kms_key_arn             = module.kms.key_arn
  recovery_window_in_days = var.secret_recovery_window_days
}

module "database" {
  source                = "../database"
  name_prefix           = var.name_prefix
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  kms_key_arn           = module.kms.key_arn
  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
  deletion_protection   = var.deletion_protection
  skip_final_snapshot   = !var.deletion_protection
  monitoring_interval   = var.db_monitoring_interval
}

module "storage" {
  source            = "../storage"
  name_prefix       = var.name_prefix
  kms_key_arn       = module.kms.key_arn
  enable_versioning = true
  force_destroy     = !var.deletion_protection
}

module "email" {
  source          = "../email"
  name_prefix     = var.name_prefix
  domain          = local.mail_domain
  manage_dns      = var.route53_zone_id != null
  route53_zone_id = var.route53_zone_id
  dmarc_policy    = var.dmarc_policy
}

module "ecr" {
  source       = "../ecr"
  name_prefix  = var.name_prefix
  kms_key_arn  = module.kms.key_arn
  force_delete = !var.deletion_protection
}

# ─── Edge ────────────────────────────────────────────────────────────────────

module "edge" {
  source                = "../edge"
  name_prefix           = var.name_prefix
  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  hostnames             = local.hostnames
  route53_zone_id       = var.route53_zone_id
  certificate_arn       = var.certificate_arn
  create_dns_records    = !var.enable_cdn
  allow_only_cloudfront = var.enable_cdn
  access_logs_bucket    = var.alb_access_logs_bucket
  deletion_protection   = var.deletion_protection
}

module "cdn" {
  count              = var.enable_cdn ? 1 : 0
  source             = "../cdn"
  providers          = { aws.us_east_1 = aws.us_east_1 }
  name_prefix        = var.name_prefix
  hostnames          = local.hostnames
  route53_zone_id    = var.route53_zone_id
  origin_domain_name = module.edge.dns_name
  enable_waf         = var.enable_waf
}

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix
  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
}

# ─── API ─────────────────────────────────────────────────────────────────────

locals {
  api_environment = merge({
    NODE_ENV     = "production"
    TZ           = "UTC"
    PORT         = "8080"
    TRUST_PROXY  = local.trust_proxy
    PRODUCT_NAME = var.product_name
    AWS_REGION   = local.region
    CORS_ORIGINS = join(",", [local.urls.app, local.urls.console])
    APP_WEB_URL  = local.urls.app
    PORTAL_URL   = local.urls.app
    APP_BASE_URL = local.urls.api
    STORAGE      = "s3"
    S3_BUCKET    = module.storage.bucket_name
    MAIL_MODE    = "ses"
    MAIL_FROM    = "${var.product_name} <${module.email.from_address}>"
    # Applied to every workspace sending domain the API creates, not only the platform's.
    SES_CONFIGURATION_SET = module.email.configuration_set
    KMS_MODE              = "aws"
    KMS_KEY_ID            = module.kms.alias_name
    MIGRATE_ON_BOOT       = tostring(var.migrate_on_boot)
    MIGRATIONS_DIR        = "/app/db/migrations"
    DATA_DIR              = "/tmp/data"
    # No database password in the environment: the API reads it from the RDS-managed
    # secret for each new connection, so a rotation needs no redeploy.
    DATABASE_SECRET_ARN = module.database.master_user_secret_arn
    DB_HOST             = module.database.address
    DB_PORT             = tostring(module.database.port)
    DB_NAME             = module.database.database_name
    DB_USER             = module.database.master_username
    DB_SSL              = "require"
  }, var.api_extra_environment)

  api_secrets = [for k in module.secrets.keys : { name = k, valueFrom = "${module.secrets.secret_arn}:${k}::" }]
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "Documents"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${module.storage.bucket_arn}/*"]
  }
  statement {
    sid       = "DocumentsBucket"
    actions   = ["s3:ListBucket"]
    resources = [module.storage.bucket_arn]
  }
  statement {
    # Wrap and unwrap each workspace's personal-data key. KMS refuses both without the
    # purpose=pii encryption context, so this role cannot use the key for anything else.
    sid       = "PersonalDataKeys"
    actions   = ["kms:Encrypt", "kms:Decrypt"]
    resources = [module.kms.key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:purpose"
      values   = ["pii"]
    }
  }
  statement {
    sid       = "SseKmsViaS3"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [module.kms.key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${local.region}.amazonaws.com"]
    }
  }
  statement {
    sid       = "DatabasePassword"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [module.database.master_user_secret_arn]
  }
  statement {
    sid       = "DatabasePasswordDecrypt"
    actions   = ["kms:Decrypt"]
    resources = [module.kms.key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }
  statement {
    # The platform identity and every workspace's own verified sending domain.
    sid       = "SendMail"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["arn:aws:ses:${local.region}:${local.account}:identity/*", "arn:aws:ses:${local.region}:${local.account}:configuration-set/*"]
  }
  statement {
    # Workspaces bring their own sending domain from Settings; the API creates, checks
    # and removes those SES identities (apps/api/src/ses-domains.ts).
    sid = "WorkspaceSendingDomains"
    actions = [
      "ses:CreateEmailIdentity", "ses:GetEmailIdentity", "ses:DeleteEmailIdentity",
      "ses:PutEmailIdentityMailFromAttributes", "ses:PutEmailIdentityDkimAttributes",
    ]
    resources = ["arn:aws:ses:${local.region}:${local.account}:identity/*"]
  }
}

module "api" {
  source                   = "../service"
  name_prefix              = var.name_prefix
  name                     = "api"
  image                    = local.images.api
  command                  = ["node", "dist/index.js"]
  environment              = local.api_environment
  secrets                  = local.api_secrets
  cluster_arn              = aws_ecs_cluster.this.arn
  vpc_id                   = module.network.vpc_id
  subnet_ids               = module.network.private_subnet_ids
  listener_arn             = module.edge.https_listener_arn
  lb_security_group_id     = module.edge.security_group_id
  listener_priority        = 100
  host_headers             = [local.hostnames.api]
  health_check_path        = "/up"
  connect_to_database      = true
  db_security_group_id     = module.database.security_group_id
  db_port                  = module.database.port
  kms_key_arn              = module.kms.key_arn
  has_task_policy          = true
  task_policy_json         = data.aws_iam_policy_document.api.json
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  min_count                = var.api_min_count
  max_count                = var.api_max_count
  log_retention_days       = var.log_retention_days
  logs_kms_key_arn         = module.kms.key_arn
  container_health_command = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8080/up').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
}

# One-off tasks on the API image: migrations and the operator CLI (make aws-migrate,
# make aws-operator). Same network, secrets and database access as the API.
module "migrate" {
  source               = "../service"
  name_prefix          = var.name_prefix
  name                 = "migrate"
  image                = local.images.api
  command              = ["node", "dist/migrate.js"]
  environment          = local.api_environment
  secrets              = local.api_secrets
  create_service       = false
  cluster_arn          = aws_ecs_cluster.this.arn
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  connect_to_database  = true
  db_security_group_id = module.database.security_group_id
  db_port              = module.database.port
  kms_key_arn          = module.kms.key_arn
  has_task_policy      = true
  task_policy_json     = data.aws_iam_policy_document.api.json
  cpu                  = 256
  memory               = 512
  log_retention_days   = var.log_retention_days
  logs_kms_key_arn     = module.kms.key_arn
}

# ─── Web apps ────────────────────────────────────────────────────────────────

locals {
  frontend_environment = {
    NODE_ENV     = "production"
    PORT         = "8080"
    HOSTNAME     = "0.0.0.0"
    API_URL      = "${local.urls.api}/api"
    PRODUCT_NAME = var.product_name
  }
}

module "web" {
  source               = "../service"
  name_prefix          = var.name_prefix
  name                 = "web"
  image                = local.images.web
  environment          = local.frontend_environment
  cluster_arn          = aws_ecs_cluster.this.arn
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  listener_arn         = module.edge.https_listener_arn
  lb_security_group_id = module.edge.security_group_id
  listener_priority    = 110
  host_headers         = [local.hostnames.app]
  health_check_path    = "/env.js"
  kms_key_arn          = module.kms.key_arn
  cpu                  = var.web_cpu
  memory               = var.web_memory
  min_count            = var.web_min_count
  max_count            = var.web_max_count
  log_retention_days   = var.log_retention_days
  logs_kms_key_arn     = module.kms.key_arn
}

module "console" {
  source               = "../service"
  name_prefix          = var.name_prefix
  name                 = "console"
  image                = local.images.console
  environment          = merge(local.frontend_environment, { TENANT_URL = local.urls.app })
  cluster_arn          = aws_ecs_cluster.this.arn
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  listener_arn         = module.edge.https_listener_arn
  lb_security_group_id = module.edge.security_group_id
  listener_priority    = 120
  host_headers         = [local.hostnames.console]
  health_check_path    = "/env.js"
  kms_key_arn          = module.kms.key_arn
  cpu                  = 256
  memory               = 512
  min_count            = 1
  max_count            = 1
  log_retention_days   = var.log_retention_days
  logs_kms_key_arn     = module.kms.key_arn
}

# ─── Observability ───────────────────────────────────────────────────────────

module "observability" {
  source                 = "../observability"
  name_prefix            = var.name_prefix
  alarm_email            = var.alarm_email
  alb_arn_suffix         = module.edge.arn_suffix
  ecs_cluster_name       = aws_ecs_cluster.this.name
  db_instance_identifier = module.database.instance_identifier
  services = {
    api     = { service_name = module.api.service_name, target_group_arn_suffix = module.api.target_group_arn_suffix }
    web     = { service_name = module.web.service_name, target_group_arn_suffix = module.web.target_group_arn_suffix }
    console = { service_name = module.console.service_name, target_group_arn_suffix = module.console.target_group_arn_suffix }
  }
}
