"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal, PauseCircle, PlayCircle, Search, Loader2, KeyRound, LogIn, Download, Plus,
  Trash2, AlertTriangle, ChevronLeft, ChevronRight, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { buildImpersonationUrl } from "@open-hrms/api-client";
import { http, apiError, downloadFile } from "@/lib/api";
import type { ImpersonationResponse, Tenant, TenantDetail, TenantUser, FleetActivity } from "@open-hrms/types";
import { useAuth } from "@/lib/auth";
import { canOperate } from "@/lib/roles";
import { actionMeta } from "@/lib/activity";
import { tenantUrl } from "@/lib/runtime-env";
import { PageHeader } from "@open-hrms/ui/page-header";
import { StarterContentSection } from "@/components/starter-content-section";
import { Input } from "@open-hrms/ui/input";
import { Textarea } from "@open-hrms/ui/textarea";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Label } from "@open-hrms/ui/label";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Button } from "@open-hrms/ui/button";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Separator } from "@open-hrms/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@open-hrms/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@open-hrms/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@open-hrms/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@open-hrms/ui/dropdown-menu";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "default",
  SUSPENDED: "destructive",
  PENDING_VERIFICATION: "secondary",
  CANCELLED: "outline",
};

const PAGE_SIZE = 20;

type StatusAction = "suspend" | "reactivate";

function fmtDate(s?: string) {
  if (!s) return "-";
  try { return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return s; }
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[10.5px] uppercase leading-tight tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

/** Small reusable confirm dialog with an optional reason, recorded in the audit log. */
function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) setReason(""); }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="action-reason">Reason (optional)</Label>
          <Textarea
            id="action-reason"
            rows={3}
            placeholder="Why are you doing this? (recorded in the audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={() => onConfirm(reason)}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteWorkspaceDialog({
  tenant,
  status,
  onDeleted,
}: {
  tenant: Tenant;
  status: string;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");
  const canDelete = status === "SUSPENDED";

  const del = useMutation({
    mutationFn: () => http.del(`/platform/tenants/${tenant.id}`, { confirmName, reason }),
    onSuccess: () => {
      toast.success("Workspace deleted");
      qc.invalidateQueries({ queryKey: ["tenants"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      setOpen(false);
      onDeleted();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4" /> Danger zone
      </div>
      <p className="mb-3 text-[12.5px] text-muted-foreground">
        Permanently delete this workspace and all of its data. This cannot be undone.
      </p>
      {!canDelete && (
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          Suspend the workspace first: only suspended workspaces can be deleted.
        </p>
      )}
      <Button
        size="sm"
        variant="destructive"
        disabled={!canDelete}
        onClick={() => { setConfirmName(""); setReason(""); setOpen(true); }}
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete workspace
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {tenant.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the workspace and all its data. Type the exact workspace name to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="confirm-name">
                Type <span className="font-mono font-semibold text-foreground">{tenant.name}</span> to confirm
              </Label>
              <Input
                id="confirm-name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={tenant.name}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-reason">Reason (optional)</Label>
              <Textarea
                id="delete-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Recorded in the audit log"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={del.isPending || confirmName !== tenant.name}
              onClick={() => del.mutate()}
            >
              {del.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkspaceDetail({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const qc = useQueryClient();
  const id = tenant.id;
  const { admin } = useAuth();
  const isOperator = canOperate(admin);

  const [confirm, setConfirm] = useState<null | StatusAction | "admin-reset" | "impersonate">(null);

  const { data: detail } = useQuery({ queryKey: ["ws-detail", id], queryFn: () => http.get<TenantDetail>(`/platform/tenants/${id}`) });
  const { data: users = [] } = useQuery({ queryKey: ["ws-users", id], queryFn: () => http.get<TenantUser[]>(`/platform/tenants/${id}/users`) });
  const { data: activity = [] } = useQuery({ queryKey: ["ws-activity", id], queryFn: () => http.get<FleetActivity[]>(`/platform/tenants/${id}/activity`) });

  const status = detail?.org.status ?? tenant.status;

  const setStatus = useMutation({
    mutationFn: ({ action, reason }: { action: StatusAction; reason: string }) =>
      http.post(`/platform/tenants/${id}/${action}`, { reason }),
    onSuccess: (_d, v) => {
      toast.success(v.action === "suspend" ? "Workspace suspended" : "Workspace reactivated");
      qc.invalidateQueries({ queryKey: ["tenants"] });
      qc.invalidateQueries({ queryKey: ["ws-detail", id] });
      qc.invalidateQueries({ queryKey: ["ws-activity", id] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      setConfirm(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const adminReset = useMutation({
    mutationFn: (reason: string) => http.post<{ to: string; mode: string }>(`/platform/tenants/${id}/admin-reset`, { reason }),
    onSuccess: (r) => {
      toast.success(`Reset link sent to ${r.to} (${r.mode})`);
      qc.invalidateQueries({ queryKey: ["ws-activity", id] });
      setConfirm(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const impersonate = useMutation({
    mutationFn: (reason: string) =>
      http.post<ImpersonationResponse>(`/platform/tenants/${id}/impersonate`, { reason }),
    onSuccess: (r) => {
      // Open the tenant app as a support session. The token travels only in the URL
      // fragment of the new tab (see buildImpersonationUrl); it is deliberately NOT
      // put on the clipboard, where it would outlive the session and leak to other apps.
      window.open(buildImpersonationUrl(tenantUrl(), r.token), "_blank", "noopener,noreferrer");
      toast.success(`Opening ${r.impersonating.orgName} as ${r.impersonating.userEmail}`);
      setConfirm(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  async function exportData() {
    try {
      await downloadFile(`/platform/tenants/${id}/export`, `${tenant.slug}-export.json`);
      toast.success("Export downloaded");
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>{tenant.name}</SheetTitle>
            <Badge variant={STATUS_VARIANT[status] || "outline"}>{status?.toLowerCase()}</Badge>
          </div>
          <SheetDescription>
            {tenant.slug}{tenant.country ? ` · ${tenant.country}` : ""} · {detail?.org.signupSource ?? tenant.signupSource} · created {fmtDate(detail?.org.createdAt ?? tenant.createdAt)}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {/* Metrics */}
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Employees" value={detail?.metrics.employees ?? tenant.employees} />
            <Metric label="Users" value={detail?.metrics.users ?? tenant.users} />
            <Metric label="Departments" value={detail?.metrics.departments ?? 0} />
            <Metric label="Exited" value={detail?.metrics.exited ?? 0} />
            <Metric label="Pending users" value={detail?.metrics.pendingUsers ?? 0} />
          </div>

          {/* Actions */}
          {isOperator ? (
            <div className="flex flex-wrap gap-2">
              {status === "SUSPENDED" ? (
                <Button size="sm" onClick={() => setConfirm("reactivate")} disabled={setStatus.isPending}>
                  <PlayCircle className="mr-1.5 h-3.5 w-3.5" /> Reactivate
                </Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={() => setConfirm("suspend")} disabled={setStatus.isPending}>
                  <PauseCircle className="mr-1.5 h-3.5 w-3.5" /> Suspend
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setConfirm("impersonate")} disabled={impersonate.isPending}>
                <LogIn className="mr-1.5 h-3.5 w-3.5" /> Impersonate
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirm("admin-reset")} disabled={adminReset.isPending}>
                <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Admin reset
              </Button>
              <Button size="sm" variant="outline" onClick={exportData}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={exportData}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export
              </Button>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> read-only (Support role)
              </span>
            </div>
          )}

          <Separator />

          {/* Starter content: repair a tenant created outside provisioning */}
          <StarterContentSection orgId={id} canApply={isOperator} />

          <Separator />

          {/* Users */}
          <div>
            <div className="mb-2 text-sm font-semibold">Users ({users.length})</div>
            <div className="space-y-1.5">
              {users.length === 0 ? (
                <div className="text-xs text-muted-foreground">No users.</div>
              ) : users.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{u.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{u.email}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{u.role}</span>
                    <Badge variant={STATUS_VARIANT[u.status] || "outline"} className="text-[10px]">{u.status?.toLowerCase()}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Activity */}
          <div>
            <div className="mb-2 text-sm font-semibold">Recent activity</div>
            {activity.length === 0 ? (
              <div className="text-xs text-muted-foreground">No recent activity.</div>
            ) : (
              <ul className="space-y-1.5">
                {activity.slice(0, 20).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 border-b border-border/60 pb-1.5 text-[12.5px] last:border-0">
                    <span>{actionMeta(a.action).label}{a.actor ? ` · ${a.actor}` : ""}</span>
                    <span className="shrink-0 text-muted-foreground">{fmtDate(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Danger zone, OPERATOR only */}
          {isOperator && (
            <>
              <Separator />
              <DeleteWorkspaceDialog tenant={tenant} status={status} onDeleted={onClose} />
            </>
          )}
        </div>
      </SheetContent>

      {/* Confirm dialogs */}
      <ConfirmActionDialog
        open={confirm === "suspend"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Suspend ${tenant.name}?`}
        description="The workspace and its users lose access until reactivated."
        confirmLabel="Suspend"
        destructive
        busy={setStatus.isPending}
        onConfirm={(reason) => setStatus.mutate({ action: "suspend", reason })}
      />
      <ConfirmActionDialog
        open={confirm === "reactivate"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Reactivate ${tenant.name}?`}
        description="The workspace and its users get their access back immediately."
        confirmLabel="Reactivate"
        busy={setStatus.isPending}
        onConfirm={(reason) => setStatus.mutate({ action: "reactivate", reason })}
      />
      <ConfirmActionDialog
        open={confirm === "admin-reset"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Reset admin for ${tenant.name}?`}
        description="Sends a set-password reset to the workspace's primary admin."
        confirmLabel="Send reset"
        busy={adminReset.isPending}
        onConfirm={(reason) => adminReset.mutate(reason)}
      />
      <ConfirmActionDialog
        open={confirm === "impersonate"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Impersonate ${tenant.name}?`}
        description="Opens the tenant app in an operator support session. This is audited."
        confirmLabel="Impersonate"
        busy={impersonate.isPending}
        onConfirm={(reason) => impersonate.mutate(reason)}
      />
    </Sheet>
  );
}

function CreateWorkspaceDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ companyName: "", adminName: "", email: "", country: "IN", sendInvite: true });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () => http.post("/platform/tenants", form),
    onSuccess: () => {
      toast.success("Workspace created");
      qc.invalidateQueries({ queryKey: ["tenants"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      setOpen(false);
      setForm({ companyName: "", adminName: "", email: "", country: "IN", sendInvite: true });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> New workspace</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>Provision a customer workspace and its first admin. The admin gets a set-password invite by default.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ws-company">Company name</Label>
              <Input id="ws-company" required value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ws-admin">Admin name</Label>
                <Input id="ws-admin" value={form.adminName} onChange={(e) => set("adminName", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ws-country">Country</Label>
                <Input id="ws-country" value={form.country} onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-email">Admin email</Label>
              <Input id="ws-email" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <Label className="gap-3 font-normal text-muted-foreground">
              <Checkbox checked={form.sendInvite} onCheckedChange={(v) => set("sendInvite", v === true)} />
              Email the admin a set-password invite
            </Label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function WorkspacesPage() {
  const qc = useQueryClient();
  const { admin } = useAuth();
  const isOperator = canOperate(admin);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Tenant | null>(null);
  const [rowConfirm, setRowConfirm] = useState<{ tenant: Tenant; action: StatusAction } | null>(null);

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => http.get<Tenant[]>("/platform/tenants"),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: StatusAction; reason: string }) =>
      http.post(`/platform/tenants/${id}/${action}`, { reason }),
    onSuccess: (_d, v) => {
      toast.success(v.action === "suspend" ? "Workspace suspended" : "Workspace reactivated");
      qc.invalidateQueries({ queryKey: ["tenants"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
      setRowConfirm(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const filtered = useMemo(
    () =>
      tenants.filter((t) =>
        q ? `${t.name} ${t.slug} ${t.country ?? ""}`.toLowerCase().includes(q.toLowerCase()) : true
      ),
    [tenants, q]
  );

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  function onSearch(value: string) {
    setQ(value);
    setPage(0);
  }

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="All customer workspaces on the platform. Click a row for details."
        actions={isOperator ? <CreateWorkspaceDialog /> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search workspaces..." value={q} onChange={(e) => onSearch(e.target.value)} />
        </div>
        {!isOperator && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> read-only (Support role)
          </span>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead className="hidden sm:table-cell">Employees</TableHead>
              <TableHead className="hidden md:table-cell">Users</TableHead>
              <TableHead className="hidden lg:table-cell">Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No workspaces found.</TableCell>
              </TableRow>
            ) : (
              pageRows.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(t)}
                >
                  <TableCell>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.slug}{t.country ? ` · ${t.country}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{t.employees}</TableCell>
                  <TableCell className="hidden md:table-cell">{t.users}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{t.signupSource}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[t.status] || "outline"}>{t.status?.toLowerCase()}</Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted">
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setSelected(t)}>View details</DropdownMenuItem>
                        {isOperator && (
                          t.status === "SUSPENDED" ? (
                            <DropdownMenuItem onClick={() => setRowConfirm({ tenant: t, action: "reactivate" })}>
                              <PlayCircle className="mr-2 h-4 w-4" /> Reactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setRowConfirm({ tenant: t, action: "suspend" })}
                            >
                              <PauseCircle className="mr-2 h-4 w-4" /> Suspend
                            </DropdownMenuItem>
                          )
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      {!isLoading && total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{start + 1} to {Math.min(start + PAGE_SIZE, total)} of {total}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Prev
            </Button>
            <span className="text-xs">Page {safePage + 1} / {pageCount}</span>
            <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
              Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {selected && <WorkspaceDetail tenant={selected} onClose={() => setSelected(null)} />}

      {/* Row-level suspend / reactivate confirm */}
      {rowConfirm && (
        <ConfirmActionDialog
          open
          onOpenChange={(o) => !o && setRowConfirm(null)}
          title={`${rowConfirm.action === "suspend" ? "Suspend" : "Reactivate"} ${rowConfirm.tenant.name}?`}
          description={
            rowConfirm.action === "suspend"
              ? "The workspace and its users lose access until reactivated."
              : "The workspace and its users get their access back immediately."
          }
          confirmLabel={rowConfirm.action === "suspend" ? "Suspend" : "Reactivate"}
          destructive={rowConfirm.action === "suspend"}
          busy={setStatus.isPending}
          onConfirm={(reason) => setStatus.mutate({ id: rowConfirm.tenant.id, action: rowConfirm.action, reason })}
        />
      )}
    </>
  );
}
