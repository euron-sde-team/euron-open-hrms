"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Laptop, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Checkbox } from "@open-hrms/ui/checkbox";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@open-hrms/ui/dropdown-menu";

// --- Local types (mirror the assets.routes.js contract) ---------------------

type AssetStatus = "PROVISIONED" | "IN_USE" | "SUBMITTED" | "RETURNED" | "LOST";

interface Asset {
  id: string;
  employeeId: string;
  employeeName?: string;
  category: string;
  name: string;
  serial: string;
  condition: string;
  status: AssetStatus;
  assignedAt: string | null;
  acknowledgedAt: string | null;
  returnedAt: string | null;
  notes: string;
  createdAt?: string;
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName?: string;
  code?: string;
}

const CATEGORIES = ["LAPTOP", "MONITOR", "PHONE", "ACCESS_CARD", "HEADSET", "SIM", "OTHER"] as const;

const STATUS_VARIANT: Record<AssetStatus, "green" | "amber" | "red" | "blue" | "grey" | "violet"> = {
  PROVISIONED: "amber",
  IN_USE: "green",
  SUBMITTED: "blue",
  RETURNED: "grey",
  LOST: "red",
};

function prettyLabel(s: string): string {
  return s
    .split("_")
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(" ");
}

function formatDate(d: string | null): string {
  if (!d) return "-";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

// --- Provision dialog (staff) -----------------------------------------------

function ProvisionDialog({
  open,
  onOpenChange,
  employees,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employees: EmployeeOption[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    employeeId: "",
    category: "LAPTOP",
    name: "",
    serial: "",
    condition: "New",
    notes: "",
  });
  const set = (k: keyof typeof form, v: string | null) =>
    setForm((f) => ({ ...f, [k]: v ?? "" }));

  const employeeItems = employees.map((e) => ({
    value: e.id,
    label: `${e.firstName} ${e.lastName ?? ""}`.trim() + (e.code ? ` · ${e.code}` : ""),
  }));

  const create = useMutation({
    mutationFn: () => http.post<Asset>("/assets", form),
    onSuccess: () => {
      toast.success("Asset provisioned");
      qc.invalidateQueries({ queryKey: ["assets"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Provision asset</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Employee">
            <Select items={employeeItems} value={form.employeeId} onValueChange={(v) => set("employeeId", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employeeItems.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <FormGrid columns={2}>
            <Field label="Category">
              <Select
                items={CATEGORIES.map((c) => ({ value: c, label: prettyLabel(c) }))}
                value={form.category}
                onValueChange={(v) => set("category", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {prettyLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Condition">
              <Input value={form.condition} onChange={(e) => set("condition", e.target.value)} />
            </Field>
          </FormGrid>
          <Field label="Name">
            <Input
              required
              placeholder="MacBook Pro 14-inch"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Serial number">
            <Input value={form.serial} onChange={(e) => set("serial", e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !form.employeeId}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Provision
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Return dialog (staff) --------------------------------------------------

function ReturnDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: Asset | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [condition, setCondition] = useState("");
  const [lost, setLost] = useState(false);

  const submit = useMutation({
    mutationFn: () =>
      http.post<Asset>(`/assets/${asset!.id}/return`, { lost, condition: condition || undefined }),
    onSuccess: () => {
      toast.success(lost ? "Asset marked lost" : "Return accepted");
      qc.invalidateQueries({ queryKey: ["assets"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!asset) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Accept return · {asset.name}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Condition on return">
            <Input
              placeholder={asset.condition}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            />
          </Field>
          <Label className="text-sm">
            <Checkbox checked={lost} onCheckedChange={(v) => setLost(v === true)} />
            Mark as lost instead of returned
          </Label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={lost ? "destructive" : "default"} disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {lost ? "Mark lost" : "Accept return"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Submit dialog (employee) -----------------------------------------------

function SubmitDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: Asset | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      http.post<Asset>(`/assets/${asset!.id}/submit`, {
        condition: condition || undefined,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success("Asset submitted for return");
      qc.invalidateQueries({ queryKey: ["assets"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!asset) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Return {asset.name}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Current condition">
            <Input
              placeholder={asset.condition}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            />
          </Field>
          <Field label="Notes">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
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

// --- Page -------------------------------------------------------------------

export default function AssetsPage() {
  const qc = useQueryClient();
  const { isStaff } = useAuth();
  const [statusFilter, setStatusFilter] = useState("all");
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [returnAsset, setReturnAsset] = useState<Asset | null>(null);
  const [submitAsset, setSubmitAsset] = useState<Asset | null>(null);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets", statusFilter],
    queryFn: () =>
      http.get<Asset[]>("/assets", statusFilter !== "all" ? { status: statusFilter } : undefined),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees", "asset-options"],
    queryFn: () => http.get<EmployeeOption[]>("/employees"),
    enabled: isStaff,
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => http.post<Asset>(`/assets/${id}/acknowledge`, {}),
    onSuccess: () => {
      toast.success("Receipt acknowledged");
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const colSpan = isStaff ? 7 : 6;

  return (
    <>
      <PageHeader
        title="Assets"
        description={
          isStaff
            ? "Company asset register, provision and track devices assigned to employees."
            : "Devices and equipment assigned to you."
        }
        actions={
          isStaff ? (
            <Button onClick={() => setProvisionOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Provision asset
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Select
          items={[
            { value: "all", label: "All statuses" },
            ...(Object.keys(STATUS_VARIANT) as AssetStatus[]).map((s) => ({ value: s, label: prettyLabel(s) })),
          ]}
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v ?? "all")}
        >
          <SelectTrigger className="sm:w-56">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_VARIANT) as AssetStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {prettyLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              {isStaff && <TableHead className="hidden md:table-cell">Assigned to</TableHead>}
              <TableHead className="hidden sm:table-cell">Serial</TableHead>
              <TableHead className="hidden lg:table-cell">Assigned</TableHead>
              <TableHead className="hidden lg:table-cell">Condition</TableHead>
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
            ) : assets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-muted-foreground">
                  <Laptop className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  {isStaff ? "No assets provisioned yet." : "No assets assigned to you."}
                </TableCell>
              </TableRow>
            ) : (
              assets.map((a) => {
                const isMine = !isStaff;
                const canAck = a.status === "PROVISIONED";
                const canSubmit = a.status === "PROVISIONED" || a.status === "IN_USE";
                const canReturn = a.status === "SUBMITTED" || a.status === "IN_USE" || a.status === "PROVISIONED";
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{prettyLabel(a.category)}</div>
                    </TableCell>
                    {isStaff && (
                      <TableCell className="hidden md:table-cell">{a.employeeName || "Unassigned"}</TableCell>
                    )}
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                      {a.serial || "-"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {formatDate(a.assignedAt)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {a.condition || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[a.status] || "grey"}>{prettyLabel(a.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {isMine ? (
                        <div className="flex justify-end gap-1">
                          {canAck && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={acknowledge.isPending}
                              onClick={() => acknowledge.mutate(a.id)}
                            >
                              Acknowledge
                            </Button>
                          )}
                          {canSubmit && (
                            <Button size="sm" variant="ghost" onClick={() => setSubmitAsset(a)}>
                              Return
                            </Button>
                          )}
                        </div>
                      ) : (
                        canReturn && (
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted">
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setReturnAsset(a)}>
                                Accept return
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setReturnAsset(a)}
                              >
                                Mark lost
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {isStaff && provisionOpen && (
        <ProvisionDialog open={provisionOpen} onOpenChange={setProvisionOpen} employees={employees} />
      )}
      {isStaff && (
        <ReturnDialog
          key={returnAsset?.id ?? "none"}
          asset={returnAsset}
          open={!!returnAsset}
          onOpenChange={(o) => !o && setReturnAsset(null)}
        />
      )}
      {!isStaff && (
        <SubmitDialog
          key={submitAsset?.id ?? "none"}
          asset={submitAsset}
          open={!!submitAsset}
          onOpenChange={(o) => !o && setSubmitAsset(null)}
        />
      )}
    </>
  );
}
