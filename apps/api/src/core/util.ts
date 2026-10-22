/** Shared helpers: errors, async wrapper, dates, money, geo-distance. */

export class HttpError extends Error {
  status: number;
  /** Machine-readable reason, for clients that need to branch on more than the message. */
  code?: string;
  constructor(status, message, code?: string) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}
export const bad = (msg) => new HttpError(400, msg);
export const unauth = (msg = "Not authenticated") => new HttpError(401, msg);
export const forbidden = (msg = "Not allowed") => new HttpError(403, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);
/** The record exists but the thing it points at is gone (e.g. a stored file was removed). */
export const gone = (msg = "No longer available") => new HttpError(410, msg);

/** Wrap an async route so thrown errors hit the error middleware. */
/** Escape text for interpolation into HTML (email bodies, reports). */
export const escapeHtml = (s: unknown): string =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Haversine distance in metres between two {lat,lng} points. */
export function distanceMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const todayStr = (d = new Date()) => d.toISOString().slice(0, 10); // YYYY-MM-DD

/**
 * A timestamp as YYYY-MM-DD, whatever shape it arrived in.
 *
 * `String(value).slice(0, 10)` is the obvious version and it is wrong half the time: pg hands
 * back real Date objects, and String(date) is "Mon Aug 24 2026 ...", so the slice yields
 * "Mon Aug 24". It survives in JSON responses because those serialise to ISO first, which is
 * exactly why it only shows up somewhere like a CSV export.
 */
export const isoDate = (v: any): string => {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

/**
 * Validate + normalize a calendar date to YYYY-MM-DD, rejecting absurd years.
 * Returns the normalized string, or null if invalid / out of [1900, 2200].
 */
export function normalizeDate(s) {
  if (s == null || s === "") return null;
  const str = String(s).trim();
  const d = new Date(str.length <= 10 ? str + "T00:00:00Z" : str);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1900 || y > 2200) return null;
  return d.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(fromStr, toStr) {
  const from = new Date(fromStr + "T00:00:00Z");
  const to = new Date(toStr + "T00:00:00Z");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Currency-aware money formatter for any country. Used across payslips, letters,
 * settlement and reports so amounts render in each org/employee's own currency.
 * No FX conversion, it only formats the given amount in the given currency.
 */
export const money = (n, currency = "INR", locale = "en-IN") => {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(round2(n));
  } catch {
    // Unknown currency/locale → fall back to a plain "<CODE> 1,234.56".
    return `${currency} ${round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
};

/** Backward-compatible INR formatter (unchanged behaviour). */
export const inr = (n) =>
  "₹" + round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Sum an employee's earning amounts, supporting both the new generalized
 * compensation shape ({ components: [{key,label,amount}] }) and the legacy
 * India shape ({ basic, hra, allowances }). `deductions` (legacy PF figure) is
 * NOT an earning and is excluded. Used by letters/settlement/reports so they
 * keep working for both shapes.
 */
export const compEarnings = (salary) => {
  const s = salary || {};
  if (Array.isArray(s.components) && s.components.length) {
    return round2(s.components.reduce((acc, c) => acc + (Number(c.amount) || 0), 0));
  }
  return round2(Number(s.basic || 0) + Number(s.hra || 0) + Number(s.allowances || 0));
};

export const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** Random readable password for onboarding. */
export function tempPassword() {
  const a = ["Sky","Run","Bold","Fast","Cloud","Spark","Vivid","Prime","Nova","Echo"];
  const b = a[Math.floor(Math.random() * a.length)];
  return `${b}@${Math.floor(1000 + Math.random() * 9000)}`;
}
