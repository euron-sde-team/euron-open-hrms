"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Check, X, Ban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError, apiErrorCode } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Employee } from "@open-hrms/types";
import { PageHeader } from "@open-hrms/ui/page-header";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Badge } from "@open-hrms/ui/badge";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { FieldHint } from "@open-hrms/ui/label";
import { Card } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@open-hrms/ui/tabs";

// Local types mirror the leave.routes.js contract -----------------------------

interface LeaveType {
  id: string;
  name: string;
  maxPerYear: number;
  paid: boolean;
  carryForwardCap: number;
}

interface LeaveBalance {
  leaveType: string;
  leaveTypeId: string;
  paid: boolean;
  total: number;
  used: number;
  remaining: number;
}

type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  note?: string;
  createdAt?: string;
  employeeName: string;
  employeeCode: string;
  leaveTypeName: string;
  /** Company leave rules someone deliberately overrode for this request. */
  ruleOverrides?: string[];
}

const STATUS_VARIANT: Record<LeaveStatus, "green" | "amber" | "red" | "grey"> = {
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "grey",
};

const STATUS_FILTERS = ["ALL", "PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function statusLabel(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// Company leave rules (Settings → Leave rules) -----------------------------------

interface RuleProblem {
  rule: "MONTHLY_LIMIT" | "ADVANCE_NOTICE";
  message: string;
}

interface RuleCheck {
  /** The request's size in days: working days when the rules count only those. */
  days: number;
  workingDaysOnly: boolean;
  problems: RuleProblem[];
}

interface MonthlyAllowance {
  enabled: boolean;
  /** "YYYY-MM" */
  month?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  newJoiner?: boolean;
  newJoinerEnds?: string | null;
  /** Unused days from earlier months this year, when they carry over. */
  carriedOver?: number;
}

const RULE_LABEL: Record<string, string> = {
  MONTHLY_LIMIT: "Over monthly limit",
  ADVANCE_NOTICE: "Short notice",
};

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtMonth = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

// Apply-for-leave dialog -------------------------------------------------------

interface CoverageCheck {
  applicable: boolean;
  mode: "warn" | "block";
  minPresent: number;
  department: string | null;
  conflicts: { date: string; present: number; minPresent: number }[];
}

function ApplyLeaveDialog({ types }: { types: LeaveType[] }) {
  const qc = useQueryClient();
  const { user, isStaff } = useAuth();
  const [open, setOpen] = useState(false);
  const blank = () => ({ employeeId: user?.employeeId ?? "", leaveTypeId: "", from: "", to: "", reason: "" });
  const [form, setForm] = useState(blank);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setType = (v: string | null) => set("leaveTypeId", v ?? "");

  // Staff can apply on anyone's behalf; everyone else applies for themselves.
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => http.get<Employee[]>("/employees"),
    enabled: open && isStaff,
  });
  const activeEmployees = useMemo(() => employees.filter((e) => e.status !== "EXITED"), [employees]);
  const onBehalf = isStaff && !!form.employeeId && form.employeeId !== user?.employeeId;
  const who = onBehalf ? { employeeId: form.employeeId } : {};
  const datesOk = !!form.from && !!form.to && form.to >= form.from;

  // Live minimum-coverage check (no-op unless enabled for the team).
  const { data: coverage } = useQuery({
    queryKey: ["coverage-check", form.employeeId, form.from, form.to],
    queryFn: () => http.get<CoverageCheck>("/leave/coverage/check", { from: form.from, to: form.to, ...who }),
    enabled: open && datesOk && !!form.employeeId,
  });
  const conflict = coverage?.applicable && coverage.conflicts.length > 0 ? coverage : null;

  // Live check against the company's leave rules (never any problems while they are off).
  const { data: ruleCheck } = useQuery({
    queryKey: ["leave-rules-check", form.employeeId, form.leaveTypeId, form.from, form.to],
    queryFn: () =>
      http.get<RuleCheck>("/leave/rules/check", { leaveTypeId: form.leaveTypeId, from: form.from, to: form.to, ...who }),
    enabled: open && datesOk && !!form.employeeId && !!form.leaveTypeId,
  });
  const problems = ruleCheck?.problems ?? [];
  // HR applying for someone else may override the rules. The tick belongs to this exact
  // request, so changing the person, type or dates clears it rather than carrying it over.
  const requestKey = [form.employeeId, form.leaveTypeId, form.from, form.to].join("|");
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const override = onBehalf && overrideFor === requestKey;
  const blocked = problems.length > 0 && !override;
  const nothingToTake = ruleCheck?.days === 0;

  const reset = () => {
    setForm(blank());
    setOverrideFor(null);
  };

  const apply = useMutation({
    mutationFn: () =>
      http.post<LeaveRequest>("/leave/requests", {
        leaveTypeId: form.leaveTypeId,
        from: form.from,
        to: form.to,
        reason: form.reason,
        ...who,
        ...(override && problems.length ? { force: true } : {}),
      }),
    onSuccess: () => {
      toast.success(onBehalf ? "Leave request submitted on their behalf" : "Leave request submitted");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      qc.invalidateQueries({ queryKey: ["leave-balance"] });
      qc.invalidateQueries({ queryKey: ["leave-allowance"] });
      reset();
      setOpen(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Apply for leave
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Apply for leave</DialogTitle>
            <DialogDescription>Request time off. Your reporting manager will review it, HR or an admin can also approve.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apply.mutate();
            }}
            className="space-y-4"
          >
            {isStaff && (
              <Field label="Employee" hint={onBehalf ? "You are applying on their behalf." : undefined}>
                <EmployeeCombobox
                  employees={activeEmployees}
                  value={form.employeeId}
                  onValueChange={(id) => set("employeeId", id)}
                />
              </Field>
            )}
            <Field label="Leave type">
              <Select
                items={types.map((t) => ({ value: t.id, label: `${t.name}${t.paid ? "" : " (unpaid)"}` }))}
                value={form.leaveTypeId}
                onValueChange={setType}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a leave type" />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.paid ? "" : " (unpaid)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <FormGrid columns={2}>
              <Field label="From" htmlFor="from">
                <Input id="from" type="date" required value={form.from} onChange={(e) => set("from", e.target.value)} />
              </Field>
              <Field label="To" htmlFor="to">
                <Input id="to" type="date" required value={form.to} onChange={(e) => set("to", e.target.value)} />
              </Field>
            </FormGrid>
            {ruleCheck?.workingDaysOnly && datesOk && (
              <FieldHint>
                {nothingToTake
                  ? "Every day in this range is a weekly off or a holiday, so there is nothing to apply for."
                  : `Counts as ${ruleCheck.days} working day${ruleCheck.days === 1 ? "" : "s"}. Weekly offs and holidays are not counted.`}
              </FieldHint>
            )}
            <Field label="Reason" htmlFor="reason">
              <Textarea id="reason" rows={3} value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Optional note for the approver" />
            </Field>
            {conflict && (
              <div
                className="rounded-[6px] border px-3 py-2 text-[13px]"
                style={
                  conflict.mode === "block"
                    ? { borderColor: "var(--bad)", background: "var(--bad-bg)", color: "var(--bad)" }
                    : { borderColor: "var(--warn)", background: "var(--warn-bg)", color: "var(--warn)" }
                }
              >
                {conflict.mode === "block" ? "This would leave " : "Heads up, this leaves "}
                <b>{conflict.department}</b> below {conflict.minPresent} present on{" "}
                {conflict.conflicts.map((c) => c.date).join(", ")}.
                {conflict.mode === "block" ? " A manager will need to override it." : " You can still apply; the approver will see this."}
              </div>
            )}
            {problems.length > 0 && (
              <div
                className="space-y-2 rounded-[6px] border px-3 py-2 text-[13px]"
                style={{ borderColor: "var(--bad)", background: "var(--bad-bg)", color: "var(--bad)" }}
              >
                {problems.map((p, i) => (
                  <p key={i}>{p.message}</p>
                ))}
                {onBehalf && (
                  <label className="flex cursor-pointer items-center gap-2 pt-1 font-medium">
                    <Checkbox
                      checked={override}
                      onCheckedChange={(v) => setOverrideFor(v ? requestKey : null)}
                    />
                    Override the leave rules for this request
                  </label>
                )}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={apply.isPending || !form.leaveTypeId || !form.employeeId || blocked || nothingToTake}
              >
                {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Balances card ----------------------------------------------------------------

function BalancesCard() {
  const { data: balances = [], isLoading } = useQuery({
    queryKey: ["leave-balance"],
    queryFn: () => http.get<LeaveBalance[]>("/leave/balance"),
  });
  // The company's monthly paid-leave limit, when it is on.
  const { data: allowance } = useQuery({
    queryKey: ["leave-allowance"],
    queryFn: () => http.get<MonthlyAllowance>("/leave/rules/allowance"),
  });

  return (
    <Card className="mb-6 p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Your balances ({new Date().getFullYear()})</h2>
        {allowance?.enabled && allowance.month && (
          <p className="mt-1 text-sm">
            <span className="font-medium">Paid leave in {fmtMonth(allowance.month)}:</span> {allowance.used} of{" "}
            {allowance.limit} {allowance.limit === 1 ? "day" : "days"} used, including pending requests.
            {allowance.carriedOver
              ? ` That includes ${allowance.carriedOver} ${allowance.carriedOver === 1 ? "day" : "days"} carried over from earlier months.`
              : ""}
            {allowance.newJoiner && allowance.newJoinerEnds && (
              <span className="text-muted-foreground">
                {" "}The new-joiner limit applies until {fmtDate(allowance.newJoinerEnds)}.
              </span>
            )}
          </p>
        )}
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : balances.length === 0 ? (
        <p className="text-sm text-muted-foreground">No leave types configured.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {balances.map((b) => (
            <div key={b.leaveTypeId} className="rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{b.leaveType}</span>
                {!b.paid && <Badge variant="grey">Unpaid</Badge>}
              </div>
              <div className="mt-1 text-2xl font-semibold">{b.remaining}</div>
              <div className="text-xs text-muted-foreground">
                {b.used} used of {b.total}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Page -------------------------------------------------------------------------

type Scope = "mine" | "team";

export default function LeavePage() {
  const qc = useQueryClient();
  const { user, isStaff, can } = useAuth();
  const canApprove = isStaff || can("leave.approve");
  // A reporting manager who is NOT staff gets an extra "My team" scope. Staff
  // already see every request through the existing all-requests view.
  const isManager = !isStaff && user?.hasReports === true;
  const [scope, setScope] = useState<Scope>("mine");
  const [status, setStatus] = useState<StatusFilter>(isStaff ? "PENDING" : "ALL");

  const teamView = isManager && scope === "team";

  const { data: types = [] } = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => http.get<LeaveType[]>("/leave/types"),
  });

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["leave-requests", scope, status],
    queryFn: () =>
      http.get<LeaveRequest[]>("/leave/requests", {
        ...(teamView ? { scope: "team" } : {}),
        ...(status === "ALL" ? {} : { status }),
      }),
  });

  const decide = useMutation({
    mutationFn: (vars: { id: string; decision: "APPROVED" | "REJECTED"; force?: boolean }) =>
      http.post<LeaveRequest>(`/leave/requests/${vars.id}/decide`, { decision: vars.decision, force: vars.force }),
    onSuccess: (_res, vars) => {
      toast.success(`Request ${vars.decision === "APPROVED" ? "approved" : "rejected"}`);
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      qc.invalidateQueries({ queryKey: ["leave-balance"] });
      qc.invalidateQueries({ queryKey: ["leave-allowance"] });
    },
    onError: (e, vars) => {
      const msg = apiError(e);
      // Over the company's monthly limit, or a minimum-coverage hard block → offer an override.
      const ruleBreak = apiErrorCode(e) === "LEAVE_RULE";
      if (!vars.force && (ruleBreak || /present|coverage|override/i.test(msg))) {
        const ask = ruleBreak ? "Approve anyway, overriding the leave rule?" : "Approve anyway and override coverage?";
        if (typeof window !== "undefined" && window.confirm(`${msg}\n\n${ask}`)) {
          decide.mutate({ ...vars, force: true });
          return;
        }
      }
      toast.error(msg);
    },
  });

  const cancelApproved = useMutation({
    mutationFn: (id: string) => http.post<LeaveRequest>(`/leave/requests/${id}/cancel`, {}),
    onSuccess: () => {
      toast.success("Leave cancelled and balance restored");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      qc.invalidateQueries({ queryKey: ["leave-balance"] });
      qc.invalidateQueries({ queryKey: ["leave-allowance"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const removePending = useMutation({
    mutationFn: (id: string) => http.del<{ ok: boolean }>(`/leave/requests/${id}`),
    onSuccess: () => {
      toast.success("Request withdrawn");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      qc.invalidateQueries({ queryKey: ["leave-allowance"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const busy = decide.isPending || cancelApproved.isPending || removePending.isPending;

  // Decision actions: staff/approvers everywhere, or a manager in their team view
  // (the backend permits the reporting manager to decide & cancel reports' leave).
  const canDecide = canApprove || teamView;
  // Employee name column shows for staff (all requests) and managers (team view).
  const showEmployee = isStaff || teamView;
  const colSpan = showEmployee ? 6 : 5;

  const rows = useMemo(() => requests, [requests]);

  return (
    <>
      <PageHeader
        title="Leave"
        description={isStaff ? "Requests, approvals and balances." : "Apply for leave and track your requests."}
        actions={!teamView && types.length > 0 && (!!user?.employeeId || isStaff) ? <ApplyLeaveDialog types={types} /> : undefined}
      />

      {isManager && (
        <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)} className="mb-4">
          <TabsList>
            <TabsTrigger value="mine">My leave</TabsTrigger>
            <TabsTrigger value="team">My team</TabsTrigger>
          </TabsList>
          <TabsContent value="mine" />
          <TabsContent value="team" />
        </Tabs>
      )}

      {!isStaff && !teamView && <BalancesCard />}

      <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)} className="mb-4">
        <TabsList>
          {STATUS_FILTERS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === "ALL" ? "All" : statusLabel(s)}
            </TabsTrigger>
          ))}
        </TabsList>
        {STATUS_FILTERS.map((s) => (
          <TabsContent key={s} value={s} />
        ))}
      </Tabs>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {showEmployee && <TableHead>Employee</TableHead>}
              <TableHead>Type</TableHead>
              <TableHead className="hidden sm:table-cell">Dates</TableHead>
              <TableHead className="hidden md:table-cell">Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={colSpan}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-muted-foreground">
                  No leave requests found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  {showEmployee && (
                    <TableCell>
                      <div className="font-medium">{r.employeeName}</div>
                      <div className="text-xs text-muted-foreground">{r.employeeCode}</div>
                    </TableCell>
                  )}
                  <TableCell>{r.leaveTypeName}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div>{r.from} &rarr; {r.to}</div>
                    <div className="text-xs text-muted-foreground">{r.days} day(s)</div>
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate md:table-cell text-sm text-muted-foreground">
                    {r.reason || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                      {r.ruleOverrides?.map((rule) => (
                        <Badge key={rule} variant="amber" title="A company leave rule was overridden for this request">
                          {RULE_LABEL[rule] ?? rule}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canDecide && r.status === "PENDING" && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => decide.mutate({ id: r.id, decision: "APPROVED" })}
                          >
                            <Check className="mr-1 size-4" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => decide.mutate({ id: r.id, decision: "REJECTED" })}
                          >
                            <X className="mr-1 size-4" /> Reject
                          </Button>
                        </>
                      )}
                      {canDecide && r.status === "APPROVED" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => cancelApproved.mutate(r.id)}
                        >
                          <Ban className="mr-1 size-4" /> Cancel
                        </Button>
                      )}
                      {!canDecide && r.status === "PENDING" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => removePending.mutate(r.id)}
                        >
                          <Trash2 className="mr-1 size-4" /> Withdraw
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
