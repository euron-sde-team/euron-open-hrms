/**
 * Uploaded branding images (workspace logo, signatory signature): decide what an upload
 * really is from its bytes, and rebuild SVGs into markup that is safe to serve back to
 * browsers. Pure functions over buffers: no storage, no requests.
 */

/**
 * Detect an image type from its MAGIC BYTES (not the client-supplied mimetype,
 * which is trivially spoofed). Returns a safe content-type from a fixed
 * allowlist, or null.
 *
 * SVG has no magic bytes (it is XML), so it is sniffed structurally: the first
 * markup in the document must be an <svg> root, which rules out HTML polyglots.
 * An SVG is only ACCEPTED after sanitizeSvg() rebuilds it from an element/
 * attribute allowlist (see the comment there), because a raw SVG can carry inline
 * <script> and we serve the logo back to browsers.
 */
export function sniffImageType(buf: Buffer): string | null {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  // WEBP: "RIFF"...."WEBP"
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (looksLikeSvg(buf)) return "image/svg+xml";
  return null;
}
export const EXT_FOR: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

/* ------------------------------------------------------------------ */
/* SVG sanitiser                                                       */
/* ------------------------------------------------------------------ */

/**
 * The sanitiser NEVER passes source markup through: it tokenizes the document
 * and re-serializes it from canonical, allowlisted element and attribute names,
 * escaping every text node. Anything unknown (script, foreignObject, <a>,
 * animate*, event handlers, xlink:*, unknown attributes) simply has no path to
 * the output. Entity references are decoded before values are inspected so
 * "&#106;avascript:" cannot smuggle a scheme past the check, and are re-escaped
 * on the way out. DOCTYPEs are dropped and any internal ENTITY declaration
 * rejects the whole file (entity expansion / XXE).
 *
 * Serving is hardened independently of this: GET /logo sends
 * "default-src 'none'; sandbox" so even a bug here cannot execute script.
 */

// lowercase -> canonical spelling. Emitting the canonical name means <SCRIPT>,
// <ScRiPt> and friends can never round-trip as themselves.
const SVG_TAGS = [
  "svg", "g", "defs", "symbol", "use", "switch", "title", "desc", "style",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath", "image",
  "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "marker",
  "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feComposite",
  "feFlood", "feMerge", "feMergeNode", "feDropShadow", "feMorphology",
];
const TAG_CANON = new Map(SVG_TAGS.map((t) => [t.toLowerCase(), t]));

const SVG_ATTRS = [
  "id", "class", "style", "transform", "opacity", "display", "visibility", "overflow",
  "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "dx", "dy", "d", "points", "viewBox", "preserveAspectRatio", "version", "baseProfile",
  "xmlns", "xml:space", "role", "aria-label", "aria-hidden", "focusable",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit",
  "color", "clip-path", "clip-rule", "mask", "filter", "shape-rendering", "vector-effect",
  "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "word-spacing",
  "text-anchor", "text-decoration", "dominant-baseline", "alignment-baseline", "textLength", "lengthAdjust",
  "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod",
  "patternUnits", "patternContentUnits", "patternTransform", "clipPathUnits",
  "maskUnits", "maskContentUnits", "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "orient",
  "filterUnits", "primitiveUnits", "stdDeviation", "in", "in2", "result", "mode", "type", "values",
  "operator", "flood-color", "flood-opacity", "radius", "k1", "k2", "k3", "k4",
];
const ATTR_CANON = new Map(SVG_ATTRS.map((a) => [a.toLowerCase(), a]));

/** Structural sniff: the first markup in the file must be an <svg> root. */
function looksLikeSvg(buf: Buffer): boolean {
  // Only look at the head: enough for a BOM, an XML declaration, a DOCTYPE and comments.
  const head = buf.toString("utf8", 0, Math.min(buf.length, 4096)).replace(/^\uFEFF/, "");
  const stripped = head.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi, "").trim();
  return /^<svg[\s/>]/i.test(stripped);
}

/** Decode entity references (repeatedly, so "&amp;#x6a;" cannot hide a scheme). */
function decodeEntities(s: string): string {
  let prev = "";
  let out = s;
  for (let i = 0; i < 3 && out !== prev; i++) {
    prev = out;
    out = out
      .replace(/&#x([0-9a-f]+);?/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16) || 0))
      .replace(/&#(\d+);?/g, (_m, d) => String.fromCodePoint(Number(d) || 0))
      .replace(/&(amp|lt|gt|quot|apos);/gi, (_m: string, n: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[n.toLowerCase()] ?? _m);
  }
  return out;
}
const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** True if a decoded value carries a script-bearing or external reference. */
function unsafeValue(v: string): boolean {
  // Strip whitespace and control chars first: "java\nscript:" is still a scheme to a browser.
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  const flat = decodeEntities(v).replace(/[\s\u0000-\u001f\u007f]/g, "").toLowerCase();
  if (/(javascript|vbscript|data|blob|file):/.test(flat)) return true;
  if (/url\((?!#)/.test(flat)) return true; // only same-document url(#id) refs survive
  return false;
}

/** Keep CSS that cannot reach the network or break out of the <style> element. */
function sanitizeCss(css: string): string {
  return decodeEntities(css)
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\)/gi, "none")
    .replace(/[<>]/g, "");
}

/** href/xlink:href is allowed only as a same-document ref, or an inline raster. */
function safeHref(el: string, v: string): string | null {
  const value = decodeEntities(v).trim();
  if (/^#[\w.:-]+$/.test(value)) return value;
  if (el === "image" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$/.test(value)) return value.replace(/\s/g, "");
  return null;
}

const ATTR_RE = /([:A-Za-z_][-.:\w]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/**
 * Rebuild an SVG from allowlisted elements/attributes. Returns the sanitised
 * bytes, or null when the input is not a usable SVG (or declares entities).
 */
export function sanitizeSvg(raw: Buffer): Buffer | null {
  const src = raw.toString("utf8").replace(/^\uFEFF/, "");
  if (src.includes("\u0000")) return null;

  const out: string[] = [];
  const stack: string[] = [];
  let drop = 0; // depth inside a dropped element's subtree
  let rootSeen = false;
  let i = 0;

  const text = (t: string) => {
    if (drop > 0 || !rootSeen) return;
    if (stack[stack.length - 1] === "style") out.push(sanitizeCss(t));
    else out.push(escapeXml(decodeEntities(t)));
  };

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { text(src.slice(i)); break; }
    if (lt > i) text(src.slice(i, lt));

    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt); i = e < 0 ? src.length : e + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt);
      text(src.slice(lt + 9, e < 0 ? src.length : e)); // unwrapped, then escaped/CSS-cleaned like any text
      i = e < 0 ? src.length : e + 3;
      continue;
    }
    if (src.startsWith("<!", lt)) { // DOCTYPE and friends
      const sub = src.indexOf("[", lt);
      const close = src.indexOf(">", lt);
      let end = close;
      if (sub >= 0 && close >= 0 && sub < close) { const sq = src.indexOf("]", sub); end = src.indexOf(">", sq < 0 ? src.length : sq); }
      const decl = src.slice(lt, end < 0 ? src.length : end + 1);
      if (/entity/i.test(decl)) return null; // entity expansion / XXE: refuse the file
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (src.startsWith("<?", lt)) { const e = src.indexOf("?>", lt); i = e < 0 ? src.length : e + 2; continue; }

    // A tag. Scan to its ">" honouring quoted attribute values, so a ">" inside
    // an attribute cannot split the tag and leak the rest as text.
    let j = lt + 1;
    let quote = "";
    for (; j < src.length; j++) {
      const ch = src[j];
      if (quote) { if (ch === quote) quote = ""; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
    }
    const inner = src.slice(lt + 1, j);
    i = j + 1;

    if (inner.startsWith("/")) { // end tag
      if (drop > 0) { drop--; continue; }
      const canon = TAG_CANON.get(inner.slice(1).trim().toLowerCase());
      if (canon && stack[stack.length - 1] === canon) { stack.pop(); out.push(`</${canon}>`); }
      continue;
    }

    const selfClosing = /\/\s*$/.test(inner);
    const body = selfClosing ? inner.replace(/\/\s*$/, "") : inner;
    const name = (body.match(/^[^\s/>]+/) || [""])[0];
    const canon = TAG_CANON.get(name.toLowerCase());
    if (drop > 0) { if (!selfClosing) drop++; continue; }
    if (!canon || (!rootSeen && canon !== "svg")) { if (!selfClosing) drop = 1; continue; }

    const attrs: string[] = [];
    ATTR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ATTR_RE.exec(body.slice(name.length))) !== null) {
      const attr = m[1].toLowerCase();
      const rawValue = m[3] ?? m[4] ?? m[5] ?? "";
      if (attr === "href" || attr === "xlink:href") {
        const href = safeHref(canon, rawValue);
        if (href) attrs.push(`href="${escapeXml(href)}"`); // xlink is legacy; emit the plain href
        continue;
      }
      const attrName = ATTR_CANON.get(attr);
      if (!attrName) continue; // drops on*, xlink:*, xmlns:*, and everything unknown
      if (attrName === "style") { attrs.push(`style="${escapeXml(sanitizeCss(rawValue))}"`); continue; }
      if (unsafeValue(rawValue)) continue;
      attrs.push(`${attrName}="${escapeXml(decodeEntities(rawValue))}"`);
    }
    if (!rootSeen) {
      rootSeen = true;
      if (!attrs.some((a) => a.startsWith("xmlns="))) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
    }
    out.push(`<${[canon, ...attrs].join(" ")}${selfClosing ? "/>" : ">"}`);
    if (!selfClosing) stack.push(canon);
  }

  if (!rootSeen) return null;
  while (stack.length) out.push(`</${stack.pop()}>`); // close anything the source left open
  const svg = out.join("");
  // Belt and braces: the rebuild should make these impossible, so a hit means a bug.
  if (/<\s*(script|foreignobject|iframe)|javascript:|\son[a-z]+\s*=/i.test(svg)) return null;
  return Buffer.from(svg, "utf8");
}
