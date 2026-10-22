"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Check, X, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
import { Badge } from "@open-hrms/ui/badge";
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

// Local interfaces mirroring the /ai-tokens backend contract --------------------

interface AiTokenRequest {
  id: string;
  requestedLimit: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  at: string;
}

interface AiTokenRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  code?: string;
  plan: string;
  dailyLimit: number;
  usedToday: number;
  requests?: AiTokenRequest[];
  grantedBy?: string | null;
}

type Plans = Record<string, number>;

interface StaffResponse {
  plans: Plans;
  records: AiTokenRecord[];
}

type EmployeeResponse = AiTokenRecord & { plans: Plans };

const STATUS_VARIANT: Record<string, "green" | "amber" | "red"> = {
  APPROVED: "green",
  PENDING: "amber",
  REJECTED: "red",
};

function planVariant(plan: string): "violet" | "grey" {
  return plan && plan.toUpperCase() !== "NONE" ? "violet" : "grey";
}

function pct(used: number, limit: number): number {
  if (!limit) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function num(n: number | undefined): string {
  return (n ?? 0).toLocaleString();
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${value}%` }} />
    </div>
  );
}

// Staff: set a plan / custom daily limit for an employee ------------------------

function GrantDialog({
  record,
  plans,
  open,
  onOpenChange,
}: {
  record: AiTokenRecord;
  plans: Plans;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const planKeys = useMemo(() => Object.keys(plans), [plans]);
  const [plan, setPlan] = useState<string>(planKeys.includes(record.plan) ? record.plan : planKeys[0] ?? "STARTER");
  const [dailyLimit, setDailyLimit] = useState<string>("");

  const planItems = planKeys.map((p) => ({
    value: p,
    label: `${p} ${plans[p] ? `· ${plans[p].toLocaleString()}/day` : ""}`.trim(),
  }));

  const grant = useMutation({
    mutationFn: () =>
      http.post("/ai-tokens/grant", {
        employeeId: record.employeeId,
        plan,
        dailyLimit: dailyLimit.trim() === "" ? undefined : Number(dailyLimit),
      }),
    onSuccess: () => {
      toast.success(`AI plan updated for ${record.employeeName ?? "employee"}`);
      qc.invalidateQueries({ queryKey: ["ai-tokens"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set AI plan</DialogTitle>
          <DialogDescription>
            Choose a plan for {record.employeeName ?? "this employee"}, or set a custom daily token limit.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            grant.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label>Plan</Label>
            <Select items={planItems} value={plan} onValueChange={(v) => setPlan(v ?? plan)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {planItems.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dailyLimit">Custom daily limit (optional)</Label>
            <Input
              id="dailyLimit"
              type="number"
              min={0}
              placeholder="Leave blank to use the plan default"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={grant.isPending}>
              {grant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Grant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Employee: request more tokens ------------------------------------------------

function RequestDialog({
  record,
  open,
  onOpenChange,
}: {
  record: AiTokenRecord;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [requestedLimit, setRequestedLimit] = useState<string>(String((record.dailyLimit || 0) * 2));
  const [reason, setReason] = useState("");

  const requestMore = useMutation({
    mutationFn: () =>
      http.post("/ai-tokens/request", {
        requestedLimit: Number(requestedLimit) || record.dailyLimit,
        reason,
      }),
    onSuccess: () => {
      toast.success("Request sent to HR");
      qc.invalidateQueries({ queryKey: ["ai-tokens"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request more AI tokens</DialogTitle>
          <DialogDescription>Ask HR to raise your daily AI token allowance.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            requestMore.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="requestedLimit">Requested daily limit</Label>
            <Input
              id="requestedLimit"
              type="number"
              min={0}
              required
              value={requestedLimit}
              onChange={(e) => setRequestedLimit(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              placeholder="Why do you need more tokens?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={requestMore.isPending}>
              {requestMore.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

// Employee view ----------------------------------------------------------------

function EmployeeView() {
  const [requestOpen, setRequestOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["ai-tokens"],
    queryFn: () => http.get<EmployeeResponse>("/ai-tokens"),
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="AI access" description="Your AI usage allowance and token usage." />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </>
    );
  }

  const usagePct = pct(data.usedToday, data.dailyLimit);
  const remaining = Math.max(0, (data.dailyLimit || 0) - (data.usedToday || 0));

  return (
    <>
      <PageHeader
        title="AI access"
        description="Your AI usage allowance and token usage."
        actions={
          <Button onClick={() => setRequestOpen(true)}>
            <Sparkles className="mr-2 h-4 w-4" /> Request more
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="AI plan" value={data.plan || "-"} />
        <StatCard label="Daily tokens" value={num(data.dailyLimit)} />
        <StatCard label="Used today" value={num(data.usedToday)} hint={`${usagePct}% of limit`} />
      </div>

      <Card className="mt-4 p-4">
        <h3 className="text-sm font-medium">Usage today</h3>
        <div className="mt-3">
          <ProgressBar value={usagePct} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {num(data.usedToday)} / {num(data.dailyLimit)} tokens used · {num(remaining)} remaining. Need more for heavy AI
          work? Click &apos;Request more&apos;.
        </p>
      </Card>

      <Card className="mt-4">
        <div className="border-b p-4">
          <h3 className="text-sm font-medium">My requests</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requested limit</TableHead>
              <TableHead className="hidden sm:table-cell">Reason</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data.requests ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-12 text-center text-sm text-muted-foreground">
                  No top-up requests yet.
                </TableCell>
              </TableRow>
            ) : (
              [...(data.requests ?? [])].reverse().map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-medium">{num(q.requestedLimit)}/day</TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">{q.reason || "-"}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={STATUS_VARIANT[q.status] || "grey"}>{q.status}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {requestOpen && <RequestDialog record={data} open={requestOpen} onOpenChange={setRequestOpen} />}
    </>
  );
}

// Staff view -------------------------------------------------------------------

function StaffView() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [grantRecord, setGrantRecord] = useState<AiTokenRecord | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-tokens"],
    queryFn: () => http.get<StaffResponse>("/ai-tokens"),
  });

  const decide = useMutation({
    mutationFn: ({ id, requestId, decision }: { id: string; requestId: string; decision: "APPROVED" | "REJECTED" }) =>
      http.post(`/ai-tokens/${id}/decide`, { requestId, decision }),
    onSuccess: (_res, vars) => {
      toast.success(vars.decision === "APPROVED" ? "Request approved" : "Request rejected");
      qc.invalidateQueries({ queryKey: ["ai-tokens"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const records = useMemo(() => data?.records ?? [], [data]);
  const plans = data?.plans ?? {};

  const pending = useMemo(
    () =>
      records.flatMap((r) =>
        (r.requests ?? [])
          .filter((q) => q.status === "PENDING")
          .map((q) => ({ record: r, request: q }))
      ),
    [records]
  );

  return (
    <>
      <PageHeader
        title="AI access"
        description="Grant AI usage allowances per employee and approve top-up requests."
      />

      <Card className="mb-4">
        <div className="border-b p-4">
          <h3 className="text-sm font-medium">Pending top-up requests</h3>
        </div>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : pending.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No pending requests.</p>
        ) : (
          <div className="divide-y">
            {pending.map(({ record, request }) => {
              const own = !!record.employeeId && record.employeeId === user?.employeeId;
              return (
                <div
                  key={`${record.id}-${request.id}`}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="text-sm">
                    <span className="font-medium">{record.employeeName ?? "-"}</span> wants{" "}
                    <span className="font-medium">{num(request.requestedLimit)}</span>/day
                    {request.reason ? <span className="text-muted-foreground"> · {request.reason}</span> : null}
                  </div>
                  {own ? (
                    <span className="text-xs text-muted-foreground">
                      Your request, another admin must approve it.
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() =>
                          decide.mutate({ id: record.id, requestId: request.id, decision: "APPROVED" })
                        }
                      >
                        <Check className="mr-1 size-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={decide.isPending}
                        onClick={() =>
                          decide.mutate({ id: record.id, requestId: request.id, decision: "REJECTED" })
                        }
                      >
                        <X className="mr-1 size-4" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="hidden sm:table-cell">Plan</TableHead>
              <TableHead className="hidden md:table-cell">Daily limit</TableHead>
              <TableHead>Used today</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                  No employees found.
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => {
                const usagePct = pct(r.usedToday, r.dailyLimit);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.employeeName ?? "-"}</div>
                      {r.code && <div className="text-xs text-muted-foreground">{r.code}</div>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={planVariant(r.plan)}>{r.plan}</Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{num(r.dailyLimit)}</TableCell>
                    <TableCell>
                      <div className="min-w-32">
                        <div className="text-sm">
                          {num(r.usedToday)} <span className="text-muted-foreground">/ {num(r.dailyLimit)}</span>
                        </div>
                        <div className="mt-1">
                          <ProgressBar value={usagePct} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setGrantRecord(r)}>
                        <Settings2 className="mr-1 size-4" /> Set plan
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {grantRecord && (
        <GrantDialog
          key={grantRecord.id}
          record={grantRecord}
          plans={plans}
          open={!!grantRecord}
          onOpenChange={(o) => {
            if (!o) setGrantRecord(null);
          }}
        />
      )}
    </>
  );
}

export default function AiTokensPage() {
  const { isStaff } = useAuth();
  return isStaff ? <StaffView /> : <EmployeeView />;
}
