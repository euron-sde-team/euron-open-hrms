"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, CornerDownLeft } from "lucide-react";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NAV_GROUPS, type NavItem } from "@/lib/nav";
import { cn } from "@open-hrms/ui/cn";

interface Person {
  id: string;
  name: string;
  code?: string;
  designation?: string;
  department?: string;
}
interface Result {
  key: string;
  label: string;
  hint?: string;
  href: string;
  group: string;
}

export function CommandPalette() {
  const router = useRouter();
  const { user, isStaff } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl+K to open; also a custom event so a nav button can open it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("cmdk:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cmdk:open", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const { data: people = [] } = useQuery({
    queryKey: ["directory", "cmdk"],
    queryFn: () => http.get<Person[]>("/directory"),
    enabled: open,
    staleTime: 60_000,
  });

  const navResults = useMemo<Result[]>(() => {
    const out: Result[] = [];
    for (const group of NAV_GROUPS) {
      for (const item of group.items as NavItem[]) {
        if (item.staff && !isStaff) continue;
        if (item.employeeOnly && !user?.employeeId) continue;
        out.push({ key: "nav:" + item.href, label: item.label, hint: group.label, href: item.href, group: "Go to" });
      }
    }
    return out;
  }, [isStaff, user?.employeeId]);

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase();
    const nav = navResults.filter((r) => !needle || r.label.toLowerCase().includes(needle) || r.hint?.toLowerCase().includes(needle));
    const ppl: Result[] = needle
      ? people
          .filter((p) =>
            `${p.name} ${p.code ?? ""} ${p.designation ?? ""} ${p.department ?? ""}`.toLowerCase().includes(needle)
          )
          .slice(0, 8)
          .map((p) => ({
            key: "person:" + p.id,
            label: p.name,
            hint: [p.designation, p.department].filter(Boolean).join(" · "),
            href: "/directory",
            group: "People",
          }))
      : [];
    return [...nav, ...ppl];
  }, [q, navResults, people]);

  useEffect(() => {
    if (sel >= results.length) setSel(0);
  }, [results.length, sel]);

  if (!open) return null;

  const go = (r?: Result) => {
    if (!r) return;
    setOpen(false);
    router.push(r.href);
  };

  // Group results for display while keeping a flat index for keyboard nav.
  let idx = -1;
  const groups: { name: string; items: { r: Result; i: number }[] }[] = [];
  for (const r of results) {
    idx++;
    const g = groups.find((x) => x.name === r.group);
    const entry = { r, i: idx };
    if (g) g.items.push(entry);
    else groups.push({ name: r.group, items: [entry] });
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex justify-center bg-[rgba(20,19,15,0.45)] pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex max-h-[68vh] w-[580px] max-w-[92vw] flex-col overflow-hidden rounded-[10px] border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); go(results[sel]); }
            }}
            placeholder="Search pages and people…"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No matches.</div>
          ) : (
            groups.map((g) => (
              <div key={g.name}>
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--faint)]">
                  {g.name}
                </div>
                {g.items.map(({ r, i }) => (
                  <button
                    key={r.key}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(r)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-left",
                      i === sel ? "bg-[var(--accent-50)] text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-foreground">{r.label}</span>
                    {r.hint && <span className="truncate text-xs text-muted-foreground">{r.hint}</span>}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-2 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1"><CornerDownLeft className="size-4" /> to open</span>
          <span>↑↓ to navigate</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
