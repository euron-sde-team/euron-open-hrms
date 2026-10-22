/**
 * Public document verification, the shared spine for payslips, offer and
 * relieving letters, experience certificates, ID cards and digital signatures.
 *
 * Every artefact the system issues carries a short code, a clickable URL and a
 * QR encoding that URL. Anyone holding the document, a bank, a landlord, a
 * background-check firm, the next employer, can confirm it is genuine without
 * an account and without contacting HR.
 *
 * Design decisions worth stating, because they are the difference between real
 * verification and decoration:
 *
 * 1. WE SIGN THE CONTENT, NOT JUST THE ID. Each record stores an HMAC over a
 *    canonical digest of the facts the document asserts. A forged PDF quoting a
 *    real code fails, because the digest presented won't match the one signed.
 *
 * 2. THE PUBLIC PAGE DISCLOSES AS LITTLE AS POSSIBLE. Verifying a payslip must
 *    not hand a stranger someone's salary. The default answer is "yes, this is
 *    a genuine payslip issued by X to Y on Z"; amounts are disclosed only when
 *    the issuer explicitly opts in per document.
 *
 * 3. CODES ARE UNGUESSABLE. 60 bits of CSPRNG (12 characters) in Crockford base32, so the
 *    public endpoint cannot be enumerated to harvest employee names.
 *
 * 4. NO MIGRATION. Records live in `auth_tokens` (a globally-indexed table with
 *    a JSONB `data` column) under a distinct type, so lookup by code is O(1)
 *    without adding a table. The developer runs migrations, not this code.
 */

import crypto from "crypto";
import QRCode from "qrcode";
import { systemRepos, readRow, TABLES } from "../repositories/base.repository";
import { db } from "../db/kysely";
import { DEV_DEFAULTS } from "../core/config";

export const VERIFY_TOKEN_TYPE = "DOC_VERIFY";

/** Never expires: a relieving letter must still verify in ten years. */
const FAR_FUTURE = new Date("2999-12-31T00:00:00Z");

/** Crockford base32, no I, L, O or U, so codes survive being read aloud. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomCode(groups = 3, size = 4): string {
  const bytes = crypto.randomBytes(groups * size);
  let out = "";
  for (let i = 0; i < groups * size; i++) {
    if (i > 0 && i % size === 0) out += "-";
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

// assertSecrets() refuses to boot production without a distinct DOC_VERIFY_SECRET,
// so the development default below can never sign a real document.
const secret = () => process.env.DOC_VERIFY_SECRET || DEV_DEFAULTS.DOC_VERIFY_SECRET;

/**
 * Canonical digest of what the document asserts.
 *
 * Keys are sorted so the same facts always hash identically regardless of
 * property order, and values are normalised to strings so 1000 and "1000"
 * cannot produce different digests for the same payslip.
 */
export function contentDigest(facts: Record<string, unknown>): string {
  const canonical = Object.keys(facts)
    .filter((k) => facts[k] !== undefined && facts[k] !== null)
    .sort()
    .map((k) => `${k}=${String(facts[k])}`)
    .join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** HMAC binding the code to the digest, so neither can be swapped alone. */
export function signature(code: string, digest: string): string {
  return crypto.createHmac("sha256", secret()).update(`${code}.${digest}`).digest("hex");
}

export type VerifiableKind =
  | "PAYSLIP"
  | "OFFER_LETTER"
  | "RELIEVING_LETTER"
  | "EXPERIENCE_CERTIFICATE"
  | "APPRAISAL_LETTER"
  | "TERMINATION_LETTER"
  // A confirmation letter is the document banks and landlords most often ask to see, so it
  // carries a verification code like the rest of the employment paperwork.
  | "CONFIRMATION_LETTER"
  | "PROBATION_EXTENSION_LETTER"
  | "ID_CARD"
  | "SIGNED_DOCUMENT";

export const KIND_LABEL: Record<VerifiableKind, string> = {
  PAYSLIP: "Payslip",
  OFFER_LETTER: "Offer letter",
  RELIEVING_LETTER: "Relieving letter",
  EXPERIENCE_CERTIFICATE: "Experience certificate",
  APPRAISAL_LETTER: "Appraisal / increment letter",
  TERMINATION_LETTER: "Termination letter",
  CONFIRMATION_LETTER: "Confirmation of employment",
  PROBATION_EXTENSION_LETTER: "Probation extension letter",
  ID_CARD: "Employee ID card",
  SIGNED_DOCUMENT: "Digitally signed document",
};

export interface IssueInput {
  kind: VerifiableKind;
  orgId: string;
  orgName: string;
  employeeId?: string | null;
  /** Shown publicly, a name and code are the minimum needed to confirm identity. */
  subjectName: string;
  subjectCode?: string | null;
  /** Facts the document asserts. Hashed; only `disclose` keys are shown publicly. */
  facts: Record<string, unknown>;
  /** Fact keys safe to show on the public page. Defaults to none. */
  disclose?: string[];
  /** Links the record back to the stored document row, when there is one. */
  documentId?: string | null;
  issuedBy?: string | null;
  /** Optional validity window (ID cards expire; letters do not). */
  validUntil?: string | null;
}

export interface IssuedVerification {
  code: string;
  url: string;
  digest: string;
  qrDataUrl: string;
}

export function verifyBaseUrl(): string {
  const base = process.env.APP_WEB_URL || process.env.APP_BASE_URL || "http://localhost:3010";
  return base.replace(/\/$/, "");
}

export const verifyUrlFor = (code: string) => `${verifyBaseUrl()}/verify/${code}`;

/**
 * Create a verification record and return its code, URL and QR image.
 *
 * The QR is a data URL so PDF renderers can embed it directly without a round
 * trip to storage.
 */
export async function issueVerification(input: IssueInput): Promise<IssuedVerification> {
  const code = randomCode();
  const digest = contentDigest(input.facts);
  const url = verifyUrlFor(code);

  await systemRepos().authTokens.insert({
    type: VERIFY_TOKEN_TYPE,
    // The code is public and printed on the document, so there is nothing to
    // protect by hashing it, and hashing would prevent lookup by code.
    tokenHash: `${VERIFY_TOKEN_TYPE}:${code}`,
    orgId: input.orgId,
    userId: null,
    email: null,
    expiresAt: FAR_FUTURE,
    usedAt: null,
    data: {
      code,
      kind: input.kind,
      orgName: input.orgName,
      employeeId: input.employeeId ?? null,
      subjectName: input.subjectName,
      subjectCode: input.subjectCode ?? null,
      facts: input.facts,
      disclose: input.disclose ?? [],
      digest,
      signature: signature(code, digest),
      documentId: input.documentId ?? null,
      issuedBy: input.issuedBy ?? null,
      issuedAt: new Date().toISOString(),
      validUntil: input.validUntil ?? null,
      revokedAt: null,
      revokedReason: null,
    },
  });

  const qrDataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#000000", light: "#FFFFFF" },
  });

  return { code, url, digest, qrDataUrl };
}

/** Raw record lookup by public code. */
async function findRecord(code: string) {
  if (!code) return null;
  const clean = String(code).toUpperCase().trim().replace(/\s+/g, "");
  const row = await db
    .selectFrom("auth_tokens")
    .selectAll()
    .where("token_hash", "=", `${VERIFY_TOKEN_TYPE}:${clean}`)
    .where("type", "=", VERIFY_TOKEN_TYPE)
    .executeTakeFirst();
  return row ? readRow(TABLES.authTokens, row) : null;
}

export interface VerificationResult {
  found: boolean;
  valid: boolean;
  status: "VALID" | "REVOKED" | "EXPIRED" | "NOT_FOUND" | "TAMPERED";
  message: string;
  document?: {
    code: string;
    kind: VerifiableKind;
    kindLabel: string;
    issuer: string;
    subjectName: string;
    subjectCode: string | null;
    issuedAt: string;
    validUntil: string | null;
    /** Only the fact keys the issuer chose to disclose. */
    details: Record<string, unknown>;
    digest: string;
  };
}

/**
 * Public verification.
 *
 * `presentedDigest` is optional: a verifier reading a PDF can pass the digest
 * printed on it, and a mismatch proves the document was altered after issue
 * even though the code is real. Without it we can only confirm the code was
 * issued, which is why the digest is printed on the document.
 */
export async function verifyCode(code: string, presentedDigest?: string): Promise<VerificationResult> {
  const rec = await findRecord(code);
  if (!rec) {
    return {
      found: false,
      valid: false,
      status: "NOT_FOUND",
      message: "No document was issued with that code. Check for a typo, or ask the holder to re-share it.",
    };
  }

  const d = rec.data ?? rec;
  const expected = signature(d.code, d.digest);
  if (expected !== d.signature) {
    // The stored record itself doesn't verify, only possible if the row was
    // edited directly in the database.
    return {
      found: true,
      valid: false,
      status: "TAMPERED",
      message: "This verification record failed its integrity check and cannot be trusted.",
    };
  }

  if (presentedDigest && String(presentedDigest).toLowerCase() !== String(d.digest).toLowerCase()) {
    return {
      found: true,
      valid: false,
      status: "TAMPERED",
      message:
        "A document with this code exists, but its contents do not match what was issued. The copy you are holding has been altered.",
    };
  }

  const detail = {
    code: d.code,
    kind: d.kind,
    kindLabel: KIND_LABEL[d.kind as VerifiableKind] ?? d.kind,
    issuer: d.orgName,
    subjectName: d.subjectName,
    subjectCode: d.subjectCode ?? null,
    issuedAt: d.issuedAt,
    validUntil: d.validUntil ?? null,
    // Disclose only what the issuer opted into, verifying a payslip must not
    // hand a stranger someone's salary.
    details: Object.fromEntries(
      (d.disclose ?? []).filter((k: string) => d.facts?.[k] !== undefined).map((k: string) => [k, d.facts[k]])
    ),
    digest: d.digest,
  };

  if (d.revokedAt) {
    return {
      found: true,
      valid: false,
      status: "REVOKED",
      message: d.revokedReason
        ? `This document was revoked by the issuer: ${d.revokedReason}`
        : "This document was revoked by the issuer and is no longer valid.",
      document: detail,
    };
  }

  if (d.validUntil && new Date(d.validUntil) < new Date()) {
    return {
      found: true,
      valid: false,
      status: "EXPIRED",
      message: `This document expired on ${new Date(d.validUntil).toLocaleDateString("en-IN")}.`,
      document: detail,
    };
  }

  return {
    found: true,
    valid: true,
    status: "VALID",
    message: `Genuine ${detail.kindLabel.toLowerCase()} issued by ${d.orgName}.`,
    document: detail,
  };
}

/**
 * Revoke a previously issued document (a superseded ID card, a payslip HR
 * withdrew), so the public page stops calling it genuine.
 *
 * The revocation is written INSIDE the nested `data` object, because that is
 * what verifyCode reads (`rec.data ?? rec`). Spreading it at the top level, as
 * this used to, left `data.revokedAt` null and the code kept verifying as VALID.
 * The signature covers only code + digest, so this does not trip the integrity
 * check. `orgId`, when given, refuses another org's code.
 */
export async function revokeVerification(
  code: string | null | undefined,
  reason: string,
  opts: { orgId?: string; byUserId?: string | null } = {},
) {
  const rec = await findRecord(String(code || ""));
  if (!rec) return false;
  if (opts.orgId && rec.orgId !== opts.orgId) return false;
  const revocation = {
    revokedAt: new Date().toISOString(),
    revokedReason: reason || "",
    revokedBy: opts.byUserId ?? null,
  };
  await systemRepos().authTokens.update(
    rec.id,
    rec.data ? { data: { ...rec.data, ...revocation } } : revocation,
  );
  return true;
}

/** Every verification issued for an employee, powers "my documents". */
export async function verificationsForEmployee(orgId: string, employeeId: string) {
  const rows = await db
    .selectFrom("auth_tokens")
    .selectAll()
    .where("type", "=", VERIFY_TOKEN_TYPE)
    .where("org_id", "=", orgId)
    .execute();
  return rows
    .map((r) => readRow(TABLES.authTokens, r))
    .filter((r: any) => (r.data ?? r).employeeId === employeeId)
    .map((r: any) => {
      const d = r.data ?? r;
      return {
        code: d.code,
        kind: d.kind,
        kindLabel: KIND_LABEL[d.kind as VerifiableKind] ?? d.kind,
        issuedAt: d.issuedAt,
        validUntil: d.validUntil,
        revokedAt: d.revokedAt,
        url: verifyUrlFor(d.code),
        documentId: d.documentId,
      };
    })
    .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
}

/** QR image for an already-issued code, for re-rendering. */
export async function qrFor(code: string): Promise<string> {
  return QRCode.toDataURL(verifyUrlFor(code), { errorCorrectionLevel: "M", margin: 1, width: 320 });
}
