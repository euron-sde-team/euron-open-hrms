"use client";

/**
 * HR's review queue and case reviewer.
 *
 * The screen exists to answer one question honestly: what exactly will change on this
 * person's record if I approve this? So the reviewer leads with the diff, current value
 * beside submitted value, rather than with the form. For a new joiner the left column is
 * empty; for somebody already on the roster it is the difference between "they filled in a
 * form" and "their bank account is about to change".
 *
 * Approval is per section, and the case only commits once every section carries a verdict.
 * That is enforced by the server too, so the button here is a convenience rather than the
 * guard.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, FileText, Loader2, X, Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { http, apiError, downloadFile } from "@/lib/api";
import { Button } from "@open-hrms/ui/button";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Textarea } from "@open-hrms/ui/textarea";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Input } from "@open-hrms/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@open-hrms/ui/table";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@open-hrms/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@open-hrms/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@open-hrms/ui/dialog";
import { cn } from "@open-hrms/ui/cn";
import {
  CASE_STATUS_LABEL, CASE_STATUS_VARIANT, SECTION_STATUS_LABEL, SECTION_STATUS_VARIANT,
  dueLabel, formatDate,
  type CaseDetail, type CaseListItem, type CaseStatus,
} from "@/lib/onboarding-forms";

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All open" },
  { value: "SUBMITTED", label: "Awaiting review" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "CHANGES_REQUESTED", label: "Changes requested" },
  { value: "NOT_STARTED", label: "Not started" },
  { value: "APPROVED", label: "Approved" },
];

/** Render a value from the employee record for the diff column. */
function DiffValue({ value, muted }: { value: unknown; muted?: boolean }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <span className={cn("break-words text-[13px]", empty || muted ? "text-muted-foreground" : "font-medium")}>
      {empty ? "not set" : typeof value === "object" ? JSON.stringify(value) : String(value)}
    </span>
  );
}

function ReviewSheet({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<{ key: string; title: string } | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["onboarding-case", caseId],
    queryFn: () => http.get<CaseDetail>(`/onboarding-cases/${caseId}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["onboarding-case", caseId] });
    qc.invalidateQueries({ queryKey: ["onboarding-review"] });
  };

  const review = useMutation({
    mutationFn: (v: { key: string; verdict: "APPROVED" | "CHANGES_REQUESTED"; note?: string }) =>
      http.post(`/onboarding-cases/${caseId}/sections/${v.key}/review`, { verdict: v.verdict, note: v.note }),
    onSuccess: () => { invalidate(); setRejecting(null); setNote(""); },
    onError: (e) => toast.error(apiError(e)),
  });

  const approve = useMutation({
    mutationFn: () => http.post<{ changes: unknown[] }>(`/onboarding-cases/${caseId}/approve`),
    onSuccess: (r) => {
      toast.success(`Approved. ${r.changes.length} field${r.changes.length === 1 ? "" : "s"} updated.`);
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const allApproved = !!data && data.templateSnapshot.every((s) => data.sections[s.key]?.status === "APPROVED");

  return (
    <>
      <Sheet open onOpenChange={(o: boolean) => !o && onClose()}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{data?.employee?.name ?? "Onboarding"}</SheetTitle>
            <SheetDescription>
              {data?.employee?.code ? `${data.employee.code} · ` : ""}
              {data?.templateName}
              {data?.dueAt && ` · ${dueLabel(data.dueAt)}`}
            </SheetDescription>
          </SheetHeader>

          {isLoading || !data ? (
            <div className="space-y-3 px-5 pb-6">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <div className="space-y-6 px-5 pb-8">
              {/* What will change */}
              <section className="space-y-3">
                <h3 className="text-[15px] font-semibold">What approving this will change</h3>
                {data.diff.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-4 py-5 text-center text-[13px] text-muted-foreground">
                    Nothing on their record changes. They have confirmed what was already on file.
                  </p>
                ) : (
                  <Card className="divide-y p-0">
                    {data.diff.map((d) => (
                      <div key={d.path} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-3">
                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{d.label}</p>
                          <DiffValue value={d.from} muted />
                        </div>
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">submitted</p>
                          <DiffValue value={d.to} />
                        </div>
                      </div>
                    ))}
                  </Card>
                )}
              </section>

              {/* Documents */}
              {data.documents.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-[15px] font-semibold">Documents</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {data.documents.map((d) => (
                      <Card key={d.documentId} className="flex items-center gap-3 p-3">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">
                            {d.document?.categoryLabel ?? d.category}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {d.document?.originalName}
                          </p>
                        </div>
                        <a
                          href={`/api/documents/${d.documentId}/download`}
                          className="shrink-0 text-[12px] underline underline-offset-2"
                          onClick={(e) => {
                            // The API needs the bearer token, which a plain href will not carry.
                            e.preventDefault();
                            void import("@/lib/api").then((m) =>
                              m.downloadFile(`/documents/${d.documentId}/download`, d.document?.originalName ?? "document")
                            );
                          }}
                        >
                          Open
                        </a>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* Declared assets */}
              {data.assets?.declared?.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-[15px] font-semibold">Items they declared</h3>
                  <p className="text-[13px] text-muted-foreground">
                    These are not on the asset register yet. Approving the case adds the ones you accept.
                  </p>
                  {data.assets.declared.map((a) => (
                    <Card key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{a.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {a.category}{a.serial ? ` · ${a.serial}` : ""}
                        </p>
                      </div>
                      <Badge variant={a.status === "APPROVED" ? "green" : a.status === "REJECTED" ? "red" : "amber"}>
                        {a.status === "PENDING" ? "Awaiting your decision" : a.status}
                      </Badge>
                    </Card>
                  ))}
                </section>
              )}

              {/* Issue kit before day one */}
              <IssueAssetBlock caseId={data.id} issued={data.issuedAssets ?? []} open={OPEN_FOR_ISSUE.includes(data.status)} onIssued={invalidate} />

              {/* Acknowledged assets, with discrepancies called out */}
              {data.assets?.acknowledged?.some((a) => a.discrepancy || a.received === false) && (
                <section className="space-y-2">
                  <h3 className="text-[15px] font-semibold">Asset discrepancies</h3>
                  {data.assets.acknowledged
                    .filter((a) => a.discrepancy || a.received === false)
                    .map((a) => {
                      const asset = data.issuedAssets.find((x) => x.id === a.assetId);
                      return (
                        <Card key={a.assetId} className="flex items-start gap-2.5 p-3">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[color:var(--warn)]" />
                          <p className="text-[13px]">
                            <span className="font-medium">{asset?.name ?? a.assetId}</span>
                            {a.received === false
                              ? ": they say they never received it."
                              : `: serial on record is ${asset?.serial ?? "unknown"}, they entered ${a.serial}.`}
                          </p>
                        </Card>
                      );
                    })}
                </section>
              )}

              {/* Section verdicts */}
              <section className="space-y-3">
                <h3 className="text-[15px] font-semibold">Sections</h3>
                {data.templateSnapshot.map((s) => {
                  const state = data.sections[s.key];
                  const check = data.checks.find((c) => c.key === s.key);
                  const status = state?.status ?? check?.status ?? "EMPTY";
                  return (
                    <Card key={s.key} className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium">{s.title}</p>
                          {check && check.errors.length > 0 && (
                            <p className="mt-0.5 text-[12px] text-[color:var(--warn)]">
                              {check.errors.slice(0, 3).join("; ")}
                            </p>
                          )}
                          {status === "CHANGES_REQUESTED" && state?.note && (
                            <p className="mt-0.5 text-[12px] text-muted-foreground">You said: {state.note}</p>
                          )}
                        </div>
                        <Badge variant={SECTION_STATUS_VARIANT[status]} className="shrink-0">
                          {SECTION_STATUS_LABEL[status]}
                        </Badge>
                      </div>
                      {data.status !== "APPROVED" && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant={status === "APPROVED" ? "secondary" : "default"}
                            disabled={review.isPending || status === "APPROVED"}
                            onClick={() => review.mutate({ key: s.key, verdict: "APPROVED" })}
                          >
                            <Check className="size-3.5" /> {status === "APPROVED" ? "Approved" : "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={review.isPending}
                            onClick={() => { setRejecting({ key: s.key, title: s.title }); setNote(""); }}
                          >
                            <X className="size-3.5" /> Ask for a change
                          </Button>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </section>

              {data.status !== "APPROVED" && (
                <div className="sticky bottom-0 -mx-5 border-t bg-popover px-5 py-4">
                  <Button
                    className="w-full"
                    disabled={!allApproved || approve.isPending}
                    onClick={() => approve.mutate()}
                  >
                    {approve.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    {allApproved
                      ? "Approve and update their record"
                      : "Approve every section first"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* A rejection without a reason is a round trip that teaches nobody anything, so the
          note is required here exactly as it is on the server. */}
      <Dialog open={!!rejecting} onOpenChange={(o: boolean) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask for a change</DialogTitle>
            <DialogDescription>
              {rejecting?.title}. They will be emailed and only this section reopens.
            </DialogDescription>
          </DialogHeader>
          <Field label="What needs changing?" htmlFor="reject-note" required>
            <Textarea
              id="reject-note"
              rows={4}
              value={note}
              placeholder="The cheque photo is unreadable, please upload a clearer one."
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              disabled={note.trim().length < 3 || review.isPending}
              onClick={() => rejecting && review.mutate({ key: rejecting.key, verdict: "CHANGES_REQUESTED", note: note.trim() })}
            >
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


/** Statuses where issuing still makes sense: the person can still confirm it on their form. */
const OPEN_FOR_ISSUE = ["NOT_STARTED", "IN_PROGRESS", "CHANGES_REQUESTED", "SUBMITTED"];
const ASSET_CATS = ["LAPTOP", "MONITOR", "PHONE", "ACCESS_CARD", "HEADSET", "SIM", "OTHER"];

/**
 * Issue kit to somebody before their first day.
 *
 * Provisioning used to require an `employees` row, which a joiner does not have until this
 * very approval, so the commonest handover in any company (the day-one laptop) could not be
 * staged and the acknowledge half of the assets section was dead for new hires. The asset is
 * held against the CASE and becomes theirs when approval creates the employee.
 */
function IssueAssetBlock({
  caseId, issued, open, onIssued,
}: {
  caseId: string;
  issued: { id: string; name: string; category: string; serial?: string; status?: string }[];
  open: boolean;
  onIssued: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ category: "LAPTOP", name: "", serial: "", condition: "New" });

  const issue = useMutation({
    mutationFn: () => http.post("/assets", { ...draft, caseId }),
    onSuccess: () => {
      toast.success("Issued. They will be asked to confirm it on their form.");
      setDraft({ category: "LAPTOP", name: "", serial: "", condition: "New" });
      setAdding(false);
      onIssued();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!issued.length && !open) return null;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Company assets issued</h3>
        {open && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Issue an asset
          </Button>
        )}
      </div>

      {issued.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nothing issued yet. Anything you add here appears on their form for them to confirm.
        </p>
      ) : (
        issued.map((a) => (
          <Card key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="text-[13px]">
              <span className="font-medium">{a.name}</span>
              <span className="text-muted-foreground">
                {" "}· {a.category}
                {a.serial ? ` · ${a.serial}` : ""}
              </span>
            </p>
            <Badge variant={a.status === "IN_USE" ? "green" : "amber"}>
              {a.status === "IN_USE" ? "Confirmed received" : "Awaiting their confirmation"}
            </Badge>
          </Card>
        ))
      )}

      {adding && (
        <Card className="space-y-3 p-4">
          <FormGrid>
            <Field label="Type">
              <Select
                items={ASSET_CATS.map((c) => ({ value: c, label: c.replace("_", " ") }))}
                value={draft.category}
                onValueChange={(v) => setDraft({ ...draft, category: v ?? "OTHER" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_CATS.map((c) => <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="What is it">
              <Input value={draft.name} placeholder="MacBook Air 13" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Serial number" hint="They are asked to retype this, so it must match the item.">
              <Input value={draft.serial} onChange={(e) => setDraft({ ...draft, serial: e.target.value })} />
            </Field>
          </FormGrid>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" disabled={!draft.name.trim() || issue.isPending} onClick={() => issue.mutate()}>
              {issue.isPending && <Loader2 className="size-3.5 animate-spin" />} Issue
            </Button>
          </div>
        </Card>
      )}
    </section>
  );
}

export function ReviewQueue() {
  const [status, setStatus] = useState("SUBMITTED");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["onboarding-review", status],
    queryFn: () => http.get<CaseListItem[]>("/onboarding-cases", status ? { status } : undefined),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          items={STATUS_FILTERS}
          value={status}
          onValueChange={(v) => setStatus(String(v ?? ""))}
        >
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-[13px] text-muted-foreground">
          {isLoading ? "Loading…" : `${data.length} ${data.length === 1 ? "case" : "cases"}`}
        </p>
        {/* Status and progress only; the answers stay behind the scoped, audited case view. */}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() =>
            downloadFile(
              `/onboarding-cases/export.csv${status === "ALL" ? "" : `?status=${status}`}`,
              "onboarding-cases.csv"
            ).catch(() => toast.error("Could not export"))
          }
        >
          <Download className="size-3.5" /> Export
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : data.length === 0 ? (
        <Card className="p-10 text-center">
          <CheckCircle2 className="mx-auto size-7 text-[color:var(--ok)]" />
          <p className="mt-3 text-[15px] font-medium">Nothing waiting</p>
          <p className="mt-1 text-[13px] text-muted-foreground">No onboarding cases match this filter.</p>
        </Card>
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Form</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <p className="font-medium">{c.employeeName ?? "Unassigned"}</p>
                    {c.employeeCode && <p className="text-[12px] text-muted-foreground">{c.employeeCode}</p>}
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{c.templateName}</TableCell>
                  <TableCell className="text-[13px]">{c.sectionsDone}/{c.sectionsTotal}</TableCell>
                  <TableCell className="text-[13px]">
                    {c.dueAt ? (
                      <span className={cn(c.overdue && "text-[color:var(--bad)]")}>
                        {formatDate(c.dueAt)}
                        {c.overdue && <span className="ml-1 text-[11px]">({dueLabel(c.dueAt)})</span>}
                      </span>
                    ) : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={CASE_STATUS_VARIANT[c.status as CaseStatus]}>
                      {CASE_STATUS_LABEL[c.status as CaseStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(c.id)}>Review</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {openId && <ReviewSheet caseId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
