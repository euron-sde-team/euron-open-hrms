# Deploy to AWS

This guide deploys a complete environment with one command: network, database, keys,
storage, mail, the three applications and monitoring. Two environments ship with the
repository: `aws-dev` (a cheaper full copy) and `aws-prod`. Both call the same module,
`infra/terraform/modules/deployment`, with different sizes and safety switches.

After deployment you have:

| URL | Application |
| --- | --- |
| `https://app.<domain>` | Tenant web app |
| `https://api.<domain>` | API (`/api` tenant plane, `/api/platform` operator plane) |
| `https://console.<domain>` | Operator console |

## Prerequisites

| Requirement | Notes |
| --- | --- |
| An AWS account and credentials | With permission to create the resources below; the deploy runs as you |
| Terraform 1.10 or later | `versions.tf` requires `>= 1.10.0` and the AWS provider `~> 6.70` |
| Docker with `buildx` | Images are built for `linux/arm64` |
| AWS CLI v2 | ECR login, waiting for services, one-off tasks |
| `python3` | Used by `scripts/aws-run-task.sh` to read Terraform output |
| A domain | The apps are served at `app.`, `api.` and `console.` under it |
| SES production access | New SES accounts start in the sandbox and can only send to verified addresses; request production access for the region |

Set your region in the shell to the same value you put in `terraform.tfvars`. The deploy
script uses `AWS_REGION` first, then your CLI default region, then the `region` in the
tfvars file:

```bash
export AWS_REGION=us-east-1
```

## 1. Configure the environment

```bash
cp infra/terraform/envs/aws-dev/terraform.tfvars.example infra/terraform/envs/aws-dev/terraform.tfvars
```

`terraform.tfvars` is git-ignored. Variables:

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `region` | yes | | AWS region |
| `name_prefix` | yes | | Prefix for every resource name, 3 to 24 lowercase letters, digits and hyphens, starting with a letter. Bucket names derive from it, so make it globally unique (for example `acme-hrms-dev`) |
| `domain` | yes | | Base domain, for example `hrms.example.com` |
| `route53_zone_id` | one of these two | `null` | Hosted zone for the domain: automatic certificates and DNS |
| `certificate_arn` | one of these two | `null` | An existing regional ACM certificate covering `app.`, `api.` and `console.<domain>`, when the zone is not in Route53 |
| `mail_domain` | no | `domain` | SES sending domain; mail goes out as `no-reply@<mail_domain>` |
| `image_tag` | set by `make aws-deploy` | | Image tag to deploy; set it here only to pin a release for `terraform` runs by hand |
| `product_name` | no | `Euron Open HRMS` | Shown in the apps and emails |
| `enable_cdn` | no | `false` (dev), `true` (prod) | CloudFront and WAF in front of the load balancer; needs `route53_zone_id` |
| `alarm_email` | no | `null` | Address subscribed to the alarm topic (confirm the subscription email) |
| `api_extra_environment` | no | `{}` | Extra non-secret API environment, for example AI document extraction settings |
| `db_instance_class` | no | `db.t4g.small` (dev), `db.t4g.medium` (prod) | RDS instance class |
| `environment` | no | `dev` / `prod` | Value of the `Environment` tag |
| `extra_tags` | no | `{}` | Tags added to every resource |

Minimal example:

```hcl
region          = "us-east-1"
name_prefix     = "acme-hrms-dev"
domain          = "hrms.example.com"
route53_zone_id = "<ROUTE53_HOSTED_ZONE_ID>"
alarm_email     = "oncall@example.com"
```

`api_extra_environment` is for configuration, never secrets: values land in the ECS task
definition in plain text. The Terraform provisions three application secrets only
(`JWT_SECRET`, `PLATFORM_JWT_SECRET`, `DOC_VERIFY_SECRET`); an AI provider key would need its
own secret added to the `secrets` module.

### Remote state

State contains the generated application secrets. For anything shared, store it in S3:

```bash
cp infra/terraform/envs/aws-dev/backend.tf.example infra/terraform/envs/aws-dev/backend.tf
```

Uncomment the block and fill in a bucket that is private, versioned and encrypted, with
access limited to the people who deploy. The example uses S3-native locking
(`use_lockfile = true`), so no DynamoDB table is needed.

## 2. Deploy

```bash
make aws-deploy ENV=aws-dev
```

`ENV` defaults to `aws-dev`. `TAG` defaults to the first 12 characters of the current
commit hash; pass `TAG=...` to choose one. The target runs `scripts/aws-deploy.sh <env>
<tag>`, which:

1. checks that `terraform`, `docker` and `aws` are installed and that
   `envs/<env>/terraform.tfvars` exists, and notes if the working tree has uncommitted
   changes (the images are built from the tree as it is);
2. runs `terraform init`;
3. **registries**: `terraform apply -target=module.hrms.module.ecr` (the ECR repositories,
   and the KMS key that encrypts them);
4. logs Docker in to ECR;
5. **images**: builds `api`, `web` and `console` with `docker buildx build --platform
   linux/arm64` from `infra/docker/*.Dockerfile` and pushes `<repo>:<tag>`;
6. **infrastructure**: `terraform apply` of everything else with that `image_tag`;
7. **rollout**: `aws ecs wait services-stable` for the `api`, `web` and `console` services;
8. prints the `urls` output and the next step.

Database migrations run when the API boots (`MIGRATE_ON_BOOT=true`), under an advisory lock,
so several tasks starting together are safe. To run them as an explicit step instead:

```bash
make aws-migrate ENV=aws-dev
```

To preview changes without applying:

```bash
make aws-plan ENV=aws-dev
```

ECR tags are immutable, so every deployment needs a tag that has not been pushed before:
commit first, or pass a new `TAG`.

## 3. DNS

### With a Route53 zone (`route53_zone_id`)

Everything is automatic: the ACM certificate and its validation records, `A` aliases for the
three hostnames (to the load balancer, or to CloudFront when `enable_cdn` is on), the SES
DKIM `CNAME` records, the `MAIL FROM` `MX` and SPF `TXT` records on `bounce.<mail_domain>`,
and a DMARC record (`dmarc_policy`, default `none`).

### Without a Route53 zone (`certificate_arn`)

Request or import an ACM certificate for `app.<domain>`, `api.<domain>` and
`console.<domain>` in the deployment region yourself, pass its ARN as `certificate_arn`, then
publish two sets of records at your DNS provider after the first apply:

```bash
terraform -chdir=infra/terraform/envs/aws-dev output load_balancer_dns_name
terraform -chdir=infra/terraform/envs/aws-dev output mail_dns_records
```

| Records | Source |
| --- | --- |
| `CNAME` for `app.`, `api.` and `console.<domain>` pointing at the load balancer | `load_balancer_dns_name` |
| Three DKIM `CNAME` records, plus `MX` and SPF `TXT` for `bounce.<mail_domain>` | `mail_dns_records` |

A DMARC record is not part of `mail_dns_records`; publish one for your domain if you do not
have one. The `certificate_validation_records` output lists the validation records of a
certificate Terraform created; Terraform creates one only when a Route53 zone is given, and
publishes those records itself, so with `certificate_arn` this output is empty.

CloudFront (`enable_cdn`) requires a Route53 zone, because its certificate is validated
through DNS automatically.

## 4. Create the first operator

```bash
make aws-operator ENV=aws-dev EMAIL=you@example.com
```

This runs `node dist/cli.js operator:create --email you@example.com` as a one-off Fargate
task (same network, secrets and database access as the API), waits for it, and prints the
task's recent logs, which contain a generated one-time password. Then:

1. sign in at `https://console.<domain>`;
2. enrol two-factor authentication under Security;
3. create a workspace, or sign up a company at `https://app.<domain>/signup`.

The password is printed by the task, so it is also kept in the task's CloudWatch log group
(`/hrms/<name_prefix>/migrate`) for the log retention period. The console has no operator
password change, so enrol 2FA immediately. Add further operators from the console; give
`SUPPORT` to anyone who does not need destructive actions.

## Sizing

Values from `envs/aws-dev/main.tf`, `envs/aws-prod/main.tf` and the module defaults:

| Setting | aws-dev | aws-prod |
| --- | --- | --- |
| Availability zones | 2 | 3 |
| NAT gateways | 1 (shared) | 1 per AZ |
| Interface endpoints (KMS, Secrets Manager) | off | on |
| CloudFront + WAF | off by default (`enable_cdn`) | on by default |
| Database instance | `db.t4g.small` | `db.t4g.medium` |
| Database Multi-AZ | no | yes |
| Database storage | 20 GiB gp3, autoscaling to 100 GiB | same |
| Automated backup retention | 3 days | 14 days |
| Deletion protection (RDS, ALB) and final DB snapshot | off | on |
| S3 bucket and ECR force-destroy | on | off |
| KMS key deletion window | 7 days | 30 days |
| Secrets recovery window | 0 (immediate) | 30 days |
| API tasks (min to max) | 1 to 2 | 2 to 6 |
| Web tasks (min to max) | 1 to 2 | 2 to 6 |
| Console tasks | 1 | 1 |
| API task size | 0.5 vCPU, 1 GiB | same |
| Web and console task size | 0.25 vCPU, 0.5 GiB | same |
| Application log retention | 14 days | 365 days |
| VPC flow log retention | 30 days | 365 days |

WAF is enabled in both environments but is attached to CloudFront, so it is only in effect
when `enable_cdn` is on. Autoscaling targets 60 percent average CPU.

## Cost notes

No prices are quoted here; use the AWS Pricing Calculator for your region. What drives the
bill, roughly in order:

- **Always-on tasks**: the minimum task counts run around the clock (3 tasks in `aws-dev`,
  5 in `aws-prod`), plus Container Insights metrics.
- **The database**: Multi-AZ runs a standby instance; storage, backups beyond the free
  allowance, Performance Insights and Enhanced Monitoring add to it.
- **NAT gateways**: hourly per gateway plus per-GB processing. `aws-prod` runs three. S3
  traffic avoids NAT through the gateway endpoint.
- **Interface endpoints** (`aws-prod`): hourly per endpoint per AZ.
- **Load balancer**: hourly plus capacity units.
- **CloudFront and WAF** when enabled: per request, plus per rule for WAF.
- **CloudWatch Logs**: ingestion and the 365-day retention in `aws-prod`.
- **KMS**: per key per month and per request; the data-key cache keeps PII requests to
  about one per workspace per task every 10 minutes.
- **SES**: per message.

To reduce `aws-dev` cost further, lower the task counts, keep `enable_cdn` off, and destroy
the environment when idle.

## Updating

Commit, then run `make aws-deploy ENV=<env>` again. The services roll with a circuit
breaker: a deployment whose tasks fail health checks is rolled back automatically.

## Tearing down

Before destroying, handle what Terraform does not manage:

- **Workspace sending domains** are SES identities created by the API at runtime. Remove
  them in each workspace's settings first, or delete the identities in SES afterwards.
- **Take a manual database snapshot** if you need the data. In `aws-prod` a final snapshot
  is taken only while deletion protection is on, and turning protection off (below) also
  turns the final snapshot off.

`aws-dev`:

```bash
terraform -chdir=infra/terraform/envs/aws-dev destroy -var image_tag=<deployed tag>
```

`aws-prod` has deletion protection on. To destroy it, set `deletion_protection = false` in
`envs/aws-prod/main.tf`, apply, empty the versioned documents bucket (all object versions)
and delete the images in the ECR repositories, then run `destroy`. The KMS key is scheduled
for deletion after its 30-day window and the secrets after their 30-day recovery window; you
can cancel either during that time.

## Next steps

- Day-two operations: [operations.md](operations.md)
- Every environment variable: [configuration.md](configuration.md)
- Security controls and the operator checklist: [security.md](../architecture/security.md#operator-checklist)
