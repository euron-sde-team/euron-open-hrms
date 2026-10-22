"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { cn } from "@open-hrms/ui/cn";
import { employmentTypeOptions } from "@/lib/employment";
import type { Department } from "@open-hrms/types";
import { Button } from "@open-hrms/ui/button";
import { Card } from "@open-hrms/ui/card";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Input } from "@open-hrms/ui/input";
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
import { employeeLabel, statusOptions, type EnrichedEmployee } from "./types";

/** Exactly the fields POST /employees/bulk-update accepts (managerId is derived from
 *  reportsTo at send time). Salary and bank are absent on purpose: compensation does
 *  not belong in a fast multi-row editor, and the server ignores them here anyway. */
type EditableField =
  | "firstName" | "lastName" | "designation" | "departmentId" | "employmentType"
  | "reportsTo" | "status" | "joiningDate" | "officeId" | "phone"
  | "personalEmail" | "officialEmail";

type RowEdits = Partial<Record<EditableField, string>>;

/** Fields sent as null rather than "" when cleared, so the server stores an absent
 *  reference instead of an empty string that later reads as a real (missing) id. */
const NULLABLE_FIELDS: EditableField[] = ["departmentId", "reportsTo", "officeId"];

/** Sentinel for the "clear this reference" option: Base UI treats "" as "no value
 *  chosen" and shows the placeholder, so an empty-valued item can never be picked. */
const NONE = "__none__";

interface Office {
  id: string;
  name: string;
}

interface BulkUpdateResponse {
  updated: EnrichedEmployee[];
  failed: Array<{ id: string; error: string }>;
  savedCount: number;
}

interface RowError {
  message: string;
  field: EditableField | null;
}

/**
 * The server validates a row as a whole and returns one message per row, so the
 * offending cell has to be inferred from the message to highlight it. Anything that
 * does not match stays a row-level error rather than being pinned to a random cell.
 */
const ERROR_FIELDS: Array<{ match: RegExp; field: EditableField }> = [
  { match: /manager|report/i, field: "reportsTo" },
  { match: /department/i, field: "departmentId" },
  { match: /employmentType/i, field: "employmentType" },
];

function fieldForError(message: string): EditableField | null {
  return ERROR_FIELDS.find((h) => h.match.test(message))?.field ?? null;
}

/** Server value of a field as the grid's string form (all controls are string-valued). */
function storedValue(e: EnrichedEmployee, field: EditableField): string {
  if (field === "reportsTo") return String(e.reportsTo ?? e.managerId ?? "");
  // Dates arrive as either yyyy-mm-dd or a full ISO timestamp; <input type="date">
  // only accepts the former.
  if (field === "joiningDate") return String(e.joiningDate ?? "").slice(0, 10);
  const raw = (e as Record<string, unknown>)[field];
  return raw == null ? "" : String(raw);
}

interface ColumnDef {
  field: EditableField;
  label: string;
  kind: "text" | "email" | "date" | "select";
  /** Minimum control width; the table itself scrolls horizontally. */
  width: string;
  placeholder?: string;
  /** Select columns. Options can depend on the row: a manager list must exclude the
   *  row itself, and a picker must keep the row's current (possibly legacy) value. */
  options?: (row: EnrichedEmployee) => Array<{ value: string; label: string }>;
}

export function EmployeeBulkEditGrid({
  rows,
  allEmployees,
  departments,
  isLoading,
  selected,
  onToggleRow,
  onToggleAll,
  onDirtyChange,
}: {
  rows: EnrichedEmployee[];
  allEmployees: EnrichedEmployee[];
  departments: Department[];
  isLoading: boolean;
  selected: Set<string>;
  onToggleRow: (id: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  /** Lets the page warn before it unmounts the grid (and the pending edits with it). */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, RowEdits>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, RowError>>({});

  const { data: offices = [] } = useQuery({
    queryKey: ["offices"],
    queryFn: () => http.get<Office[]>("/org/offices"),
  });

  const departmentOptions = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })),
    [departments],
  );
  const officeOptions = useMemo(
    () => offices.map((o) => ({ value: o.id, label: o.name })),
    [offices],
  );
  const managerOptions = useMemo(
    () =>
      allEmployees
        .filter((m) => m.status !== "EXITED")
        .map((m) => ({ value: m.id, label: employeeLabel(m) })),
    [allEmployees],
  );

  const columns: ColumnDef[] = useMemo(
    () => [
      { field: "firstName", label: "First name", kind: "text", width: "min-w-[9rem]" },
      { field: "lastName", label: "Last name", kind: "text", width: "min-w-[9rem]" },
      { field: "designation", label: "Designation", kind: "text", width: "min-w-[11rem]" },
      {
        field: "departmentId", label: "Department", kind: "select", width: "min-w-[11rem]",
        placeholder: "None",
        options: () => [{ value: NONE, label: "No department" }, ...departmentOptions],
      },
      {
        field: "employmentType", label: "Type", kind: "select", width: "min-w-[10rem]",
        options: (row) =>
          employmentTypeOptions(row.employmentType).map((t) => ({ value: t.value, label: t.label })),
      },
      {
        field: "reportsTo", label: "Reports to", kind: "select", width: "min-w-[13rem]",
        placeholder: "No manager",
        options: (row) => [
          { value: NONE, label: "No manager" },
          ...managerOptions.filter((m) => m.value !== row.id),
        ],
      },
      {
        field: "status", label: "Status", kind: "select", width: "min-w-[9.5rem]",
        options: (row) => statusOptions(row.status),
      },
      { field: "joiningDate", label: "Joining date", kind: "date", width: "min-w-[9.5rem]" },
      {
        field: "officeId", label: "Office", kind: "select", width: "min-w-[10rem]",
        placeholder: "None",
        options: () => [{ value: NONE, label: "No office" }, ...officeOptions],
      },
      { field: "phone", label: "Phone", kind: "text", width: "min-w-[10rem]" },
      { field: "personalEmail", label: "Personal email", kind: "email", width: "min-w-[13rem]" },
      { field: "officialEmail", label: "Official email", kind: "email", width: "min-w-[13rem]" },
    ],
    [departmentOptions, managerOptions, officeOptions],
  );

  const byId = useMemo(() => new Map(rows.map((e) => [e.id, e])), [rows]);

  /** Stage one cell. Setting a cell back to its stored value clears it, so the change
   *  count only ever reflects real differences. */
  function setCell(id: string, field: EditableField, value: string) {
    const employee = byId.get(id);
    setEdits((prev) => {
      const row = { ...(prev[id] ?? {}) };
      if (employee && storedValue(employee, field) === value) delete row[field];
      else row[field] = value;
      const next = { ...prev };
      if (Object.keys(row).length) next[id] = row;
      else delete next[id];
      return next;
    });
    setRowErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /** Apply one value to every selected row: the reason this grid exists is a
   *  reorg where fifty people move department at once. */
  function applyToSelected(field: EditableField, value: string) {
    const targets = rows.filter(
      // Nobody can report to themselves, so quietly leave that row out rather than
      // staging an edit the server is guaranteed to reject.
      (e) => selected.has(e.id) && !(field === "reportsTo" && value === e.id),
    );
    if (!targets.length) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const e of targets) {
        const row = { ...(next[e.id] ?? {}) };
        if (storedValue(e, field) === value) delete row[field];
        else row[field] = value;
        if (Object.keys(row).length) next[e.id] = row;
        else delete next[e.id];
      }
      return next;
    });
    setRowErrors({});
    toast.success(`Applied to ${targets.length} ${targets.length === 1 ? "person" : "people"}`);
  }

  const changeCount = Object.values(edits).reduce((n, row) => n + Object.keys(row).length, 0);
  const peopleCount = Object.keys(edits).length;
  const errorCount = Object.keys(rowErrors).length;

  useEffect(() => {
    onDirtyChange(changeCount > 0);
    return () => onDirtyChange(false);
  }, [changeCount, onDirtyChange]);

  const save = useMutation({
    mutationFn: (updates: Array<Record<string, unknown>>) =>
      http.post<BulkUpdateResponse>("/employees/bulk-update", { updates }),
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: ["employees"] });
      const previous = qc.getQueryData<EnrichedEmployee[]>(["employees"]);
      const patchById = new Map(updates.map((u) => [String(u.id), u]));
      const deptName = new Map(departments.map((d) => [d.id, d.name]));
      // Paint the edits on straight away; onSuccess replaces this with the server's
      // own rows (which also reverts anything that failed validation).
      qc.setQueryData<EnrichedEmployee[]>(["employees"], (old) =>
        old?.map((e) => {
          const patch = patchById.get(e.id);
          if (!patch) return e;
          const merged = { ...e, ...patch } as EnrichedEmployee;
          if ("departmentId" in patch) {
            merged.department = deptName.get(String(patch.departmentId ?? "")) ?? "-";
          }
          return merged;
        }),
      );
      return { previous };
    },
    onError: (e, _updates, ctx) => {
      if (ctx?.previous) qc.setQueryData(["employees"], ctx.previous);
      toast.error(apiError(e));
    },
    onSuccess: (res, _updates, ctx) => {
      const savedById = new Map(res.updated.map((u) => [u.id, u]));
      // Rebuild from the pre-save snapshot so failed rows fall back to stored values.
      qc.setQueryData<EnrichedEmployee[]>(["employees"], (old) =>
        (ctx?.previous ?? old)?.map((e) => savedById.get(e.id) ?? e),
      );
      const failedIds = new Set(res.failed.map((f) => f.id));
      // Keep the failed rows' pending values on screen next to their error; drop the
      // rest, they are now the stored values.
      setEdits((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([id]) => failedIds.has(id))),
      );
      setRowErrors(
        Object.fromEntries(
          res.failed.map((f) => [f.id, { message: f.error, field: fieldForError(f.error) }]),
        ),
      );
      if (res.failed.length) {
        toast.error(`${res.savedCount} saved, ${res.failed.length} need attention`);
      } else {
        toast.success(`${res.savedCount} ${res.savedCount === 1 ? "person" : "people"} updated`);
      }
      qc.invalidateQueries({ queryKey: ["employees"] });
      // Letter status carries names and departments, so it goes stale with this save.
      qc.invalidateQueries({ queryKey: ["letters", "status"] });
    },
  });

  function submit() {
    const updates = Object.entries(edits).map(([id, row]) => {
      const payload: Record<string, unknown> = { id };
      for (const [field, value] of Object.entries(row) as Array<[EditableField, string]>) {
        payload[field] = NULLABLE_FIELDS.includes(field) && value === "" ? null : value;
      }
      // The server keeps the two in sync, but the per-row edit path sends both, so
      // this does too rather than relying on which one wins.
      if ("reportsTo" in row) payload.managerId = payload.reportsTo;
      return payload;
    });
    if (updates.length) save.mutate(updates);
  }

  const visibleIds = rows.map((e) => e.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-muted/30 px-3 py-2.5">
        <span className="text-[13px] font-medium text-muted-foreground">
          {selected.size > 0
            ? `Set for ${selected.size} selected:`
            : "Select rows to set a value on all of them:"}
        </span>
        <ApplyToSelected
          disabled={selected.size === 0}
          label="Department"
          options={departmentOptions}
          onApply={(v) => applyToSelected("departmentId", v)}
        />
        <ApplyToSelected
          disabled={selected.size === 0}
          label="Manager"
          options={managerOptions}
          onApply={(v) => applyToSelected("reportsTo", v)}
        />
        <ApplyToSelected
          disabled={selected.size === 0}
          label="Status"
          options={statusOptions()}
          onApply={(v) => applyToSelected("status", v)}
        />
        <ApplyToSelected
          disabled={selected.size === 0}
          label="Type"
          options={employmentTypeOptions().map((t) => ({ value: t.value, label: t.label }))}
          onApply={(v) => applyToSelected("employmentType", v)}
        />
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4">
                <Checkbox
                  aria-label="Select all rows"
                  checked={allSelected}
                  onCheckedChange={(v) => onToggleAll(!!v)}
                />
              </TableHead>
              <TableHead>Employee</TableHead>
              {columns.map((c) => (
                <TableHead key={c.field}>{c.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columns.length + 2}>
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 2}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No employees found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((e) => {
                const rowEdits = edits[e.id] ?? {};
                const error = rowErrors[e.id];
                return (
                  <TableRow
                    key={e.id}
                    data-state={selected.has(e.id) ? "selected" : undefined}
                    className={cn(error && "bg-[var(--bad-bg)]/40")}
                  >
                    <TableCell className="pl-4 align-top">
                      <Checkbox
                        aria-label={`Select ${e.firstName} ${e.lastName ?? ""}`.trim()}
                        checked={selected.has(e.id)}
                        onCheckedChange={(v) => onToggleRow(e.id, !!v)}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="pt-1.5 text-[13px] font-medium">{e.code}</div>
                      <div
                        className="max-w-[14rem] truncate text-xs text-muted-foreground"
                        title={e.email}
                      >
                        {e.email || "No login email"}
                      </div>
                      {error && !error.field && (
                        <div className="mt-1 max-w-[14rem] text-xs text-destructive">
                          {error.message}
                        </div>
                      )}
                    </TableCell>
                    {columns.map((c) => {
                      const stored = storedValue(e, c.field);
                      const dirty = c.field in rowEdits;
                      const value = dirty ? (rowEdits[c.field] as string) : stored;
                      return (
                        <TableCell key={c.field} className="align-top">
                          <GridCell
                            column={c}
                            row={e}
                            value={value}
                            dirty={dirty}
                            error={error?.field === c.field ? error.message : null}
                            onChange={(v) => setCell(e.id, c.field, v)}
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {changeCount > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-card/95 px-4 py-3 shadow-[var(--elev-3)] backdrop-blur">
          <div className="text-sm">
            <strong>{changeCount}</strong> change{changeCount === 1 ? "" : "s"} on{" "}
            <strong>{peopleCount}</strong> {peopleCount === 1 ? "person" : "people"}
            {errorCount > 0 && (
              <span className="ml-2 text-destructive">
                · {errorCount} row{errorCount === 1 ? "" : "s"} rejected, fix the highlighted cells
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={() => {
                setEdits({});
                setRowErrors({});
              }}
            >
              <RotateCcw className="size-4" /> Discard
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={submit}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />} Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One editable cell: a compact control plus the dirty dot and per-cell error. */
function GridCell({
  column,
  row,
  value,
  dirty,
  error,
  onChange,
}: {
  column: ColumnDef;
  row: EnrichedEmployee;
  value: string;
  dirty: boolean;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const marker = dirty && (
    <span
      aria-hidden
      className="pointer-events-none absolute -right-1 -top-1 size-2 rounded-full bg-primary shadow-[var(--elev-1)]"
    />
  );

  return (
    <div className={cn("relative", column.width)}>
      {column.kind === "select" ? (
        <Select
          items={column.options?.(row) ?? []}
          value={value}
          onValueChange={(v) => onChange(v === NONE ? "" : (v ?? ""))}
        >
          <SelectTrigger
            size="sm"
            aria-invalid={!!error}
            // The sm trigger is w-fit by default, which leaves ragged columns in a
            // grid. Overriding in the same variant group lets tailwind-merge drop it.
            className={cn("data-[size=sm]:w-full", dirty && "border-primary/70")}
          >
            <SelectValue placeholder={column.placeholder ?? "Select"} />
          </SelectTrigger>
          <SelectContent>
            {(column.options?.(row) ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          inputSize="compact"
          type={column.kind === "date" ? "date" : column.kind === "email" ? "email" : "text"}
          aria-label={column.label}
          aria-invalid={!!error}
          value={value}
          className={cn(dirty && "border-primary/70")}
          onChange={(ev) => onChange(ev.target.value)}
        />
      )}
      {marker}
      {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
    </div>
  );
}

/** A "set this on everything selected" picker. It resets after each use because it
 *  is an action, not a filter: leaving the last value showing reads as row state. */
function ApplyToSelected({
  label,
  options,
  disabled,
  onApply,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onApply: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (!v) return;
        onApply(v);
        setValue("");
      }}
    >
      <SelectTrigger size="sm" className="w-auto min-w-[9rem]">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
