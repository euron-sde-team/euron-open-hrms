"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Badge } from "@open-hrms/ui/badge";
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

type HolidayType = "PUBLIC" | "RESTRICTED" | "COMPANY";

type Holiday = {
  id: string;
  name: string;
  date: string;
  type?: HolidayType;
  region?: string;
};

type BadgeColour = "green" | "amber" | "red" | "blue" | "grey" | "violet";

const TYPE_VARIANT: Record<HolidayType, BadgeColour> = {
  PUBLIC: "green",
  RESTRICTED: "amber",
  COMPANY: "blue",
};

const HOLIDAY_TYPES: HolidayType[] = ["PUBLIC", "RESTRICTED", "COMPANY"];

function typeLabel(t: HolidayType) {
  return t.charAt(0) + t.slice(1).toLowerCase();
}

function dayName(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long" });
}

function dateLabel(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type HolidayForm = { name: string; date: string; type: HolidayType };

function HolidayDialog({
  holiday,
  open,
  onOpenChange,
}: {
  holiday: Holiday | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const isNew = !holiday;
  const [form, setForm] = useState<HolidayForm>({
    name: holiday?.name ?? "",
    date: holiday?.date ?? "",
    type: holiday?.type ?? "PUBLIC",
  });
  const set = (k: keyof HolidayForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? http.post<Holiday>("/content/holidays", form)
        : http.put<Holiday>(`/content/holidays/${holiday!.id}`, form),
    onSuccess: () => {
      toast.success(isNew ? "Holiday added" : "Holiday saved");
      qc.invalidateQueries({ queryKey: ["holidays"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add holiday" : `Edit ${holiday!.name}`}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim() || !form.date) {
              toast.error("Name and date are required");
              return;
            }
            save.mutate();
          }}
        >
          <Field label="Name" htmlFor="hol-name">
            <Input
              id="hol-name"
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <FormGrid columns={2}>
            <Field label="Date" htmlFor="hol-date">
              <Input
                id="hol-date"
                type="date"
                required
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field label="Type">
              <Select
                items={HOLIDAY_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))}
                value={form.type}
                onValueChange={(v) => set("type", v ?? "PUBLIC")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOLIDAY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {typeLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
              {isNew ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function HolidaysPage() {
  const qc = useQueryClient();
  const { isStaff } = useAuth();
  const [dialogHoliday, setDialogHoliday] = useState<Holiday | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => http.get<Holiday[]>("/content/holidays"),
  });

  const sorted = [...holidays].sort((a, b) => (a.date < b.date ? -1 : 1));

  const remove = useMutation({
    mutationFn: (id: string) => http.del(`/content/holidays/${id}`),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const openNew = () => {
    setDialogHoliday(null);
    setDialogOpen(true);
  };
  const openEdit = (h: Holiday) => {
    setDialogHoliday(h);
    setDialogOpen(true);
  };

  const colSpan = isStaff ? 5 : 4;

  return (
    <>
      <PageHeader
        title="Holidays"
        description="The company holiday calendar."
        actions={
          isStaff ? (
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> Add holiday
            </Button>
          ) : undefined
        }
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="hidden sm:table-cell">Day</TableHead>
              <TableHead>Holiday</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              {isStaff && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={colSpan}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No holidays published.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">{dateLabel(h.date)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {dayName(h.date)}
                  </TableCell>
                  <TableCell>{h.name}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {h.type ? (
                      <Badge variant={TYPE_VARIANT[h.type] || "grey"}>{typeLabel(h.type)}</Badge>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  {isStaff && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(h)}>
                          <Pencil className="mr-1 size-4" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(h.id)}
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

      {dialogOpen && (
        <HolidayDialog
          key={dialogHoliday?.id ?? "new"}
          holiday={dialogHoliday}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </>
  );
}
