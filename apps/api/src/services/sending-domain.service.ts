/**
 * Custom sending domain (per-tenant), adapted
 * to HRMS: one sending domain per org, stored in org.data.emailDomain (no migration).
 * A tenant brings their own domain, publishes DNS, verifies via SES, and (once
 * VERIFIED) sets a From address so HRMS emails send from their brand domain.
 *
 * SES is the verification source of truth.
 */
import type { RequestContext } from "../core/context";
import type { Row } from "../repositories/repository";
import { bad, notFound, HttpError } from "../core/util";
import { systemRepos } from "../repositories/base.repository";
import { createRepositories } from "../repositories";
import * as sesDomains from "../integrations/mail/ses-domains";
import { senderFor, sendTenantMail, MAIL_MODE, PLATFORM_FROM, addressOf } from "../integrations/mail/mailer";

const nowIso = () => new Date().toISOString();
const olderThan24h = (iso) => iso && (Date.now() - new Date(iso).getTime() > 24 * 3600 * 1000);

/**
 * Default local part for the From address, applied automatically the moment a domain
 * verifies. Setting the From address used to be a separate manual step behind a card that
 * only appeared after verification, so a tenant could sit indefinitely at "VERIFIED" while
 * every email still went out from the platform address. That state now cannot exist: the
 * tenant can still change the address, but there is no window in which a verified domain
 * is unused.
 */
const DEFAULT_FROM_LOCAL = "hr";

/**
 * Shape an org.data.emailDomain record for the client (camelCase).
 * `org` is passed so the response can state the address emails are ACTUALLY sent from,
 * which is the one fact the old response omitted and the whole reason a broken setup
 * looked identical to a working one.
 */
function toResponse(ed, org?, extra = {}) {
  if (!ed) return null;
  const sender = org ? senderFor(org) : null;
  // Fall back to the region named inside the records, so a legacy record set shows the
  // mismatch on load rather than only after the tenant clicks "Check verification".
  const recordRegion = ed.region || sesDomains.regionFromRecords(ed.dnsRecords);
  return {
    domain: ed.domain,
    mailFromSubdomain: ed.mailFromSubdomain || null,
    status: ed.status || "PENDING",
    dkimStatus: ed.dkimStatus || null,
    mailFromStatus: ed.mailFromStatus || null,
    dnsRecords: Array.isArray(ed.dnsRecords) ? ed.dnsRecords : [],
    failureReason: ed.failureReason || null,
    verifiedAt: ed.verifiedAt || null,
    lastCheckedAt: ed.lastCheckedAt || null,
    isApex: !!ed.isApex,
    fromAddress: ed.fromAddress || null,
    fromName: ed.fromName || null,
    replyTo: ed.replyTo || null,
    createdAt: ed.createdAt || null,
    // The region these DNS records were built for, and the region we would talk to now.
    // A mismatch means the records can never verify the identity we created.
    region: recordRegion,
    currentRegion: sesDomains.regionOf(),
    regionMismatch: !!(recordRegion && recordRegion !== sesDomains.regionOf()),
    // What actually goes out on the wire right now.
    effectiveFrom: sender ? sender.from : null,
    usingCustomDomain: sender ? sender.usingCustomDomain : false,
    senderFallbackReason: sender ? sender.reason : null,
    mailMode: MAIL_MODE,
    ...extra,
  };
}

/** The caller's workspace row. authRequired has already resolved it, so it exists. */
const loadOrg = async (ctx: RequestContext) => (await ctx.data.organizations.byId(ctx.orgId)) as Row;
const saveDomain = (ctx: RequestContext, ed) => ctx.data.organizations.update(ctx.orgId, { emailDomain: ed });

/** Build a fresh PENDING record for `domain` by provisioning it in the current region. */
async function provision(domain): Promise<any> {
  const { dnsRecords, mailFromSubdomain, region } = await sesDomains.onboard(domain);
  return {
    domain,
    mailFromSubdomain,
    region,
    fromAddress: null,
    fromName: null,
    replyTo: null,
    status: "PENDING",
    dkimStatus: "PENDING",
    mailFromStatus: "PENDING",
    dnsRecords,
    isApex: sesDomains.isApex(domain),
    failureReason: null,
    verifiedAt: null,
    lastCheckedAt: null,
    createdAt: nowIso(),
  };
}

/** The org's sending domain (or null). */
export async function getSendingDomain(ctx: RequestContext) {
  const org = await loadOrg(ctx);
  const ed = org.emailDomain;
  if (!ed) return null;
  const existingDmarcTxt = await sesDomains.lookupExistingDmarc(ed.domain);
  return toResponse(ed, org, { existingDmarcTxt });
}

/**
 * Register + provision a sending domain. `created` is false when the workspace already
 * holds exactly this domain (the call is idempotent).
 */
export async function addSendingDomain(ctx: RequestContext, rawDomain: unknown) {
  const domain = sesDomains.validateDomain(rawDomain);
  const org = await loadOrg(ctx);
  const existing = org.emailDomain;
  if (existing && existing.domain === domain) {
    const existingDmarcTxt = await sesDomains.lookupExistingDmarc(domain);
    return { created: false, domain: toResponse(existing, org, { existingDmarcTxt }) }; // idempotent
  }
  if (existing) throw bad("This workspace already has a sending domain. Remove it first to add another.");

  /*
   * One domain, one workspace.
   *
   * SES identities are account-wide, not per workspace. Without this check a second
   * workspace could register a domain another workspace had already verified: its own
   * "check" would then read the SAME identity, report VERIFIED, and let it send mail as
   * the other workspace. The platform's own sending domain is reserved for the same reason.
   */
  const platformDomain = addressOf(PLATFORM_FROM).split("@")[1]?.toLowerCase();
  if (domain === platformDomain) throw new HttpError(409, "That domain is the platform's own sending domain.", "EMAIL_DOMAIN_TAKEN");
  const holders = await createRepositories(systemRepos()).organizations.holdersOfEmailDomain(domain, ctx.orgId);
  if (holders.length) throw new HttpError(409, "That sending domain is already in use by another workspace.", "EMAIL_DOMAIN_TAKEN");

  const existingDmarcTxt = await sesDomains.lookupExistingDmarc(domain);
  const ed = await provision(domain);
  await saveDomain(ctx, ed);
  await ctx.data.auditLog.create({ action: "EMAIL_DOMAIN_ONBOARD", userId: ctx.user.id, meta: { domain, region: ed.region } });
  return { created: true, domain: toResponse(ed, { ...org, emailDomain: ed }, { existingDmarcTxt }) };
}

/**
 * Rebuild the identity + DNS records in the CURRENT region, keeping the same domain.
 *
 * Recovery path for a record set built against a different region: the MAIL FROM MX value
 * names a region, so records issued for one region can never verify an identity created in
 * another. Without this the only way out was delete-and-re-add, which discards the record
 * and any From address already configured. Verification state resets to PENDING because
 * the tenant genuinely has to publish the new records.
 */
export async function reprovisionSendingDomain(ctx: RequestContext) {
  const org = await loadOrg(ctx);
  const prev = org.emailDomain;
  if (!prev) throw notFound("No sending domain to reprovision");
  const ed = await provision(prev.domain);
  // Carry the sender identity across: re-publishing DNS is no reason to retype it.
  ed.fromAddress = prev.fromAddress || null;
  ed.fromName = prev.fromName || null;
  ed.replyTo = prev.replyTo || null;
  ed.createdAt = prev.createdAt || ed.createdAt;
  await saveDomain(ctx, ed);
  await ctx.data.auditLog.create({
    action: "EMAIL_DOMAIN_REPROVISION",
    userId: ctx.user.id,
    meta: { domain: ed.domain, fromRegion: prev.region || null, toRegion: ed.region },
  });
  const existingDmarcTxt = await sesDomains.lookupExistingDmarc(ed.domain);
  return toResponse(ed, { ...org, emailDomain: ed }, { existingDmarcTxt });
}

/** Re-read SES status and update verification state. */
export async function checkSendingDomain(ctx: RequestContext) {
  const org = await loadOrg(ctx);
  const ed = org.emailDomain;
  if (!ed) throw notFound("No sending domain to check");

  ed.lastCheckedAt = nowIso();

  /*
   * Refuse to answer across a region boundary.
   *
   * SES identities are per-region and the MAIL FROM MX record we handed the tenant names
   * the region it was built for. When those disagree, GetEmailIdentity in the current
   * region either 404s or, worse, answers about a same-named identity created by something
   * else entirely: that is exactly how this workspace came to report VERIFIED against an
   * identity belonging to a different product, while its own identity sat FAILED in the
   * region its DNS records actually pointed at. Reporting the drift is the only honest
   * answer; /reprovision is the way out.
   */
  const currentRegion = sesDomains.regionOf();
  // Records predating the `region` field still name their region inside the MAIL FROM MX
  // value, so recover it rather than assuming the current one.
  if (!ed.region) ed.region = sesDomains.regionFromRecords(ed.dnsRecords);
  if (ed.region && ed.region !== currentRegion) {
    ed.status = "REGION_MISMATCH";
    ed.failureReason =
      `These DNS records were issued for AWS region ${ed.region}, but this workspace now sends through ${currentRegion}. ` +
      `Re-provision the domain to get records for ${currentRegion}, then publish them.`;
    await saveDomain(ctx, ed);
    return toResponse(ed, { ...org, emailDomain: ed });
  }

  const { dkimStatus, mailFromStatus, verified, region } = await sesDomains.check(ed.domain);
  ed.dkimStatus = dkimStatus;
  ed.mailFromStatus = mailFromStatus;
  // Records provisioned before this field existed: adopt the region that just answered,
  // so the drift guard above has something to compare against from here on.
  if (!ed.region) ed.region = region;

  const wasVerified = ed.status === "VERIFIED";
  if (verified) {
    ed.status = "VERIFIED";
    ed.verifiedAt = ed.verifiedAt || nowIso();
    ed.failureReason = null;
    /*
     * Adopt a From address the moment the domain verifies.
     *
     * Setting it was a separate manual step, and skipping it left the workspace VERIFIED
     * while every email still went out from the platform address, with nothing anywhere
     * saying so. Defaulting here removes that state entirely; PUT /sender still changes it.
     */
    if (!ed.fromAddress) {
      ed.fromAddress = `${DEFAULT_FROM_LOCAL}@${ed.domain}`;
      ed.fromName = ed.fromName || org.name || null;
    }
  } else if ((dkimStatus === "FAILED" || mailFromStatus === "FAILED") && olderThan24h(ed.createdAt)) {
    ed.status = "FAILED";
    ed.failureReason = "DNS records have been missing or incorrect for over 24 hours.";
  } else {
    ed.status = wasVerified ? "VERIFIED" : "PENDING";
  }
  await saveDomain(ctx, ed);
  if (verified && !wasVerified) {
    await ctx.data.auditLog.create({
      action: "EMAIL_DOMAIN_VERIFIED",
      userId: ctx.user.id,
      meta: { domain: ed.domain, region: ed.region, fromAddress: ed.fromAddress },
    });
  }
  return toResponse(ed, { ...org, emailDomain: ed });
}

/** Set the From identity on a verified domain. */
export async function setSender(ctx: RequestContext, input: { fromAddress?: unknown; fromName?: unknown; replyTo?: unknown }) {
  const org = await loadOrg(ctx);
  const ed = org.emailDomain;
  if (!ed) throw notFound("No sending domain");
  if (ed.status !== "VERIFIED") throw bad("Verify the domain before setting a From address");
  const fromAddress = String(input.fromAddress || "").trim().toLowerCase();
  const m = /^[^@\s]+@([^@\s]+)$/.exec(fromAddress);
  if (!m) throw bad("Enter a valid From address");
  if (m[1] !== ed.domain) throw bad(`The From address must be on @${ed.domain}`);
  ed.fromAddress = fromAddress;
  ed.fromName = String(input.fromName || "").trim() || null;
  ed.replyTo = String(input.replyTo || "").trim().toLowerCase() || null;
  await saveDomain(ctx, ed);
  await ctx.data.auditLog.create({ action: "EMAIL_DOMAIN_SENDER", userId: ctx.user.id, meta: { fromAddress } });
  return toResponse(ed, { ...org, emailDomain: ed });
}

/**
 * Send a test email through the resolved tenant sender.
 *
 * Always to the caller's own address, never one supplied in the body: this exists to
 * prove the sending identity works, and an arbitrary-recipient sender reachable by anyone
 * holding settings.manage is a spam relay. The result reports the address the message
 * was actually sent FROM, which is the fact being tested.
 */
export async function sendTestEmail(ctx: RequestContext) {
  const org = await loadOrg(ctx);
  const to = ctx.user.email;
  if (!to) throw bad("Your account has no email address to send a test to");
  const sender = senderFor(org);
  const when = new Date().toISOString();
  const result: any = await sendTenantMail(org, {
    to,
    subject: `${org.name}: sending domain test`,
    html:
      `<p>This is a test message from your ${org.name} HRMS workspace.</p>` +
      `<p>It was sent from <b>${sender.from}</b>${sender.usingCustomDomain ? " (your own sending domain)" : " (the platform's shared address)"}.</p>` +
      `<p style="color:#666;font-size:12px">Requested at ${when}.</p>`,
    text: `Test message from your ${org.name} HRMS workspace, sent from ${sender.from} at ${when}.`,
  }, { test: true });
  await ctx.data.auditLog.create({
    action: "EMAIL_DOMAIN_TEST",
    userId: ctx.user.id,
    meta: { to, from: sender.from, usingCustomDomain: sender.usingCustomDomain, delivered: !!result.delivered, mode: result.mode },
  });
  return {
    to,
    from: sender.from,
    usingCustomDomain: sender.usingCustomDomain,
    senderFallbackReason: sender.reason,
    mode: result.mode,
    delivered: !!result.delivered,
    messageId: result.id || null,
    error: result.error || null,
  };
}

/** Remove the sending domain (SES + org.data). Reverts to platform default. */
export async function removeSendingDomain(ctx: RequestContext) {
  const org = await loadOrg(ctx);
  const ed = org.emailDomain;
  if (!ed) throw notFound("No sending domain");
  await sesDomains.remove(ed.domain);
  await saveDomain(ctx, null);
  await ctx.data.auditLog.create({ action: "EMAIL_DOMAIN_DELETE", userId: ctx.user.id, meta: { domain: ed.domain } });
  return { ok: true };
}
