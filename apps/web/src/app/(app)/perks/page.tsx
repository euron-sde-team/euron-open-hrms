"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gift, Ticket, Plus, Loader2, Check, Sparkles } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@open-hrms/ui/card";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Skeleton } from "@open-hrms/ui/skeleton";
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

// ── Local types (backend contract) ──────────────────────────────────────────
type PerkType = "GOODIE" | "COUPON";
type PerkStatus = "ALLOCATED" | "CLAIMED";

interface Perk {
  id: string;
  employeeId: string;
  employeeName: string;
  type: PerkType;
  item: string;
  code: string;
  status: PerkStatus;
  expiresAt: string | null;
  claimedAt?: string | null;
  createdAt?: string;
}

type DistributeForm = {
  type: PerkType;
  item: string;
  code: string;
  expiresAt: string;
  all: boolean;
  employeeId: string;
};

function emptyForm(): DistributeForm {
  return { type: "GOODIE", item: "", code: "", expiresAt: "", all: true, employeeId: "" };
}

// ── Distribute dialog (staff) ────────────────────────────────────────────────
function DistributeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<DistributeForm>(emptyForm());
  const set = (k: keyof DistributeForm, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => http.get<Employee[]>("/employees"),
    enabled: open,
  });
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status !== "EXITED"),
    [employees]
  );

  const save = useMutation({
    mutationFn: () =>
      http.post<{ ok: boolean; distributed: number }>("/perks", {
        type: form.type,
        item: form.item,
        code: form.type === "COUPON" ? form.code : "",
        expiresAt: form.expiresAt || null,
        all: form.all,
        employeeIds: form.all || !form.employeeId ? [] : [form.employeeId],
      }),
    onSuccess: (res) => {
      toast.success(`Distributed to ${res.distributed} employee${res.distributed === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["perks"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Distribute a perk</DialogTitle>
          <DialogDescription>
            Send a goodie or coupon to the team. Coupons can carry a redeemable code.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <FormGrid columns={2}>
            <Field label="Type">
              <Select
                items={{ GOODIE: "Goodie", COUPON: "Coupon" }}
                value={form.type}
                onValueChange={(v) => set("type", v as PerkType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GOODIE">Goodie</SelectItem>
                  <SelectItem value="COUPON">Coupon</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Item">
              <Input
                required
                placeholder={form.type === "COUPON" ? "₹2,000 Amazon voucher" : "Welcome kit / T-shirt"}
                value={form.item}
                onChange={(e) => set("item", e.target.value)}
              />
            </Field>

            {form.type === "COUPON" && (
              <Field
                label={
                  <>
                    Coupon code{" "}
                    <span className="font-normal text-muted-foreground">
                      (blank = auto-generated)
                    </span>
                  </>
                }
              >
                <Input value={form.code} onChange={(e) => set("code", e.target.value)} />
              </Field>
            )}

            <Field
              label={
                <>
                  Expires <span className="font-normal text-muted-foreground">(optional)</span>
                </>
              }
            >
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) => set("expiresAt", e.target.value)}
              />
            </Field>
          </FormGrid>

          <Label className="text-sm">
            <Checkbox checked={form.all} onCheckedChange={(v) => set("all", !!v)} />
            Give to <b>all active employees</b>
          </Label>

          {!form.all && (
            <Field label="Employee">
              <Select
                items={activeEmployees.map((e) => ({
                  value: e.id,
                  label: `${e.firstName} ${e.lastName ?? ""}`.trim() + ` · ${e.code}`,
                }))}
                value={form.employeeId}
                onValueChange={(v) => set("employeeId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick an employee" />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.firstName} {e.lastName ?? ""} · {e.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || (!form.all && !form.employeeId)}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Distribute
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Perk card ────────────────────────────────────────────────────────────────
function PerkCard({
  perk,
  isStaff,
  onClaim,
  claiming,
}: {
  perk: Perk;
  isStaff: boolean;
  onClaim: (id: string) => void;
  claiming: boolean;
}) {
  const isCoupon = perk.type === "COUPON";
  const claimed = perk.status === "CLAIMED";
  return (
    <Card className="flex flex-col">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {isCoupon ? <Ticket className="h-5 w-5" /> : <Gift className="h-5 w-5" />}
          </div>
          <Badge variant={claimed ? "green" : "amber"}>
            {claimed ? "Claimed" : "Allocated"}
          </Badge>
        </div>
        <CardTitle className="text-base">{perk.item}</CardTitle>
      </CardHeader>
      <CardContent className="mt-auto space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={isCoupon ? "blue" : "violet"}>{isCoupon ? "Coupon" : "Goodie"}</Badge>
          {isStaff && <span>For {perk.employeeName}</span>}
          {perk.expiresAt && <span>· Expires {new Date(perk.expiresAt).toLocaleDateString()}</span>}
        </div>

        {/* Coupon codes have to be readable in full, so wrap rather than truncate. */}
        {isCoupon && perk.code && (
          <div className="rounded-md border border-dashed px-3 py-2 font-mono text-sm break-all">{perk.code}</div>
        )}

        {!isStaff &&
          (claimed ? (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="h-4 w-4" /> Claimed
            </div>
          ) : (
            <Button
              size="sm"
              className="w-full"
              disabled={claiming}
              onClick={() => onClaim(perk.id)}
            >
              {claiming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Claim
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PerksPage() {
  const qc = useQueryClient();
  const { isStaff } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: perks = [], isLoading } = useQuery({
    queryKey: ["perks"],
    queryFn: () => http.get<Perk[]>("/perks"),
  });

  const claim = useMutation({
    mutationFn: (id: string) => http.post<Perk>(`/perks/${id}/claim`, {}),
    onSuccess: () => {
      toast.success("Perk claimed");
      qc.invalidateQueries({ queryKey: ["perks"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <PageHeader
        title="Perks &amp; rewards"
        description={
          isStaff
            ? "Distribute goodies and coupons to the team and track what's been claimed."
            : "Goodies and coupons given to you. Claim them before they expire."
        }
        actions={
          isStaff ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Distribute perk
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="space-y-3">
                <Skeleton className="h-9 w-9 rounded-md" />
                <Skeleton className="h-5 w-3/4" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : perks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Sparkles className="h-8 w-8" />
            <p>
              {isStaff ? "Nothing distributed yet." : "No perks yet, check back soon."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {perks.map((perk) => (
            <PerkCard
              key={perk.id}
              perk={perk}
              isStaff={isStaff}
              onClaim={(id) => claim.mutate(id)}
              claiming={claim.isPending && claim.variables === perk.id}
            />
          ))}
        </div>
      )}

      {dialogOpen && <DistributeDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </>
  );
}
