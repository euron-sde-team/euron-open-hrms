# One containerised application on ECS Fargate. Used for the API, the tenant web app,
# the operator console and (with create_service = false) the one-off migration task,
# so all four share one hardened shape:
#
#   - its own security group: ingress only from the load balancer, egress only to HTTPS
#     and (when given) the database
#   - its own execution role (pull, log, inject the listed secrets) and task role (only
#     the policy the caller passes)
#   - a read-only root filesystem with a writable /tmp, ARM64, no public IP
#   - a host-header rule on the shared HTTPS listener, deployment circuit breaker with
#     automatic rollback, and CPU target-tracking autoscaling
data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  full_name    = "${var.name_prefix}-${var.name}"
  with_service = var.create_service
  # Booleans, not null checks on ARNs: those are unknown until apply, and count must be
  # decidable at plan time.
  with_lb     = var.create_service && var.attach_to_load_balancer
  secret_arns = distinct([for s in var.secrets : regex("^(arn:[^:]+:secretsmanager:[^:]+:[^:]+:secret:[^:]+)", s.valueFrom)[0]])
}

# ─── Networking ──────────────────────────────────────────────────────────────

resource "aws_security_group" "task" {
  name        = "${local.full_name}-task"
  description = "${var.name} tasks; ingress only from the load balancer"
  vpc_id      = var.vpc_id
  tags        = { Name = "${local.full_name}-task" }
}

resource "aws_vpc_security_group_ingress_rule" "from_lb" {
  count                        = local.with_lb ? 1 : 0
  security_group_id            = aws_security_group.task.id
  description                  = "From the load balancer"
  referenced_security_group_id = var.lb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
}

resource "aws_vpc_security_group_egress_rule" "lb_to_task" {
  count                        = local.with_lb ? 1 : 0
  security_group_id            = var.lb_security_group_id
  description                  = "To ${var.name} tasks"
  referenced_security_group_id = aws_security_group.task.id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.task.id
  description       = "HTTPS to AWS APIs (and AI providers, when document extraction is enabled)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "db" {
  count                        = var.connect_to_database ? 1 : 0
  security_group_id            = aws_security_group.task.id
  description                  = "To PostgreSQL"
  referenced_security_group_id = var.db_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.db_port
  to_port                      = var.db_port
}

resource "aws_vpc_security_group_ingress_rule" "db_from_task" {
  count                        = var.connect_to_database ? 1 : 0
  security_group_id            = var.db_security_group_id
  description                  = "From ${var.name} tasks"
  referenced_security_group_id = aws_security_group.task.id
  ip_protocol                  = "tcp"
  from_port                    = var.db_port
  to_port                      = var.db_port
}

# ─── Load balancing ──────────────────────────────────────────────────────────

resource "aws_lb_target_group" "this" {
  #checkov:skip=CKV_AWS_378:TLS terminates at the load balancer; the hop to the task stays inside private subnets.
  count                = local.with_lb ? 1 : 0
  name                 = substr(local.full_name, 0, 32)
  port                 = var.container_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30
  health_check {
    path                = var.health_check_path
    matcher             = "200-399"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "host" {
  count        = local.with_lb ? 1 : 0
  listener_arn = var.listener_arn
  priority     = var.listener_priority
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[0].arn
  }
  condition {
    host_header {
      values = var.host_headers
    }
  }
}

# ─── IAM ─────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

# Execution role: pull the image, write logs, inject the listed secrets. Nothing else.
resource "aws_iam_role" "execution" {
  name               = "${local.full_name}-execution"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution" {
  count = length(var.secrets) > 0 ? 1 : 0
  statement {
    sid       = "InjectSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.secret_arns
  }
  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "execution" {
  count  = length(var.secrets) > 0 ? 1 : 0
  name   = "secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution[0].json
}

# Task role: exactly what this application's code does at runtime (caller-supplied).
resource "aws_iam_role" "task" {
  name               = "${local.full_name}-task"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy" "task" {
  count  = var.has_task_policy ? 1 : 0
  name   = "runtime"
  role   = aws_iam_role.task.id
  policy = var.task_policy_json
}

# ─── Task definition ─────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "this" {
  #checkov:skip=CKV_AWS_338:Retention is an input (log_retention_days); aws-prod keeps 365 days.
  name              = "/hrms/${var.name_prefix}/${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
}

resource "aws_ecs_task_definition" "this" {
  family                   = local.full_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([{
    name                   = var.name
    image                  = var.image
    essential              = true
    readonlyRootFilesystem = true
    command                = var.command
    portMappings           = local.with_service ? [{ containerPort = var.container_port, protocol = "tcp" }] : []
    environment            = [for k, v in var.environment : { name = k, value = v }]
    secrets                = var.secrets
    linuxParameters        = { initProcessEnabled = true }
    # The root filesystem is read-only; the runtime only needs a writable /tmp.
    mountPoints = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]
    healthCheck = local.with_service && var.container_health_command != null ? {
      command     = var.container_health_command
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 20
    } : null
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = var.name
      }
    }
  }])
}

# ─── Service + autoscaling ───────────────────────────────────────────────────

resource "aws_ecs_service" "this" {
  count                  = local.with_service ? 1 : 0
  name                   = var.name
  cluster                = var.cluster_arn
  task_definition        = aws_ecs_task_definition.this.arn
  desired_count          = var.min_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = local.with_lb ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.this[0].arn
      container_name   = var.name
      container_port   = var.container_port
    }
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = local.with_lb ? 30 : null

  # Autoscaling owns the running count after the first deploy.
  lifecycle {
    ignore_changes = [desired_count]
  }
  depends_on = [aws_lb_listener_rule.host]
}

resource "aws_appautoscaling_target" "this" {
  count              = local.with_service && var.max_count > var.min_count ? 1 : 0
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${element(split("/", var.cluster_arn), 1)}/${aws_ecs_service.this[0].name}"
  min_capacity       = var.min_count
  max_capacity       = var.max_count
}

resource "aws_appautoscaling_policy" "cpu" {
  count              = length(aws_appautoscaling_target.this)
  name               = "${local.full_name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this[0].service_namespace
  scalable_dimension = aws_appautoscaling_target.this[0].scalable_dimension
  resource_id        = aws_appautoscaling_target.this[0].resource_id
  target_tracking_scaling_policy_configuration {
    target_value       = var.cpu_target_percent
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
