"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Card } from "@open-hrms/ui/card";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

interface Office {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

interface OfficeForm {
  name: string;
  address: string;
  lat: string;
  lng: string;
  radiusMeters: string;
}

function emptyForm(): OfficeForm {
  return { name: "", address: "", lat: "", lng: "", radiusMeters: "250" };
}

function fromOffice(o: Office): OfficeForm {
  return {
    name: o.name ?? "",
    address: o.address ?? "",
    lat: o.lat != null ? String(o.lat) : "",
    lng: o.lng != null ? String(o.lng) : "",
    radiusMeters: o.radiusMeters != null ? String(o.radiusMeters) : "250",
  };
}

function OfficeDialog({
  office,
  open,
  onOpenChange,
}: {
  office: Office | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const isNew = !office;
  const [form, setForm] = useState<OfficeForm>(office ? fromOffice(office) : emptyForm());
  const [locating, setLocating] = useState(false);
  const set = (k: keyof OfficeForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const useCurrentLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Geolocation is not supported by this browser");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({
          ...f,
          lat: p.coords.latitude.toFixed(6),
          lng: p.coords.longitude.toFixed(6),
        }));
        setLocating(false);
        toast.success("Filled in your current location");
      },
      () => {
        setLocating(false);
        toast.error("Could not get your location (allow permission and try again)");
      }
    );
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        address: form.address,
        lat: Number(form.lat),
        lng: Number(form.lng),
        radiusMeters: Number(form.radiusMeters),
      };
      return isNew
        ? http.post<Office>("/org/offices", body)
        : http.put<Office>(`/org/offices/${office!.id}`, body);
    },
    onSuccess: () => {
      toast.success(isNew ? "Office added" : "Office saved");
      qc.invalidateQueries({ queryKey: ["offices"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add office" : `Edit ${office!.name}`}</DialogTitle>
          <DialogDescription>
            Check-ins within the radius of an office centre are marked PRESENT.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Name" htmlFor="o_name">
            <Input
              id="o_name"
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <FormGrid columns={2}>
            <Field label="Latitude" htmlFor="o_lat">
              <Input
                id="o_lat"
                required
                inputMode="decimal"
                placeholder="e.g. 12.971599"
                value={form.lat}
                onChange={(e) => set("lat", e.target.value)}
              />
            </Field>
            <Field label="Longitude" htmlFor="o_lng">
              <Input
                id="o_lng"
                required
                inputMode="decimal"
                placeholder="e.g. 77.594566"
                value={form.lng}
                onChange={(e) => set("lng", e.target.value)}
              />
            </Field>
          </FormGrid>
          <Button type="button" variant="outline" size="sm" disabled={locating} onClick={useCurrentLocation}>
            {locating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}
            Use my current location
          </Button>
          <FormGrid columns={2}>
            <Field label="Radius (metres)" htmlFor="o_rad">
              <Input
                id="o_rad"
                type="number"
                min={1}
                value={form.radiusMeters}
                onChange={(e) => set("radiusMeters", e.target.value)}
              />
            </Field>
            <Field label="Address" htmlFor="o_addr">
              <Input id="o_addr" value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {isNew ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function OfficesPage() {
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const [dialogOffice, setDialogOffice] = useState<Office | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: offices = [], isLoading } = useQuery({
    queryKey: ["offices"],
    queryFn: () => http.get<Office[]>("/org/offices"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => http.del(`/org/offices/${id}`),
    onSuccess: () => {
      toast.success("Office deleted");
      qc.invalidateQueries({ queryKey: ["offices"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const openNew = () => {
    setDialogOffice(null);
    setDialogOpen(true);
  };
  const openEdit = (o: Office) => {
    setDialogOffice(o);
    setDialogOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Offices"
        description="Geofenced locations used to validate attendance check-ins."
        actions={
          isStaff ? (
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> Add office
            </Button>
          ) : undefined
        }
      />

      <p className="mb-4 rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        Check-ins within the radius of an office centre are marked PRESENT; outside is REMOTE.
      </p>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Office</TableHead>
              <TableHead className="hidden sm:table-cell">Latitude</TableHead>
              <TableHead className="hidden sm:table-cell">Longitude</TableHead>
              <TableHead>Radius (m)</TableHead>
              <TableHead className="hidden lg:table-cell">Address</TableHead>
              {isStaff && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={isStaff ? 6 : 5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : offices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isStaff ? 6 : 5} className="py-12 text-center text-sm text-muted-foreground">
                  No offices configured.
                </TableCell>
              </TableRow>
            ) : (
              offices.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">{o.lat}</TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">{o.lng}</TableCell>
                  <TableCell>{o.radiusMeters}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{o.address || "-"}</TableCell>
                  {isStaff && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(o)}>
                          <Pencil className="mr-1 size-4" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm(`Delete office "${o.name}"?`)) remove.mutate(o.id);
                          }}
                        >
                          <Trash2 className="mr-1 size-4" /> Delete
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {dialogOpen && isStaff && (
        <OfficeDialog
          key={dialogOffice?.id ?? "new"}
          office={dialogOffice}
          open={dialogOpen}
          onOpenChange={(o) => {
            setDialogOpen(o);
            if (!o) qc.invalidateQueries({ queryKey: ["offices"] });
          }}
        />
      )}
    </>
  );
}
