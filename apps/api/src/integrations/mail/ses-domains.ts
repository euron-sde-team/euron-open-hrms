/**
 * AWS SES custom sending-domain provisioning (SES v2). Faithful port of the
 * Per-tenant "bring your own sending domain" core:
 *   onboard -> create domain identity with Easy DKIM + custom MAIL FROM -> hand the
 *   tenant a list of DNS records -> poll GetEmailIdentity until DKIM + MAIL FROM
 *   both report SUCCESS -> VERIFIED.
 *
 * SES is the source of truth for verification (not raw DNS). All AWS calls are
 * idempotent (AlreadyExists / NotFound are swallowed). One sending domain per org.
 *
 * Uses the same AWS credentials as the mailer (AWS_ACCESS_KEY_ID/SECRET, SES_REGION).
 */
import { promises as dnsp } from "dns";
import { bad } from "../../core/util";
import { PRODUCT_ID } from "../../core/product";
import { awsClientConfig, awsRegion } from "../../core/aws";

/**
 * The SES region, read on EVERY call rather than captured once at module load.
 *
 * An identity lives in exactly one region, and the MAIL FROM MX record handed to the
 * tenant names that region (`feedback-smtp.<region>.amazonses.com`). Capturing the value
 * at import time meant a later env change silently split the two: records were built for
 * the old region while `check()` queried the new one. A tenant then published records that
 * could never verify the identity we actually created, and `check()` reported on whatever
 * identity happened to exist in the new region, including one created by a different
 * product entirely. Reading it per call keeps every SES call and every emitted record
 * agreed on one region, and `regionOf()` lets callers store which region a record was
 * built for so a later drift is detectable rather than silent.
 */
export const regionOf = () => awsRegion("ses");

// Lazy-load the SDK; the client is cached per region so a region change builds a new one
// instead of reusing a client still pointed at the previous region.
let SES: any = null;
const clients = new Map<string, any>();
function ses() {
  const region = regionOf();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the SES SDK loads only when a workspace manages a sending domain
  if (!SES) SES = require("@aws-sdk/client-sesv2");
  if (!clients.has(region)) {
    clients.set(region, new SES.SESv2Client({ ...awsClientConfig("ses"), region }));
  }
  return { SES, client: clients.get(region), region };
}

// A domain (apex like acme.io, or a subdomain like mail.acme.io).
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** Normalize + validate a sending domain; throws BadRequestError on bad input. */
export function validateDomain(raw) {
  const d = String(raw || "").trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(d)) throw bad("Enter a valid domain, e.g. mail.yourschool.com");
  return d;
}

/** Heuristic: a 2-label domain (acme.io) is an apex -> warn the tenant. */
export const isApex = (d) => String(d).split(".").length === 2;

/** Build the DNS records the tenant must publish (DKIM CNAMEs, MAIL FROM, SPF, DMARC). */
export function buildDnsRecords(domain, dkimTokens, region) {
  const recs: { type: string; name: string; value: string; purpose: string; priority?: number }[] = [];
  for (const t of dkimTokens) {
    recs.push({ type: "CNAME", name: `${t}._domainkey.${domain}`, value: `${t}.dkim.amazonses.com`, purpose: "DKIM" });
  }
  recs.push({ type: "MX", name: `bounce.${domain}`, value: `feedback-smtp.${region}.amazonses.com`, priority: 10, purpose: "MAIL_FROM_MX" });
  // TXT values are stored UNQUOTED. The surrounding double quotes are BIND zone-file syntax,
  // not part of the record, and every hosted DNS manager (Cloudflare, Route 53, GoDaddy,
  // Namecheap) adds its own quoting on save. Pasting a pre-quoted value there publishes
  // ""v=spf1 ..."", which does not match and fails verification with no useful error.
  recs.push({ type: "TXT", name: `bounce.${domain}`, value: "v=spf1 include:amazonses.com ~all", purpose: "MAIL_FROM_SPF" });
  recs.push({ type: "TXT", name: `${domain}`, value: "v=spf1 include:amazonses.com ~all", purpose: "SENDING_SPF" });
  recs.push({ type: "TXT", name: `_dmarc.${domain}`, value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}`, purpose: "DMARC" });
  return recs;
}

/**
 * Recover the region a stored record set was built for, from the records themselves.
 *
 * `region` was only added to the stored record after this drift was found, so records
 * created earlier carry no explicit region. They do carry it implicitly: the MAIL FROM MX
 * value is `feedback-smtp.<region>.amazonses.com`. Reading it back is strictly better than
 * assuming the current region, which is the assumption that let a mismatched workspace
 * report VERIFIED in the first place. Returns null when it cannot be determined.
 */
export function regionFromRecords(dnsRecords) {
  const mx = (dnsRecords || []).find((r) => r && r.purpose === "MAIL_FROM_MX");
  const m = mx && /^feedback-smtp\.([a-z0-9-]+)\.amazonses\.com$/.exec(String(mx.value || "").trim());
  return m ? m[1] : null;
}

/** Best-effort lookup of an already-published DMARC record (so apex tenants don't clobber it). */
export async function lookupExistingDmarc(domain) {
  try {
    const txt = await dnsp.resolveTxt(`_dmarc.${domain}`);
    const flat = (txt || []).map((chunks) => chunks.join(""));
    return flat.find((v) => /v=DMARC1/i.test(v)) || null;
  } catch {
    return null; // NXDOMAIN / no record -> nothing to warn about
  }
}

/**
 * Provision SES for a domain: create the identity (Easy DKIM, RSA 2048) and set a
 * custom MAIL FROM (bounce.{domain}). Idempotent. Returns DKIM tokens + DNS records.
 */
export async function onboard(domain) {
  const { SES, client, region } = ses();
  let tokens = [];
  try {
    const out = await client.send(new SES.CreateEmailIdentityCommand({
      EmailIdentity: domain,
      DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" }, // Easy DKIM
      Tags: [{ Key: "app", Value: PRODUCT_ID }],
      // The platform's configuration set (TLS required, bounces and complaints
      // suppressed, reputation metrics) applies to workspace domains too.
      ...(process.env.SES_CONFIGURATION_SET ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET } : {}),
    }));
    tokens = (out.DkimAttributes && out.DkimAttributes.Tokens) || [];
  } catch (e: any) {
    if (e && e.name === "AlreadyExistsException") {
      const got = await client.send(new SES.GetEmailIdentityCommand({ EmailIdentity: domain }));
      tokens = (got.DkimAttributes && got.DkimAttributes.Tokens) || [];
    } else {
      throw e;
    }
  }
  // Custom MAIL FROM aligns the bounce/return-path with the tenant's domain.
  await client.send(new SES.PutEmailIdentityMailFromAttributesCommand({
    EmailIdentity: domain,
    MailFromDomain: `bounce.${domain}`,
    BehaviorOnMxFailure: "REJECT_MESSAGE",
  }));
  return {
    tokens,
    region,
    mailFromSubdomain: `bounce.${domain}`,
    dnsRecords: buildDnsRecords(domain, tokens, region),
  };
}

/**
 * Read live DKIM + MAIL FROM status from SES (the verification source of truth).
 * Returns the region the answer came from so the caller can compare it against the region
 * the tenant's DNS records were built for.
 */
export async function check(domain) {
  const { SES, client, region } = ses();
  const got = await client.send(new SES.GetEmailIdentityCommand({ EmailIdentity: domain }));
  const dkimStatus = (got.DkimAttributes && got.DkimAttributes.Status) || null; // PENDING|SUCCESS|FAILED|...
  const mailFromStatus = (got.MailFromAttributes && got.MailFromAttributes.MailFromDomainStatus) || null;
  return { dkimStatus, mailFromStatus, region, verified: dkimStatus === "SUCCESS" && mailFromStatus === "SUCCESS" };
}

/** Tear down the SES identity (best effort). */
export async function remove(domain) {
  const { SES, client } = ses();
  try {
    await client.send(new SES.DeleteEmailIdentityCommand({ EmailIdentity: domain }));
  } catch (e: any) {
    if (!e || e.name !== "NotFoundException") throw e;
  }
}
