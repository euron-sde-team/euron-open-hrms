"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Active-tab state kept in sync with the `?tab=` query param in BOTH
 * directions, so nav items can deep-link to a specific tab
 * (e.g. /settings?tab=users) *and* a manual tab click updates the URL.
 *
 * The write-back matters for more than deep links: the top nav decides which
 * entry to highlight by reading `?tab=`. Without it, clicking "Pay runs" in
 * the page left the URL on `/payroll`, so the nav went on highlighting
 * "Payslips", the tab and the nav disagreed about where you were.
 *
 * Components using this must sit inside a <Suspense> boundary.
 */
export function useActiveTab(fallback: string) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlTab = sp.get("tab");
  const [tab, setTabState] = useState(urlTab ?? fallback);

  // URL → state (back/forward, and deep links from the nav).
  useEffect(() => {
    if (urlTab && urlTab !== tab) setTabState(urlTab);
  }, [urlTab, tab]);

  // state → URL, preserving any other query params already on the page.
  const setTab = useCallback(
    (next: string) => {
      setTabState(next);
      const params = new URLSearchParams(Array.from(sp.entries()));
      if (next === fallback) params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname, fallback]
  );

  return [tab, setTab] as const;
}
