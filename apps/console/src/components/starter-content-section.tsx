"use client";

/**
 * Operator-side starter content: inspect and repair a tenant that has no
 * baseline configuration.
 *
 * This exists because a tenant can be created without ever passing through
 * provisionOrgDefaults() (an organization inserted directly by a seed or a
 * migration, for example), and nothing backfills it afterwards. Without this
 * an operator would have to impersonate the tenant to fix them.
 *
 * Applies every pack at once: an operator repairing an empty tenant wants the
 * whole baseline, and per-pack selection lives in the tenant's own settings.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { http, apiError } from "@/lib/api";
import { Button } from "@open-hrms/ui/button";
import { Badge } from "@open-hrms/ui/badge";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@open-hrms/ui/select";
import type { StarterContentPlan } from "@open-hrms/types";

// Select values cannot be empty strings, so "no state" needs a sentinel.
const NATIONWIDE = "__none__";

export function StarterContentSection({
  orgId,
  canApply,
}: {
  orgId: string;
  canApply: boolean;
}) {
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [state, setState] = useState(NATIONWIDE);
  const stateParam = state === NATIONWIDE ? undefined : state;

  const { data, isLoading } = useQuery({
    queryKey: ["ws-starter", orgId, year, stateParam],
    queryFn: () =>
      http.get<StarterContentPlan>(`/platform/tenants/${orgId}/starter-content`, {
        year,
        state: stateParam,
      }),
  });

  const plan = data?.plan ?? [];
  const totalToAdd = plan.reduce((n, p) => n + p.added, 0);
  // `packs` is always the full catalogue (ids + labels), whatever was selected.
  const labelFor = (id: string) => data?.packs.find((p) => p.id === id)?.label ?? id;
  const yearItems = (data?.verifiedYears ?? [thisYear]).map((y) => ({ value: String(y), label: String(y) }));
  const stateItems = [
    { value: NATIONWIDE, label: "Nationwide only" },
    ...(data?.states ?? []).map((s) => ({ value: s.code, label: s.name })),
  ];

  const apply = useMutation({
    mutationFn: () =>
      http.post<{ added: number }>(`/platform/tenants/${orgId}/starter-content`, {
        year: Number(year),
        state: stateParam ?? null,
      }),
    onSuccess: (res) => {
      toast.success(
        res.added === 0 ? "Already configured, nothing added" : `Loaded ${res.added} items`
      );
      qc.invalidateQueries({ queryKey: ["ws-starter", orgId] });
      qc.invalidateQueries({ queryKey: ["ws-activity", orgId] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Starter content</div>
        {canApply && (
          <Button
            size="sm"
            onClick={() => apply.mutate()}
            disabled={apply.isPending || isLoading || totalToAdd === 0}
          >
            {apply.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {totalToAdd === 0 && !isLoading ? "Nothing to add" : `Load ${totalToAdd} items`}
          </Button>
        )}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select items={yearItems} value={year} onValueChange={(v) => setYear(String(v))}>
          <SelectTrigger size="sm" aria-label="Holiday year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearItems.map((y) => (
              <SelectItem key={y.value} value={y.value}>
                {y.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={stateItems} value={state} onValueChange={(v) => setState(String(v))}>
          <SelectTrigger size="sm" aria-label="State">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stateItems.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <div className="space-y-1.5">
          {plan.map((p) => (
            <div
              key={p.pack}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <span className="truncate text-[13px]">
                {labelFor(p.pack)}
                {p.sourceLabel && (
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    {p.sourceLabel}
                    {p.national ? " (national list)" : ""}
                  </span>
                )}
              </span>
              {p.unavailable ? (
                <span className="text-[11px] text-amber-600" title={p.unavailable}>
                  no verified data
                </span>
              ) : p.added > 0 ? (
                <Badge variant="secondary" className="text-[10px]">
                  {p.added} missing
                </Badge>
              ) : (
                <span className="text-[11px] text-muted-foreground">configured</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
