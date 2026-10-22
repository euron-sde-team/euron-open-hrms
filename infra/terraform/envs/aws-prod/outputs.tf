output "urls" {
  description = "Public URLs of the three applications."
  value       = module.hrms.urls
}

output "cluster_name" {
  description = "ECS cluster."
  value       = module.hrms.cluster_name
}

output "services" {
  description = "ECS service names."
  value       = module.hrms.services
}

output "ecr_repositories" {
  description = "Image repositories."
  value       = module.hrms.ecr_repositories
}

output "run_task" {
  description = "Parameters for one-off tasks (migrate, operator CLI)."
  value       = module.hrms.run_task
}

output "load_balancer_dns_name" {
  description = "CNAME target when the zone is not in Route53."
  value       = module.hrms.load_balancer_dns_name
}

output "certificate_validation_records" {
  description = "Publish by hand when the zone is not in Route53."
  value       = module.hrms.certificate_validation_records
}

output "mail_dns_records" {
  description = "Publish by hand when the zone is not in Route53."
  value       = module.hrms.mail_dns_records
}

output "documents_bucket" {
  description = "Documents bucket."
  value       = module.hrms.documents_bucket
}
