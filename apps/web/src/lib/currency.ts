/**
 * Shared currency formatting for the tenant client. Replaces the per-page
 * `inr()` re-declarations so amounts render in each org/employee's own currency.
 * No FX conversion, it only formats the given amount in the given currency.
 */

import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api";

export interface OrgPayrollSettings {
  country: string;
  currency: string;
  locale: string;
}

/** Format `amount` in `currency`/`locale`, falling back gracefully. */
export function formatMoney(
  amount: number,
  currency = "INR",
  locale = "en-IN",
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: opts.minimumFractionDigits ?? 0,
      maximumFractionDigits: opts.maximumFractionDigits ?? 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString("en-US", {
      minimumFractionDigits: opts.minimumFractionDigits ?? 0,
      maximumFractionDigits: opts.maximumFractionDigits ?? 0,
    })}`;
  }
}

/**
 * The org's payroll country/currency/locale. Read from /api/org, which exposes
 * `org.payroll` (set in payroll settings). Defaults to India/INR. Cached for the
 * session; safe to call from any component.
 */
export function useOrgPayroll(): OrgPayrollSettings {
  const { data } = useQuery({
    queryKey: ["org"],
    queryFn: () => http.get<{ org: { payroll?: OrgPayrollSettings; country?: string } }>("/org"),
    staleTime: 5 * 60 * 1000,
  });
  const p = data?.org?.payroll;
  return {
    country: p?.country || data?.org?.country || "IN",
    currency: p?.currency || "INR",
    locale: p?.locale || "en-IN",
  };
}
