"use client";

/**
 * Probation reviews.
 *
 * Probation length was captured at onboarding and then surfaced nowhere, so confirming
 * somebody happened only when a person remembered. This panel answers "who is due a
 * decision", and offers the two outcomes: confirm the employment, or extend the probation.
 *
 * It renders only when somebody is actually due, so the roster is not permanently carrying a
 * panel about nothing.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { Badge } from "@open-hrms/ui/badge";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Field } from "@open-hrms/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@open-hrms/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@open-hrms/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@open-hrms/ui/table";

export interface ProbationRow {
  employeeId: string;
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  joiningDate: string | null;
  probationMonths: number;
  probationEndsOn: string;
  overdue: boolean;
  confirmationIssued: boolean;
  extensionIssued: boolean;
}

const PROBATION_KEY = ["letters", "probation-due"];

/**
 * Fetched once over a wide horizon and narrowed on the client.
 *
 * Querying the server per horizon looked tidier but hid the control that changes it: with
 * nobody due inside the default window the whole card disappeared, taking the only way to
 * widen the search with it. Holding the full list means the card appears whenever anyone is
 * on probation at all, and moving the horizon is instant.
 */
const HORIZON_MAX = 365;
const DEFAULT_HORIZON = 90;

function formatDate(v?: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function useProbationDue(enabled: boolean) {
  return useQuery({
    queryKey: PROBATION_KEY,
    queryFn: () => http.get<ProbationRow[]>(`/letters/probation-due?withinDays=${HORIZON_MAX}`),
    enabled,
  });
}

type Outcome = "confirm" | "extend";

/** The decision dialog. One component for both outcomes: the fields differ, the flow does not. */
function DecisionDialog({
  row, outcome, onOpenChange,
}: {
  row: ProbationRow;
  outcome: Outcome;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [effectiveDate, setEffectiveDate] = useState(row.probationEndsOn);
  const [recordIt, setRecordIt] = useState(true);
  const [extendBy, setExtendBy] = useState(3);

  const run = useMutation({
    mutationFn: () =>
      outcome === "confirm"
        ? http.post<{ documentId: string }>(`/letters/confirmation/${row.employeeId}`, {
            effectiveDate,
            confirm: recordIt,
          })
        : http.post<{ documentId: string }>(`/letters/probation-extension/${row.employeeId}`, {
            effectiveDate,
            extendByMonths: recordIt ? extendBy : 0,
          }),
    onSuccess: () => {
      toast.success(
        outcome === "confirm"
          ? `Confirmation letter issued for ${row.name}`
          : `Probation extension issued for ${row.name}`
      );
      qc.invalidateQueries({ queryKey: PROBATION_KEY });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const confirming = outcome === "confirm";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{confirming ? "Confirm employment" : "Extend probation"}</DialogTitle>
          <DialogDescription>
            {row.name} ({row.code}). Probation ends {formatDate(row.probationEndsOn)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Effective from" htmlFor="pr-date">
            <Input id="pr-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </Field>

          {!confirming && (
            <Field label="Extend by (months)" htmlFor="pr-months">
              <Input
                id="pr-months"
                type="number"
                min={1}
                max={12}
                value={extendBy}
                onChange={(e) => setExtendBy(Number(e.target.value))}
              />
            </Field>
          )}

          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={recordIt} onCheckedChange={(v) => setRecordIt(!!v)} className="mt-0.5" />
            <span>
              {confirming ? (
                <>
                  Record the confirmation on their record
                  <span className="block text-xs text-muted-foreground">
                    Untick to issue the letter only. Recording it is what removes them from this list.
                  </span>
                </>
              ) : (
                <>
                  Update the probation length on their record
                  <span className="block text-xs text-muted-foreground">
                    Untick to issue the letter only. Updating it is what brings them back here at the new date.
                  </span>
                </>
              )}
            </span>
          </label>

          <p className="text-xs text-muted-foreground">
            The wording comes from your template in Settings, Letters. The letter is filed under the
            employee&apos;s documents and carries a verification code.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!effectiveDate || run.isPending} onClick={() => run.mutate()}>
            {run.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirming ? "Issue confirmation" : "Issue extension"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProbationReviewsCard({ enabled }: { enabled: boolean }) {
  const [withinDays, setWithinDays] = useState(DEFAULT_HORIZON);
  const [decision, setDecision] = useState<{ row: ProbationRow; outcome: Outcome } | null>(null);
  const { data: all = [], isLoading } = useProbationDue(enabled);

  // Nobody on probation at all means nothing to show. A permanent empty panel is noise.
  if (!enabled || isLoading || all.length === 0) return null;

  const cutoff = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
  const rows = all.filter((r) => r.probationEndsOn <= cutoff);
  const overdue = rows.filter((r) => r.overdue).length;

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="size-4" />
                Probation reviews
                {overdue > 0 && <Badge variant="amber">{overdue} overdue</Badge>}
              </CardTitle>
              <CardDescription>
                {rows.length === 0
                  ? `Nobody is due within ${withinDays} days. ${all.length} ${all.length === 1 ? "person is" : "people are"} on probation; widen the window to see them.`
                  : `${rows.length} ${rows.length === 1 ? "person is" : "people are"} due a confirmation decision. Confirming or extending both issue a letter.`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Ending within</span>
              <Input
                type="number"
                min={1}
                max={365}
                value={withinDays}
                onChange={(e) => setWithinDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
                className="w-20"
                aria-label="Days ahead to look"
              />
              <span className="text-muted-foreground">days</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Designation</TableHead>
                <TableHead className="hidden lg:table-cell">Joined</TableHead>
                <TableHead>Probation ends</TableHead>
                <TableHead className="text-right">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.code}
                      {r.department ? ` · ${r.department}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{r.designation || "-"}</TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {formatDate(r.joiningDate)}
                  </TableCell>
                  <TableCell>
                    <span className={r.overdue ? "font-medium text-amber-600 dark:text-amber-500" : undefined}>
                      {formatDate(r.probationEndsOn)}
                    </span>
                    <div className="text-xs text-muted-foreground">
                      {r.overdue ? "Overdue" : `${r.probationMonths} month probation`}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {r.extensionIssued && <Badge variant="grey" className="self-center">Extended</Badge>}
                      <Button size="sm" variant="outline" onClick={() => setDecision({ row: r, outcome: "extend" })}>
                        Extend
                      </Button>
                      <Button size="sm" onClick={() => setDecision({ row: r, outcome: "confirm" })}>
                        Confirm
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      {decision && (
        <DecisionDialog
          key={`${decision.row.employeeId}-${decision.outcome}`}
          row={decision.row}
          outcome={decision.outcome}
          onOpenChange={(o) => !o && setDecision(null)}
        />
      )}
    </>
  );
}
