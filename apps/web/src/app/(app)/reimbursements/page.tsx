"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Check, X, Banknote, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, http, apiError, downloadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Field, FormGrid } from "@open-hrms/ui/field";
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
import { Tabs, TabsList, TabsTrigger } from "@open-hrms/ui/tabs";

const CATEGORIES = [
  "TRAVEL",
  "INTERNET_WFH",
  "EQUIPMENT",
  "FOOD",
  "CLIENT_MEETING",
  "TRAINING",
  "OTHER",
] as const;

type ReimbursementStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAID";
type Decision = "APPROVED" | "REJECTED" | "PAID";

interface Reimbursement {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  category: string;
  amount: number;
  expenseDate: string;
  description: string;
  receiptFilename: string | null;
  receiptOriginalName: string | null;
  status: ReimbursementStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string;
  createdAt: string;
}

const STATUS_VARIANT: Record<ReimbursementStatus, "green" | "amber" | "red"> = {
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
  PAID: "green",
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

function categoryLabel(c: string): string {
  return c
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function SubmitClaimDialog({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("TRAVEL");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);

  const reset = () => {
    setCategory("TRAVEL");
    setAmount("");
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setDescription("");
    setReceipt(null);
  };

  const submit = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("category", category);
      fd.append("amount", amount);
      fd.append("expenseDate", expenseDate);
      fd.append("description", description);
      if (receipt) fd.append("receipt", receipt);
      return api.post("/reimbursements", fd).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success("Claim submitted");
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
      setOpen(false);
      reset();
      onDone();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> New claim
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit reimbursement claim</DialogTitle>
            <DialogDescription>
              Claim an expense you&apos;ve paid for. Attach a receipt to speed up approval.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(amount);
              if (!n || n <= 0) {
                toast.error("Enter a positive amount");
                return;
              }
              submit.mutate();
            }}
            className="space-y-4"
          >
            <FormGrid columns={2}>
              <Field label="Category">
                <Select
                  items={CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }))}
                  value={category}
                  onValueChange={(v) => setCategory(v ?? "TRAVEL")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {categoryLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Amount (₹)" htmlFor="amount">
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            </FormGrid>
            <Field label="Expense date" htmlFor="expenseDate">
              <Input
                id="expenseDate"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </Field>
            <Field label="Description" htmlFor="description">
              <Textarea
                id="description"
                rows={3}
                placeholder="What was this expense for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label="Receipt (optional)" htmlFor="receipt" hint={receipt?.name}>
              <Input
                id="receipt"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submit.isPending}>
                {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Scope = "mine" | "team";

export default function ReimbursementsPage() {
  const qc = useQueryClient();
  const { user, isStaff } = useAuth();
  const isManager = !!user?.hasReports && !isStaff;
  const [scope, setScope] = useState<Scope>("mine");
  const [statusFilter, setStatusFilter] = useState<ReimbursementStatus | "ALL">("ALL");

  const { data: claims = [], isLoading } = useQuery({
    queryKey: ["reimbursements", scope],
    queryFn: () =>
      http.get<Reimbursement[]>("/reimbursements", scope === "team" ? { scope: "team" } : undefined),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: Decision }) =>
      http.post(`/reimbursements/${id}/decide`, { decision }),
    onSuccess: (_d, vars) => {
      toast.success(`Claim ${vars.decision.toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => http.del(`/reimbursements/${id}`),
    onSuccess: () => {
      toast.success("Claim cancelled");
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const filtered = useMemo(
    () => (statusFilter === "ALL" ? claims : claims.filter((c) => c.status === statusFilter)),
    [claims, statusFilter]
  );

  const isTeamView = isManager && scope === "team";
  // Team view always shows the employee column; staff view shows it too.
  const showEmployee = isStaff || isTeamView;
  const colSpan = showEmployee ? 7 : 6;

  return (
    <>
      <PageHeader
        title="Reimbursements"
        description={isStaff ? "Review and settle employee expense claims." : "Submit and track your expense claims."}
        actions={isTeamView ? undefined : <SubmitClaimDialog onDone={() => setStatusFilter("ALL")} />}
      />

      {isManager && (
        <Tabs
          value={scope}
          onValueChange={(v) => {
            setScope(v as Scope);
            setStatusFilter("ALL");
          }}
          className="mb-4"
        >
          <TabsList>
            <TabsTrigger value="mine">My claims</TabsTrigger>
            <TabsTrigger value="team">My team</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as ReimbursementStatus | "ALL")} className="mb-4">
        <TabsList>
          <TabsTrigger value="ALL">All</TabsTrigger>
          <TabsTrigger value="PENDING">Pending</TabsTrigger>
          <TabsTrigger value="APPROVED">Approved</TabsTrigger>
          <TabsTrigger value="PAID">Paid</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {showEmployee && <TableHead>Employee</TableHead>}
              <TableHead>Category</TableHead>
              <TableHead className="hidden md:table-cell">Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="hidden sm:table-cell">Date</TableHead>
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
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-muted-foreground">
                  No claims to show.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow key={c.id}>
                  {showEmployee && (
                    <TableCell>
                      <div className="font-medium">{c.employeeName}</div>
                      <div className="text-xs text-muted-foreground">{c.employeeCode}</div>
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge variant="grey">{categoryLabel(c.category)}</Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate md:table-cell text-sm text-muted-foreground">
                    {c.description || "-"}
                    {c.note ? <span className="block text-xs italic">Note: {c.note}</span> : null}
                  </TableCell>
                  <TableCell className="text-right font-medium">{inr.format(c.amount)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{c.expenseDate}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {c.receiptFilename && !isTeamView && (
                        // Fetched through the API client rather than a plain link: the
                        // receipt route needs the bearer token, which an <a href> never sends.
                        <button
                          type="button"
                          onClick={() =>
                            downloadFile(`/reimbursements/${c.id}/receipt`, c.receiptOriginalName || "receipt").catch((e) =>
                              toast.error(apiError(e))
                            )
                          }
                          className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[0.8rem] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Paperclip className="size-4" /> Receipt
                        </button>
                      )}
                      {isStaff && c.status === "PENDING" && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: c.id, decision: "APPROVED" })}
                          >
                            <Check className="mr-1 size-4" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: c.id, decision: "REJECTED" })}
                          >
                            <X className="mr-1 size-4" /> Reject
                          </Button>
                        </>
                      )}
                      {isStaff && c.status === "APPROVED" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: c.id, decision: "PAID" })}
                        >
                          <Banknote className="mr-1 size-4" /> Mark paid
                        </Button>
                      )}
                      {isTeamView && c.status === "PENDING" && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: c.id, decision: "APPROVED" })}
                          >
                            <Check className="mr-1 size-4" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: c.id, decision: "REJECTED" })}
                          >
                            <X className="mr-1 size-4" /> Reject
                          </Button>
                        </>
                      )}
                      {!isStaff && !isTeamView && c.status === "PENDING" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(c.id)}
                        >
                          <Trash2 className="mr-1 size-4" /> Cancel
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
