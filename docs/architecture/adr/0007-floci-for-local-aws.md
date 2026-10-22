# ADR 0007: Develop against an AWS emulator (Floci), provisioned by the production Terraform

## Status

Accepted.

## Context

In production the API depends on S3 (documents), KMS (personal-data keys), Secrets
Manager, and SES (platform mail and per-workspace sending domains, including DKIM
verification). Local development that swaps each of these for a different mechanism (disk
files, a hard-coded key, an `.eml` outbox) leaves the most security-sensitive code paths
untested until they reach a real AWS account. The infrastructure code itself also needs a
place to run on every change without credentials.

## Decision

- `make up` runs the Floci AWS emulator (`floci/floci`, MIT licence) alongside Postgres,
  Mailpit and the three app images.
- A one-shot Terraform container applies `infra/terraform/envs/local-floci` against the
  emulator before the API starts. That environment uses the **same** `kms`, `storage`,
  `secrets` and `email` modules as production, with only the endpoint and a few
  emulator-specific switches changed (no TLS-only bucket policy, versioning off,
  force-destroy on).
- The API runs locally with `STORAGE=s3`, `KMS_MODE=aws` and `MAIL_MODE=ses`, pointed at the
  emulator with `AWS_ENDPOINT_URL`.
- The emulator relays SES sends to Mailpit, so mail can be read in a browser.
- The platform sending identity is verified locally the same way as on AWS: the emulator
  keeps a domain identity pending until its DKIM records exist in a Route53 zone, so the
  local environment creates the zone and the records through the production `email` module.
- Terraform state for the local environment lives in a Docker volume and is wiped with the
  emulator by `make down`.
- The other backends (`STORAGE=local`, `MAIL_MODE=outbox|smtp`, `KMS_MODE=local`) remain
  supported, and `make test-matrix` runs the integration suite under all 12 combinations.

## Consequences

Positive:

- Developers and CI exercise the real SDK calls, KMS encryption contexts, SSE-KMS buckets
  and the full sending-domain lifecycle without an AWS account.
- The Terraform modules are applied on every `make up`, not only on deploy.
- Mail is observable end to end.

Trade-offs:

- An emulator is not AWS. IAM policy evaluation, service quotas, SES sandbox rules and
  real DNS propagation are not reproduced; [deploy-aws.md](../../guides/deploy-aws.md) and
  `make up-aws` cover the gap.
- Some behaviour differs in timing: SES verification completes in seconds on the emulator
  and can take minutes on AWS.
- One more container and image version to keep current.

## Alternatives considered

- **Per-service local substitutes** (disk, MinIO, an SMTP catcher, a static key). Simple,
  but the production code paths for KMS and SES would go untested locally.
- **LocalStack.** A comparable emulator offering the same approach; Floci is the one this
  project is built and tested against.
- **A shared development AWS account.** Highest fidelity, but needs credentials for every
  contributor, costs money, and shared state makes tests interfere with each other.
