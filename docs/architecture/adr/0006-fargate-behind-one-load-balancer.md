# ADR 0006: Three Fargate services behind one Application Load Balancer

## Status

Accepted.

## Context

A deployment has three long-running applications (tenant web app, operator console, API)
and two one-off commands (migrations, the operator CLI). The target audience for the
Terraform is a team that wants a production-grade AWS deployment without operating a
container platform: no cluster nodes to patch, no ingress controller, no service mesh.

## Decision

- **ECS on Fargate** for all three services and the one-off tasks, on ARM64.
- **One public ALB** with an HTTPS listener and host-header rules:
  `app.<domain>` to web, `api.<domain>` to the API, `console.<domain>` to the console.
  Unknown hosts get a fixed 404; port 80 redirects to 443.
- **One certificate** covering the three names, DNS-validated through Route53, or an
  existing certificate when the zone is elsewhere.
- **Optional CloudFront and WAF** (`enable_cdn`) in front of the ALB, in which case the ALB
  only accepts traffic from CloudFront's origin-facing address ranges.
- Every service gets the same hardened shape from one `service` module: its own security
  group, execution role and task role, read-only root filesystem, no public IP, circuit
  breaker with rollback, CPU target-tracking autoscaling.
- One-off tasks reuse the API task definition shape (`migrate`) and are launched by
  `scripts/aws-run-task.sh`.

## Consequences

Positive:

- One load balancer, one certificate and one DNS pattern for the whole product.
- No servers to patch; scaling, rollout and rollback are ECS features.
- Identical service shape means a security property fixed once applies to all three.
- ARM64 tasks; the images are built for `linux/arm64` by `make aws-deploy`.

Trade-offs:

- Three hostnames are required; path-based routing on one hostname is not supported by the
  modules.
- The API and the front ends share one ALB, so ALB-level limits and its availability are
  shared.
- Fargate has per-task cold starts and no host-level access; ECS Exec is disabled on
  purpose, so debugging relies on logs.
- Images must be built for ARM64 (`docker buildx`).

## Alternatives considered

- **EKS.** More flexible, but a cluster to operate is out of proportion for three services.
- **App Runner.** Simpler, but less control over networking (private database access,
  security groups) than this deployment needs.
- **Lambda.** The API runs a background worker and long-lived sweeps; serverless functions
  would need a different architecture for both.
- **One load balancer per service.** Simpler rules, but three times the fixed cost and
  three certificates for no isolation benefit.
- **EC2 with Docker.** Lowest unit cost, but brings back patching and capacity management.
