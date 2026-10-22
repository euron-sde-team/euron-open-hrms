/**
 * Font registration for every generated document.
 *
 * pdfkit's built-in fonts (Helvetica and friends) are the PDF core 14: WinAnsi-encoded,
 * with no Indian rupee glyph. Every `₹` in every letter and payslip was therefore printing
 * as `¹`. The only fix is embedding a Unicode TTF, so Inter is vendored in
 * `server/assets/fonts` (SIL OFL, see the README there) and registered here.
 *
 * Inter is also the tenant app's UI font, so issued documents match the product.
 *
 * Call `useFonts(doc)` once per document, then reference the FONT constants. Nothing in
 * document code should name "Helvetica" again.
 */
import path from "path";
import fs from "fs";

const DIR = path.join(__dirname, "..", "assets", "fonts");

export const FONT = {
  regular: "Body",
  medium: "BodyMedium",
  semibold: "BodySemi",
  bold: "BodyBold",
} as const;

const FILES: Record<string, string> = {
  [FONT.regular]: "Inter_400Regular.ttf",
  [FONT.medium]: "Inter_500Medium.ttf",
  [FONT.semibold]: "Inter_600SemiBold.ttf",
  [FONT.bold]: "Inter_700Bold.ttf",
};

/** True when the vendored files are actually present (they are committed, so normally yes). */
export function fontsAvailable(): boolean {
  return Object.values(FILES).every((f) => fs.existsSync(path.join(DIR, f)));
}

/**
 * Register the embedded family on a document.
 *
 * If the files are somehow missing (a partial deploy, a trimmed image), fall back to the
 * core fonts rather than throwing: a letter with a wrong currency glyph still beats a
 * 500 when HR clicks Generate. `fontsAvailable()` lets callers warn about it.
 */
export function useFonts(doc: any): boolean {
  if (!fontsAvailable()) {
    doc.registerFont(FONT.regular, "Helvetica");
    doc.registerFont(FONT.medium, "Helvetica");
    doc.registerFont(FONT.semibold, "Helvetica-Bold");
    doc.registerFont(FONT.bold, "Helvetica-Bold");
    return false;
  }
  for (const [name, file] of Object.entries(FILES)) {
    doc.registerFont(name, path.join(DIR, file));
  }
  doc.font(FONT.regular);
  return true;
}
