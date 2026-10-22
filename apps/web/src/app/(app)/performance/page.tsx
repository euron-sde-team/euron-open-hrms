"use client";

import { Suspense, useMemo, useState } from "react";
import { useActiveTab } from "@/lib/use-active-tab";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, CheckCircle2, Trash2, Send, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Employee } from "@open-hrms/types";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Textarea } from "@open-hrms/ui/textarea";
import { Separator } from "@open-hrms/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@open-hrms/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@open-hrms/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-hrms/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

// ── Local types (backend response shapes) ───────────────────────────────────
interface AppraisalCycle {
  id: string;
  name: string;
  periodLabel?: string;
  status: "OPEN" | "CLOSED" | string;
  appraisals?: number;
  createdAt?: string;
}

interface Appraisal {
  id: string;
  cycleId: string;
  employeeId: string;
  employeeName?: string;
  cycleName?: string;
  selfReview?: string;
  achievements?: string;
  managerRating?: number | null;
  managerComments?: string;
  recommendedHikePct?: number;
  finalHikePct?: number;
  status: "PENDING_SELF" | "PENDING_MANAGER" | "COMPLETED" | string;
}

interface PipCheckin {
  date: string;
  note: string;
  rating?: number | null;
}

interface Pip {
  id: string;
  employeeId: string;
  employeeName?: string;
  title: string;
  reason?: string;
  objectives?: string;
  startDate?: string;
  endDate?: string;
  status: "ACTIVE" | "CLEARED" | "EXTENDED" | "TERMINATED" | string;
  mentorId?: string | null;
  checkins?: PipCheckin[];
  outcome?: string;
  createdAt?: string;
}

interface WorkLog {
  id: string;
  employeeId: string;
  employeeName?: string;
  date: string;
  type: "ONSITE" | "OFFSITE" | "CLIENT" | "REMOTE" | string;
  client?: string;
  hours: number;
  productivityScore: number;
  summary?: string;
  tasks?: string;
}

interface WorkLogSummaryRow {
  employeeId: string;
  name: string;
  days: number;
  hours: number;
  scoreSum: number;
  byType: Record<string, number>;
  avgProductivity: number;
}

interface WorkLogSummary {
  from: string;
  to: string;
  rows: WorkLogSummaryRow[];
}

type WorkLogScope = "mine" | "team" | "all";

type EmployeeLite = Pick<Employee, "id" | "firstName" | "lastName">;

const WORKLOG_TYPES = ["ONSITE", "OFFSITE", "CLIENT", "REMOTE"];
const PIP_STATUSES = ["ACTIVE", "CLEARED", "EXTENDED", "TERMINATED"];

const APPRAISAL_VARIANT: Record<string, "green" | "amber" | "red" | "blue" | "grey" | "violet"> = {
  PENDING_SELF: "amber",
  PENDING_MANAGER: "amber",
  COMPLETED: "green",
};
const PIP_VARIANT: Record<string, "green" | "amber" | "red" | "blue" | "grey" | "violet"> = {
  ACTIVE: "amber",
  OPEN: "amber",
  CLEARED: "green",
  COMPLETED: "green",
  EXTENDED: "grey",
  FAILED: "red",
  TERMINATED: "red",
};
const WORKLOG_TYPE_VARIANT: Record<string, "green" | "amber" | "red" | "blue" | "grey" | "violet"> = {
  REMOTE: "blue",
  CLIENT: "violet",
  ONSITE: "green",
  OFFSITE: "grey",
};

const labelize = (s?: string) => (s ? s.toLowerCase().replace(/_/g, " ") : "-");
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// ── Appraisals ───────────────────────────────────────────────────────────────
function NewCycleDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", periodLabel: "" });

  const create = useMutation({
    mutationFn: () => http.post("/performance/cycles", form),
    onSuccess: () => {
      toast.success("Cycle opened · self-reviews requested from all employees");
      qc.invalidateQueries({ queryKey: ["appraisal-cycles"] });
      qc.invalidateQueries({ queryKey: ["appraisals"] });
      setOpen(false);
      setForm({ name: "", periodLabel: "" });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Open cycle
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Open appraisal cycle</DialogTitle>
            <DialogDescription>
              Opening a cycle creates a pending self-review for every active employee.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
            className="space-y-4"
          >
            <Field label="Cycle name" htmlFor="cycleName">
              <Input
                id="cycleName"
                required
                placeholder="H1 2026"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="Period label" htmlFor="periodLabel">
              <Input
                id="periodLabel"
                placeholder="Jan, Jun 2026"
                value={form.periodLabel}
                onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))}
              />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Open cycle
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SelfReviewDialog({
  appraisal,
  open,
  onOpenChange,
}: {
  appraisal: Appraisal;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    selfReview: appraisal.selfReview ?? "",
    achievements: appraisal.achievements ?? "",
  });

  const submit = useMutation({
    mutationFn: () => http.post(`/performance/appraisals/${appraisal.id}/self`, form),
    onSuccess: () => {
      toast.success("Self-review submitted");
      qc.invalidateQueries({ queryKey: ["appraisals"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Self-review · {appraisal.cycleName}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Self review" htmlFor="selfReview">
            <Textarea
              id="selfReview"
              rows={4}
              value={form.selfReview}
              onChange={(e) => setForm((f) => ({ ...f, selfReview: e.target.value }))}
            />
          </Field>
          <Field label="Key achievements" htmlFor="achievements">
            <Textarea
              id="achievements"
              rows={4}
              value={form.achievements}
              onChange={(e) => setForm((f) => ({ ...f, achievements: e.target.value }))}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({
  appraisal,
  open,
  onOpenChange,
}: {
  appraisal: Appraisal;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    managerRating: appraisal.managerRating ?? 3,
    managerComments: appraisal.managerComments ?? "",
    recommendedHikePct: appraisal.recommendedHikePct ?? 0,
    finalHikePct: appraisal.finalHikePct ?? 0,
  });

  const review = useMutation({
    mutationFn: () => http.post(`/performance/appraisals/${appraisal.id}/review`, form),
    onSuccess: () => {
      toast.success("Review submitted");
      qc.invalidateQueries({ queryKey: ["appraisals"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Review · {appraisal.employeeName}</DialogTitle>
          <DialogDescription>{appraisal.cycleName}</DialogDescription>
        </DialogHeader>
        {(appraisal.selfReview || appraisal.achievements) && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            {appraisal.selfReview && (
              <p>
                <span className="font-medium">Self review: </span>
                {appraisal.selfReview}
              </p>
            )}
            {appraisal.achievements && (
              <p>
                <span className="font-medium">Achievements: </span>
                {appraisal.achievements}
              </p>
            )}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            review.mutate();
          }}
          className="space-y-4"
        >
          <FormGrid columns={3}>
            <Field label="Rating (1 to 5)" htmlFor="rating">
              <Input
                id="rating"
                type="number"
                min={1}
                max={5}
                value={form.managerRating}
                onChange={(e) => setForm((f) => ({ ...f, managerRating: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Recommended hike %" htmlFor="rec">
              <Input
                id="rec"
                type="number"
                step="0.01"
                value={form.recommendedHikePct}
                onChange={(e) =>
                  setForm((f) => ({ ...f, recommendedHikePct: Number(e.target.value) }))
                }
              />
            </Field>
            <Field label="Final hike %" htmlFor="final">
              <Input
                id="final"
                type="number"
                step="0.01"
                value={form.finalHikePct}
                onChange={(e) => setForm((f) => ({ ...f, finalHikePct: Number(e.target.value) }))}
              />
            </Field>
          </FormGrid>
          <Field label="Manager comments" htmlFor="comments">
            <Textarea
              id="comments"
              rows={3}
              value={form.managerComments}
              onChange={(e) => setForm((f) => ({ ...f, managerComments: e.target.value }))}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={review.isPending}>
              {review.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Complete review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AppraisalsTab() {
  const { isStaff, user } = useAuth();
  const qc = useQueryClient();
  const [selfTarget, setSelfTarget] = useState<Appraisal | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Appraisal | null>(null);

  const { data: cycles = [], isLoading: cyclesLoading } = useQuery({
    queryKey: ["appraisal-cycles"],
    queryFn: () => http.get<AppraisalCycle[]>("/performance/cycles"),
  });
  const { data: appraisals = [], isLoading: appraisalsLoading } = useQuery({
    queryKey: ["appraisals"],
    queryFn: () => http.get<Appraisal[]>("/performance/appraisals"),
  });

  const closeCycle = useMutation({
    mutationFn: (id: string) => http.post(`/performance/cycles/${id}/close`, {}),
    onSuccess: () => {
      toast.success("Cycle closed");
      qc.invalidateQueries({ queryKey: ["appraisal-cycles"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="space-y-6">
      {isStaff && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium">Appraisal cycles</h3>
            <NewCycleDialog />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cycle</TableHead>
                <TableHead className="hidden sm:table-cell">Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Appraisals</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cyclesLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : cycles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                    No cycles opened yet.
                  </TableCell>
                </TableRow>
              ) : (
                cycles.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="hidden sm:table-cell">{c.periodLabel || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "OPEN" ? "amber" : "grey"}>
                        {labelize(c.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{c.appraisals ?? 0}</TableCell>
                    <TableCell className="text-right">
                      {c.status === "OPEN" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={closeCycle.isPending}
                          onClick={() => closeCycle.mutate(c.id)}
                        >
                          Close
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {isStaff && <TableHead>Employee</TableHead>}
              <TableHead>Cycle</TableHead>
              <TableHead className="w-44 whitespace-nowrap">Status</TableHead>
              <TableHead className="hidden w-24 md:table-cell">Rating</TableHead>
              <TableHead className="hidden w-28 lg:table-cell">Final hike</TableHead>
              <TableHead className="w-40 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appraisalsLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={isStaff ? 6 : 5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : appraisals.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isStaff ? 6 : 5}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No appraisals yet.
                </TableCell>
              </TableRow>
            ) : (
              appraisals.map((a) => {
                const isOwn = !!user?.employeeId && a.employeeId === user.employeeId;
                return (
                  <TableRow key={a.id} className="h-14 [&>td]:py-0">
                    {isStaff && <TableCell className="font-medium">{a.employeeName}</TableCell>}
                    <TableCell>{a.cycleName || "-"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={APPRAISAL_VARIANT[a.status] || "grey"}>
                        {labelize(a.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{a.managerRating ?? "-"}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {a.status === "COMPLETED" ? `${a.finalHikePct ?? 0}%` : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {(() => {
                        const canSelf = isOwn && a.status === "PENDING_SELF";
                        const canReview = isStaff && a.status !== "PENDING_SELF" && a.status !== "COMPLETED";
                        if (!canSelf && !canReview) {
                          return <span className="text-muted-foreground">-</span>;
                        }
                        return (
                          <div className="flex justify-end gap-1">
                            {canSelf && (
                              <Button size="sm" variant="ghost" onClick={() => setSelfTarget(a)}>
                                <Send className="mr-1 size-4" /> Self review
                              </Button>
                            )}
                            {canReview && (
                              <Button size="sm" variant="ghost" onClick={() => setReviewTarget(a)}>
                                <ClipboardCheck className="mr-1 size-4" /> Review
                              </Button>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {selfTarget && (
        <SelfReviewDialog
          key={selfTarget.id}
          appraisal={selfTarget}
          open={!!selfTarget}
          onOpenChange={(o) => !o && setSelfTarget(null)}
        />
      )}
      {reviewTarget && (
        <ReviewDialog
          key={reviewTarget.id}
          appraisal={reviewTarget}
          open={!!reviewTarget}
          onOpenChange={(o) => !o && setReviewTarget(null)}
        />
      )}
    </div>
  );
}

// ── PIP ──────────────────────────────────────────────────────────────────────
function NewPipDialog({ employees }: { employees: EmployeeLite[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    title: "Performance Improvement Plan",
    reason: "",
    objectives: "",
    startDate: todayStr(),
    endDate: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () => http.post("/performance/pips", form),
    onSuccess: () => {
      toast.success("PIP created");
      qc.invalidateQueries({ queryKey: ["pips"] });
      setOpen(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> New PIP
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New performance improvement plan</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
            className="space-y-4"
          >
            <Field label="Employee">
              <Select
                items={employees.map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName ?? ""}`.trim() }))}
                value={form.employeeId}
                onValueChange={(v) => set("employeeId", v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.firstName} {e.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Title" htmlFor="pipTitle">
              <Input id="pipTitle" value={form.title} onChange={(e) => set("title", e.target.value)} />
            </Field>
            <FormGrid columns={2}>
              <Field label="Start date" htmlFor="startDate">
                <Input
                  id="startDate"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                />
              </Field>
              <Field label="End date" htmlFor="endDate">
                <Input
                  id="endDate"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => set("endDate", e.target.value)}
                />
              </Field>
            </FormGrid>
            <Field label="Reason" htmlFor="reason">
              <Textarea
                id="reason"
                rows={3}
                value={form.reason}
                onChange={(e) => set("reason", e.target.value)}
              />
            </Field>
            <Field label="Objectives" htmlFor="objectives">
              <Textarea
                id="objectives"
                rows={3}
                value={form.objectives}
                onChange={(e) => set("objectives", e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending || !form.employeeId}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ManagePipDialog({
  pip,
  open,
  onOpenChange,
}: {
  pip: Pip;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(pip.status);
  const [outcome, setOutcome] = useState(pip.outcome ?? "");
  const [checkinNote, setCheckinNote] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["pips"] });

  const update = useMutation({
    mutationFn: () => http.put(`/performance/pips/${pip.id}`, { status, outcome }),
    onSuccess: () => {
      toast.success("PIP updated");
      invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const checkin = useMutation({
    mutationFn: () => http.post(`/performance/pips/${pip.id}/checkin`, { note: checkinNote }),
    onSuccess: () => {
      toast.success("Check-in added");
      setCheckinNote("");
      invalidate();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{pip.title}</DialogTitle>
          <DialogDescription>{pip.employeeName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {pip.reason && (
            <p>
              <span className="font-medium">Reason: </span>
              {pip.reason}
            </p>
          )}
          {pip.objectives && (
            <p>
              <span className="font-medium">Objectives: </span>
              {pip.objectives}
            </p>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <h4 className="text-sm font-medium">Check-ins</h4>
          {pip.checkins && pip.checkins.length > 0 ? (
            <ul className="space-y-2">
              {pip.checkins.map((c, i) => (
                <li key={i} className="rounded-md border p-2 text-sm">
                  <span className="text-xs text-muted-foreground">{c.date}</span>
                  <div>{c.note || "-"}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No check-ins yet.</p>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="Add a check-in note..."
              value={checkinNote}
              onChange={(e) => setCheckinNote(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={checkin.isPending || !checkinNote.trim()}
              onClick={() => checkin.mutate()}
            >
              {checkin.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </div>
        </div>

        <Separator />

        <FormGrid columns={2}>
          <Field label="Status">
            <Select
              items={PIP_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))}
              value={status}
              onValueChange={(v) => setStatus(v ?? status)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIP_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Outcome" htmlFor="outcome">
            <Input id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          </Field>
        </FormGrid>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={update.isPending} onClick={() => update.mutate()}>
            {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PipTab({ employees }: { employees: EmployeeLite[] }) {
  const { isStaff } = useAuth();
  const [target, setTarget] = useState<Pip | null>(null);

  const { data: pips = [], isLoading } = useQuery({
    queryKey: ["pips"],
    queryFn: () => http.get<Pip[]>("/performance/pips"),
  });

  return (
    <div className="space-y-4">
      {isStaff && (
        <div className="flex justify-end">
          <NewPipDialog employees={employees} />
        </div>
      )}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {isStaff && <TableHead>Employee</TableHead>}
              <TableHead>Plan</TableHead>
              <TableHead className="hidden md:table-cell">Window</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Check-ins</TableHead>
              {isStaff && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pips.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  No improvement plans.
                </TableCell>
              </TableRow>
            ) : (
              pips.map((p) => (
                <TableRow key={p.id}>
                  {isStaff && <TableCell className="font-medium">{p.employeeName}</TableCell>}
                  <TableCell>
                    <div className="font-medium">{p.title}</div>
                    {p.reason && (
                      <div className="text-xs text-muted-foreground line-clamp-1">{p.reason}</div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                    {p.startDate || "-"}
                    {p.endDate ? ` → ${p.endDate}` : ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={PIP_VARIANT[p.status] || "grey"}>{labelize(p.status)}</Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{p.checkins?.length ?? 0}</TableCell>
                  {isStaff && (
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setTarget(p)}>
                        <CheckCircle2 className="mr-1 size-4" /> Manage
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {target && (
        <ManagePipDialog
          key={target.id}
          pip={target}
          open={!!target}
          onOpenChange={(o) => !o && setTarget(null)}
        />
      )}
    </div>
  );
}

// ── Work logs ─────────────────────────────────────────────────────────────────
function LogWorkDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    date: todayStr(),
    type: "REMOTE",
    client: "",
    hours: 8,
    productivityScore: 5,
    summary: "",
    tasks: "",
  });
  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => http.post("/worklogs", form),
    onSuccess: () => {
      toast.success("Work logged");
      qc.invalidateQueries({ queryKey: ["worklogs"] });
      setOpen(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Log work
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Log a day&apos;s work</DialogTitle>
            <DialogDescription>Logging the same date again updates that entry.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <FormGrid columns={2}>
              <Field label="Date" htmlFor="logDate">
                <Input
                  id="logDate"
                  type="date"
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                />
              </Field>
              <Field label="Type">
                <Select
                  items={WORKLOG_TYPES.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() }))}
                  value={form.type}
                  onValueChange={(v) => set("type", v ?? "REMOTE")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKLOG_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.charAt(0) + t.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Hours" htmlFor="hours">
                <Input
                  id="hours"
                  type="number"
                  step="0.5"
                  min={0}
                  value={form.hours}
                  onChange={(e) => set("hours", Number(e.target.value))}
                />
              </Field>
              <Field label="Productivity (1 to 10)" htmlFor="score">
                <Input
                  id="score"
                  type="number"
                  min={1}
                  max={10}
                  value={form.productivityScore}
                  onChange={(e) => set("productivityScore", Number(e.target.value))}
                />
              </Field>
            </FormGrid>
            {form.type === "CLIENT" && (
              <Field label="Client" htmlFor="client">
                <Input id="client" value={form.client} onChange={(e) => set("client", e.target.value)} />
              </Field>
            )}
            <Field label="Summary" htmlFor="summary">
              <Input id="summary" value={form.summary} onChange={(e) => set("summary", e.target.value)} />
            </Field>
            <Field label="Tasks" htmlFor="tasks">
              <Textarea
                id="tasks"
                rows={3}
                value={form.tasks}
                onChange={(e) => set("tasks", e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WorkLogsTab() {
  const { isStaff, user } = useAuth();
  const qc = useQueryClient();

  const canSeeTeam = isStaff || !!user?.hasReports;
  const [scope, setScope] = useState<WorkLogScope>(isStaff ? "all" : "mine");
  const [from, setFrom] = useState(daysAgoStr(30));
  const [to, setTo] = useState(todayStr());

  // The backend only honours scope=team; "mine" / "all" map to no scope param
  // (employees are restricted to their own logs server-side anyway).
  const scopeParam = scope === "team" ? "team" : undefined;

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["worklogs", scope, from, to],
    queryFn: () =>
      http.get<WorkLog[]>("/worklogs", { scope: scopeParam, from, to }),
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["worklogs-summary", scope, from, to],
    queryFn: () =>
      http.get<WorkLogSummary>("/worklogs/summary", {
        scope: scopeParam,
        from,
        to,
      }),
    enabled: canSeeTeam,
  });

  const remove = useMutation({
    mutationFn: (id: string) => http.del(`/worklogs/${id}`),
    onSuccess: () => {
      toast.success("Log removed");
      qc.invalidateQueries({ queryKey: ["worklogs"] });
      qc.invalidateQueries({ queryKey: ["worklogs-summary"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {canSeeTeam && (
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select
                items={{ mine: "Mine", team: "Team", all: "All" }}
                value={scope}
                onValueChange={(v) => setScope((v as WorkLogScope) || scope)}
              >
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mine">Mine</SelectItem>
                  {!!user?.hasReports && <SelectItem value="team">Team</SelectItem>}
                  {isStaff && <SelectItem value="all">All</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="wlFrom">From</Label>
            <Input
              id="wlFrom"
              type="date"
              className="w-full sm:w-[150px]"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wlTo">To</Label>
            <Input
              id="wlTo"
              type="date"
              className="w-full sm:w-[150px]"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        {/* Only those with an employee record can log work (backend enforces this);
            don't show the action to HR/admins who have no employee record. */}
        {!!user?.employeeId && <LogWorkDialog />}
      </div>

      {canSeeTeam && (
        <Card className="p-4">
          <h3 className="mb-3 font-medium">
            Productivity summary
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {summary ? `${summary.from} → ${summary.to}` : ""}
            </span>
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="hidden sm:table-cell">Entries</TableHead>
                <TableHead>Total hours</TableHead>
                <TableHead>Avg productivity</TableHead>
                <TableHead className="hidden md:table-cell">Breakdown</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : !summary || summary.rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    No activity in this window.
                  </TableCell>
                </TableRow>
              ) : (
                summary.rows.map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="hidden sm:table-cell">{r.days}</TableCell>
                    <TableCell>{r.hours}</TableCell>
                    <TableCell>{r.avgProductivity}/10</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(r.byType).map(([t, n]) => (
                          <Badge key={t} variant={WORKLOG_TYPE_VARIANT[t] || "grey"}>
                            {t.charAt(0) + t.slice(1).toLowerCase()} · {n}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              {isStaff && <TableHead>Employee</TableHead>}
              <TableHead>Type</TableHead>
              <TableHead className="hidden sm:table-cell">Hours</TableHead>
              <TableHead className="hidden md:table-cell">Productivity</TableHead>
              <TableHead className="hidden lg:table-cell">Summary</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={isStaff ? 7 : 6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isStaff ? 7 : 6}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No work logged yet.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((w) => {
                const canDelete = isStaff || w.employeeId === user?.employeeId;
                return (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.date}</TableCell>
                    {isStaff && <TableCell>{w.employeeName}</TableCell>}
                    <TableCell>
                      <Badge variant={WORKLOG_TYPE_VARIANT[w.type] || "grey"}>
                        {w.type.charAt(0) + w.type.slice(1).toLowerCase()}
                        {w.client ? ` · ${w.client}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{w.hours}</TableCell>
                    <TableCell className="hidden md:table-cell">{w.productivityScore}/10</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground line-clamp-1">
                      {w.summary || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(w.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function PerformancePageInner() {
  const { isStaff } = useAuth();
  const [tab, setTab] = useActiveTab("appraisals");

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => http.get<EmployeeLite[]>("/employees"),
    enabled: isStaff,
  });

  const employeeOptions = useMemo(
    () => employees.map((e) => ({ id: e.id, firstName: e.firstName, lastName: e.lastName })),
    [employees]
  );

  return (
    <>
      <PageHeader
        title="Performance"
        description="Appraisals, improvement plans and work logs."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="appraisals">Appraisals</TabsTrigger>
          <TabsTrigger value="pip">PIP</TabsTrigger>
          <TabsTrigger value="worklogs">Work logs</TabsTrigger>
        </TabsList>
        <TabsContent value="appraisals" className="mt-6">
          <AppraisalsTab />
        </TabsContent>
        <TabsContent value="pip" className="mt-6">
          <PipTab employees={employeeOptions} />
        </TabsContent>
        <TabsContent value="worklogs" className="mt-6">
          <WorkLogsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function PerformancePage() {
  return (
    <Suspense fallback={null}>
      <PerformancePageInner />
    </Suspense>
  );
}
