output "urls" {
  description = "Public URLs of the three applications."
  value       = local.urls
}

output "cluster_name" {
  description = "ECS cluster."
  value       = aws_ecs_cluster.this.name
}

output "services" {
  description = "ECS service names."
  value       = { api = module.api.service_name, web = module.web.service_name, console = module.console.service_name }
}

output "ecr_repositories" {
  description = "Image repositories to push api, web and console to."
  value       = module.ecr.repository_urls
}

output "run_task" {
  description = "Everything `aws ecs run-task` needs for the one-off migrate and operator tasks."
  value = {
    cluster         = aws_ecs_cluster.this.name
    task_definition = module.migrate.task_definition_family
    container       = "migrate"
    subnets         = module.network.private_subnet_ids
    security_groups = [module.migrate.security_group_id]
  }
}

output "load_balancer_dns_name" {
  description = "CNAME target for the three host names when the zone is not in Route53."
  value       = module.edge.dns_name
}

output "certificate_validation_records" {
  description = "Records to publish by hand when the zone is not in Route53."
  value       = module.edge.certificate_validation_records
}

output "mail_dns_records" {
  description = "SES DKIM and MAIL FROM records to publish by hand when the zone is not in Route53."
  value       = module.email.dns_records
}

output "documents_bucket" {
  description = "Documents bucket."
  value       = module.storage.bucket_name
}

output "alarm_topic_arn" {
  description = "SNS topic receiving every alarm."
  value       = module.observability.alarm_topic_arn
}
