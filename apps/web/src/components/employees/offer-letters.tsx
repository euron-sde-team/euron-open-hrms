"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError, downloadFile } from "@/lib/api";
import { Badge } from "@open-hrms/ui/badge";
import { Button } from "@open-hrms/ui/button";
import { Skeleton } from "@open-hrms/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";
import type { EnrichedEmployee } from "./types";

interface LetterInfo {
  issued: boolean;
  /** Issued, but the stored PDF is gone. The record is real; the bytes are not. */
  fileMissing?: boolean;
  documentId?: string;
  issuedAt?: string;
  filename?: string;
}

export interface LetterStatusRow {
  employeeId: string;
  code: string;
  name: string;
  status: string;
  department: string | null;
  hasSalary: boolean;
  letters: Record<string, LetterInfo>;
}

interface BulkOfferResult {
  issued: number;
  skipped: Array<{ employeeId: string; reason: string }>;
  failed: Array<{ employeeId: string; error: string }>;
  employeeIds: string[];
}

const LETTER_STATUS_KEY = ["letters", "status"];

/** Module scope so React Query can memoise the derived Map instead of rebuilding it
 *  (and handing out a fresh reference) on every render. */
const toMapByEmployee = (rows: LetterStatusRow[]) => new Map(rows.map((r) => [r.employeeId, r]));

function formatDate(v?: string): string {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Letter status for the whole roster, keyed by employee id.
 *
 * One request covers the table rather than one per row: the endpoint already reads
 * every document once, so per-row fetching would be the same work multiplied by the
 * headcount.
 */
export function useOfferLetterStatus(enabled: boolean) {
  return useQuery({
    queryKey: LETTER_STATUS_KEY,
    queryFn: () => http.get<LetterStatusRow[]>("/letters/status"),
    enabled,
    select: toMapByEmployee,
  });
}

/** Optimistically mark one employee's offer letter as issued in the cached roster. */
function markIssued(rows: LetterStatusRow[] | undefined, employeeId: string) {
  return rows?.map((r) =>
    r.employeeId === employeeId
      ? {
          ...r,
          // documentId is unknown until the refetch lands, which is exactly what keeps
          // the download button disabled for the moment the letter is being rendered.
          letters: { ...r.letters, OFFER_LETTER: { issued: true, issuedAt: new Date().toISOString() } },
        }
      : r,
  );
}

/** The Offer letter cell: issued state plus the one action that state allows. */
export function OfferLetterCell({
  employee,
  row,
  isLoading,
}: {
  employee: EnrichedEmployee;
  row?: LetterStatusRow;
  isLoading: boolean;
}) {
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState(false);

  const issue = useMutation({
    // `reissue` is required when a record already exists: the endpoint refuses a silent
    // duplicate, which is right for a normal re-click but would otherwise make a
    // missing-file record permanently unfixable from the UI.
    mutationFn: (opts?: { reissue?: boolean }) =>
      http.post(`/letters/offer/${employee.id}`, opts?.reissue ? { reissue: true } : {}),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: LETTER_STATUS_KEY });
      const previous = qc.getQueryData<LetterStatusRow[]>(LETTER_STATUS_KEY);
      qc.setQueryData<LetterStatusRow[]>(LETTER_STATUS_KEY, (old) => markIssued(old, employee.id));
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(LETTER_STATUS_KEY, ctx.previous);
      toast.error(apiError(e));
    },
    onSuccess: () => toast.success("Offer letter issued"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LETTER_STATUS_KEY });
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  if (isLoading) return <Skeleton className="h-5 w-24" />;

  const letter = row?.letters?.OFFER_LETTER;

  // Issued but the file is gone: downloading can only ever fail, so offer the one action
  // that actually fixes it. Without this the row said "Issued" next to a button that
  // returned a bare 404 forever, and the duplicate guard refused a fresh copy.
  if (letter?.issued && letter.fileMissing) {
    return (
      <div className="flex items-center gap-2">
        <div>
          <Badge variant="amber" title="The record exists but its PDF is missing from storage">
            File missing
          </Badge>
          {letter.issuedAt && (
            <div className="text-xs text-muted-foreground">Issued {formatDate(letter.issuedAt)}</div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={issue.isPending}
          onClick={() => issue.mutate({ reissue: true })}
          title="Generate a fresh copy of this letter"
        >
          {issue.isPending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
          Re-issue
        </Button>
      </div>
    );
  }

  if (letter?.issued) {
    return (
      <div className="flex items-center gap-2">
        <div>
          <Badge variant="green">Issued</Badge>
          {letter.issuedAt && (
            <div className="text-xs text-muted-foreground">{formatDate(letter.issuedAt)}</div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Download offer letter"
          title={letter.documentId ? "Download offer letter" : "Preparing the document"}
          disabled={!letter.documentId || downloading}
          onClick={async () => {
            setDownloading(true);
            try {
              await downloadFile(
                `/documents/${letter.documentId}/download`,
                `offer-letter-${employee.code}.pdf`,
              );
            } catch (e) {
              toast.error(apiError(e));
            } finally {
              setDownloading(false);
            }
          }}
        >
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        </Button>
      </div>
    );
  }

  // hasSalary comes from the same payload, so the reason a bulk run would skip this
  // person is visible before anyone starts one.
  const noSalary = row ? !row.hasSalary : false;
  return (
    // Stacked rather than side by side: this column sits in an already wide table, and
    // the reason line next to the button pushed the Actions column off screen.
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="xs"
        disabled={noSalary || issue.isPending}
        title={noSalary ? "No salary on record. Set compensation first." : undefined}
        onClick={() => issue.mutate({})}
      >
        {issue.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
        Issue
      </Button>
      {noSalary && <span className="text-xs text-muted-foreground">No salary</span>}
    </div>
  );
}

/**
 * Bulk issue for the selected rows.
 *
 * The dialog shows the split before the run (from letter status) and the server's own
 * skipped / failed reasons after it, because "23 issued" alone leaves HR to work out
 * on their own which seven people did not get one, and why.
 */
export function BulkOfferLettersDialog({
  open,
  onOpenChange,
  employees,
  selectedIds,
  statusById,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employees: EnrichedEmployee[];
  selectedIds: string[];
  statusById?: Map<string, LetterStatusRow>;
}) {
  const qc = useQueryClient();
  const [result, setResult] = useState<BulkOfferResult | null>(null);

  const nameOf = (id: string) => {
    const e = employees.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName || ""}`.trim() : statusById?.get(id)?.name || id;
  };

  const alreadyIssued = selectedIds.filter((id) => statusById?.get(id)?.letters?.OFFER_LETTER?.issued);
  const noSalary = selectedIds.filter(
    (id) => statusById?.get(id) && !statusById.get(id)!.hasSalary && !statusById.get(id)!.letters?.OFFER_LETTER?.issued,
  );
  const eligible = selectedIds.filter(
    (id) => !alreadyIssued.includes(id) && !noSalary.includes(id),
  );

  const run = useMutation({
    mutationFn: () =>
      // Every selected id is sent, not just the eligible ones, so the skip reasons
      // reported back are the server's own rather than this component's guess.
      http.post<BulkOfferResult>("/letters/offer/bulk", { employeeIds: selectedIds }),
    onSuccess: (res) => {
      setResult(res);
      if (res.issued) toast.success(`${res.issued} offer letter${res.issued === 1 ? "" : "s"} issued`);
      qc.invalidateQueries({ queryKey: LETTER_STATUS_KEY });
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setResult(null);
      run.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue offer letters</DialogTitle>
          <DialogDescription>
            {selectedIds.length} employee{selectedIds.length === 1 ? "" : "s"} selected.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <strong>{result.issued}</strong> issued
              {result.skipped.length > 0 && <span> · {result.skipped.length} skipped</span>}
              {result.failed.length > 0 && <span> · {result.failed.length} failed</span>}
            </div>
            {result.skipped.length > 0 && (
              <ResultList
                title="Skipped"
                items={result.skipped.map((s) => ({ id: s.employeeId, detail: s.reason }))}
                nameOf={nameOf}
              />
            )}
            {result.failed.length > 0 && (
              <ResultList
                title="Failed"
                tone="destructive"
                items={result.failed.map((f) => ({ id: f.employeeId, detail: f.error }))}
                nameOf={nameOf}
              />
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <SummaryLine count={eligible.length} label="will get an offer letter" />
            {alreadyIssued.length > 0 && (
              <SummaryLine
                count={alreadyIssued.length}
                label={`already ${alreadyIssued.length === 1 ? "has" : "have"} one (skipped)`}
                muted
              />
            )}
            {noSalary.length > 0 && (
              <SummaryLine
                count={noSalary.length}
                label={`${noSalary.length === 1 ? "has" : "have"} no salary on record (skipped)`}
                muted
              />
            )}
            {noSalary.length > 0 && (
              <p className="text-xs text-muted-foreground">
                An offer letter quotes compensation, so set a salary on those employees first
                (Salary action) and run this again.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {result ? "Done" : "Cancel"}
          </Button>
          {!result && (
            <Button disabled={!eligible.length || run.isPending} onClick={() => run.mutate()}>
              {run.isPending && <Loader2 className="size-4 animate-spin" />}
              Issue {eligible.length || ""}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryLine({ count, label, muted }: { count: number; label: string; muted?: boolean }) {
  return (
    <div className={muted ? "text-muted-foreground" : undefined}>
      <strong>{count}</strong> {label}
    </div>
  );
}

function ResultList({
  title,
  items,
  nameOf,
  tone,
}: {
  title: string;
  items: Array<{ id: string; detail: string }>;
  nameOf: (id: string) => string;
  tone?: "destructive";
}) {
  return (
    <div>
      <div className={tone === "destructive" ? "font-medium text-destructive" : "font-medium"}>
        {title}
      </div>
      <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
        {items.map((i) => (
          <li key={i.id}>
            <span className="text-foreground">{nameOf(i.id)}</span> · {i.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}
