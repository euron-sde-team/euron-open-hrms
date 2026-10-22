/**
 * Org-configurable theme colour.
 *
 * The org's `branding.color` (Settings → Organization → Theme colour) is
 * applied at runtime as the app's `--primary` CSS variable; Tailwind's
 * primary token maps to it in globals.css, so buttons, links, focus rings
 * and active states all pick it up. An inline style on <html> wins over
 * both the light and dark stylesheet values, so the brand colour holds
 * across both modes. The same colour also feeds generated documents
 * (letterheads) on the backend, one knob, branded everywhere.
 */

export interface ThemePreset {
  name: string;
  color: string;
}

/** The stylesheet's default --primary. Choosing it clears the override. */
export const DEFAULT_BRAND_COLOR = "#0f6e5e";

/** Curated, accessible presets, shown as swatches in the settings UI. */
export const THEME_PRESETS: ThemePreset[] = [
  { name: "Evergreen", color: DEFAULT_BRAND_COLOR }, // app default
  { name: "Ocean", color: "#0f4c81" },
  { name: "Indigo", color: "#4f46e5" },
  { name: "Violet", color: "#7c3aed" },
  { name: "Rose", color: "#be123c" },
  { name: "Amber", color: "#b45309" },
  { name: "Forest", color: "#166534" },
  { name: "Slate", color: "#334155" },
];

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** "0f4c81" / "#0F4C81" → "#0f4c81"; anything else → null. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = HEX_RE.exec(input.trim());
  return m?.[1] ? `#${m[1].toLowerCase()}` : null;
}

/** WCAG-ish relative luminance, enough to pick black vs white text. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * toLin((n >> 16) & 0xff) +
    0.7152 * toLin((n >> 8) & 0xff) +
    0.0722 * toLin(n & 0xff)
  );
}

/**
 * Apply (or clear) the org brand colour on the document root.
 * Pass null/empty/invalid to fall back to the stylesheet defaults.
 */
export function applyBrandColor(color: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const hex = normalizeHex(color);
  if (!hex) {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    return;
  }
  root.style.setProperty("--primary", hex);
  root.style.setProperty(
    "--primary-foreground",
    luminance(hex) > 0.45 ? "#0a0a0a" : "#ffffff",
  );
}
