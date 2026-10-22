"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, CheckCircle2, X, Calendar, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
import { Field } from "@open-hrms/ui/field";
import { Badge } from "@open-hrms/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@open-hrms/ui/card";
import { Switch } from "@open-hrms/ui/switch";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Separator } from "@open-hrms/ui/separator";
import { Textarea } from "@open-hrms/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@open-hrms/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-hrms/ui/select";

// Local types, mirror the backend separation route response shape ----------

type ClearanceKey = "it" | "finance" | "hr" | "assets" | "knowledgeTransfer";

interface Clearance {
  it?: boolean;
  finance?: boolean;
  hr?: boolean;
  assets?: boolean;
  knowledgeTransfer?: boolean;
}

interface Separation {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeCode?: string;
  type: string;
  typeLabel?: string;
  subReason?: string | null;
  reason?: string;
  initiatedBy?: string;
  status: string;
  proposedLastWorkingDay?: string | null;
  lastWorkingDay?: string | null;
  noticeWaived?: boolean;
  /** Days of notice actually served. 0 when it was waived. */
  noticeDays?: number | null;
  /** How the notice was stated: DEFAULT | DAYS | UNTIL | SKIP. */
  noticeMode?: string | null;
  handoverNotes?: string;
  recoveries?: number;
  clearance?: Clearance;
  exitInterview?: { responses: Record<string, string>; submittedAt: string } | null;
  /** Letters chosen for this exit. Absent means the type's default still applies. */
  documents?: string[];
  documentIds?: string[];
  createdAt?: string;
  completedAt?: string | null;
}

/** Terminal letters that can be issued on an exit, whatever the type. */
const EXIT_DOCUMENTS = [
  { value: "RELIEVING_LETTER", label: "Relieving and experience letter" },
  { value: "EXPERIENCE_LETTER", label: "Experience certificate" },
  { value: "TERMINATION_LETTER", label: "Termination letter" },
  { value: "RETIREMENT_LETTER", label: "Superannuation letter" },
];

/** Termination for misconduct, where an experience certificate is withheld by default. */
const isForCause = (s: Separation) => s.type === "TERMINATION" && s.subReason === "MISCONDUCT";

/**
 * What a separation would issue if nobody chose. Mirrors the server so the checkboxes show
 * the same answer the server holds, rather than appearing empty until somebody clicks.
 */
function defaultDocsFor(s: Separation): string[] {
  if (s.type === "RESIGNATION") return ["RELIEVING_LETTER"];
  if (s.type === "RETIREMENT") return ["RETIREMENT_LETTER"];
  if (s.type === "END_OF_CONTRACT") return ["EXPERIENCE_LETTER"];
  if (s.type === "TERMINATION") {
    return isForCause(s) ? ["TERMINATION_LETTER"] : ["TERMINATION_LETTER", "EXPERIENCE_LETTER"];
  }
  return [];
}

interface ExitInterviewQuestion {
  key: string;
  label: string;
  type: "select" | "text";
  options?: string[];
}

interface SeparationConfig {
  exitInterviewQuestions?: ExitInterviewQuestion[];
  [k: string]: unknown;
}

interface Settlement {
  net?: number;
  gross?: number;
  recoveries?: number;
  [k: string]: unknown;
}

const CLEARANCE_ITEMS: { key: ClearanceKey; label: string; desc: string }[] = [
  { key: "it", label: "IT / Accounts", desc: "System access & accounts deactivated" },
  { key: "finance", label: "Finance / F&F", desc: "Dues cleared, full & final settled" },
  { key: "hr", label: "HR", desc: "Documents collected, exit interview done" },
  { key: "assets", label: "Assets", desc: "Laptop, ID card & other assets returned" },
  { key: "knowledgeTransfer", label: "Knowledge transfer", desc: "Handover to successor complete" },
];

const STATUS_VARIANT: Record<string, "green" | "amber" | "red" | "blue" | "grey" | "violet"> = {
  PENDING_MANAGER: "amber",
  PENDING_HR: "amber",
  REQUESTED: "amber",
  NOTICE_PERIOD: "amber",
  IN_CLEARANCE: "amber",
  COMPLETED: "grey",
  RELIEVED: "grey",
  ABSCONDING: "red",
  ABSCONDED: "red",
  DECLINED: "red",
  WITHDRAWN: "red",
  CANCELLED: "red",
};

const PENDING_STATUSES = ["PENDING_MANAGER", "PENDING_HR", "REQUESTED"];
const ACTIVE_STATUSES = [
  "PENDING_MANAGER",
  "PENDING_HR",
  "REQUESTED",
  "NOTICE_PERIOD",
  "IN_CLEARANCE",
  "ABSCONDING",
];

/**
 * Notice options offered when HR accepts a resignation. Mirrors NOTICE_MODES in
 * apps/api/src/separation-config.ts.
 *
 * "As proposed" is first because the employee has already named a date and
 * agreeing with it is the common case. The others exist because agreeing is not
 * always possible: a 30-day proposal against a 60-day contract used to have to be
 * typed in as a raw date, every time.
 */
const ACCEPT_NOTICE_MODES = [
  { value: "UNTIL", label: "Last working day as proposed" },
  { value: "DEFAULT", label: "Serve contractual notice" },
  { value: "DAYS", label: "Serve a set number of days" },
  { value: "SKIP", label: "Waive notice, release immediately" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const statusLabel = (s: string) => s.toLowerCase().replace(/_/g, " ");
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "-");

function clearanceProgress(c?: Clearance): { done: number; total: number } {
  const total = CLEARANCE_ITEMS.length;
  const done = CLEARANCE_ITEMS.filter((i) => c?.[i.key]).length;
  return { done, total };
}

// --- Employee: resign dialog ------------------------------------------------

function ResignDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [reason, setReason] = useState("");

  const resign = useMutation({
    mutationFn: () => http.post<Separation>("/separation/resign", { lastWorkingDay, reason }),
    onSuccess: () => {
      toast.success("Resignation submitted");
      qc.invalidateQueries({ queryKey: ["separations"] });
      setOpen(false);
      setLastWorkingDay("");
      setReason("");
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <LogOut className="mr-2 h-4 w-4" /> Resign
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit resignation</DialogTitle>
            <DialogDescription>
              Your request is routed to your reporting manager and HR for review. You can withdraw it
              until it is accepted.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              resign.mutate();
            }}
            className="space-y-4"
          >
            <Field
              label="Proposed last working day"
              htmlFor="lwd"
              hint="Subject to your notice period. HR confirms the final date."
            >
              <Input
                id="lwd"
                type="date"
                value={lastWorkingDay}
                onChange={(e) => setLastWorkingDay(e.target.value)}
              />
            </Field>
            <Field label="Reason" htmlFor="reason">
              <Textarea
                id="reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Optional. Let your manager know why you're moving on."
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={resign.isPending}>
                {resign.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- Exit interview (employee fill-in, staff record + read-only view) --------

function useSeparationConfig(enabled: boolean) {
  return useQuery({
    queryKey: ["separation-config"],
    queryFn: () => http.get<SeparationConfig>("/separation/config"),
    enabled,
  });
}

function ExitInterviewDialog({
  sep,
  open,
  onOpenChange,
}: {
  sep: Separation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [responses, setResponses] = useState<Record<string, string>>({});

  const { data: config, isLoading } = useSeparationConfig(open);
  const questions = config?.exitInterviewQuestions ?? [];

  const submit = useMutation({
    mutationFn: () =>
      http.post<Separation>(`/separation/${sep.id}/exit-interview`, { responses }),
    onSuccess: () => {
      toast.success("Exit interview submitted");
      qc.invalidateQueries({ queryKey: ["separations"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const setResponse = (key: string, value: string) =>
    setResponses((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Exit interview</DialogTitle>
          <DialogDescription>
            Honest feedback helps us improve. Responses are visible to HR only.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
            className="space-y-4"
          >
            {questions.map((q) => (
              <Field key={q.key} label={q.label} htmlFor={`exit-${q.key}`}>
                {q.type === "select" ? (
                  <Select
                    items={(q.options ?? []).map((o) => ({ value: o, label: o }))}
                    value={responses[q.key] ?? null}
                    onValueChange={(v) => setResponse(q.key, (v as string) ?? "")}
                  >
                    <SelectTrigger id={`exit-${q.key}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(q.options ?? []).map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Textarea
                    id={`exit-${q.key}`}
                    rows={3}
                    value={responses[q.key] ?? ""}
                    onChange={(e) => setResponse(q.key, e.target.value)}
                  />
                )}
              </Field>
            ))}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submit.isPending || questions.length === 0}>
                {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExitInterviewAnswers({
  exitInterview,
}: {
  exitInterview: NonNullable<Separation["exitInterview"]>;
}) {
  const { data: config } = useSeparationConfig(true);
  const questions = config?.exitInterviewQuestions ?? [];

  if (!config) return <Skeleton className="h-16 w-full" />;

  return (
    <div className="space-y-2">
      {questions.map((q) => (
        <div key={q.key} className="text-sm">
          <div className="text-muted-foreground">{q.label}</div>
          <div>{exitInterview.responses?.[q.key]?.trim() || "-"}</div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Submitted {fmtDate(exitInterview.submittedAt)}
      </p>
    </div>
  );
}

// --- Employee: own separation status card -----------------------------------

function MySeparationCard({ sep }: { sep: Separation }) {
  const qc = useQueryClient();
  const [exitOpen, setExitOpen] = useState(false);
  const { done, total } = clearanceProgress(sep.clearance);
  const canWithdraw = PENDING_STATUSES.includes(sep.status);
  const canFillExitInterview =
    !sep.exitInterview && !["WITHDRAWN", "DECLINED"].includes(sep.status);

  const withdraw = useMutation({
    mutationFn: () => http.post<Separation>(`/separation/${sep.id}/withdraw`, {}),
    onSuccess: () => {
      toast.success("Resignation withdrawn");
      qc.invalidateQueries({ queryKey: ["separations"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">{sep.typeLabel || sep.type}</CardTitle>
        <Badge variant={STATUS_VARIANT[sep.status] || "grey"}>{statusLabel(sep.status)}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Submitted</div>
            <div className="font-medium">{fmtDate(sep.createdAt)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Last working day</div>
            <div className="font-medium">
              {fmtDate(sep.lastWorkingDay || sep.proposedLastWorkingDay)}
              {!sep.lastWorkingDay && sep.proposedLastWorkingDay ? " (proposed)" : ""}
            </div>
          </div>
        </div>

        {sep.reason && (
          <div className="text-sm">
            <div className="text-muted-foreground">Reason</div>
            <div>{sep.reason}</div>
          </div>
        )}

        <Separator />

        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Clearance progress</span>
            <span className="text-muted-foreground">
              {done}/{total} complete
            </span>
          </div>
          <ul className="space-y-1.5">
            {CLEARANCE_ITEMS.map((item) => (
              <li key={item.key} className="flex items-center gap-2 text-sm">
                {sep.clearance?.[item.key] ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <X className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={sep.clearance?.[item.key] ? "" : "text-muted-foreground"}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {(sep.exitInterview || canFillExitInterview) && (
          <>
            <Separator />
            <div>
              <div className="mb-2 text-sm font-medium">Exit interview</div>
              {sep.exitInterview ? (
                <ExitInterviewAnswers exitInterview={sep.exitInterview} />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Share feedback about your time with us. It takes a couple of minutes and helps
                    us improve.
                  </p>
                  <Button variant="outline" onClick={() => setExitOpen(true)}>
                    <ClipboardList className="mr-2 h-4 w-4" /> Fill exit interview
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        {canWithdraw && (
          <div className="pt-2">
            <Button variant="outline" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
              {withdraw.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Withdraw
              resignation
            </Button>
          </div>
        )}
      </CardContent>

      {exitOpen && <ExitInterviewDialog sep={sep} open={exitOpen} onOpenChange={setExitOpen} />}
    </Card>
  );
}

// --- Staff: accept / decline dialog -----------------------------------------

function AcceptDialog({
  sep,
  open,
  onOpenChange,
}: {
  sep: Separation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [noticeMode, setNoticeMode] = useState("UNTIL");
  const [noticeDays, setNoticeDays] = useState("");
  const [lastWorkingDay, setLastWorkingDay] = useState(sep.proposedLastWorkingDay || todayIso());

  const { data: config } = useQuery({
    queryKey: ["separation-config"],
    queryFn: () => http.get<{ orgNoticeDays: number | null; fallbackNoticeDays: number }>("/separation/config"),
    enabled: open,
  });
  const contractualDays = config?.orgNoticeDays ?? config?.fallbackNoticeDays ?? 30;

  const resolvedLwd =
    noticeMode === "SKIP"
      ? todayIso()
      : noticeMode === "DAYS"
        ? addDaysIso(Number(noticeDays) || 0)
        : noticeMode === "DEFAULT"
          ? addDaysIso(contractualDays)
          : lastWorkingDay || todayIso();
  const releasing = noticeMode === "SKIP" || resolvedLwd <= todayIso();

  const accept = useMutation({
    mutationFn: () =>
      http.post<Separation>(`/separation/${sep.id}/accept`, {
        noticeMode,
        ...(noticeMode === "DAYS" ? { noticeDays: Number(noticeDays) || 0 } : {}),
        ...(noticeMode === "UNTIL" ? { lastWorkingDay } : {}),
      }),
    onSuccess: () => {
      toast.success(releasing ? "Resignation accepted, employee exited" : "Resignation accepted, notice period started");
      qc.invalidateQueries({ queryKey: ["separations"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Accept resignation</DialogTitle>
          <DialogDescription>
            {sep.employeeName} ({sep.employeeCode}): confirm the last working day to start the notice
            period.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Notice period">
            <Select items={ACCEPT_NOTICE_MODES} value={noticeMode} onValueChange={(v) => setNoticeMode(v ?? "UNTIL")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCEPT_NOTICE_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.value === "DEFAULT" ? `${m.label} (${contractualDays} days)` : m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {noticeMode === "UNTIL" && (
            <Field label="Last working day" htmlFor="acc-lwd">
              <Input
                id="acc-lwd"
                type="date"
                value={lastWorkingDay}
                onChange={(e) => setLastWorkingDay(e.target.value)}
              />
            </Field>
          )}
          {noticeMode === "DAYS" && (
            <Field label="Notice days" htmlFor="acc-days">
              <Input
                id="acc-days"
                type="number"
                min={0}
                value={noticeDays}
                placeholder={String(contractualDays)}
                onChange={(e) => setNoticeDays(e.target.value)}
              />
            </Field>
          )}
          {/* Both consequences spelled out: the status decides whether their final
              payslip is scaled and whether they still appear in the directory. */}
          <p
            className={
              releasing
                ? "rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                : "rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
            }
          >
            {releasing ? (
              <>
                Last working day <strong>{resolvedLwd}</strong>. No notice is served, so{" "}
                {sep.employeeName} is marked <strong>exited</strong> straight away.
              </>
            ) : (
              <>
                Last working day <strong>{resolvedLwd}</strong>. {sep.employeeName} stays on{" "}
                <strong>notice period</strong> until then, and their final payslip is scaled to that date.
              </>
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
            {accept.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({
  sep,
  open,
  onOpenChange,
}: {
  sep: Separation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const decline = useMutation({
    mutationFn: () => http.post<Separation>(`/separation/${sep.id}/decline`, { reason }),
    onSuccess: () => {
      toast.success("Resignation declined");
      qc.invalidateQueries({ queryKey: ["separations"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Decline resignation</DialogTitle>
          <DialogDescription>
            {sep.employeeName} will be notified. Add a note explaining the decision.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" htmlFor="dec-reason">
          <Textarea id="dec-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={decline.isPending} onClick={() => decline.mutate()}>
            {decline.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Staff: manage one separation (clearance + workflow) --------------------

function ManageDialog({
  sep,
  open,
  onOpenChange,
}: {
  sep: Separation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [exitOpen, setExitOpen] = useState(false);

  const { data: settlement } = useQuery({
    queryKey: ["separation-settlement", sep.id],
    queryFn: () => http.get<Settlement>(`/separation/${sep.id}/settlement`),
    enabled: open,
  });

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      http.put<Separation>(`/separation/${sep.id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["separations"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const [emailOnComplete, setEmailOnComplete] = useState(true);

  const complete = useMutation({
    mutationFn: (force: boolean) =>
      http.post<Separation>(`/separation/${sep.id}/complete`, { force, email: emailOnComplete }),
    onSuccess: () => {
      toast.success("Separation completed, employee relieved");
      qc.invalidateQueries({ queryKey: ["separations"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const issueLetter = useMutation({
    mutationFn: (body: { kind: string; acknowledgeForCause?: boolean }) =>
      http.post<{ documentId: string }>(`/separation/${sep.id}/issue-letter`, body),
    onSuccess: () => {
      toast.success("Letter issued and emailed");
      qc.invalidateQueries({ queryKey: ["separations"] });
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const toggleClearance = (key: ClearanceKey, value: boolean) =>
    update.mutate({ clearance: { [key]: value } });

  const { done, total } = clearanceProgress(sep.clearance);
  const allCleared = done === total;
  const inClearanceFlow = ["NOTICE_PERIOD", "IN_CLEARANCE"].includes(sep.status);
  const canSettle = typeof settlement?.net === "number";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {sep.employeeName}{" "}
            <span className="font-normal text-muted-foreground">({sep.employeeCode})</span>
          </DialogTitle>
          <DialogDescription>
            {sep.typeLabel || sep.type} · {statusLabel(sep.status)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Last working day</div>
              <div className="font-medium">
                {fmtDate(sep.lastWorkingDay || sep.proposedLastWorkingDay)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Submitted</div>
              <div className="font-medium">{fmtDate(sep.createdAt)}</div>
            </div>
            {/* Recorded on every exit now, and it decides two things people ask about
                later: what the relieving letter states, and whether a shortfall was
                recovered from the final pay. */}
            {(sep.noticeWaived || typeof sep.noticeDays === "number") && (
              <div>
                <div className="text-muted-foreground">Notice period</div>
                <div className="font-medium">
                  {sep.noticeWaived || sep.noticeDays === 0
                    ? "Waived, released immediately"
                    : `${sep.noticeDays} days`}
                </div>
              </div>
            )}
          </div>

          {sep.reason && (
            <div className="text-sm">
              <div className="text-muted-foreground">Reason</div>
              <div>{sep.reason}</div>
            </div>
          )}

          <Separator />

          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">Clearance checklist</span>
              <span className="text-xs text-muted-foreground">
                {done}/{total} complete
              </span>
            </div>
            <ul className="space-y-3">
              {CLEARANCE_ITEMS.map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.desc}</div>
                  </div>
                  <Switch
                    checked={!!sep.clearance?.[item.key]}
                    disabled={update.isPending}
                    onCheckedChange={(v) => toggleClearance(item.key, v)}
                  />
                </li>
              ))}
            </ul>
          </div>

          <Separator />

          <div>
            <div className="mb-2 text-sm font-medium">Exit interview</div>
            {sep.exitInterview ? (
              <ExitInterviewAnswers exitInterview={sep.exitInterview} />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Exit interview not submitted yet.</p>
                <Button size="sm" variant="outline" onClick={() => setExitOpen(true)}>
                  <ClipboardList className="mr-1.5 size-4" /> Record exit interview
                </Button>
              </div>
            )}
          </div>

          {canSettle && (
            <>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Estimated full &amp; final</span>
                <span className="font-medium">{settlement?.net}</span>
              </div>
            </>
          )}

          {inClearanceFlow && sep.status === "NOTICE_PERIOD" && (
            <Button
              variant="outline"
              className="w-full"
              disabled={update.isPending}
              onClick={() => update.mutate({ status: "IN_CLEARANCE" })}
            >
              Move to clearance
            </Button>
          )}

          {/*
            Exit paperwork, decided here rather than by the separation type.
            Letters can also be handed over before the exit is finalised: somebody serving
            notice often needs their relieving or experience letter in hand for a visa or a
            background check, and waiting for completion is not an option for them.
          */}
          {inClearanceFlow && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="text-sm font-medium">Exit letters</div>
                {EXIT_DOCUMENTS.map((d) => {
                  const chosen = (sep.documents ?? defaultDocsFor(sep)).includes(d.value);
                  const blocked = d.value === "EXPERIENCE_LETTER" && isForCause(sep);
                  return (
                    <div key={d.value} className="flex items-center justify-between gap-2">
                      <Label className="flex items-start gap-2 text-sm font-normal">
                        <Checkbox
                          checked={chosen}
                          disabled={update.isPending}
                          onCheckedChange={(v) => {
                            const cur = sep.documents ?? defaultDocsFor(sep);
                            const next = v ? [...cur, d.value] : cur.filter((x) => x !== d.value);
                            update.mutate({
                              documents: next,
                              ...(blocked && v ? { acknowledgeForCause: true } : {}),
                            });
                          }}
                          className="mt-0.5"
                        />
                        <span>
                          {d.label}
                          {blocked && (
                            <span className="block text-xs text-amber-600 dark:text-amber-500">
                              Withheld by default on a misconduct termination
                            </span>
                          )}
                        </span>
                      </Label>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={issueLetter.isPending}
                        onClick={() => issueLetter.mutate({ kind: d.value, acknowledgeForCause: blocked })}
                        title="Generate and email this letter now, without finalising the exit"
                      >
                        Issue now
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {inClearanceFlow && (
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {!allCleared && (
              <p className="text-xs text-muted-foreground">
                {total - done} clearance item(s) still pending.
              </p>
            )}
            <Label className="flex w-full items-start gap-2 text-sm font-normal">
              <Checkbox checked={emailOnComplete} onCheckedChange={(v) => setEmailOnComplete(!!v)} className="mt-0.5" />
              <span>
                Email {sep.employeeName} on completion
                <span className="block text-xs text-muted-foreground">
                  Their exit letters are attached, since access is revoked at the same moment.
                </span>
              </span>
            </Label>
            <Button
              className="w-full"
              disabled={complete.isPending}
              onClick={() => complete.mutate(!allCleared)}
            >
              {complete.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {allCleared ? "Complete & relieve" : "Force complete & relieve"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>

      {exitOpen && <ExitInterviewDialog sep={sep} open={exitOpen} onOpenChange={setExitOpen} />}
    </Dialog>
  );
}

// --- Staff: separations table -----------------------------------------------

function StaffSeparations({ separations, isLoading }: { separations: Separation[]; isLoading: boolean }) {
  const [accept, setAccept] = useState<Separation | null>(null);
  const [decline, setDecline] = useState<Separation | null>(null);
  const [manage, setManage] = useState<Separation | null>(null);

  return (
    <>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="hidden md:table-cell">Last working day</TableHead>
              <TableHead className="hidden lg:table-cell">Clearance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : separations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  No separations to manage.
                </TableCell>
              </TableRow>
            ) : (
              separations.map((s) => {
                const { done, total } = clearanceProgress(s.clearance);
                const isPending = PENDING_STATUSES.includes(s.status);
                const inFlow = ["NOTICE_PERIOD", "IN_CLEARANCE"].includes(s.status);
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.employeeName}</div>
                      <div className="text-xs text-muted-foreground">{s.employeeCode}</div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="grey">{s.typeLabel || s.type}</Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {fmtDate(s.lastWorkingDay || s.proposedLastWorkingDay)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {done}/{total}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[s.status] || "grey"}>
                        {statusLabel(s.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {isPending && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setAccept(s)}>
                              <CheckCircle2 className="mr-1 size-4" /> Accept
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDecline(s)}>
                              <X className="mr-1 size-4" /> Decline
                            </Button>
                          </>
                        )}
                        {inFlow && (
                          <Button size="sm" variant="ghost" onClick={() => setManage(s)}>
                            <Calendar className="mr-1 size-4" /> Manage
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {accept && (
        <AcceptDialog sep={accept} open={!!accept} onOpenChange={(o) => !o && setAccept(null)} />
      )}
      {decline && (
        <DeclineDialog sep={decline} open={!!decline} onOpenChange={(o) => !o && setDecline(null)} />
      )}
      {manage && (
        <ManageDialog
          key={manage.id}
          sep={separations.find((s) => s.id === manage.id) ?? manage}
          open={!!manage}
          onOpenChange={(o) => !o && setManage(null)}
        />
      )}
    </>
  );
}

// --- Page -------------------------------------------------------------------

export default function SeparationPage() {
  const { isStaff, user } = useAuth();

  const { data: separations = [], isLoading } = useQuery({
    queryKey: ["separations"],
    queryFn: () => http.get<Separation[]>("/separation"),
  });

  const myEmployeeId = user?.employeeId ?? null;

  const mySeparation = useMemo(() => {
    if (!myEmployeeId) return null;
    return (
      separations.find((s) => s.employeeId === myEmployeeId && ACTIVE_STATUSES.includes(s.status)) ||
      separations.find((s) => s.employeeId === myEmployeeId) ||
      null
    );
  }, [separations, myEmployeeId]);

  const hasActiveOwn = !!(
    mySeparation && ACTIVE_STATUSES.includes(mySeparation.status)
  );

  // Employee view ------------------------------------------------------------
  if (!isStaff) {
    return (
      <>
        <PageHeader
          title="Separation"
          description="Resign and track your offboarding."
          actions={myEmployeeId && !hasActiveOwn ? <ResignDialog /> : undefined}
        />

        {isLoading ? (
          <Card>
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ) : !myEmployeeId ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Separation is available to employees only.
            </CardContent>
          </Card>
        ) : mySeparation && hasActiveOwn ? (
          <MySeparationCard sep={mySeparation} />
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              You don&apos;t have an active separation. Use{" "}
              <span className="font-medium text-foreground">Resign</span> above if you wish to leave the
              organisation.
            </CardContent>
          </Card>
        )}
      </>
    );
  }

  // Staff view ---------------------------------------------------------------
  return (
    <>
      <PageHeader
        title="Separation"
        description="Manage resignations, offboarding and clearance."
      />
      <StaffSeparations separations={separations} isLoading={isLoading} />
    </>
  );
}
