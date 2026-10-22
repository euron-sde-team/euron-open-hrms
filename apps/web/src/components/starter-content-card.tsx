"use client";

/**
 * Starter content, load the configuration common to every company (leave
 * types, holiday calendar, policies, benefits, departments) in one action.
 *
 * Shows a dry-run count before writing anything, because "Load" against a
 * tenant that is already configured should visibly be a no-op rather than a
 * leap of faith. Applying is idempotent server-side, so a double click is safe.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import type { PackId, StarterContentApplyResult, StarterContentPlan } from "@open-hrms/types";
import { http, apiError } from "@/lib/api";
import { Button } from "@open-hrms/ui/button";
import { Label } from "@open-hrms/ui/label";
import { Badge } from "@open-hrms/ui/badge";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Skeleton } from "@open-hrms/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@open-hrms/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-hrms/ui/select";

const NATIONWIDE = "__none__";

export function StarterContentCard() {
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [state, setState] = useState<string>(NATIONWIDE);
  const [selected, setSelected] = useState<PackId[] | null>(null);

  const stateParam = state === NATIONWIDE ? undefined : state;

  const { data, isLoading } = useQuery({
    queryKey: ["starter-content", year, stateParam],
    queryFn: () =>
      http.get<StarterContentPlan>("/content/starter", { year, state: stateParam }),
  });

  // Default to every pack, but only once the catalogue is known.
  const packs = data?.packs ?? [];
  const chosen = selected ?? packs.map((p) => p.id);
  const planFor = useMemo(
    () => new Map((data?.plan ?? []).map((r) => [r.pack, r])),
    [data]
  );

  const toggle = (id: PackId) =>
    setSelected(chosen.includes(id) ? chosen.filter((p) => p !== id) : [...chosen, id]);

  const totalToAdd = chosen.reduce((n, id) => n + (planFor.get(id)?.added ?? 0), 0);
  const holidayPlan = planFor.get("HOLIDAYS");
  const unavailable = holidayPlan?.unavailable;
  const years = data?.verifiedYears ?? [];

  const apply = useMutation({
    mutationFn: () =>
      http.post<StarterContentApplyResult>("/content/starter/apply", {
        packs: chosen,
        year: Number(year),
        state: stateParam ?? null,
      }),
    onSuccess: (res) => {
      const refreshed = (res.results ?? []).reduce((n, r) => n + (r.updated ?? 0), 0);
      const parts: string[] = [];
      if (res.added) parts.push(`added ${res.added}`);
      // Corrections to already-present holidays are real changes; say so.
      if (refreshed) parts.push(`refreshed ${refreshed} from the gazette`);
      toast.success(
        parts.length ? parts.join(", ") : "Everything was already configured, nothing to add"
      );
      // Everything these packs touch is cached elsewhere in the app.
      for (const key of ["starter-content", "leave-types", "holidays", "policies", "benefits", "departments"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Starter content</CardTitle>
            <CardDescription>
              Load the setup most companies need, leave types, a holiday calendar, policies,
              benefits and departments. Existing entries are never overwritten.
            </CardDescription>
          </div>
          <Button
            onClick={() => apply.mutate()}
            disabled={apply.isPending || isLoading || chosen.length === 0 || totalToAdd === 0}
          >
            {apply.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {totalToAdd === 0 && !isLoading ? "Nothing to add" : `Load ${totalToAdd} item${totalToAdd === 1 ? "" : "s"}`}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="starter-year">Holiday year</Label>
            <Select value={year} onValueChange={(v) => setYear(v ?? String(thisYear))}>
              <SelectTrigger id="starter-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="starter-state">State</Label>
            <Select value={state} onValueChange={(v) => setState(v ?? NATIONWIDE)}>
              <SelectTrigger id="starter-state">
                <SelectValue placeholder="Nationwide only" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NATIONWIDE}>Nationwide only</SelectItem>
                {(data?.states ?? []).map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {holidayPlan?.sourceLabel && (
          <div className="flex gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">{holidayPlan.sourceLabel}</span>, transcribed from{" "}
              {holidayPlan.sourceCitation}.
              {holidayPlan.national &&
                " No state gazette is held for this state, so the central list is used, add state-specific holidays by hand."}
            </p>
          </div>
        )}

        {unavailable && (
          <div className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-muted-foreground">{unavailable}</p>
          </div>
        )}

        <div className="space-y-3">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            : packs.map((p) => {
                const plan = planFor.get(p.id);
                const add = plan?.added ?? 0;
                const skip = plan?.skipped ?? 0;
                return (
                  <label
                    key={p.id}
                    htmlFor={`pack-${p.id}`}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted"
                  >
                    <Checkbox
                      id={`pack-${p.id}`}
                      checked={chosen.includes(p.id)}
                      onCheckedChange={() => toggle(p.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{p.label}</span>
                        {plan?.unavailable ? (
                          <Badge variant="outline" className="text-amber-600">
                            unavailable
                          </Badge>
                        ) : add > 0 ? (
                          <Badge variant="secondary">{add} to add</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            <Check className="mr-1 h-3 w-3" /> already set up
                          </Badge>
                        )}
                        {skip > 0 && add > 0 && (
                          <span className="text-xs text-muted-foreground">{skip} already present</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                    </div>
                  </label>
                );
              })}
        </div>
      </CardContent>
    </Card>
  );
}
