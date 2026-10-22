"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Mail } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { mailToast, type MailResult } from "@/lib/mail";
import type { Vendor } from "@open-hrms/types";
import { PageHeader } from "@open-hrms/ui/page-header";
import { PhoneField, joinPhone, splitPhone } from "@/components/phone-field";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Skeleton } from "@open-hrms/ui/skeleton";
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

const VENDOR_TYPES = ["VENDOR", "CONSULTANT", "PROVIDER", "CONTRACTOR"];
const VENDOR_TYPE_ITEMS = VENDOR_TYPES.map((t) => ({
  value: t,
  label: t.charAt(0) + t.slice(1).toLowerCase(),
}));

type VendorForm = {
  name: string;
  type: string;
  email: string;
  dialCode: string;
  phone: string;
  company: string;
  gstin: string;
  pan: string;
  services: string;
  bankAccount: string;
  bankIfsc: string;
  bankPaypal: string;
  sendInvite: boolean;
};

function emptyForm(): VendorForm {
  return {
    name: "", type: "VENDOR", email: "", dialCode: "+91", phone: "", company: "", gstin: "", pan: "",
    services: "", bankAccount: "", bankIfsc: "", bankPaypal: "", sendInvite: true,
  };
}

function fromVendor(v: Vendor): VendorForm {
  const p = splitPhone(v.phone);
  return {
    name: v.name ?? "", type: v.type ?? "VENDOR", email: v.email ?? "", dialCode: p.dialCode, phone: p.number,
    company: v.company ?? "", gstin: v.gstin ?? "", pan: v.pan ?? "", services: v.services ?? "",
    bankAccount: v.bank?.account ?? "", bankIfsc: v.bank?.ifsc ?? "", bankPaypal: v.bank?.paypal ?? "",
    sendInvite: false,
  };
}

function VendorDialog({
  vendor,
  open,
  onOpenChange,
}: {
  vendor: Vendor | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const isNew = !vendor;
  const [form, setForm] = useState<VendorForm>(vendor ? fromVendor(vendor) : emptyForm());
  const set = (k: keyof VendorForm, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      // dialCode is UI-only; fold it into a single phone string for the payload.
      const { dialCode, phone, ...rest } = form;
      const payload = { ...rest, phone: joinPhone(dialCode, phone) };
      return isNew
        ? http.post<{ invite?: MailResult }>("/vendors", payload)
        : http.put(`/vendors/${vendor!.id}`, payload);
    },
    onSuccess: (res) => {
      if (isNew) mailToast((res as { invite?: MailResult })?.invite, "Vendor onboarded · login", "emailed");
      else toast.success("Vendor saved");
      qc.invalidateQueries({ queryKey: ["vendors"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Onboard vendor / consultant" : `Edit ${vendor!.name}`}</DialogTitle>
          <DialogDescription>
            Vendors and consultants can be paid domestically (bank + IFSC) or internationally (PayPal).
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
            <Field label="Name">
              <Input required value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Type">
              <Select items={VENDOR_TYPE_ITEMS} value={form.type} onValueChange={(v) => set("type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VENDOR_TYPE_ITEMS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Email">
              <Input type="email" required disabled={!isNew} value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Phone">
              <PhoneField
                dialCode={form.dialCode}
                number={form.phone}
                onDialCodeChange={(c) => set("dialCode", c)}
                onNumberChange={(v) => set("phone", v)}
              />
            </Field>
            <Field label="Company">
              <Input value={form.company} onChange={(e) => set("company", e.target.value)} />
            </Field>
            <Field label="GSTIN">
              <Input value={form.gstin} onChange={(e) => set("gstin", e.target.value)} />
            </Field>
            <Field label="PAN">
              <Input value={form.pan} onChange={(e) => set("pan", e.target.value)} />
            </Field>
            <Field label="Services">
              <Input value={form.services} onChange={(e) => set("services", e.target.value)} />
            </Field>
          </FormGrid>

          <div className="rounded-md border p-3">
            <p className="mb-3 text-xs text-muted-foreground">
              Payment details: provide <b>bank account + IFSC</b> for domestic (India) vendors, or a{" "}
              <b>PayPal email</b> for international vendors.
            </p>
            <FormGrid columns={2}>
              <Field label="Bank account">
                <Input value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} />
              </Field>
              <Field label="IFSC">
                <Input value={form.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value)} />
              </Field>
              <Field
                className="sm:col-span-2"
                label={
                  <>
                    PayPal email <span className="font-normal text-muted-foreground">(for international vendors)</span>
                  </>
                }
              >
                <Input type="email" placeholder="name@paypal.com" value={form.bankPaypal} onChange={(e) => set("bankPaypal", e.target.value)} />
              </Field>
            </FormGrid>
          </div>

          {isNew && (
            <Label className="text-sm">
              <Checkbox checked={form.sendInvite} onCheckedChange={(v) => set("sendInvite", !!v)} />
              Send vendor portal login so they can raise bills
            </Label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {isNew ? "Onboard" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function payoutLabel(v: Vendor): string {
  if (v.bank?.account) return `${v.bank.account}${v.bank.ifsc ? ` · ${v.bank.ifsc}` : ""}`;
  if (v.bank?.paypal) return `PayPal · ${v.bank.paypal}`;
  return "-";
}

export default function VendorsPage() {
  const qc = useQueryClient();
  const { isStaff } = useAuth();
  const [dialogVendor, setDialogVendor] = useState<Vendor | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => http.get<Vendor[]>("/vendors"),
  });

  const invite = useMutation({
    mutationFn: (id: string) => http.post<{ invite?: MailResult }>(`/vendors/${id}/invite`, {}),
    onSuccess: (res) => mailToast(res?.invite, "Portal login", "emailed"),
    onError: (e) => toast.error(apiError(e)),
  });

  const openNew = () => { setDialogVendor(null); setDialogOpen(true); };
  const openEdit = (v: Vendor) => { setDialogVendor(v); setDialogOpen(true); };

  return (
    <>
      <PageHeader
        title="Vendors & consultants"
        description="Onboard vendors and consultants and manage how they're paid."
        actions={isStaff ? <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Onboard vendor</Button> : undefined}
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden lg:table-cell">Payout</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))
            ) : vendors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">No vendors onboarded yet.</TableCell>
              </TableRow>
            ) : (
              vendors.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-muted-foreground">{v.code}{v.company ? ` · ${v.company}` : ""}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="violet">{v.type.charAt(0) + v.type.slice(1).toLowerCase()}</Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate md:table-cell" title={v.email}>{v.email}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{payoutLabel(v)}</TableCell>
                  <TableCell className="text-right">
                    {isStaff && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(v)}>
                          <Pencil className="mr-1 size-4" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" disabled={invite.isPending} onClick={() => invite.mutate(v.id)}>
                          <Mail className="mr-1 size-4" /> Portal login
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {dialogOpen && (
        <VendorDialog
          key={dialogVendor?.id ?? "new"}
          vendor={dialogVendor}
          open={dialogOpen}
          onOpenChange={(o) => { setDialogOpen(o); if (!o) qc.invalidateQueries({ queryKey: ["vendors"] }); }}
        />
      )}
    </>
  );
}
