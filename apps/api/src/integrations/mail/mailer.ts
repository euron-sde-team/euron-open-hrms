/**
 * Email sender. Three modes (MAIL_MODE):
 *  - outbox : (default) writes each message as a .eml file under data/outbox/ and
 *             logs it, so email flows work locally with no mail server. (the "stub")
 *  - smtp   : real delivery via a nodemailer SMTP transport (configure SMTP_* in .env)
 *  - ses    : real delivery via AWS SES (SESv2). Builds the full MIME (so HTML +
 *             attachments work) and sends it raw. Requires a verified MAIL_FROM and
 *             AWS credentials/region. Off until you set MAIL_MODE=ses.
 */
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { DATA_DIR } from "../../core/data-dir";
import { logger } from "../../core/logger";
import { PRODUCT_NAME } from "../../core/product";
import { awsClientConfig } from "../../core/aws";

const MODE = (process.env.MAIL_MODE || "outbox").toLowerCase();
const FROM = process.env.MAIL_FROM || `${PRODUCT_NAME} <no-reply@example.com>`;

let smtpTransport: any = null;
if (MODE === "smtp") {
  smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

// SES is lazy-loaded only when MAIL_MODE=ses, so the SDK never loads otherwise.
let ses: any = null, SES: any = null;
if (MODE === "ses") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the SES SDK loads only when MAIL_MODE=ses
  SES = require("@aws-sdk/client-sesv2");
  ses = new SES.SESv2Client(awsClientConfig("ses"));
}

function outbox() {
  const d = path.join(DATA_DIR, "outbox");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Build a full RFC822 MIME message (with attachments) as a Buffer. */
async function buildMime(message) {
  const streamT = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  const info = await streamT.sendMail(message);
  return info.message;
}

/**
 * Send an email.
 * @param {{to:string, subject:string, html?:string, text?:string, attachments?:Array}} msg
 */
/** Outcome of a send. `delivered` is false for outbox mode and for failures (then `error` says why). */
export type MailResult = {
  delivered: boolean;
  mode: string;
  id?: string;
  file?: string;
  attachments?: unknown;
  error?: string;
};

async function sendMail(msg): Promise<MailResult> {
  const message = { from: FROM, ...msg };

  if (MODE === "smtp" && smtpTransport) {
    const info = await smtpTransport.sendMail(message);
    return { delivered: true, mode: "smtp", id: info.messageId };
  }

  if (MODE === "ses" && ses) {
    const raw = await buildMime(message); // MIME supports HTML + attachments uniformly
    const out = await ses.send(new SES.SendEmailCommand({
      FromEmailAddress: message.from, // honor a per-tenant From; matches the MIME From header
      Destination: { ToAddresses: [msg.to] },
      Content: { Raw: { Data: raw } },
    }));
    return { delivered: true, mode: "ses", id: out.MessageId };
  }

  // outbox mode (default / stub), save the MIME so it opens in any mail client.
  const raw = await buildMime(message);
  const safe = (msg.to || "unknown").replace(/[^a-z0-9._@-]/gi, "_");
  const file = path.join(outbox(), `${Date.now()}_${safe}.eml`);
  fs.writeFileSync(file, raw as any);
  const nAtt = (msg.attachments || []).length;
  console.log(`[mail:outbox] -> ${msg.to} | ${msg.subject} | ${nAtt} attachment(s) | saved ${path.basename(file)}`);
  return { delivered: false, mode: "outbox", file: path.basename(file), attachments: nAtt };
}

/**
 * Send an email but NEVER throw. A mail-provider failure (e.g. an unverified SES
 * sender, a transient outage) must not break the user action that triggered it
 * (signup, invite, password reset…). Logs the failure and returns a result with
 * `delivered:false` + `error`, so callers keep their normal generic response.
 */
async function sendMailSafe(msg, context = {}): Promise<MailResult> {
  try {
    return await sendMail(msg);
  } catch (err: any) {
    logger.error({ err, to: msg && msg.to, subject: msg && msg.subject, ...context }, "email send failed");
    return { delivered: false, mode: MODE, error: err && err.message ? err.message : "send failed" };
  }
}

/** Just the address part of a "Name <addr@x>" (or a bare address). */
function addressOf(from) {
  const m = String(from || "").match(/<([^>]+)>/);
  return m ? m[1].trim() : String(from || "").trim();
}

/**
 * Resolve the sender for a tenant, and say WHY when the custom domain isn't used.
 *
 * Priority: VERIFIED custom sending domain -> the org's `emailSenderName` over the
 * platform's verified address (display-name only, no DNS setup) -> the platform default.
 *
 * The `reason` exists because the failure was previously invisible. A tenant who verified
 * their domain but never completed the separate "set a From address" step got the platform
 * address on every email with no signal anywhere, which reads as "the feature is broken".
 * Callers surface this to the UI so a half-finished setup is legible instead of silent.
 *
 * Always returns a sender; `usingCustomDomain` says whether it is the tenant's own.
 * `org` is a flattened org row (org.emailDomain / org.emailSenderName live in org.data).
 */
function senderFor(org) {
  const ed = org && org.emailDomain;
  if (ed && ed.status === "VERIFIED" && ed.fromAddress) {
    const name = ed.fromName || org.name || "";
    return {
      from: name ? `${name} <${ed.fromAddress}>` : ed.fromAddress,
      replyTo: ed.replyTo || undefined,
      usingCustomDomain: true,
      reason: null,
    };
  }
  const reason = !ed
    ? "NO_DOMAIN"
    : ed.status !== "VERIFIED"
      ? "NOT_VERIFIED"
      : "NO_FROM_ADDRESS"; // verified, but the From address step was never completed

  // Display-name override on the platform's verified address.
  const senderName = org && typeof org.emailSenderName === "string" ? org.emailSenderName.trim() : "";
  if (senderName) {
    return { from: `${senderName} <${addressOf(FROM)}>`, replyTo: undefined, usingCustomDomain: false, reason };
  }
  return { from: FROM, replyTo: undefined, usingCustomDomain: false, reason };
}

/**
 * The From line for a tenant, or null to mean "use the platform default".
 * Thin wrapper over senderFor() kept for callers that only need the override.
 */
function resolveTenantFrom(org) {
  const s = senderFor(org);
  return s.usingCustomDomain || s.from !== FROM ? { from: s.from, replyTo: s.replyTo } : null;
}

/**
 * Send on behalf of a tenant: routes through their verified custom sending domain
 * when configured, else the org's preferred sender name, else the platform default.
 * Never throws (uses sendMailSafe).
 */
async function sendTenantMail(org, msg, context = {}): Promise<MailResult> {
  const s = senderFor(org);
  const m = { ...msg, from: s.from, replyTo: msg.replyTo || s.replyTo };
  return sendMailSafe(m, {
    orgId: org && org.id,
    customDomain: s.usingCustomDomain,
    // Why the tenant's own domain wasn't used, so a misconfigured workspace is
    // diagnosable from the logs rather than only from the database.
    senderFallback: s.reason,
    ...context,
  });
}

export { sendMail, sendMailSafe, sendTenantMail, resolveTenantFrom, senderFor, addressOf, FROM as PLATFORM_FROM, MODE as MAIL_MODE };
