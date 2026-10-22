# Run locally against real AWS

`make up` runs everything against an emulator. When you need to test against real AWS
services (real KMS key policies, real SES delivery and sandbox rules, a real bucket), run the
same local containers with the AWS overlay instead. Postgres, the web app, the console and
Mailpit still run locally; S3, KMS and SES are the real services in your account.

## How it works

`make up-aws` combines `deploy/compose/compose.yaml` with
`deploy/compose/compose.aws.yaml`. The overlay:

- loads `deploy/compose/.env.aws` into the API container;
- sets `STORAGE=s3`, `KMS_MODE=aws`, `MAIL_MODE=ses`;
- mounts your `~/.aws` directory read-only into the container and selects
  `AWS_PROFILE` (default `default`), so the SDK uses your normal credentials;
- does not start the emulator, and sets no endpoint override.

## 1. Have the AWS resources

The simplest source is an `aws-dev` deployment ([deploy-aws.md](deploy-aws.md)), whose
outputs give you every value. You can also create the resources yourself:

| Resource | Requirement |
| --- | --- |
| S3 bucket | Private; SSE-KMS recommended |
| KMS key | Symmetric; your IAM identity may call `kms:Encrypt` and `kms:Decrypt` with encryption context `purpose=pii`, plus `kms:GenerateDataKey` and `kms:Decrypt` for SSE-KMS through S3 |
| SES identity | A verified domain (or address) for `MAIL_FROM` in the region you use |

Your IAM identity needs roughly what the API task role has: `s3:GetObject`, `s3:PutObject`,
`s3:DeleteObject` on the bucket's objects and `s3:ListBucket` on the bucket; the KMS
permissions above; `ses:SendEmail` and `ses:SendRawEmail`; and, to try workspace sending
domains, `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`, `ses:DeleteEmailIdentity`,
`ses:PutEmailIdentityMailFromAttributes` and `ses:PutEmailIdentityDkimAttributes`.

To read the values from an `aws-dev` deployment:

```bash
terraform -chdir=infra/terraform/envs/aws-dev output documents_bucket
```

The KMS alias is `alias/<name_prefix>` and the platform sender is
`no-reply@<mail_domain>` (the `mail_domain` defaults to `domain`).

## 2. Write `.env.aws`

```bash
cp deploy/compose/.env.aws.example deploy/compose/.env.aws
```

Edit it:

```bash
AWS_REGION=us-east-1
S3_BUCKET=acme-hrms-dev-documents
KMS_KEY_ID=alias/acme-hrms-dev
MAIL_FROM=Euron Open HRMS <no-reply@hrms.example.com>
```

The file holds resource names only, never credentials. Optional additions:

```bash
# Use a named profile instead of "default" (set in your shell, not in the file):
#   export AWS_PROFILE=hrms-dev
# Attach your SES configuration set to workspace identities the API creates:
SES_CONFIGURATION_SET=acme-hrms-dev-mail
```

## 3. Start

```bash
make up-aws
```

The URLs are the same as with `make up` (web 3410, console 3420, API 5005). `make demo` is
written for the emulator overlay, so seed the demo data with the AWS overlay's file list:

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/compose.yaml -f deploy/compose/compose.aws.yaml \
  exec -T -e DEMO_PASSWORD="$(grep HRMS_DEMO_PASSWORD deploy/compose/.env | cut -d= -f2)" api node dist/cli.js demo:seed
```

Check the API log for the storage line:

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/compose.yaml -f deploy/compose/compose.aws.yaml logs api | grep -i "storage"
```

`file storage ready: s3://<bucket> (<region>)` means the bucket is reachable.
`FILE STORAGE NOT USABLE` is followed by a specific reason (access denied, wrong region,
bucket missing).

## What is different from the emulator

| Area | Behaviour against real AWS |
| --- | --- |
| Mail | Delivered for real through SES. While your SES account is in the sandbox, you can only send to verified addresses. Nothing arrives in Mailpit |
| Personal-data keys | Each workspace's data key is wrapped by your real KMS key. The local database is useless without that key |
| Sending domains | Verification needs real DNS records at your DNS provider, and can take minutes |
| Cost | You pay for KMS requests, S3 storage and requests, and SES sends |

## Stop

```bash
make down
```

`make down` stops both overlays and deletes the local volumes (the database). Objects in
your bucket and SES identities created by workspaces stay in AWS; remove sending domains in
the app before you reset, or delete the identities in SES afterwards.
