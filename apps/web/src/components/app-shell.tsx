"use client";

import { Suspense, useEffect, useMemo, useState, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Menu, LogOut, User as UserIcon, ChevronDown, Search, Sun, Moon } from "lucide-react";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { applyBrandColor } from "@/lib/brand-theme";
import { navLabel, resolveActiveHref, visibleNavGroups, type NavGroup, type NavViewer } from "@/lib/nav";
import { productName } from "@/lib/runtime-env";
import { ProductTour } from "@/components/product-tour";
import { cn } from "@open-hrms/ui/cn";
import { Button } from "@open-hrms/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@open-hrms/ui/sheet";
import { Avatar, AvatarFallback } from "@open-hrms/ui/avatar";
import { CommandPalette } from "@/components/command-palette";
import { NotificationsBell } from "@/components/notifications-bell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@open-hrms/ui/dropdown-menu";

function useReminderCount() {
  const { data } = useQuery({
    queryKey: ["reminder-count"],
    queryFn: () => http.get<{ open: number; dueToday: number }>("/reminders/count"),
    refetchInterval: 60_000,
  });
  return data ?? { open: 0, dueToday: 0 };
}

function openCommandPalette() {
  window.dispatchEvent(new Event("cmdk:open"));
}

/** The one nav entry matching the current location (see resolveActiveHref). */
function useActiveHref(): string | null {
  const pathname = usePathname();
  const currentTab = useSearchParams().get("tab");
  return useMemo(() => resolveActiveHref(pathname, currentTab), [pathname, currentTab]);
}

function useNavViewer(): NavViewer {
  const { user, isStaff } = useAuth();
  return { isStaff, hasEmployee: !!user?.employeeId };
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const saved = typeof window !== "undefined" && window.localStorage.getItem("hrms.theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("hrms.theme", next ? "dark" : "light");
  };
  return (
    <DropdownMenuItem onClick={(e) => { e.preventDefault(); toggle(); }}>
      {dark ? <Sun /> : <Moon />}
      {dark ? "Light mode" : "Dark mode"}
    </DropdownMenuItem>
  );
}

function initials(name?: string) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Brand({ org }: { org?: string }) {
  return (
    <Link
      href="/dashboard"
      className="press flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.018em] text-foreground"
    >
      <span className="grid size-9 place-items-center rounded-[10px] bg-primary text-[18px] font-bold text-primary-foreground shadow-[var(--elev-2)]">
        e
      </span>
      <span className="hidden max-w-[220px] truncate sm:inline">{org || productName()}</span>
    </Link>
  );
}

// ── Desktop: horizontal top nav with grouped dropdowns ──
function TopNav() {
  const viewer = useNavViewer();
  const reminders = useReminderCount();
  const activeHref = useActiveHref();
  const isActive = (href: string) => href === activeHref;
  const groupActive = (g: NavGroup) => g.items.some((i) => isActive(i.href));

  return (
    <nav className="hidden h-full items-stretch lg:flex">
      {visibleNavGroups(viewer).map((group) => {
        const items = group.items;
        const [only] = items;

        // Single-item group: render as a direct tab.
        if (items.length === 1 && only) {
          const item = only;
          const active = isActive(item.href);
          return (
            <Link
              key={group.label}
              href={item.href}
              data-tour={`nav:${group.label}`}
              className={cn(
                "relative flex items-center gap-2 px-3.5 text-[15px] font-medium transition-colors duration-200",
                "after:absolute after:inset-x-3 after:bottom-0 after:h-[2.5px] after:rounded-full after:bg-primary after:transition-opacity after:duration-200",
                active
                  ? "font-semibold text-foreground after:opacity-100"
                  : "text-muted-foreground after:opacity-0 hover:text-foreground"
              )}
            >
              {navLabel(item, viewer)}
              {item.href === "/reminders" && reminders.open > 0 && (
                <span
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-semibold text-white",
                    reminders.dueToday > 0 ? "bg-[var(--bad)]" : "bg-primary"
                  )}
                >
                  {reminders.open > 99 ? "99+" : reminders.open}
                </span>
              )}
            </Link>
          );
        }

        // Multi-item group: dropdown menu.
        const active = groupActive(group);
        return (
          <DropdownMenu key={group.label}>
            <DropdownMenuTrigger
              data-tour={`nav:${group.label}`}
              className={cn(
                "relative flex items-center gap-1.5 px-3.5 text-[15px] font-medium outline-none transition-colors duration-200",
                "after:absolute after:inset-x-3 after:bottom-0 after:h-[2.5px] after:rounded-full after:bg-primary after:transition-opacity after:duration-200",
                active
                  ? "font-semibold text-foreground after:opacity-100"
                  : "text-muted-foreground after:opacity-0 hover:text-foreground"
              )}
            >
              {group.label}
              <ChevronDown className="size-4 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              {items.map((item) => {
                const Icon = item.icon;
                const itemActive = isActive(item.href);
                return (
                  <DropdownMenuItem
                    key={item.href}
                    render={<Link href={item.href} />}
                    className={cn(
                      "flex items-center gap-3",
                      itemActive && "bg-accent font-semibold text-accent-foreground"
                    )}
                  >
                    <Icon className={cn(itemActive ? "text-accent-foreground" : "text-muted-foreground")} />
                    {navLabel(item, viewer)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}

// ── Mobile: flat vertical list inside the slide-over sheet ──
function MobileNav({ onNavigate }: { onNavigate?: () => void }) {
  const viewer = useNavViewer();
  const activeHref = useActiveHref();

  return (
    <nav className="flex flex-col gap-6 px-3 py-4">
      {visibleNavGroups(viewer).map((group) => {
        const items = group.items;
        return (
          <div key={group.label}>
            <div className="px-3 pb-2 text-[13px] font-semibold text-muted-foreground">
              {group.label}
            </div>
            <div className="flex flex-col gap-1">
              {items.map((item) => {
                const active = item.href === activeHref;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex min-h-11 items-center gap-3.5 rounded-[10px] px-3 text-[16px] transition-colors duration-200",
                      active
                        ? "bg-accent font-semibold text-accent-foreground"
                        : "text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className={cn("size-5 shrink-0", active ? "text-accent-foreground" : "text-muted-foreground")} />
                    {navLabel(item, viewer)}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout, impersonated, suspended } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Not while suspended: the session is valid, the notice (see Providers) owns the screen.
  useEffect(() => {
    if (!loading && !user && !suspended) router.replace("/login");
  }, [loading, user, suspended, router]);

  // Org-configurable accent: apply the branding colour from the session
  // (Settings → Organization → Theme colour) as the app's --primary.
  const brandColor = (user?.org?.branding as { color?: string } | null)?.color;
  useEffect(() => {
    applyBrandColor(brandColor);
  }, [brandColor]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <ProductTour />
      {/* Operator impersonation banner, only shows when an operator is acting as this user */}
      {impersonated && (
        <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-center text-[14px] font-medium text-amber-950">
          <span>⚠ Operator support session, you are viewing as <strong>{user.name}</strong> ({user.org?.name}). Actions are audited.</span>
          <button onClick={logout} className="press rounded-full bg-amber-950/15 px-3 py-1 text-[13px] font-semibold hover:bg-amber-950/25">
            Exit
          </button>
        </div>
      )}

      {/* Top navigation bar, translucent iOS-style material over scrolling content */}
      <header className="material-thick sticky top-0 z-30 flex h-16 items-stretch gap-4 border-b border-[color:var(--hairline)] px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <Brand org={user.org?.name} />
        </div>

        <Suspense fallback={<div className="hidden lg:flex" />}>
          <TopNav />
        </Suspense>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
            <SheetTitle className="flex h-16 items-center border-b border-[color:var(--hairline)] px-5 text-[19px] font-semibold">
              {user.org?.name || productName()}
            </SheetTitle>
            <div className="overflow-y-auto">
              <Suspense fallback={null}>
                <MobileNav onNavigate={() => setMobileOpen(false)} />
              </Suspense>
            </div>
          </SheetContent>
        </Sheet>

        <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
          {/* Global search → opens the ⌘K palette */}
          <button
            onClick={openCommandPalette}
            data-tour="search"
            className="press hidden h-10 items-center gap-2.5 rounded-full border border-border bg-card px-4 text-[14px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:flex"
          >
            <Search className="size-[18px]" />
            <span>Search</span>
            <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[13px]">⌘K</kbd>
          </button>
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={openCommandPalette} aria-label="Search">
            <Search />
          </Button>

          <NotificationsBell />

          <DropdownMenu>
            <DropdownMenuTrigger
              data-tour="user-menu"
              className="press flex items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
              aria-label="Account menu"
            >
              <Avatar>
                <AvatarFallback>{initials(user.name)}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-64">
              <div className="px-3 py-2">
                <div className="text-[15px] font-semibold">{user.name}</div>
                <div className="text-[13px] text-muted-foreground">{user.email}</div>
                {user.org?.name && (
                  <div className="mt-1.5 text-[13px] text-muted-foreground">{user.org.name}</div>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/profile")}>
                <UserIcon /> My profile
              </DropdownMenuItem>
              <ThemeToggle />
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} variant="destructive">
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {/* min-w-0 so a wide child (a table, a long unbroken string) scrolls inside its
            own container instead of stretching this column and the document with it. */}
        <div className="mx-auto min-w-0 max-w-[1180px]">{children}</div>
      </main>

      <CommandPalette />
    </div>
  );
}
