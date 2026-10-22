/**
 * Shared document kit: one typographic system for every PDF the product issues.
 *
 * Before this, each letter hand-drew its own letterhead, table and signature block on top
 * of pdfkit's core fonts. That produced a set of real defects, all of which this module
 * exists to prevent structurally rather than by convention:
 *
 *  - `₹` printed as `¹`, because the core fonts have no rupee glyph (see ./fonts).
 *  - the compensation table set `doc.y` but never restored `doc.x`, so every paragraph
 *    after it inherited the table's right-hand column and rendered as a crushed strip.
 *    Every primitive here restores the cursor, and `flow()` is the only way body copy is
 *    written, so that class of bug cannot come back.
 *  - the verification block was emitted after the signature without a fit check, so it
 *    routinely spilled onto an otherwise empty second page.
 *  - footers were drawn per letter, so page numbers did not exist and a two-page letter
 *    was indistinguishable from a truncated one.
 *
 * Geometry is in PDF points (72pt = 1 inch). A4 is 595.28 x 841.89.
 */
import PDFDocument from "pdfkit";
import fs from "fs";
import { FONT, useFonts } from "./fonts";
import { PRODUCT_NAME } from "../core/product";

export const PAGE = {
  size: "A4" as const,
  margin: 56,
  get width() { return 595.28; },
  get height() { return 841.89; },
  get content() { return this.width - this.margin * 2; },
};

/** Type scale. Deliberately small and tight: this is correspondence, not a brochure. */
export const TYPE = {
  title: 15,
  heading: 11,
  body: 10,
  small: 9,
  caption: 7.5,
  micro: 6.5,
};

export const INK = {
  text: "#111111",
  muted: "#5f6368",
  faint: "#8a8f98",
  rule: "#e3e5e9",
  ruleStrong: "#c9ccd2",
  band: "#f6f7f9",
};

export interface DocContext {
  doc: any;
  /** Chunks collected straight off the pdfkit stream. Nothing is written to disk. */
  chunks: Buffer[];
  brand: any;
  /** Set when a letterhead has been drawn on the current page. */
  headed: boolean;
}

/** Left edge of the text column. */
export const left = (doc: any) => doc.page.margins.left;
/** Right edge of the text column. */
export const right = (doc: any) => doc.page.width - doc.page.margins.right;
/** Usable width. */
export const colWidth = (doc: any) => right(doc) - left(doc);
/** Y beyond which content must not go before a page break. */
export const bottomLimit = (doc: any) =>
  // 24pt of clearance above the margin, not 34. The footer band and verification mark live
  // BELOW the bottom margin (finalize draws them there deliberately), so content only needs
  // to clear the margin itself. The larger reserve was pushing closing blocks onto a second
  // page when they missed by a few points, which is how a one page letter grew a second one.
  doc.page.height - doc.page.margins.bottom - 24;

/**
 * Restore the text cursor to the left margin.
 *
 * pdfkit keeps `doc.x` wherever the last absolutely-positioned `text()` put it, and then
 * derives the wrap width from it. Any primitive that draws at an explicit x MUST call this
 * before returning, or the next paragraph silently renders in a narrow column.
 */
export function resetCursor(doc: any, y?: number) {
  doc.x = left(doc);
  if (typeof y === "number") doc.y = y;
}

export function createDocument(brand: any, title: string, subject?: string): DocContext {
  const doc = new PDFDocument({
    size: PAGE.size,
    margin: PAGE.margin,
    // Needed so finalize() can walk back over every page to stamp "Page x of y".
    bufferPages: true,
    info: {
      Title: title,
      Author: brand.legalName || brand.name,
      Subject: subject || title,
      Creator: PRODUCT_NAME,
    },
  });
  useFonts(doc);
  const ctx: DocContext = { doc, chunks: [], brand, headed: false };
  // Collect as pdfkit emits, so a large document never sits in memory twice.
  doc.on("data", (c: Buffer) => ctx.chunks.push(c));
  return ctx;
}



// ── Letterhead ──────────────────────────────────────────────────────────────

/**
 * Draw the logo, returning the height consumed (0 when there is none).
 * Uploaded logos arrive as a buffer via brandForAsync; built-in brands may point at a file.
 */
/**
 * Content-stream bytes below which an SVG draw is treated as having painted nothing.
 *
 * Measured, not guessed: an SVG that svg-to-pdfkit cannot render emits only the
 * save/transform/restore boilerplate (110 to 151 bytes observed, including the bundled
 * a typical two-colour wordmark), while the simplest real mark (a single filled rect) emits 633. 300 sits
 * clear of both, so a genuine logo is never mistaken for an empty one.
 */
const EMPTY_SVG_BYTES = 300;

function drawMark(doc: any, brand: any, x: number, y: number, box: [number, number]): number {
  const logo = brand.logo;
  if (!logo) return 0;
  try {
    if (logo.type === "buffer" && logo.buf) {
      doc.image(logo.buf, x, y, { fit: box, align: "left", valign: "top" });
      return box[1];
    }
    if (logo.type === "image" && logo.file && fs.existsSync(logo.file)) {
      doc.image(logo.file, x, y, { fit: box, align: "left", valign: "top" });
      return box[1];
    }
    // Vector marks: either an uploaded SVG (string) or a built-in file. Rendered rather
    // than skipped, because SVG is the format a letterhead actually wants and skipping it
    // silently demoted those tenants to the typographic wordmark.
    if (logo.type === "svg") {
      const svg = logo.svg || (logo.file && fs.existsSync(logo.file) ? fs.readFileSync(logo.file, "utf8") : null);
      if (svg) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- svg-to-pdfkit ships CommonJS only, loaded on first SVG
        const SVGtoPDF = require("svg-to-pdfkit");
        // svg-to-pdfkit can "succeed" while painting nothing: it throws on malformed input,
        // but silently emits an empty group for structures it cannot handle (the bundled
        // a typical wordmark is one). That returned a non-zero height, which suppressed the
        // wordmark fallback and left a blank letterhead. So measure what actually reached
        // the content stream: an empty draw writes only the save/transform/restore
        // boilerplate (~108 bytes here) while a real mark writes several hundred.
        const before = doc.page.content.uncompressedLength ?? 0;
        SVGtoPDF(doc, svg, x, y, { width: box[0], height: box[1], preserveAspectRatio: "xMinYMin meet" });
        const painted = (doc.page.content.uncompressedLength ?? 0) - before;
        if (painted > EMPTY_SVG_BYTES) return box[1];
        return 0; // nothing visible: let the caller draw the wordmark instead
      }
    }
  } catch {
    // A corrupt or unsupported upload must not break the document.
  }
  return 0;
}

/**
 * Letterhead: mark (or wordmark) on the left, company particulars on the right, hairline
 * under both. Returns the Y where body content should start.
 *
 * The old version drew neither a logo nor the wordmark when an upload existed but failed
 * to decode, leaving a letterhead of two bare URLs. Here the wordmark is the fallback for
 * anything that does not actually render.
 */
export function letterhead(ctx: DocContext): number {
  const { doc, brand } = ctx;
  const x = left(doc);
  const top = doc.page.margins.top;
  const r = right(doc);

  const markH = drawMark(doc, brand, x, top, [150, 40]);
  if (!markH) {
    doc.font(FONT.bold).fontSize(19).fillColor(brand.color || INK.text)
      .text(brand.name || brand.legalName || "", x, top, { width: 300, lineBreak: false });
  }

  // Right column: legal name then contact particulars, small and quiet.
  const rw = 230;
  let ry = top;
  doc.font(FONT.semibold).fontSize(TYPE.small).fillColor(INK.text)
    .text(brand.legalName || brand.name || "", r - rw, ry, { width: rw, align: "right" });
  ry = doc.y + 1;
  doc.font(FONT.regular).fontSize(TYPE.caption).fillColor(INK.muted);
  for (const line of [brand.address, [brand.website, brand.hrEmail].filter(Boolean).join("  ·  "), brand.phone].filter(Boolean)) {
    doc.text(String(line), r - rw, ry, { width: rw, align: "right" });
    ry = doc.y;
  }

  const ruleY = Math.max(top + Math.max(markH, 34), ry) + 10;
  doc.moveTo(x, ruleY).lineTo(r, ruleY).lineWidth(1).strokeColor(brand.color || INK.ruleStrong).stroke();

  ctx.headed = true;
  resetCursor(doc, ruleY + 16);
  doc.font(FONT.regular).fontSize(TYPE.body).fillColor(INK.text);
  return doc.y;
}

// ── Building blocks ─────────────────────────────────────────────────────────

/** Reference + date line, right aligned, sitting just under the letterhead. */
export function refLine(ctx: DocContext, ref: string | null, dateText: string) {
  const { doc } = ctx;
  const y = doc.y;
  doc.font(FONT.regular).fontSize(TYPE.small).fillColor(INK.muted);
  const parts = [ref ? `Ref: ${ref}` : null, dateText].filter(Boolean).join("     ");
  doc.text(parts, left(doc), y, { width: colWidth(doc), align: "right" });
  resetCursor(doc, doc.y + 8);
}

/** Small uppercase marker, e.g. PRIVATE & CONFIDENTIAL. */
export function marker(ctx: DocContext, text: string) {
  const { doc } = ctx;
  doc.font(FONT.semibold).fontSize(TYPE.caption).fillColor(INK.faint)
    .text(text.toUpperCase(), left(doc), doc.y, { width: colWidth(doc), characterSpacing: 0.8 });
  resetCursor(doc, doc.y + 7);
}

export function title(ctx: DocContext, text: string) {
  const { doc } = ctx;
  doc.font(FONT.bold).fontSize(TYPE.title).fillColor(INK.text)
    .text(text, left(doc), doc.y, { width: colWidth(doc) });
  resetCursor(doc, doc.y + 11);
}

/** Recipient block: who the letter is addressed to. */
export function recipient(ctx: DocContext, lines: (string | null | undefined)[]) {
  const { doc } = ctx;
  const kept = lines.filter(Boolean) as string[];
  if (!kept.length) return;
  doc.font(FONT.semibold).fontSize(TYPE.body).fillColor(INK.text)
    .text(kept[0], left(doc), doc.y, { width: colWidth(doc) });
  if (kept.length > 1) {
    doc.font(FONT.regular).fontSize(TYPE.small).fillColor(INK.muted);
    for (const l of kept.slice(1)) doc.text(l, left(doc), doc.y, { width: colWidth(doc) });
  }
  resetCursor(doc, doc.y + 11);
}

/**
 * Body copy. The ONLY way letters should write prose.
 *
 * Left-aligned rather than justified on purpose: pdfkit justifies by stretching inter-word
 * space with no hyphenation, which is what produced the rivers of white space in the old
 * letters. Ragged right reads better at this measure.
 */
export function flow(ctx: DocContext, text: string, opts: { gap?: number; font?: string; size?: number; color?: string } = {}) {
  const { doc } = ctx;
  doc.font(opts.font || FONT.regular).fontSize(opts.size || TYPE.body).fillColor(opts.color || INK.text)
    .text(text, left(doc), doc.y, { width: colWidth(doc), align: "left", lineGap: 1.6 });
  resetCursor(doc, doc.y + (opts.gap ?? 7));
}

export function heading(ctx: DocContext, text: string) {
  const { doc } = ctx;
  ensureSpace(ctx, 34);
  doc.font(FONT.semibold).fontSize(TYPE.heading).fillColor(INK.text)
    .text(text, left(doc), doc.y, { width: colWidth(doc) });
  resetCursor(doc, doc.y + 6);
}

/** Bulleted list, used for terms and conditions. */
export function bullets(ctx: DocContext, items: string[]) {
  const { doc } = ctx;
  const x = left(doc);
  const w = colWidth(doc) - 14;
  doc.font(FONT.regular).fontSize(TYPE.body).fillColor(INK.text);
  for (const item of items) {
    ensureSpace(ctx, 30);
    const y = doc.y;
    doc.text("•", x + 2, y, { width: 10, lineBreak: false });
    doc.text(item, x + 14, y, { width: w, align: "left", lineGap: 1.4 });
    resetCursor(doc, doc.y + 4);
  }
  resetCursor(doc, doc.y + 3);
}

export interface AmountRow {
  label: string;
  amount: string;
  /** Renders as a subtotal band. */
  strong?: boolean;
  /** Renders as the emphasised total, in the brand colour. */
  total?: boolean;
  /** Deductions and the like, shown with a muted label. */
  muted?: boolean;
}

/**
 * Money table: label on the left, right-aligned amount on the right.
 *
 * Hairline rules and a tinted total row rather than filled bands in the brand colour. The
 * old table painted a saturated block behind white text, which reads as a web UI rather
 * than a letter, and printed badly in greyscale.
 */
export function amountTable(ctx: DocContext, rows: AmountRow[], opts: { head?: [string, string] } = {}) {
  const { doc, brand } = ctx;
  const x = left(doc);
  const w = colWidth(doc);
  const amountW = 150;
  const rowH = 20;

  ensureSpace(ctx, rowH * Math.min(rows.length + 2, 8));
  let y = doc.y;

  if (opts.head) {
    doc.font(FONT.semibold).fontSize(TYPE.caption).fillColor(INK.faint);
    doc.text(opts.head[0].toUpperCase(), x, y, { width: w - amountW, characterSpacing: 0.6, lineBreak: false });
    doc.text(opts.head[1].toUpperCase(), x + w - amountW, y, { width: amountW, align: "right", characterSpacing: 0.6, lineBreak: false });
    y += 14;
    doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.8).strokeColor(INK.ruleStrong).stroke();
    y += 6;
  }

  for (const r of rows) {
    // Break before a row rather than through it.
    if (y + rowH > bottomLimit(doc)) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    if (r.total) {
      doc.rect(x, y - 3, w, rowH + 4).fill(INK.band);
    }
    doc.font(r.total || r.strong ? FONT.semibold : FONT.regular)
      .fontSize(TYPE.body)
      .fillColor(r.total ? (brand.color || INK.text) : r.muted ? INK.muted : INK.text);
    doc.text(r.label, x + (r.total ? 8 : 0), y, { width: w - amountW - 16, lineBreak: false });
    doc.text(r.amount, x + w - amountW - (r.total ? 8 : 0), y, { width: amountW, align: "right", lineBreak: false });
    y += rowH;
    if (r.strong && !r.total) {
      doc.moveTo(x, y - 4).lineTo(x + w, y - 4).lineWidth(0.6).strokeColor(INK.rule).stroke();
    }
  }

  resetCursor(doc, y + 10);
  doc.font(FONT.regular).fontSize(TYPE.body).fillColor(INK.text);
}

/** Two-column label/value grid, for employee particulars on a payslip. */
export function detailGrid(ctx: DocContext, pairs: [string, string][], columns = 2) {
  const { doc } = ctx;
  const x = left(doc);
  const w = colWidth(doc);
  const colW = w / columns;
  const rowH = 26;
  const rows = Math.ceil(pairs.length / columns);
  ensureSpace(ctx, rows * rowH + 8);
  const startY = doc.y;

  pairs.forEach(([label, value], i) => {
    const c = i % columns;
    const r = Math.floor(i / columns);
    const cx = x + c * colW;
    const cy = startY + r * rowH;
    doc.font(FONT.regular).fontSize(TYPE.caption).fillColor(INK.faint)
      .text(label.toUpperCase(), cx, cy, { width: colW - 12, characterSpacing: 0.5, lineBreak: false });
    doc.font(FONT.medium).fontSize(TYPE.small).fillColor(INK.text)
      .text(value || "-", cx, cy + 10, { width: colW - 12, lineBreak: false });
  });

  resetCursor(doc, startY + rows * rowH + 6);
}

/** Add a page if less than `needed` points remain. */
export function ensureSpace(ctx: DocContext, needed: number) {
  const { doc } = ctx;
  if (doc.y + needed > bottomLimit(doc)) {
    doc.addPage();
    resetCursor(doc, doc.page.margins.top);
  }
}

/**
 * Signature block.
 *
 * Visual signature by design: an optional signature image, the authorised signatory's name
 * and title over a rule. Authenticity is carried by the verification strip (QR, reference
 * and content digest), not by a cryptographic signature.
 */
export function signature(ctx: DocContext, opts: { forLine?: boolean } = {}) {
  const { doc, brand } = ctx;
  ensureSpace(ctx, 92);
  const x = left(doc);
  let y = doc.y + 4;

  if (opts.forLine !== false) {
    doc.font(FONT.regular).fontSize(TYPE.body).fillColor(INK.text)
      .text(`For ${brand.legalName || brand.name},`, x, y, { width: colWidth(doc) });
    y = doc.y + 6;
  }

  // Space for a wet or scanned signature.
  const sig = brand.signatureImage;
  if (sig && sig.buf) {
    try {
      doc.image(sig.buf, x, y, { fit: [150, 44] });
      y += 46;
    } catch {
      y += 30;
    }
  } else {
    y += 26;
  }

  doc.moveTo(x, y).lineTo(x + 190, y).lineWidth(0.8).strokeColor(INK.ruleStrong).stroke();
  y += 6;
  doc.font(FONT.semibold).fontSize(TYPE.body).fillColor(INK.text)
    .text(brand.signatory?.name || "Authorised Signatory", x, y, { width: 260, lineBreak: false });
  y = doc.y;
  if (brand.signatory?.title) {
    doc.font(FONT.regular).fontSize(TYPE.small).fillColor(INK.muted)
      .text(brand.signatory.title, x, y, { width: 260, lineBreak: false });
    y = doc.y;
  }
  resetCursor(doc, y + 10);
}

/** Acceptance block for offer letters: two aligned rules, never a wrapped run of underscores. */
export function acceptance(ctx: DocContext) {
  const { doc } = ctx;
  ensureSpace(ctx, 66);
  const x = left(doc);
  const w = colWidth(doc);
  const y0 = doc.y + 4;

  doc.moveTo(x, y0).lineTo(x + w, y0).lineWidth(0.6).strokeColor(INK.rule).stroke();
  doc.font(FONT.semibold).fontSize(TYPE.small).fillColor(INK.text)
    .text("Accepted and agreed", x, y0 + 10, { width: w, lineBreak: false });

  const lineY = y0 + 44;
  const halfW = (w - 40) / 2;
  doc.moveTo(x, lineY).lineTo(x + halfW, lineY).lineWidth(0.8).strokeColor(INK.ruleStrong).stroke();
  doc.moveTo(x + halfW + 40, lineY).lineTo(x + w, lineY).lineWidth(0.8).strokeColor(INK.ruleStrong).stroke();
  doc.font(FONT.regular).fontSize(TYPE.caption).fillColor(INK.muted);
  doc.text("Signature", x, lineY + 5, { width: halfW, lineBreak: false });
  doc.text("Date", x + halfW + 40, lineY + 5, { width: halfW, lineBreak: false });

  resetCursor(doc, lineY + 16);
}

/**
 * Stamp the footer and "Page x of y" on every page, then close the document.
 *
 * Has to run at the end: the total page count is not known until the content is laid out,
 * which is why the document is created with `bufferPages`.
 */
/**
 * Close the document and resolve its bytes.
 *
 * Returns a Buffer rather than writing a file: storage is S3, so a temp file on the
 * container's disk was pure overhead (write, read back, upload, then leave the copy
 * behind forever). Callers hand the buffer straight to `storage.putBuffer`.
 */
export function finalize(ctx: DocContext, fileName: string, v: any = null): Promise<{ buffer: Buffer; fileName: string }> {
  const { doc, brand } = ctx;

  const range = doc.bufferedPageRange();
  const last = range.start + range.count - 1;
  const footerText = [brand.legalName || brand.name, brand.address].filter(Boolean).join("  ·  ");

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // pdfkit starts a NEW page as soon as text is written below the bottom margin, which
    // is exactly what a footer does. Zeroing the margin for the duration of the stamp is
    // the documented way to draw in that band; without it every document grew a blank
    // trailing page carrying nothing but the footer.
    const keepBottom = doc.page.margins.bottom;
    const x = doc.page.margins.left;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    // Geometry MUST be derived from the real bottom margin, before it is zeroed below.
    const ruleY = doc.page.height - keepBottom + 4;
    const isLast = i === last;
    // Only now relax the margin, so the writes below are not treated as overflow.
    doc.page.margins.bottom = 0;

    doc.moveTo(x, ruleY).lineTo(x + w, ruleY).lineWidth(0.5).strokeColor(INK.rule).stroke();

    // The verification mark rides in the footer of the last page rather than being inline
    // content. As a card it was tall enough to push an otherwise-complete letter onto a
    // second, near-empty page purely to carry itself.
    let textW = w;
    if (isLast && v?.qrDataUrl) {
      try {
        const b64 = String(v.qrDataUrl).split(",")[1];
        if (b64) {
          doc.image(Buffer.from(b64, "base64"), x + w - 34, ruleY + 4, { fit: [34, 34] });
          textW = w - 44;
        }
      } catch {
        // text-only footer is fine
      }
    }

    doc.font(FONT.regular).fontSize(TYPE.micro).fillColor(INK.faint);
    doc.text(footerText, x, ruleY + 6, { width: textW - 60, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, x + textW - 60, ruleY + 6, { width: 60, align: "right", lineBreak: false });

    if (isLast && v) {
      const line2 = [v.url ? `Verify: ${v.url}` : null, v.code ? `Reference ${v.code}` : null].filter(Boolean).join("   ·   ");
      if (line2) {
        doc.font(FONT.medium).fontSize(TYPE.micro).fillColor(INK.muted)
          .text(line2, x, ruleY + 16, { width: textW, lineBreak: false, link: v.url || undefined });
      }
      if (v.digest) {
        doc.font(FONT.regular).fontSize(TYPE.micro).fillColor(INK.faint)
          .text(`Digest ${String(v.digest).slice(0, 48)}`, x, ruleY + 25, { width: textW, lineBreak: false });
      }
    }

    doc.page.margins.bottom = keepBottom;
  }

  doc.flushPages();
  doc.end();
  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve({ buffer: Buffer.concat(ctx.chunks), fileName }));
    doc.on("error", reject);
  });
}
