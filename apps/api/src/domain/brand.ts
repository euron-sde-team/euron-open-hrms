/**
 * Per-organization branding for official documents: the facts a letterhead states.
 *
 * Data only. Drawing lives in `server/pdf/kit.ts`, which is why the old draw* helpers
 * (letterhead, logo, signature, footer, verification) are gone from here: every document
 * now shares one implementation of each, so they cannot drift per letter again.
 *
 * `logo.type` is "buffer" for a raster upload and "svg" for a vector one. The kit renders all three and falls
 * back to the typographic wordmark when a logo is absent or fails to draw.
 */
import * as storage from "../integrations/storage";

/** Brand used when a workspace has configured nothing yet. Neutral on purpose. */
const GENERIC = {
  tagline: "",
  website: "",
  hrEmail: "",
  phone: "",
  color: "#0f6e5e",
  logo: null,
  signatory: { name: "Authorised Signatory", title: "" },
};

/**
 * Brand for an org row: the workspace's own configured details from org.data
 * (legalName, address, website, tagline, branding.color, branding.supportEmail,
 * signatory) over a neutral fallback. Every value is a tenant setting; nothing is
 * keyed by slug. This sync form does NOT include an uploaded logo; use
 * brandForAsync to render the tenant's logo.
 */
export function brandFor(org) {
  const base = { ...GENERIC, name: org.name, legalName: org.name, address: org.address || "" };
  const branding = org.branding || {};

  // The signatory printed on every issued letter is a tenant SETTING. Without one the
  // letter is still valid, signed by a generic "Authorised Signatory".
  const configured = org.signatory || {};
  const signatory = {
    name: String(configured.name || "").trim() || base.signatory.name,
    title: String(configured.title || "").trim() || base.signatory.title,
  };

  return {
    ...base,
    signatory,
    name: org.name || base.name,
    legalName: org.legalName || base.legalName,
    address: org.address || base.address,
    website: org.website || base.website,
    tagline: org.tagline || base.tagline,
    color: branding.color || base.color,
    hrEmail: branding.supportEmail || base.hrEmail,
  };
}

/**
 * Like brandFor, but also fetches the tenant's UPLOADED logo from storage and
 * attaches it for PDF rendering. Async (storage is async). Falls back silently
 * to the typographic wordmark if there is no upload or the fetch fails.
 */
export async function brandForAsync(org) {
  const brand: any = brandFor(org);
  const file = org.branding && org.branding.logoFile;
  if (file) {
    try {
      if (await storage.exists("uploads", file)) {
        const buf = await storage.getBuffer("uploads", file);
        // PNG/JPEG render directly via pdfkit; SVG uploads aren't supported by doc.image.
        const mime = (org.branding.logoMime || "").toLowerCase();
        if (buf && buf.length) {
          // SVG is the right format for a letterhead, so it is no longer skipped. The kit
          // renders it through svg-to-pdfkit; raster uploads go straight to doc.image.
          brand.logo = mime.includes("svg")
            ? { type: "svg", svg: buf.toString("utf8"), width: 150 }
            : { type: "buffer", buf, box: [150, 46] };
        }
      }
    } catch (_e) { /* keep the typographic fallback */ }
  }

  // The signatory's handwritten signature, already background-removed and cropped on
  // upload (server/signature.ts). The kit draws it above the name; without one the letter
  // falls back to the name over a rule, which is still valid, just not executed-looking.
  const sigFile = org.branding && org.branding.signatureFile;
  if (sigFile) {
    try {
      if (await storage.exists("uploads", sigFile)) {
        const buf = await storage.getBuffer("uploads", sigFile);
        if (buf && buf.length) brand.signatureImage = { buf };
      }
    } catch (_e) { /* a missing signature must never block a letter */ }
  }
  return brand;
}
