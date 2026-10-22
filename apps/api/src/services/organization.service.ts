/**
 * The workspace itself: profile, letterhead and branding, logo and signatory signature,
 * workspace-wide settings, geo-fenced offices, and the full data export.
 */
import type { RequestContext } from "../core/context";
import type { Row } from "../repositories/repository";
import { bad, notFound } from "../core/util";
import * as storage from "../integrations/storage";
import { processSignature } from "../pdf/signature";
import { exportOrg, exportFilename } from "./export.service";
import { getRuleset, normalizeCountry } from "../domain/payroll/countries";
import { EMAIL_RE } from "../core/validate";
import { sniffImageType, sanitizeSvg, EXT_FOR } from "../domain/branding-image";

/** The caller's workspace row. authRequired has already resolved it, so it exists. */
const currentOrg = async (ctx: RequestContext) => (await ctx.data.organizations.byId(ctx.orgId)) as Row;

/** A stored image to stream back, with the type it is safe to serve as. */
export interface StoredImage {
  contentType: string;
  body: Buffer;
}

/** Current organization + its offices. */
export async function getOrganization(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const offices = await ctx.data.offices.all();
  return { org, offices };
}

/** Store a new workspace logo and drop the previous one. */
export async function uploadLogo(ctx: RequestContext, file: { buffer: Buffer } | undefined) {
  if (!file) throw bad("An image file is required");
  // Trust the file's MAGIC BYTES (structure, for SVG), not the client mimetype.
  const detected = sniffImageType(file.buffer);
  if (!detected) throw bad("The logo must be an SVG, PNG, JPEG, GIF, or WEBP image");
  let body: Buffer = file.buffer;
  if (detected === "image/svg+xml") {
    const clean = sanitizeSvg(body);
    if (!clean) throw bad("That SVG could not be read safely. Export it as a plain SVG, or upload a PNG.");
    body = clean; // only the rebuilt markup is ever stored
  }
  const filename = `logo_${ctx.orgId}_${Date.now()}${EXT_FOR[detected]}`;
  await storage.putBuffer("uploads", filename, body, detected);
  const org = await currentOrg(ctx);
  const previous = org.branding && org.branding.logoFile;
  // Persist the DETECTED type, never the client-supplied one.
  const branding = { ...(org.branding || {}), logoFile: filename, logoMime: detected };
  await ctx.data.organizations.update(ctx.orgId, { branding });
  if (previous && previous !== filename) await storage.remove("uploads", previous); // no orphans in storage
  return { ok: true, logoMime: detected };
}

/**
 * The authorised signatory's handwritten signature, for the signature block on every
 * issued letter.
 *
 * The upload is normalised, not merely stored: people photograph a signed sheet, and a
 * grey rectangle pasted onto a letter is what makes a document look generated. See
 * server/signature.ts for what it does and why. Always stored as a transparent PNG.
 */
export async function uploadSignature(ctx: RequestContext, file: { buffer: Buffer } | undefined) {
  if (!file) throw bad("An image file is required");
  const detected = sniffImageType(file.buffer);
  if (detected !== "image/png" && detected !== "image/jpeg") {
    throw bad("The signature must be a PNG or JPEG photo or scan");
  }

  let processed;
  try {
    processed = processSignature(file.buffer);
  } catch (e: any) {
    // These messages are written for the person uploading, so pass them through.
    throw bad(e?.message || "That image could not be processed");
  }

  const filename = `signature_${ctx.orgId}_${Date.now()}.png`;
  await storage.putBuffer("uploads", filename, processed.png, "image/png");
  const org = await currentOrg(ctx);
  const previous = org.branding && org.branding.signatureFile;
  const branding = { ...(org.branding || {}), signatureFile: filename, signatureMime: "image/png" };
  await ctx.data.organizations.update(ctx.orgId, { branding });
  if (previous && previous !== filename) await storage.remove("uploads", previous);
  return { ok: true, width: processed.width, height: processed.height };
}

/** The processed signature image. */
export async function getSignature(ctx: RequestContext): Promise<StoredImage> {
  const org = await currentOrg(ctx);
  const b = org.branding || {};
  if (!b.signatureFile || !(await storage.exists("uploads", b.signatureFile))) throw notFound("No signature set");
  return { contentType: "image/png", body: await storage.getBuffer("uploads", b.signatureFile) };
}

/** Clear the signature; letters fall back to the name over a rule. */
export async function deleteSignature(ctx: RequestContext) {
  const org = await currentOrg(ctx);
  const b = org.branding || {};
  if (b.signatureFile) {
    await storage.remove("uploads", b.signatureFile).catch(() => null);
    const branding = { ...b };
    delete branding.signatureFile;
    delete branding.signatureMime;
    await ctx.data.organizations.update(ctx.orgId, { branding });
  }
  return { ok: true };
}

/** The current workspace logo image. */
export async function getLogo(ctx: RequestContext): Promise<StoredImage> {
  const org = await currentOrg(ctx);
  const b = org.branding || {};
  if (!b.logoFile || !(await storage.exists("uploads", b.logoFile))) throw notFound("No logo set");
  // Serve only an allowlisted type; never reflect a stored/legacy mime that could
  // be text/html.
  const contentType = EXT_FOR[b.logoMime] ? b.logoMime : "image/png";
  return { contentType, body: await storage.getBuffer("uploads", b.logoFile) };
}

/** Remove the workspace logo. */
export async function deleteLogo(ctx: RequestContext) {
  const org = await currentOrg(ctx);
  const b = { ...(org.branding || {}) };
  const file = b.logoFile;
  delete b.logoFile;
  delete b.logoMime;
  await ctx.data.organizations.update(ctx.orgId, { branding: b });
  if (file) await storage.remove("uploads", file);
  return { ok: true };
}

/** Validate + normalize an employee-ID rule (prefix/suffix may contain {YEAR}). */
function sanitizeRule(r) {
  if (!r || typeof r !== "object") return undefined;
  return {
    prefix: String(r.prefix || "").slice(0, 24),
    suffix: String(r.suffix || "").slice(0, 24),
    seqStart: Math.max(0, Math.min(1000000, Number(r.seqStart) || 1)),
    padding: Math.max(1, Math.min(8, Number(r.padding) || 4)),
    resetYearly: !!r.resetYearly,
  };
}

/** Update org profile + branding + settings (stored in org.data). */
export async function updateOrganization(ctx: RequestContext, b: Record<string, any>) {
  const patch: any = {};
  if (b.name != null && String(b.name).trim()) patch.name = String(b.name).trim();
  if (b.address != null) patch.address = String(b.address);
  for (const k of ["legalName", "country", "gstin", "cin"]) if (b[k] !== undefined) patch[k] = String(b[k] || "");
  // Letterhead facts that used to be build-time constants: every workspace states its own.
  if (b.website !== undefined) patch.website = String(b.website || "").trim().slice(0, 200);
  if (b.tagline !== undefined) patch.tagline = String(b.tagline || "").trim().slice(0, 120);
  // Domain used for generated official addresses (firstname.lastname@domain).
  if (b.officialEmailDomain !== undefined) {
    const d = String(b.officialEmailDomain || "").trim().toLowerCase();
    if (d && !/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) {
      throw bad("officialEmailDomain must be a domain name like example.com");
    }
    patch.officialEmailDomain = d || null;
  }
  // Who receives the weekly people report. Previously a single hardcoded address.
  if (b.reportRecipients !== undefined) {
    const list = (Array.isArray(b.reportRecipients) ? b.reportRecipients : String(b.reportRecipients || "").split(/[,\s;]+/))
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean);
    const invalid = list.find((e) => !EMAIL_RE.test(e));
    if (invalid) throw bad(`Not an email address: ${invalid}`);
    patch.reportRecipients = [...new Set(list)].slice(0, 20);
  }
  if (b.branding && typeof b.branding === "object") {
    const current = await currentOrg(ctx);
    patch.branding = {
      ...(current.branding || {}), // preserve logoFile/logoMime set via the upload
      logoUrl: String(b.branding.logoUrl || ""),
      color: String(b.branding.color || ""),
      supportEmail: String(b.branding.supportEmail || ""),
    };
  }
  if (Array.isArray(b.designations)) patch.designations = b.designations.map((d) => String(d).trim()).filter(Boolean).slice(0, 300);
  // Display name on outgoing employee emails (onboarding/invites/notifications),
  // shown over the platform's verified sending address. Empty = platform default.
  if (b.emailSenderName !== undefined) patch.emailSenderName = String(b.emailSenderName || "").trim().slice(0, 80);
  if (b.employeeIdRule !== undefined) patch.employeeIdRule = b.employeeIdRule ? sanitizeRule(b.employeeIdRule) : null;
  // Default notice period for exits, in days, used when an employee's record does
  // not state their own. Blank clears it, and the exit flow falls back to 30.
  if (b.noticePeriodDays !== undefined) {
    const n = Number(b.noticePeriodDays);
    patch.noticePeriodDays =
      b.noticePeriodDays === "" || b.noticePeriodDays === null || !Number.isFinite(n) || n < 0
        ? null
        : Math.min(Math.round(n), 365);
  }
  // Who signs issued letters (offer, relieving, appraisal...). Blank fields are
  // dropped, and an entirely blank signatory is stored as null so the letter
  // layer falls back to its built-in default.
  if (b.signatory !== undefined) {
    const s = b.signatory || {};
    const signatory: any = {};
    const name = String(s.name || "").trim().slice(0, 80);
    const title = String(s.title || "").trim().slice(0, 80);
    if (name) signatory.name = name;
    if (title) signatory.title = title;
    patch.signatory = Object.keys(signatory).length ? signatory : null;
  }
  // Global payroll settings: which country pack drives this org's payroll +
  // the currency/locale used to format amounts. Validated against shipped packs.
  if (b.payroll && typeof b.payroll === "object") {
    const country = normalizeCountry(b.payroll.country);
    const pack = getRuleset(country); // falls back to IN for unknown input
    patch.payroll = {
      country: pack.country,
      currency: String(b.payroll.currency || pack.currency),
      locale: String(b.payroll.locale || pack.locale),
    };
  }
  return ctx.data.organizations.update(ctx.orgId, patch);
}

/** A full JSON snapshot of this org's data, audited, ready to download. */
export async function exportOrganization(ctx: RequestContext) {
  const bundle = await exportOrg(ctx.orgId);
  if (!bundle) throw notFound("Organization not found");
  await ctx.data.auditLog.create({ action: "DATA_EXPORT", userId: ctx.user.id, meta: { counts: bundle.meta.counts } });
  return { filename: exportFilename(bundle.organization), json: JSON.stringify(bundle, null, 2) };
}

export async function listOffices(ctx: RequestContext) {
  return ctx.data.offices.all();
}

/** Add a geo-fenced office. */
export async function createOffice(
  ctx: RequestContext,
  input: { name?: string; address?: string; lat?: unknown; lng?: unknown; radiusMeters?: unknown },
) {
  // The controller passes `req.body || {}`, so a request with no body reaches the
  // validation message below instead of failing on the destructure.
  const { name, address, lat, lng, radiusMeters } = input;
  if (!name || lat == null || lng == null) throw bad("name, lat and lng are required");
  return ctx.data.offices.create({
    name,
    address: address || "",
    lat: Number(lat),
    lng: Number(lng),
    radiusMeters: Number(radiusMeters || 250),
  });
}

export async function updateOffice(
  ctx: RequestContext,
  id: string,
  input: { name?: string; address?: string; lat?: unknown; lng?: unknown; radiusMeters?: unknown },
) {
  const office = await ctx.data.offices.byId(id);
  if (!office) throw notFound("Office not found");
  const { name, address, lat, lng, radiusMeters } = input;
  const patch: any = {};
  if (name != null) patch.name = name;
  if (address != null) patch.address = address;
  if (lat != null) patch.lat = Number(lat);
  if (lng != null) patch.lng = Number(lng);
  if (radiusMeters != null) patch.radiusMeters = Number(radiusMeters);
  return ctx.data.offices.update(office.id, patch);
}

export async function deleteOffice(ctx: RequestContext, id: string) {
  const office = await ctx.data.offices.byId(id);
  if (!office) throw notFound("Office not found");
  await ctx.data.offices.remove(office.id);
  return { ok: true };
}
