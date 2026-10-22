"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Department } from "@open-hrms/types";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Field } from "@open-hrms/ui/field";
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

type DepartmentRow = Department & {
  employeeCount?: number;
  headId?: string | null;
  headName?: string | null;
};

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName?: string;
}

type DepartmentForm = {
  name: string;
  description: string;
};

const NO_HEAD = "__none__";

function DepartmentDialog({
  department,
  open,
  onOpenChange,
  employees,
}: {
  department: DepartmentRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employees: EmployeeOption[];
}) {
  const qc = useQueryClient();
  const isNew = !department;
  const [form, setForm] = useState<DepartmentForm>({
    name: department?.name ?? "",
    description: department?.description ?? "",
  });
  const [headId, setHeadId] = useState<string | null>(department?.headId ?? null);
  const set = (k: keyof DepartmentForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, headId };
      return isNew
        ? http.post<DepartmentRow>("/departments", body)
        : http.put<DepartmentRow>(`/departments/${department!.id}`, body);
    },
    onSuccess: () => {
      toast.success(isNew ? "Department created" : "Department saved");
      qc.invalidateQueries({ queryKey: ["departments"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "New department" : `Edit ${department!.name}`}</DialogTitle>
          <DialogDescription>
            Departments group employees into teams and reporting lines.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Name" htmlFor="name">
            <Input
              id="name"
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Description" htmlFor="description">
            <Textarea
              id="description"
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
          <Field label="Department head">
            <Select
              items={[
                { value: NO_HEAD, label: "None" },
                ...employees.map((e) => ({
                  value: e.id,
                  label: `${e.firstName} ${e.lastName ?? ""}`.trim(),
                })),
              ]}
              value={headId ?? NO_HEAD}
              onValueChange={(v) => setHeadId(v === NO_HEAD ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a head" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_HEAD}>None</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.firstName} {e.lastName ?? ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
              {isNew ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  department,
  open,
  onOpenChange,
}: {
  department: DepartmentRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: () => http.del<{ ok: boolean }>(`/departments/${department!.id}`),
    onSuccess: () => {
      toast.success("Department deleted");
      qc.invalidateQueries({ queryKey: ["departments"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete department</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete {department ? <b>{department.name}</b> : "this department"}?
            This can&apos;t be undone. Departments with active employees can&apos;t be deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DepartmentsPage() {
  const { isStaff } = useAuth();
  const [dialogDept, setDialogDept] = useState<DepartmentRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDept, setDeleteDept] = useState<DepartmentRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ["departments"],
    queryFn: () => http.get<DepartmentRow[]>("/departments"),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees", "department-head-options"],
    queryFn: () => http.get<EmployeeOption[]>("/employees"),
    enabled: isStaff,
  });

  const openNew = () => {
    setDialogDept(null);
    setDialogOpen(true);
  };
  const openEdit = (d: DepartmentRow) => {
    setDialogDept(d);
    setDialogOpen(true);
  };
  const openDelete = (d: DepartmentRow) => {
    setDeleteDept(d);
    setDeleteOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Departments"
        description="Teams and reporting lines."
        actions={
          isStaff ? (
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> New department
            </Button>
          ) : undefined
        }
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Department</TableHead>
              <TableHead className="hidden md:table-cell">Description</TableHead>
              <TableHead>Head</TableHead>
              <TableHead>Employees</TableHead>
              {isStaff && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={isStaff ? 5 : 4}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : departments.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isStaff ? 5 : 4}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No departments yet.
                </TableCell>
              </TableRow>
            ) : (
              departments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.name}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {d.description || "-"}
                  </TableCell>
                  <TableCell className="text-sm">{d.headName || "-"}</TableCell>
                  <TableCell>
                    <Badge variant="grey" className="gap-1">
                      <Users className="size-4" />
                      {d.employeeCount ?? 0}
                    </Badge>
                  </TableCell>
                  {isStaff && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(d)}>
                          <Pencil className="mr-1 size-4" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openDelete(d)}>
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
        <DepartmentDialog
          key={dialogDept?.id ?? "new"}
          department={dialogDept}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          employees={employees}
        />
      )}

      {deleteOpen && (
        <DeleteDialog
          key={deleteDept?.id ?? "del"}
          department={deleteDept}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}
    </>
  );
}
