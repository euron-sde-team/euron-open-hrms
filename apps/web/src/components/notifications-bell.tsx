"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { http } from "@/lib/api";
import { cn } from "@open-hrms/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@open-hrms/ui/dropdown-menu";

interface Notification {
  id: string;
  title?: string;
  body?: string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Backend notification links use the old vanilla route names (e.g. "myleave",
// "myseparation"); map them to the current Next.js routes so they don't 404.
const LINK_MAP: Record<string, string> = {
  myleave: "/leave",
  leave: "/leave",
  myattendance: "/attendance",
  attendance: "/attendance",
  myreimbursements: "/reimbursements",
  reimbursements: "/reimbursements",
  mydocs: "/documents",
  documents: "/documents",
  myseparation: "/separation",
  separation: "/separation",
  mypayslips: "/payroll",
  payslips: "/payroll",
  payroll: "/payroll",
  assets: "/assets",
  onboarding: "/onboarding",
  vendors: "/vendors",
};
function resolveLink(link: string): string {
  const key = (link.replace(/^\//, "").split("?")[0] ?? "").toLowerCase();
  return LINK_MAP[key] ?? "/" + key;
}

export function NotificationsBell() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: count } = useQuery({
    queryKey: ["notif-count"],
    queryFn: () => http.get<{ unread: number }>("/notifications/count"),
    refetchInterval: 30_000,
  });
  const unread = count?.unread ?? 0;

  const { data: list = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => http.get<Notification[]>("/notifications", { limit: 30 }),
    enabled: open,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => http.post(`/notifications/${id}/read`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif-count"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const markAll = useMutation({
    mutationFn: () => http.post("/notifications/read-all", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif-count"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const onItem = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) {
      setOpen(false);
      router.push(resolveLink(n.link));
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="relative inline-flex rounded-[6px] p-1.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--coral)] px-[3px] text-[12px] font-bold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-[340px] overflow-auto p-0">
        <div className="sticky top-0 flex items-center justify-between border-b bg-card px-3.5 py-2.5">
          <b className="text-sm">Notifications</b>
          {unread > 0 && (
            <button className="text-xs text-primary hover:underline" onClick={() => markAll.mutate()}>
              Mark all read
            </button>
          )}
        </div>
        {list.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>
        ) : (
          list.map((n) => (
            <button
              key={n.id}
              onClick={() => onItem(n)}
              className={cn(
                "block w-full border-b px-3.5 py-2.5 text-left last:border-b-0 hover:bg-muted",
                !n.readAt && "bg-[var(--accent-50)]"
              )}
            >
              {n.title && <div className="text-[13px] font-semibold text-foreground">{n.title}</div>}
              {n.body && <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>}
              <div className="mt-0.5 text-[13px] text-muted-foreground/70">{timeAgo(n.createdAt)}</div>
            </button>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
