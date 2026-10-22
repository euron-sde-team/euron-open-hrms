"use client";

/**
 * Issue a letter for one person, from the roster.
 *
 * Until now each letter was reachable only from the flow that happened to produce it: a
 * relieving letter needed an exit in progress, an experience certificate needed one
 * completing. That fails the two requests HR gets most: a current employee who needs proof
 * of employment for a visa or a loan, and somebody who left years ago asking for a duplicate
 * of a letter that predates this system. Neither should require inventing a separation.
 *
 * Letters relevant to this person's situation are listed first, but nothing is hidden: the
 * templates are the organisation's, so what a letter may claim is their call.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError, downloadFile } from "@/lib/api";
import { Badge } from "@open-hrms/ui/badge";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
import { Field } from "@open-hrms/ui/field";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Skeleton } from "@open-hrms/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@open-hrms/ui/dialog";
import type { EnrichedEmployee } from "./types";

interface IssuableLetter {
  kind: string;
  label: string;
  /** Which date this letter states: a last working day, or an effective date. */
  dated: "lastWorkingDay" | "effectiveDate";
  /** "salary" collects revised figures instead of just a date (the appraisal letter). */
  form: "date" | "salary";
  suggested: boolean;
  defaultDate: string | null;
  issuedCount: number;
  lastIssuedAt: string | null;
  lastDocumentId: string | null;
}

interface Salary {
  basic?: number;
  hra?: number;
  allowances?: number;
  deductions?: number;
}

interface Issuable {
  employeeId: string;
  name: string;
  code: string;
  status: string;
  joiningDate: string | null;
  salary: Salary | null;
  letters: IssuableLetter[];
}

const NUM = (v: string) => Number(v) || 0;
const annual = (s: { basic: number; hra: number; allowances: number }) =>
  (s.basic + s.hra + s.allowances) * 12;

const DATE_LABEL: Record<string, string> = {
  lastWorkingDay: "Last working day",
  effectiveDate: "Effective from",
};

function formatDate(v?: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function IssueLetterDialog({
  employee, open, onOpenChange,
}: {
  employee: EnrichedEmployee;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [email, setEmail] = useState(true);
  // Set when the server reports one already exists, so re-issuing is a second, deliberate click.
  const [duplicate, setDuplicate] = useState<{ message: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["letters", "issuable", employee.id],
    queryFn: () => http.get<Issuable>(`/letters/issuable/${employee.id}`),
    enabled: open,
  });

  const selected = data?.letters.find((l) => l.kind === kind) ?? null;
  const isAppraisal = selected?.form === "salary";

  // Revised figures, prefilled from what they earn today so the form opens on "no change"
  // and every number typed is a deliberate edit.
  const [revised, setRevised] = useState({ basic: "", hra: "", allowances: "", deductions: "" });

  const choose = (l: IssuableLetter) => {
    setKind(l.kind);
    // An appraisal takes effect going forward, so today is the sensible default rather than
    // a probation date, which is what defaultDate carries for the other effective-date letters.
    setDate(l.form === "salary" ? new Date().toISOString().slice(0, 10) : (l.defaultDate ?? ""));
    if (l.form === "salary") {
      const s = data?.salary ?? {};
      setRevised({
        basic: String(s.basic ?? 0),
        hra: String(s.hra ?? 0),
        allowances: String(s.allowances ?? 0),
        deductions: String(s.deductions ?? 0),
      });
    }
    setDuplicate(null);
  };

  const current = data?.salary ?? {};
  const prevAnnual = annual({
    basic: Number(current.basic ?? 0), hra: Number(current.hra ?? 0), allowances: Number(current.allowances ?? 0),
  });
  const newAnnual = annual({
    basic: NUM(revised.basic), hra: NUM(revised.hra), allowances: NUM(revised.allowances),
  });
  const pct = prevAnnual > 0 ? ((newAnnual - prevAnnual) / prevAnnual) * 100 : 0;

  const [applyIncrement, setApplyIncrement] = useState(true);

  const issue = useMutation({
    mutationFn: (opts: { reissue?: boolean } = {}) =>
      // The appraisal letter keeps its own endpoint: it takes figures rather than a date,
      // prints a before and after comparison, and can write the new salary back.
      isAppraisal
        ? http.post<{ documentId: string }>(`/letters/appraisal/${employee.id}`, {
            salary: {
              basic: NUM(revised.basic), hra: NUM(revised.hra),
              allowances: NUM(revised.allowances), deductions: NUM(revised.deductions),
            },
            effectiveDate: date,
            applyIncrement,
            email,
          })
        : http.post<{ documentId: string }>(`/letters/issue/${employee.id}`, {
            kind,
            [selected!.dated]: date,
            email,
            ...(opts.reissue ? { reissue: true } : {}),
          }),
    onSuccess: () => {
      toast.success(
        isAppraisal && applyIncrement
          ? `Appraisal letter issued and the revised salary applied`
          : email ? `${selected?.label} issued and emailed` : `${selected?.label} issued`
      );
      qc.invalidateQueries({ queryKey: ["letters"] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      // The salary on the roster changes when the increment is applied.
      qc.invalidateQueries({ queryKey: ["employees"] });
      setDuplicate(null);
      onOpenChange(false);
    },
    onError: (e) => {
      const raw = apiError(e);
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.code === "LETTER_ALREADY_ISSUED") { setDuplicate({ message: parsed.message }); return; }
      } catch { /* not our structured conflict */ }
      toast.error(raw);
    },
  });

  const suggested = data?.letters.filter((l) => l.suggested) ?? [];
  const others = data?.letters.filter((l) => !l.suggested) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue a letter</DialogTitle>
          <DialogDescription>
            {employee.firstName} {employee.lastName} ({employee.code})
            {data ? `, ${data.status.toLowerCase().replace(/_/g, " ")}` : ""}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              {suggested.length > 0 && (
                <LetterGroup title="Suited to their situation" items={suggested} kind={kind} onChoose={choose} />
              )}
              {others.length > 0 && (
                <LetterGroup title="Other letters" items={others} kind={kind} onChoose={choose} />
              )}
            </div>

            {selected && (
              <>
                <Field label={isAppraisal ? "Effective from" : DATE_LABEL[selected.dated]} htmlFor="issue-date">
                  <Input id="issue-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                {!selected.defaultDate && !isAppraisal && (
                  <p className="text-xs text-muted-foreground">
                    Nothing on record to default to, so enter the real date. A letter about an exit
                    that happened years ago must not claim it happened today.
                  </p>
                )}

                {isAppraisal && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {([
                        ["basic", "Basic (monthly)"],
                        ["hra", "HRA"],
                        ["allowances", "Allowances"],
                        ["deductions", "Statutory deductions"],
                      ] as const).map(([key, label]) => (
                        <Field key={key} label={label} htmlFor={`rev-${key}`}>
                          <Input
                            id={`rev-${key}`}
                            type="number"
                            min={0}
                            className="text-right tabular-nums"
                            value={revised[key]}
                            onChange={(e) => setRevised((r) => ({ ...r, [key]: e.target.value }))}
                          />
                        </Field>
                      ))}
                    </div>

                    {/* The comparison the letter will print, shown before it is printed. */}
                    <div className="rounded-md border bg-muted/40 p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Current annual CTC</span>
                        <span className="tabular-nums">{prevAnnual.toLocaleString()}</span>
                      </div>
                      <div className="mt-1 flex justify-between">
                        <span className="text-muted-foreground">Revised annual CTC</span>
                        <span className="font-medium tabular-nums">{newAnnual.toLocaleString()}</span>
                      </div>
                      <div className="mt-1 flex justify-between">
                        <span className="text-muted-foreground">Change</span>
                        <span
                          className={
                            "font-medium tabular-nums " +
                            (pct > 0 ? "text-emerald-600 dark:text-emerald-500" : pct < 0 ? "text-destructive" : "")
                          }
                        >
                          {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                        </span>
                      </div>
                      {prevAnnual === 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          They have no salary on record, so the letter will show a rise from zero.
                          Set their current compensation first if that is not what you mean.
                        </p>
                      )}
                      {pct < 0 && (
                        <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                          This is a reduction. The default wording congratulates the reader, so edit
                          the template in Settings, Letters before issuing it.
                        </p>
                      )}
                    </div>

                    <Label className="flex items-start gap-2 text-sm font-normal">
                      <Checkbox checked={applyIncrement} onCheckedChange={(v) => setApplyIncrement(!!v)} className="mt-0.5" />
                      <span>
                        Apply the revised salary to their record
                        <span className="block text-xs text-muted-foreground">
                          Untick to issue the letter without changing what payroll will pay.
                        </span>
                      </span>
                    </Label>
                  </>
                )}
                <Label className="flex items-start gap-2 text-sm font-normal">
                  <Checkbox checked={email} onCheckedChange={(v) => setEmail(!!v)} className="mt-0.5" />
                  <span>
                    Email it to {employee.firstName}, with the PDF attached
                    <span className="block text-xs text-muted-foreground">
                      To {employee.officialEmail || employee.personalEmail || employee.email}
                    </span>
                  </span>
                </Label>
              </>
            )}

            {duplicate && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-sm">{duplicate.message}</p>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={issue.isPending}
                  onClick={() => issue.mutate({ reissue: true })}
                >
                  {issue.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Re-issue and supersede
                </Button>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!selected || !date || issue.isPending} onClick={() => issue.mutate({})}>
            {issue.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Issue letter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LetterGroup({
  title, items, kind, onChoose,
}: {
  title: string;
  items: IssuableLetter[];
  kind: string | null;
  onChoose: (l: IssuableLetter) => void;
}) {
  const qc = useQueryClient();
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-1">
        {items.map((l) => (
          <button
            key={l.kind}
            type="button"
            onClick={() => onChoose(l)}
            className={
              "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted " +
              (kind === l.kind ? "border-primary bg-primary/10" : "")
            }
          >
            <span>
              {l.label}
              {l.issuedCount > 0 && (
                <span className="block text-xs text-muted-foreground">
                  Issued {formatDate(l.lastIssuedAt)}
                  {l.issuedCount > 1 ? ` (${l.issuedCount} on file)` : ""}
                </span>
              )}
            </span>
            {l.lastDocumentId && (
              <Badge
                variant="grey"
                className="shrink-0 cursor-pointer"
                onClick={async (ev) => {
                  ev.stopPropagation();
                  try {
                    await downloadFile(`/documents/${l.lastDocumentId}/download`, `${l.kind.toLowerCase()}.pdf`);
                  } catch (err) {
                    toast.error(apiError(err));
                  }
                  qc.invalidateQueries({ queryKey: ["documents"] });
                }}
              >
                Download
              </Badge>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Roster action that opens the dialog. */
export function IssueLetterAction({ employee }: { employee: EnrichedEmployee }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" className="h-auto flex-col gap-1 px-2 py-1.5" onClick={() => setOpen(true)}>
        <FileText className="size-3.5" />
        <span className="text-[13px] font-medium leading-none">Letters</span>
      </Button>
      {open && <IssueLetterDialog employee={employee} open onOpenChange={setOpen} />}
    </>
  );
}
