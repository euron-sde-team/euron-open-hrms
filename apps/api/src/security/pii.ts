/**
 * Field-level encryption for personal data at rest (envelope encryption).
 *
 * HR data includes identifiers that are dangerous in a leaked database dump or an old
 * backup: national ID numbers (Aadhaar is stored in full because PF and ESIC filing
 * need it), tax IDs, passport numbers and bank accounts. Those fields are sealed before
 * they reach Postgres and opened when a row is read, inside the repository layer
 * (repo.ts), so no route or service can forget to do it.
 *
 *   KMS key (AWS KMS, or a local master key in development)
 *     └─ wraps one 256-bit data key per workspace       table org_data_keys
 *          └─ seals each sensitive field, AES-256-GCM    { "$enc": "v1", iv, ct, tag }
 *
 * Properties:
 *  - The plaintext data key exists only in this process's memory (cached briefly).
 *  - The GCM additional data binds table, workspace, row id and field name, so a
 *    ciphertext copied into another row, column or workspace fails authentication.
 *  - Deleting a workspace's org_data_keys row crypto-shreds its sealed fields, including
 *    the copies in database backups taken before the purge.
 *  - Rows written before encryption was enabled are read as-is (no backfill needed);
 *    they are sealed the next time they are saved.
 *
 * Who may READ a decrypted value is not decided here: that stays with the route-level
 * permission and scope checks (documents.manage, employees.manage, department/office
 * scope, or the employee themselves).
 */
import crypto from "crypto";
import { db } from "../db/kysely";
import { awsClientConfig } from "../core/aws";
import { DEV_DEFAULTS } from "../core/config";
import { PRODUCT_ID } from "../core/product";

/**
 * Which jsonb fields are sealed, per table. Each entry is a top-level key of the row's
 * `data` document; its whole value (object, array or scalar) becomes one envelope.
 * Hot columns can never be listed here: they are queried in SQL.
 */
export const ENCRYPTED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // kyc: national ID, tax ID, passport, driving licence, voter ID, pension/insurance numbers.
  // bank: account number, IFSC/routing, bank name.
  employees: ["kyc", "bank"],
  // Candidate answers collected during self-onboarding, before HR maps them onto the
  // employee record. They carry the same identifiers as kyc and bank.
  onboarding_cases: ["sections"],
  vendors: ["bank"],
};

export type Envelope = { $enc: "v1"; iv: string; ct: string; tag: string };

export const isEnvelope = (v: unknown): v is Envelope =>
  !!v && typeof v === "object" && (v as any).$enc === "v1" && typeof (v as any).ct === "string";

export type KeyScheme = "kms" | "local";

/** "aws" uses KMS_KEY_ID; "local" uses PII_MASTER_KEY. Defaults to aws when a KMS key is configured. */
export function keyScheme(env = process.env): KeyScheme {
  const mode = String(env.KMS_MODE || (env.KMS_KEY_ID ? "aws" : "local")).toLowerCase();
  if (mode === "aws" || mode === "kms") return "kms";
  if (mode === "local") return "local";
  throw new Error(`KMS_MODE must be "aws" or "local" (got "${mode}")`);
}

// ── Key wrapping ────────────────────────────────────────────────────────────

/** 32-byte master key for the local scheme. The development fallback is refused in production (config.ts). */
function localMasterKey(): Buffer {
  const raw = process.env.PII_MASTER_KEY;
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("PII_MASTER_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
    return key;
  }
  return crypto.createHash("sha256").update(DEV_DEFAULTS.PII_MASTER_KEY_SEED).digest();
}

function wrapLocal(dataKey: Buffer, orgId: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", localMasterKey(), iv);
  c.setAAD(Buffer.from(`${PRODUCT_ID}|org-data-key|${orgId}`));
  const ct = Buffer.concat([c.update(dataKey), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

function unwrapLocal(wrapped: string, orgId: string): Buffer {
  const buf = Buffer.from(wrapped, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", localMasterKey(), buf.subarray(0, 12));
  d.setAAD(Buffer.from(`${PRODUCT_ID}|org-data-key|${orgId}`));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

let kms: any = null;
let KMS: any = null;
function kmsClient() {
  if (!kms) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the KMS SDK loads only when KMS_MODE=aws
    KMS = require("@aws-sdk/client-kms");
    kms = new KMS.KMSClient(awsClientConfig("kms"));
  }
  return kms;
}

async function wrapKms(dataKey: Buffer, orgId: string): Promise<{ wrapped: string; keyRef: string }> {
  const keyId = process.env.KMS_KEY_ID;
  if (!keyId) throw new Error("KMS_MODE=aws requires KMS_KEY_ID");
  const out = await kmsClient().send(
    new KMS.EncryptCommand({ KeyId: keyId, Plaintext: dataKey, EncryptionContext: { orgId, purpose: "pii" } })
  );
  return { wrapped: Buffer.from(out.CiphertextBlob).toString("base64"), keyRef: String(out.KeyId || keyId) };
}

async function unwrapKms(wrapped: string, orgId: string): Promise<Buffer> {
  kmsClient();
  const out = await kms.send(
    new KMS.DecryptCommand({ CiphertextBlob: Buffer.from(wrapped, "base64"), EncryptionContext: { orgId, purpose: "pii" } })
  );
  return Buffer.from(out.Plaintext);
}

// ── Per-workspace data keys ─────────────────────────────────────────────────

/** Unwrapped keys are reused for this long, so KMS sees one Decrypt per workspace per window. */
export const DATA_KEY_CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { key: Buffer; at: number }>();
const inflight = new Map<string, Promise<Buffer>>();

async function loadOrCreateKey(orgId: string): Promise<Buffer> {
  const existing = await db.selectFrom("org_data_keys").selectAll().where("org_id", "=", orgId).executeTakeFirst();
  if (existing) {
    return existing.scheme === "kms" ? unwrapKms(existing.wrapped_key, orgId) : unwrapLocal(existing.wrapped_key, orgId);
  }
  const fresh = crypto.randomBytes(32);
  const scheme = keyScheme();
  const { wrapped, keyRef } =
    scheme === "kms" ? await wrapKms(fresh, orgId) : { wrapped: wrapLocal(fresh, orgId), keyRef: "local" };
  // Two replicas can race to create the first key; the loser adopts the winner's.
  const inserted = await db
    .insertInto("org_data_keys")
    .values({ org_id: orgId, scheme, key_ref: keyRef, wrapped_key: wrapped })
    .onConflict((oc) => oc.column("org_id").doNothing())
    .returning("org_id")
    .executeTakeFirst();
  return inserted ? fresh : loadOrCreateKey(orgId);
}

/** The workspace's data key, created on first use. */
export async function dataKeyFor(orgId: string): Promise<Buffer> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < DATA_KEY_CACHE_MS) return hit.key;
  const pending = inflight.get(orgId);
  if (pending) return pending;
  const p = loadOrCreateKey(orgId)
    .then((key) => {
      cache.set(orgId, { key, at: Date.now() });
      return key;
    })
    .finally(() => inflight.delete(orgId));
  inflight.set(orgId, p);
  return p;
}

/** Destroy a workspace's data key. Its sealed fields become permanently unreadable. */
export async function shredDataKey(orgId: string): Promise<void> {
  await db.deleteFrom("org_data_keys").where("org_id", "=", orgId).execute();
  cache.delete(orgId);
}

/** Visible for tests. */
export function resetDataKeyCache(): void {
  cache.clear();
  inflight.clear();
  kms = null;
}

// ── Field sealing ───────────────────────────────────────────────────────────

const aadFor = (table: string, orgId: string, rowId: string, field: string) =>
  Buffer.from(`${PRODUCT_ID}|${table}|${orgId}|${rowId}|${field}`);

export function seal(key: Buffer, value: unknown, aad: Buffer): Envelope {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return { $enc: "v1", iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64") };
}

export function open(key: Buffer, env: Envelope, aad: Buffer): unknown {
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  d.setAAD(aad);
  d.setAuthTag(Buffer.from(env.tag, "base64"));
  const pt = Buffer.concat([d.update(Buffer.from(env.ct, "base64")), d.final()]);
  return JSON.parse(pt.toString("utf8"));
}

/** Seal the table's sensitive fields in a `data` document about to be written. Returns a copy. */
export async function sealFields(table: string, orgId: string | null, rowId: string, data: Record<string, any>) {
  const fields = ENCRYPTED_FIELDS[table];
  if (!fields || !orgId) return data;
  const present = fields.filter((f) => data[f] !== undefined && data[f] !== null && !isEnvelope(data[f]));
  if (!present.length) return data;
  const key = await dataKeyFor(orgId);
  const out = { ...data };
  for (const f of present) out[f] = seal(key, data[f], aadFor(table, orgId, rowId, f));
  return out;
}

/** Open the sensitive fields of a record read from `table`. Mutates and returns the record. */
export async function openFields<T extends Record<string, any>>(table: string, record: T): Promise<T> {
  const fields = ENCRYPTED_FIELDS[table];
  if (!fields || !record) return record;
  const sealed = fields.filter((f) => isEnvelope(record[f]));
  if (!sealed.length) return record;
  const orgId = String(record.orgId);
  const key = await dataKeyFor(orgId);
  for (const f of sealed) {
    (record as any)[f] = open(key, record[f], aadFor(table, orgId, String(record.id), f));
  }
  return record;
}
