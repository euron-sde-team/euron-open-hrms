"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon } from "lucide-react";
import { http } from "@/lib/api";
import type { FleetActivity } from "@open-hrms/types";
import { actionMeta, activitySubject } from "@/lib/activity";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Card } from "@open-hrms/ui/card";
import { Badge } from "@open-hrms/ui/badge";
import { Skeleton } from "@open-hrms/ui/skeleton";

function fmtDateTime(s?: string) {
  if (!s) return "-";
  try { return new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return s; }
}

export default function ActivityPage() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fleet-activity"],
    queryFn: () => http.get<FleetActivity[]>("/platform/activity"),
  });

  return (
    <>
      <PageHeader title="Activity" description="Fleet-wide audit trail of operator actions across all workspaces." />

      <Card className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <ActivityIcon className="h-6 w-6 opacity-50" />
            No operator activity yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((a) => {
              const meta = actionMeta(a.action);
              const reason = typeof a.meta?.reason === "string" ? a.meta.reason : "";
              return (
                <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge variant={meta.tone} className="shrink-0">{meta.label}</Badge>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium">{activitySubject(a)}</div>
                      {reason && <div className="truncate text-xs text-muted-foreground">{reason}</div>}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.at)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
