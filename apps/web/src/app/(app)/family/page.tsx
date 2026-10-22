"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

const RELATIONS = ["Spouse", "Son", "Daughter", "Father", "Mother", "Other"];
const PLAN_OPTIONS = [
  "Group Health - Family Floater",
  "Group Health - Individual",
  "Group Health - Top-up",
  "Parents - Senior Care",
];
const DEFAULT_PLAN: string = PLAN_OPTIONS[0] ?? "";
const DEFAULT_COVER = 500000;

interface Dependent {
  name: string;
  relation: string;
  dob?: string;
}

interface FamilyBenefit {
  id: string;
  employeeId: string;
  employeeName?: string;
  plan: string;
  coverAmount: number;
  dependents?: Dependent[];
  status: string;
}

function inr(amount: number): string {
  return `₹${(amount || 0).toLocaleString("en-IN")}`;
}

function FamilyDialog({
  enrolment,
  open,
  onOpenChange,
}: {
  enrolment: FamilyBenefit | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [plan, setPlan] = useState(enrolment?.plan || DEFAULT_PLAN);
  const [coverAmount, setCoverAmount] = useState(String(enrolment?.coverAmount ?? DEFAULT_COVER));
  const [dependents, setDependents] = useState<Dependent[]>(
    enrolment?.dependents?.length
      ? enrolment.dependents.map((d) => ({ name: d.name ?? "", relation: d.relation ?? "Spouse", dob: d.dob ?? "" }))
      : [{ name: "", relation: "Spouse", dob: "" }]
  );

  const setDep = (i: number, k: keyof Dependent, v: string) =>
    setDependents((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addDep = () => setDependents((rows) => [...rows, { name: "", relation: "Son", dob: "" }]);
  const removeDep = (i: number) => setDependents((rows) => rows.filter((_, idx) => idx !== i));

  const save = useMutation({
    mutationFn: () => {
      const cleaned = dependents
        .filter((d) => d.name.trim())
        .map((d) => ({ name: d.name.trim(), relation: d.relation, dob: d.dob || undefined }));
      return http.post<FamilyBenefit>("/perks/family", {
        plan,
        coverAmount: Number(coverAmount),
        dependents: cleaned,
      });
    },
    onSuccess: () => {
      toast.success("Family enrolment saved");
      qc.invalidateQueries({ queryKey: ["family"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Family benefits enrolment</DialogTitle>
          <DialogDescription>Add the dependents you&apos;d like covered under your health plan.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <FormGrid columns={2}>
            <Field label="Plan">
              <Select
                // Keep a legacy/custom plan selectable when editing an
                // enrolment created before the preset list existed.
                items={(PLAN_OPTIONS.includes(plan)
                  ? PLAN_OPTIONS
                  : [plan, ...PLAN_OPTIONS]
                ).map((p) => ({ value: p, label: p }))}
                value={plan}
                onValueChange={(v) => setPlan(v ?? DEFAULT_PLAN)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(PLAN_OPTIONS.includes(plan) ? PLAN_OPTIONS : [plan, ...PLAN_OPTIONS]).map(
                    (p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Cover amount (₹)" htmlFor="fm_cover">
              <Input
                id="fm_cover"
                type="number"
                min={0}
                value={coverAmount}
                onChange={(e) => setCoverAmount(e.target.value)}
              />
            </Field>
          </FormGrid>

          <div className="space-y-2">
            <Label>Dependents</Label>
            <div className="space-y-3">
              {dependents.map((d, i) => (
                <div key={i} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-muted-foreground">
                      Dependent {i + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove dependent ${i + 1}`}
                      disabled={dependents.length === 1}
                      onClick={() => removeDep(i)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Field label="Full name" htmlFor={`dep-name-${i}`}>
                    <Input
                      id={`dep-name-${i}`}
                      placeholder="e.g. Meera Sharma"
                      value={d.name}
                      onChange={(e) => setDep(i, "name", e.target.value)}
                    />
                  </Field>
                  <FormGrid columns={2}>
                    <Field label="Relation">
                      <Select
                        items={RELATIONS.map((r) => ({ value: r, label: r }))}
                        value={d.relation}
                        onValueChange={(v) => setDep(i, "relation", v ?? "")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RELATIONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Date of birth" htmlFor={`dep-dob-${i}`}>
                      <Input
                        id={`dep-dob-${i}`}
                        type="date"
                        value={d.dob ?? ""}
                        onChange={(e) => setDep(i, "dob", e.target.value)}
                      />
                    </Field>
                  </FormGrid>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addDep}>
              <Plus className="mr-2 h-4 w-4" /> Add dependent
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save enrolment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StaffFamilyTable({ list, isLoading }: { list: FamilyBenefit[]; isLoading: boolean }) {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead className="hidden sm:table-cell">Plan</TableHead>
            <TableHead>Cover</TableHead>
            <TableHead className="text-center">Dependents</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={5}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : list.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                No family enrolments.
              </TableCell>
            </TableRow>
          ) : (
            list.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.employeeName || "-"}</TableCell>
                <TableCell className="hidden sm:table-cell">{f.plan}</TableCell>
                <TableCell>{inr(f.coverAmount)}</TableCell>
                <TableCell className="text-center">{f.dependents?.length ?? 0}</TableCell>
                <TableCell>
                  <Badge variant="green">{f.status}</Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

function EmployeeFamilyView({ mine, isLoading }: { mine: FamilyBenefit | null; isLoading: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <Card className="p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-4 h-24 w-full" />
      </Card>
    );
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> {mine ? "Update family" : "Enrol family"}
        </Button>
      </div>

      {mine ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">{mine.plan}</h3>
              <p className="mt-1 text-sm text-muted-foreground">Cover {inr(mine.coverAmount)}</p>
            </div>
            <Badge variant="green">{mine.status}</Badge>
          </div>

          <div className="mt-5">
            <h4 className="mb-2 text-sm font-medium">Dependents</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Relation</TableHead>
                  <TableHead>Date of birth</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mine.dependents?.length ? (
                  mine.dependents.map((d, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell>{d.relation}</TableCell>
                      <TableCell>{d.dob || "-"}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                      No dependents added.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">You haven&apos;t enrolled your family yet.</p>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Enrol now
            </Button>
          </div>
        </Card>
      )}

      {dialogOpen && (
        <FamilyDialog key={mine?.id ?? "new"} enrolment={mine} open={dialogOpen} onOpenChange={setDialogOpen} />
      )}
    </>
  );
}

export default function FamilyPage() {
  const { isStaff } = useAuth();

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["family"],
    queryFn: () => http.get<FamilyBenefit[]>("/perks/family"),
  });

  return (
    <>
      <PageHeader
        title="Family benefits"
        description={
          isStaff
            ? "Health-cover enrolments across the organisation."
            : "Enrol your dependents for health cover."
        }
      />

      {isStaff ? (
        <StaffFamilyTable list={list} isLoading={isLoading} />
      ) : (
        <EmployeeFamilyView mine={list[0] ?? null} isLoading={isLoading} />
      )}
    </>
  );
}
