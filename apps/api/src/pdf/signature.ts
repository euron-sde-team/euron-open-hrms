/**
 * Signature image processing for letterheads.
 *
 * People sign a sheet of paper and photograph it, so what arrives is dark ink on a
 * mid-grey, slightly yellow, unevenly lit background. Dropped straight onto a letter that
 * reads as a pasted-in rectangle sitting on top of the page, which is exactly what makes a
 * generated document look generated.
 *
 * So the upload is normalised rather than merely stored:
 *   1. decode (PNG or JPEG, both pure JS: no native build in the deploy image)
 *   2. knock out the paper, keeping the ink, using a per-image luminance threshold
 *   3. crop to the ink, so the signature sits on its baseline instead of floating
 *   4. cap the dimensions, since a phone photo is needlessly large for a 150pt box
 *   5. always emit PNG, because transparency is the entire point
 *
 * Deliberately not a general background remover. It assumes dark-ink-on-light-paper, which
 * is what a signature is, and says so when the image does not look like that.
 */
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

export interface SignatureResult {
  png: Buffer;
  width: number;
  height: number;
  /** Share of pixels kept as ink. Tiny means we probably erased the signature. */
  inkRatio: number;
}

interface Raw {
  data: Buffer | Uint8Array;
  width: number;
  height: number;
}

function decode(buf: Buffer): Raw {
  // Sniff the magic bytes rather than trusting a filename or content-type.
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { data: png.data, width: png.width, height: png.height };
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { data: img.data, width: img.width, height: img.height };
  }
  throw new Error("The signature must be a PNG or JPEG image");
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Choose the paper/ink cut from the image itself.
 *
 * A fixed threshold fails on both a bright scan and a dim phone photo. The border pixels
 * are almost always paper, so their median luminance gives us "what paper looks like here",
 * and the cut sits a fixed distance below it. Anything darker is ink.
 */
function paperThreshold(raw: Raw): number {
  const { data, width, height } = raw;
  const samples: number[] = [];
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return luma(data[i], data[i + 1], data[i + 2]);
  };
  const stepX = Math.max(1, Math.floor(width / 64));
  const stepY = Math.max(1, Math.floor(height / 64));
  for (let x = 0; x < width; x += stepX) {
    samples.push(at(x, 0), at(x, height - 1));
  }
  for (let y = 0; y < height; y += stepY) {
    samples.push(at(0, y), at(width - 1, y));
  }
  samples.sort((a, b) => a - b);
  const paper = samples[Math.floor(samples.length / 2)] || 255;
  // 45 below the paper median: tolerant of shadow and off-white, still well clear of ink.
  return Math.max(60, paper - 45);
}

/** Nearest-neighbour downscale. Fine here: the source is far larger than the target box. */
function downscale(raw: Raw, maxW: number, maxH: number): Raw {
  const scale = Math.min(1, maxW / raw.width, maxH / raw.height);
  if (scale >= 1) return raw;
  const w = Math.max(1, Math.round(raw.width * scale));
  const h = Math.max(1, Math.round(raw.height * scale));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(raw.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(raw.width - 1, Math.floor(x / scale));
      const si = (sy * raw.width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = raw.data[si];
      out[di + 1] = raw.data[si + 1];
      out[di + 2] = raw.data[si + 2];
      out[di + 3] = raw.data[si + 3];
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Remove the paper, crop to the ink and emit a transparent PNG.
 * Throws when the image does not look like ink on paper, rather than returning a blank.
 */
export function processSignature(input: Buffer, opts: { maxWidth?: number; maxHeight?: number } = {}): SignatureResult {
  const decoded = decode(input);
  if (!decoded.width || !decoded.height) throw new Error("That image could not be read");

  // Work at a sane size first: a 12MP phone photo is 40x more pixels than we need.
  const raw = downscale(decoded, opts.maxWidth ?? 1200, opts.maxHeight ?? 600);
  const cut = paperThreshold(raw);

  let minX = raw.width, minY = raw.height, maxX = -1, maxY = -1;
  let ink = 0;
  const alpha = new Uint8Array(raw.width * raw.height);

  for (let y = 0; y < raw.height; y++) {
    for (let x = 0; x < raw.width; x++) {
      const i = (y * raw.width + x) * 4;
      const l = luma(raw.data[i], raw.data[i + 1], raw.data[i + 2]);
      const srcA = raw.data[i + 3];
      if (srcA < 16) continue; // already transparent, leave it so

      if (l <= cut) {
        // Soft edge: fully opaque well below the cut, fading towards it, so the stroke
        // keeps its antialiasing instead of turning into a jagged bitmap.
        const a = l <= cut - 40 ? 255 : Math.round(255 * (1 - (l - (cut - 40)) / 40));
        alpha[y * raw.width + x] = a;
        if (a > 40) {
          ink++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  const total = raw.width * raw.height;
  const inkRatio = ink / total;
  if (maxX < 0 || inkRatio < 0.0005) {
    throw new Error("No signature was found in that image. Use dark ink on a light background.");
  }
  if (inkRatio > 0.6) {
    throw new Error("That image is mostly dark, so it does not look like a signature on paper.");
  }

  // Crop to the ink with a small breathing margin.
  const pad = 4;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(raw.width - 1, maxX + pad);
  maxY = Math.min(raw.height - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = minX + x;
      const sy = minY + y;
      const si = (sy * raw.width + sx) * 4;
      const di = (y * w + x) * 4;
      const a = alpha[sy * raw.width + sx];
      // Ink is rendered as its own darkness, so a blue pen stays blue-black rather than
      // being flattened to pure black.
      out.data[di] = a ? raw.data[si] : 0;
      out.data[di + 1] = a ? raw.data[si + 1] : 0;
      out.data[di + 2] = a ? raw.data[si + 2] : 0;
      out.data[di + 3] = a;
    }
  }

  return { png: PNG.sync.write(out), width: w, height: h, inkRatio };
}
