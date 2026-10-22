"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canChangeOperatorStatus, canOperate } from "@/lib/roles";
import type { Operator } from "@open-hrms/types";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { PasswordInput } from "@open-hrms/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@open-hrms/ui/select";
import { Label } from "@open-hrms/ui/label";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@open-hrms/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@open-hrms/ui/dialog";

const ROLE_ITEMS = [
  { value: "OPERATOR", label: "Operator" },
  { value: "SUPPORT", label: "Support (read-only)" },
];

function fmtDate(s?: string) {
  if (!s) return "-";
  try { return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return s; }
}

function NewOperatorDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "OPERATOR" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () => http.post<Operator>("/platform/admins", form),
    onSuccess: () => {
      toast.success("Operator created");
      qc.invalidateQueries({ queryKey: ["operators"] });
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "OPERATOR" });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> New operator</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New operator</DialogTitle>
            <DialogDescription>Operators manage customer workspaces. They sign in to this console only.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="op-name">Name</Label>
              <Input id="op-name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="op-email">Email</Label>
              <Input id="op-email" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="op-pw">Password</Label>
                <PasswordInput id="op-pw" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => set("password", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="op-role">Role</Label>
                <Select items={ROLE_ITEMS} value={form.role} onValueChange={(v) => set("role", String(v))}>
                  <SelectTrigger id="op-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_ITEMS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">At least 8 characters. The operator can change it after signing in.</p>
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

export default function OperatorsPage() {
  const { admin } = useAuth();
  // SUPPORT operators get a read-only view: the API refuses their writes.
  const writable = canOperate(admin);
  const qc = useQueryClient();

  const { data: operators = [], isLoading } = useQuery({
    queryKey: ["operators"],
    queryFn: () => http.get<Operator[]>("/platform/admins"),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      http.post(`/platform/admins/${id}/status`, { status }),
    onSuccess: (_d, v) => {
      toast.success(v.status === "DISABLED" ? "Operator disabled" : "Operator enabled");
      qc.invalidateQueries({ queryKey: ["operators"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <PageHeader
        title="Operators"
        description="Operator accounts with access to this console."
        actions={
          writable ? (
            <NewOperatorDialog />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> read-only (Support role)
            </span>
          )
        }
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operator</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Added</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))
            ) : operators.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No operators.</TableCell></TableRow>
            ) : (
              operators.map((op) => {
                const isMe = op.id === admin?.id;
                const disabled = op.status === "DISABLED";
                return (
                  <TableRow key={op.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <ShieldCheck className="h-4 w-4 text-primary" /> {op.name}
                        {isMe && <span className="text-xs text-muted-foreground">(you)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{op.email}</div>
                    </TableCell>
                    <TableCell className="text-sm">{op.role}</TableCell>
                    <TableCell>
                      <Badge variant={disabled ? "destructive" : "default"}>{(op.status || "ACTIVE").toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{fmtDate(op.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {!canChangeOperatorStatus(admin, op) ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : (
                        <Button
                          size="sm"
                          variant={disabled ? "default" : "outline"}
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ id: op.id, status: disabled ? "ACTIVE" : "DISABLED" })}
                        >
                          {disabled ? "Enable" : "Disable"}
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
    </>
  );
}
