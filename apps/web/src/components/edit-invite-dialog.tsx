"use client";

import { useEffect, useState } from "react";
import { SalaryStructureEditor, type SalaryValue } from "@/components/salary/salary-structure-editor";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import {
  INVITE_EMPLOYMENT_TYPES,
  type InviteDepartment,
  type InviteManagerOption,
  type OnboardingInvite,
} from "@/lib/onboarding";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Field, FormGrid } from "@open-hrms/ui/field";
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

interface EditForm {
  firstName: string;
  lastName: string;
  designation: string;
  joiningDate: string;
  employmentType: string;
  departmentId: string;
  reportsTo: string;
  annualCtc: number | null;
  salaryStructureId: string | null;
}

function toForm(inv: OnboardingInvite): EditForm {
  return {
    firstName: inv.firstName || "",
    lastName: inv.lastName || "",
    designation: inv.designation || "",
    joiningDate: (inv.joiningDate || "").slice(0, 10),
    employmentType: inv.employmentType || INVITE_EMPLOYMENT_TYPES[0]?.value || "",
    departmentId: inv.departmentId || "",
    reportsTo: inv.reportsTo || "",
    annualCtc: inv.annualCtc ?? null,
    salaryStructureId: inv.salaryStructureId ?? null,
  };
}

/**
 * Correct a pending invite in place.
 *
 * Editing exists because the only alternatives were resend (which re-sends the
 * wrong details) and delete (which invalidates a link the candidate may already
 * hold). The invite token is untouched, so an already-sent link keeps working.
 */
export function EditInviteDialog({
  invite,
  departments,
  open,
  onOpenChange,
}: {
  invite: OnboardingInvite | null;
  departments: InviteDepartment[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<EditForm | null>(null);
  // A view onto the same form state: the editor speaks SalaryValue, the invite
  // stores annualCtc + structure, and Save must send one object either way.
  const pay: SalaryValue = { annualCtc: form?.annualCtc ?? null, structureId: form?.salaryStructureId ?? null };
  const setPay = (next: SalaryValue) =>
    set({ annualCtc: next.annualCtc, salaryStructureId: next.structureId });

  // Reload the form whenever a different invite is opened.
  useEffect(() => {
    setForm(invite ? toForm(invite) : null);
  }, [invite]);

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => http.get<InviteManagerOption[]>("/employees"),
    enabled: open,
  });

  const managerItems = employees
    .filter((e) => e.status !== "EXITED")
    .map((e) => ({
      value: e.id,
      label: `${e.firstName} ${e.lastName || ""}`.trim() + (e.code ? ` (${e.code})` : ""),
    }));
  const departmentItems = departments.map((d) => ({ value: d.id, label: d.name }));

  const set = (patch: Partial<EditForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const save = useMutation({
    mutationFn: (values: EditForm) =>
      http.put<OnboardingInvite>(`/onboarding/invites/${invite!.id}`, {
        firstName: values.firstName,
        lastName: values.lastName,
        designation: values.designation,
        joiningDate: values.joiningDate,
        employmentType: values.employmentType,
        departmentId: values.departmentId || null,
        reportsTo: values.reportsTo || null,
        annualCtc: values.annualCtc ?? null,
        salaryStructureId: values.salaryStructureId ?? null,
      }),
    // Paint the row immediately; the table is right there behind the dialog.
    onMutate: async (values) => {
      if (!invite) return;
      await qc.cancelQueries({ queryKey: ["onboarding-invites"] });
      const previous = qc.getQueryData<OnboardingInvite[]>(["onboarding-invites"]);
      const departmentName =
        departments.find((d) => d.id === values.departmentId)?.name ?? null;
      qc.setQueryData<OnboardingInvite[]>(["onboarding-invites"], (old) =>
        (old ?? []).map((row) =>
          row.id === invite.id
            ? {
                ...row,
                ...values,
                departmentId: values.departmentId || null,
                departmentName,
                reportsTo: values.reportsTo || null,
                annualCtc: values.annualCtc ?? null,
              }
            : row,
        ),
      );
      return { previous };
    },
    onSuccess: (updated) => {
      // Trust the server's version of the row over the optimistic one.
      qc.setQueryData<OnboardingInvite[]>(["onboarding-invites"], (old) =>
        (old ?? []).map((row) => (row.id === updated.id ? updated : row)),
      );
      toast.success("Invite updated");
      onOpenChange(false);
    },
    onError: (e, _values, ctx) => {
      if (ctx?.previous) qc.setQueryData(["onboarding-invites"], ctx.previous);
      toast.error(apiError(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["onboarding-invites"] }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit invite</DialogTitle>
          <DialogDescription>
            Correct the details a pending candidate will onboard with. Their existing
            onboarding link keeps working, and no new email is sent.
          </DialogDescription>
        </DialogHeader>

        {form && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
            className="space-y-4"
          >
            <Field
              label="Candidate personal email"
              hint="The address is fixed: it is what the onboarding link was issued against. Delete the invite and send a new one to change it."
            >
              <Input value={invite?.personalEmail ?? ""} disabled readOnly />
            </Field>

            <FormGrid columns={2}>
              <Field label="First name" htmlFor="edit-first">
                <Input
                  id="edit-first"
                  value={form.firstName}
                  onChange={(e) => set({ firstName: e.target.value })}
                />
              </Field>
              <Field label="Last name" htmlFor="edit-last">
                <Input
                  id="edit-last"
                  value={form.lastName}
                  onChange={(e) => set({ lastName: e.target.value })}
                />
              </Field>
            </FormGrid>

            <FormGrid columns={2}>
              <Field label="Designation" htmlFor="edit-designation">
                <Input
                  id="edit-designation"
                  value={form.designation}
                  onChange={(e) => set({ designation: e.target.value })}
                />
              </Field>
              <Field label="Employment type">
                <Select
                  items={INVITE_EMPLOYMENT_TYPES}
                  value={form.employmentType}
                  onValueChange={(v) => set({ employmentType: String(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVITE_EMPLOYMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FormGrid>

            <FormGrid columns={2}>
              <Field label="Department">
                <Select
                  items={departmentItems}
                  value={form.departmentId}
                  onValueChange={(v) => set({ departmentId: String(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {departmentItems.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Reports to">
                <Select
                  items={managerItems}
                  value={form.reportsTo}
                  onValueChange={(v) => set({ reportsTo: String(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a manager" />
                  </SelectTrigger>
                  <SelectContent>
                    {managerItems.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FormGrid>

            <FormGrid columns={1}>
              <Field label="Joining date" htmlFor="edit-joining">
                <Input
                  id="edit-joining"
                  type="date"
                  value={form.joiningDate}
                  onChange={(e) => set({ joiningDate: e.target.value })}
                />
              </Field>
            </FormGrid>

            <SalaryStructureEditor
              value={pay}
              onChange={setPay}
              employmentType={form.employmentType}
              dense
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save changes
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
