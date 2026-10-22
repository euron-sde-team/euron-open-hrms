"use client";

import { useEffect, useState, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Loader2,
  Menu,
  LogOut,
  ShieldCheck,
  LayoutDashboard,
  Building2,
  Users,
  Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { productName } from "@/lib/runtime-env";
import { cn } from "@open-hrms/ui/cn";
import { Button } from "@open-hrms/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@open-hrms/ui/sheet";
import { Avatar, AvatarFallback } from "@open-hrms/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@open-hrms/ui/dropdown-menu";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/workspaces", label: "Workspaces", icon: Building2 },
  { href: "/operators", label: "Operators", icon: Users },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/security", label: "Security", icon: ShieldCheck },
];

function initials(email?: string) {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const { admin, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !admin) router.replace("/login");
  }, [loading, admin, router]);

  if (loading || !admin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="material-thick sticky top-0 z-30 border-b border-[color:var(--hairline)]">
        <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>

          <Link href="/overview" className="press flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-[10px] bg-primary text-[18px] font-bold text-primary-foreground">
              e
            </span>
            <span className="text-[17px] font-semibold tracking-[-0.018em]">
              {productName()}{" "}
              <span className="font-normal text-muted-foreground">· Operator Console</span>
            </span>
          </Link>

          {/* Desktop tabs sit inline with the brand, so the console reads as one bar */}
          <nav className="ml-6 hidden h-full items-stretch lg:flex">
            {NAV.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-2 px-3.5 text-[15px] font-medium transition-colors duration-200",
                    "after:absolute after:inset-x-3 after:bottom-0 after:h-[2.5px] after:rounded-full after:bg-primary after:transition-opacity after:duration-200",
                    active
                      ? "font-semibold text-foreground after:opacity-100"
                      : "text-muted-foreground after:opacity-0 hover:text-foreground"
                  )}
                >
                  <Icon className="size-[18px]" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden rounded-full bg-primary/12 px-3 py-1.5 text-[13px] font-semibold text-primary md:inline">
              Control plane
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="press flex items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
                aria-label="Account menu"
              >
                <Avatar>
                  <AvatarFallback>{initials(admin.email)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-64">
                <div className="px-3 py-2">
                  <div className="text-[15px] font-semibold">Operator</div>
                  <div className="text-[13px] text-muted-foreground">{admin.email}</div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} variant="destructive">
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
          <SheetTitle className="flex h-16 items-center border-b border-[color:var(--hairline)] px-5 text-[19px] font-semibold">
            Operator Console
          </SheetTitle>
          <nav className="flex flex-col gap-1 p-3">
            {NAV.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex min-h-12 items-center gap-3.5 rounded-[10px] px-3 text-[16px] transition-colors",
                    active
                      ? "bg-accent font-semibold text-accent-foreground"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>

      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
