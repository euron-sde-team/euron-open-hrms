output "task_definition_arn" {
  description = "Current task definition revision."
  value       = aws_ecs_task_definition.this.arn
}

output "task_definition_family" {
  description = "Task definition family (for run-task)."
  value       = aws_ecs_task_definition.this.family
}

output "security_group_id" {
  description = "The tasks' security group."
  value       = aws_security_group.task.id
}

output "service_name" {
  description = "ECS service name (null for task-only use)."
  value       = local.with_service ? aws_ecs_service.this[0].name : null
}

output "target_group_arn_suffix" {
  description = "For CloudWatch load balancer metrics."
  value       = local.with_lb ? aws_lb_target_group.this[0].arn_suffix : null
}

output "task_role_arn" {
  description = "Task role ARN."
  value       = aws_iam_role.task.arn
}

output "log_group_name" {
  description = "CloudWatch log group."
  value       = aws_cloudwatch_log_group.this.name
}
