# `database` module

PostgreSQL 16 on RDS: private, encrypted with the CMK, TLS enforced (`rds.force_ssl`), master password generated and rotated by RDS in Secrets Manager (`manage_master_user_password`), Performance Insights, automated backups, deletion protection. Consumers add their own security-group ingress rules.

## Inputs

| Name | Description | Type | Default |
|---|---|---|---|
| `name_prefix` | Prefix for every resource name. | `string` | required |
| `vpc_id` | VPC id. | `string` | required |
| `subnet_ids` | Private subnets for the DB subnet group (2+ AZs). | `list(string)` | required |
| `kms_key_arn` | CMK for storage, Performance Insights and the master-password secret. | `string` | required |
| `database_name` | Initial database name. | `string` | `"hrms"` |
| `master_username` | Master user name. The password is generated and rotated by RDS in Secrets Manager. | `string` | `"hrms_admin"` |
| `engine_version` | PostgreSQL major (or major.minor) version. | `string` | `"16"` |
| `instance_class` | Instance class. Graviton (t4g/m7g/r7g) recommended. | `string` | `"db.t4g.medium"` |
| `allocated_storage` | Initial gp3 storage in GiB. | `number` | `50` |
| `max_allocated_storage` | Storage autoscaling ceiling in GiB. | `number` | `500` |
| `multi_az` | Synchronous standby in a second AZ. | `bool` | `false` |
| `backup_retention_days` | Automated backup retention. | `number` | `7` |
| `deletion_protection` | Block accidental deletion. | `bool` | `true` |
| `monitoring_interval` | Enhanced Monitoring granularity in seconds (0 disables): 1, 5, 10, 15, 30 or 60. | `number` | `60` |
| `skip_final_snapshot` | Skip the final snapshot on destroy (throwaway envs only). | `bool` | `false` |

## Outputs

| Name | Description |
|---|---|
| `address` | DB hostname. |
| `port` | DB port. |
| `database_name` | Database name. |
| `instance_identifier` | RDS instance identifier (CloudWatch dimension). |
| `master_user_secret_arn` | Secrets Manager secret (JSON username/password) managed and rotated by RDS. |
| `security_group_id` | DB security group; consumers add ingress rules against it. |
