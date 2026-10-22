-- Per-workspace data-encryption keys for PII at rest (see docs/architecture/security.md).
--
-- Each row holds one workspace's 256-bit data key, WRAPPED: by AWS KMS (scheme 'kms',
-- EncryptionContext {orgId}) or by the deployment's local master key (scheme 'local',
-- AES-256-GCM with the org id as AAD). The plaintext key never touches the database.
-- Deleting a row crypto-shreds that workspace's encrypted fields, including copies in
-- old backups, which is why workspace purge deletes it explicitly.
CREATE TABLE "org_data_keys" (
    "org_id"      TEXT NOT NULL,
    "scheme"      TEXT NOT NULL,
    "key_ref"     TEXT,
    "wrapped_key" TEXT NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_data_keys_pkey" PRIMARY KEY ("org_id"),
    CONSTRAINT "org_data_keys_scheme_check" CHECK ("scheme" IN ('kms', 'local'))
);
