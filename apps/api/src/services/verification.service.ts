/**
 * Public document verification: "is this document genuine?" for a bank, landlord or next
 * employer, without an account. No caller context: the code itself is the only input.
 * The cryptography lives in security/verification.ts.
 */
import { bad } from "../core/util";
import { verifyCode, qrFor } from "../security/verification";

/**
 * Look a verification code up. Pass `digest` (printed on the document) to also prove the
 * copy in hand matches what was issued; without it we can only confirm the code is real.
 */
export async function verifyDocument(rawCode: unknown, digest?: string) {
  const code = String(rawCode || "").trim();
  if (!code || code.length > 32) throw bad("Provide a verification code");
  // A missing code is a legitimate answer to a legitimate question, not a
  // client error, the caller wants "is this genuine?", and "no" is an answer.
  return verifyCode(code, digest);
}

/** The QR image for a known code, for re-rendering or sharing. */
export async function verificationQr(rawCode: unknown) {
  const code = String(rawCode || "").trim();
  const result = await verifyCode(code);
  if (!result.found) throw bad("Unknown verification code");
  return { code, qrDataUrl: await qrFor(code) };
}
