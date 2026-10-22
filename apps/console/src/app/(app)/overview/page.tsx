"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, PauseCircle, UserPlus, Clock, Sparkles, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { http } from "@/lib/api";
import type { FleetMetrics } from "@open-hrms/types";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: LucideIcon }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function MiniBars({ data }: { data: { key: string; label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-3 sm:gap-5">
      {data.map((d) => (
        <div key={d.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">{d.count}</div>
          <div
            className="w-full max-w-[44px] rounded-t-md bg-primary/80"
            style={{ height: `${Math.max(4, Math.round((d.count / max) * 120))}px` }}
            title={`${d.label}: ${d.count}`}
          />
          <div className="truncate text-[11px] text-muted-foreground">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["metrics"],
    queryFn: () => http.get<FleetMetrics>("/platform/metrics"),
  });

  return (
    <>
      <PageHeader title="Overview" description="Fleet-wide numbers across all customer workspaces." />
      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Workspaces" value={data.tenants} icon={Building2} />
            <Stat label="Active" value={data.tenantsByStatus?.ACTIVE ?? data.active ?? 0} icon={CheckCircle2} />
            <Stat label="Suspended" value={data.tenantsByStatus?.SUSPENDED ?? data.suspended ?? 0} icon={PauseCircle} />
            <Stat label="Self sign-ups" value={data.selfSignup} icon={UserPlus} />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Fleet health</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label="Pending verification" value={data.pendingVerification ?? 0} icon={Clock} />
              <Stat label="New (30d)" value={data.newLast30Days ?? 0} icon={Sparkles} />
              <Stat label="Total users" value={data.totalUsers ?? 0} icon={Users} />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Signups (last 6 months)</CardTitle>
            </CardHeader>
            <CardContent>
              {data.signupsByMonth && data.signupsByMonth.length > 0 ? (
                <MiniBars data={data.signupsByMonth.slice(-6)} />
              ) : (
                <div className="text-sm text-muted-foreground">No signup history yet.</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
