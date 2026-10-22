# ADR 0005: Envelope encryption of personal identifiers, one data key per workspace

## Status

Accepted.

## Context

An HRMS stores identifiers that are dangerous in a leaked database dump or an old backup:
national ID numbers (Aadhaar in full, because PF and ESIC filing require all twelve
digits), tax IDs, passport numbers and bank accounts. Disk-level encryption (RDS storage
encryption) protects against stolen disks, not against a dump, a mis-shared snapshot or a
read replica in the wrong hands. Deleting a customer must also be able to make their data
unrecoverable, including from backups that cannot be edited.

## Decision

- **Envelope encryption in the repository layer.** Fields listed in `ENCRYPTED_FIELDS`
  (`apps/api/src/security/pii.ts`): `employees.kyc`, `employees.bank`,
  `onboarding_cases.sections`, `vendors.bank`. They are sealed with AES-256-GCM on every
  write and opened on every read inside the scoped store, so no service can forget either.
- **One 256-bit data key per workspace**, stored wrapped in `org_data_keys`, created on
  first use, cached in memory for 10 minutes.
- **Key-encryption key**: AWS KMS (`KMS_MODE=aws`) with `EncryptionContext {orgId, purpose:
  "pii"}`, and an IAM condition so the task role can use the key for this purpose only; or,
  outside AWS, a 32-byte `PII_MASTER_KEY` (`KMS_MODE=local`). Production refuses to boot
  without one of them.
- **Binding**: the GCM additional data is `product|table|orgId|rowId|field`, so ciphertext
  cannot be moved between rows, fields or workspaces.
- **Crypto-shredding**: purging a workspace deletes its key row after its data rows and
  before the workspace row, making every sealed value unreadable everywhere, backups
  included.
- **No backfill**: plaintext legacy values are read as-is and sealed on next save.

## Consequences

Positive:

- A database dump or snapshot alone does not reveal identifiers.
- Deletion is provable for sealed fields, even in immutable backups.
- KMS usage is roughly one Decrypt per workspace per task per 10 minutes, not one per field.
- Cross-tenant ciphertext substitution is detected.

Trade-offs:

- Sealed fields cannot be searched, filtered or indexed in SQL; they are `data` keys by
  construction.
- Only the listed fields are protected. Names, contact details and salaries remain readable
  to anyone who can read the database; files in S3 rely on SSE-KMS with the deployment key
  and are not crypto-shredded.
- Losing the key-encryption key (a deleted KMS key, a lost `PII_MASTER_KEY`) loses every
  sealed field in every workspace. There is no re-wrap tool for changing `PII_MASTER_KEY`.
- A compromised API task can still decrypt, because it must in order to serve requests.
- Authorisation over decrypted values stays with the routes and services.

## Alternatives considered

- **RDS storage encryption only.** Already on; does not address dumps, snapshots shared by
  mistake or deletion from backups.
- **Postgres `pgcrypto` in SQL.** Puts keys or passphrases in queries and the database
  session, and ties encryption to SQL paths the repository does not otherwise need.
- **One key for the whole deployment.** Simpler, but no per-workspace shredding and a single
  ciphertext domain across tenants.
- **A key per field or per row.** Finer shredding, but multiplies key management and KMS
  calls without a matching requirement.
- **Tokenisation through an external vault.** Strong, but adds a critical external
  dependency to every read of an employee record.
