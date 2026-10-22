"use client";

import { Suspense, useState } from "react";
import { SalaryStructureEditor, type SalaryValue } from "@/components/salary/salary-structure-editor";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Mail, Trash2, Copy, Users, Pencil, ClipboardCheck, Send, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useActiveTab } from "@/lib/use-active-tab";
import { employmentTypeLabel } from "@/lib/employment";
import {
  INVITE_EMPLOYMENT_TYPES,
  formatInviteDate,
  todayISO,
  type InviteDepartment,
  type InviteManagerOption,
  type OnboardingInvite,
} from "@/lib/onboarding";
import { mailToast, type MailResult } from "@/lib/mail";
import { PageHeader } from "@open-hrms/ui/page-header";
import { BulkOnboarding } from "@/components/bulk-onboarding";
import { ReviewQueue } from "@/components/onboarding/review-queue";
import { Campaigns } from "@/components/onboarding/campaigns";
import { TemplateBuilder } from "@/components/onboarding/template-builder";
import { BulkInvitesDialog } from "@/components/bulk-invites";
import { EditInviteDialog } from "@/components/edit-invite-dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@open-hrms/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

// Shapes for GET /api/onboarding/invites and /api/departments live in
// @/lib/onboarding, shared with the bulk invite and edit dialogs.

type BadgeColour = "green" | "amber" | "red" | "blue" | "grey" | "violet";

const STATUS_VARIANT: Record<string, BadgeColour> = {
  PENDING: "amber",
  SENT: "amber",
  COMPLETED: "green",
};

const TYPE_VARIANT: Record<string, BadgeColour> = {
  PERMANENT: "green",
  FULL_TIME: "green",
  FREELANCER: "violet",
  INTERN: "blue",
  TEMPORARY: "amber",
  VENDOR: "grey",
  // Legacy values, still present on older records.
  PART_TIME: "amber",
  CONTRACT: "violet",
  OUTSOURCED: "grey",
};

function copyLink(link: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(link).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy link"),
    );
  }
}

const EMPTY_INVITE_FORM = {
  personalEmail: "",
  firstName: "",
  lastName: "",
  departmentId: "",
  employmentType: "FULL_TIME",
  designation: "",
  reportsTo: "",
  joiningDate: "",
};

function NewInviteDialog({ departments }: { departments: InviteDepartment[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    ...EMPTY_INVITE_FORM,
    joiningDate: todayISO(),
  });
  const [pay, setPay] = useState<SalaryValue>({ annualCtc: null, structureId: null });

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  // Manager picker ("Reports to"), fetched lazily when the dialog opens.
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

  const create = useMutation({
    mutationFn: () =>
      http.post<{ invite?: OnboardingInvite; mail?: MailResult }>("/onboarding/invites", {
        ...form,
        departmentId: form.departmentId || null,
        reportsTo: form.reportsTo || null,
        annualCtc: pay.annualCtc,
        salaryStructureId: pay.structureId,
      }),
    onSuccess: (res) => {
      // Surface the real onboarding-email delivery status, not a blanket success.
      mailToast(res?.mail, "Onboarding invite created", "emailed");
      // The response is the full invite record, so show it in the table now
      // rather than after the refetch.
      if (res?.invite) {
        const created = res.invite;
        qc.setQueryData<OnboardingInvite[]>(["onboarding-invites"], (old) =>
          old ? [created, ...old] : [created],
        );
      }
      qc.invalidateQueries({ queryKey: ["onboarding-invites"] });
      setOpen(false);
      setForm({ ...EMPTY_INVITE_FORM, joiningDate: todayISO() });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> New onboarding invite
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send onboarding invite</DialogTitle>
            <DialogDescription>
              Send a self-onboarding link to a candidate&apos;s personal email. They fill in their
              details; the system then generates their official email and employee ID.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
            className="space-y-4"
          >
            <Field label="Candidate personal email" htmlFor="personalEmail">
              <Input
                id="personalEmail"
                type="email"
                required
                placeholder="candidate@example.com"
                value={form.personalEmail}
                onChange={(e) => set("personalEmail", e.target.value)}
              />
            </Field>
            <FormGrid columns={2}>
              <Field label="First name" htmlFor="firstName">
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                />
              </Field>
              <Field label="Last name" htmlFor="lastName">
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                />
              </Field>
            </FormGrid>
            <FormGrid columns={2}>
              <Field label="Designation" htmlFor="designation">
                <Input
                  id="designation"
                  value={form.designation}
                  onChange={(e) => set("designation", e.target.value)}
                />
              </Field>
              {/* INVITE_EMPLOYMENT_TYPES, not CURRENT_EMPLOYMENT_TYPES: the
                  invite endpoint validates against a shorter list and 400s on
                  anything else (Permanent used to fail here). */}
              <Field label="Employment type">
                <Select
                  items={INVITE_EMPLOYMENT_TYPES}
                  value={form.employmentType}
                  onValueChange={(v) => set("employmentType", v)}
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
                  onValueChange={(v) => set("departmentId", v)}
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
                  onValueChange={(v) => set("reportsTo", v)}
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
              <Field label="Joining date (can be back-dated)" htmlFor="joiningDate">
                <Input
                  id="joiningDate"
                  type="date"
                  value={form.joiningDate}
                  onChange={(e) => set("joiningDate", e.target.value)}
                />
              </Field>
            </FormGrid>

            {/* Compensation agreed at offer time. The breakup is computed on approval,
                so a structure edited in between is reflected. */}
            <SalaryStructureEditor
              value={pay}
              onChange={setPay}
              employmentType={form.employmentType}
              dense
            />
            <p className="text-xs text-muted-foreground">
              The breakup is worked out when you approve their form, so a structure you edit in
              the meantime is picked up. PF and professional tax are calculated each payroll run.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OnboardingPageInner() {
  const qc = useQueryClient();
  const { isStaff } = useAuth();
  const [tab, setTab] = useActiveTab("review");
  const [editing, setEditing] = useState<OnboardingInvite | null>(null);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => http.get<InviteDepartment[]>("/departments"),
    enabled: isStaff,
  });

  // Drives the count on the Review tab, so waiting work is visible without opening it.
  const { data: submitted = [] } = useQuery({
    queryKey: ["onboarding-review", "SUBMITTED"],
    queryFn: () => http.get<{ id: string }[]>("/onboarding-cases", { status: "SUBMITTED" }),
    enabled: isStaff,
  });
  const pendingReview = submitted.length;

  const { data: invites = [], isLoading } = useQuery({
    queryKey: ["onboarding-invites"],
    queryFn: () => http.get<OnboardingInvite[]>("/onboarding/invites"),
    enabled: isStaff,
  });

  const resend = useMutation({
    mutationFn: (id: string) =>
      http.post<{ mail?: MailResult }>(`/onboarding/invites/${id}/resend`, {}),
    onSuccess: (res) => mailToast(res?.mail, "Invite resent", "emailed"),
    onError: (e) => toast.error(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => http.del(`/onboarding/invites/${id}`),
    // Drop the row on click and put it back if the delete fails, rather than
    // leaving a deleted invite on screen until the refetch lands.
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["onboarding-invites"] });
      const previous = qc.getQueryData<OnboardingInvite[]>(["onboarding-invites"]);
      qc.setQueryData<OnboardingInvite[]>(["onboarding-invites"], (old) =>
        (old ?? []).filter((i) => i.id !== id),
      );
      return { previous };
    },
    onSuccess: () => toast.success("Invite deleted"),
    onError: (e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(["onboarding-invites"], ctx.previous);
      toast.error(apiError(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["onboarding-invites"] }),
  });

  if (!isStaff) {
    return (
      <>
        <PageHeader title="Onboarding" description="Invite candidates to self-onboard." />
        <Card>
          <div className="py-12 text-center text-sm text-muted-foreground">
            Staff access required to manage onboarding invites.
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="Collect and verify everyone's details: new joiners, and the people already on your roster."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          {/* Review sits first: it is the only tab with work waiting on somebody. */}
          <TabsTrigger value="review">
            <ClipboardCheck /> Review
            {pendingReview > 0 && <Badge variant="amber">{pendingReview}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="campaigns">
            <Send /> Campaigns
          </TabsTrigger>
          <TabsTrigger value="forms">
            <FileSpreadsheet /> Forms
          </TabsTrigger>
          <TabsTrigger value="bulk">
            <Users /> Bulk onboarding
          </TabsTrigger>
          <TabsTrigger value="invites">
            <Mail /> Individual invites
            {invites.filter((i) => i.status !== "COMPLETED").length > 0 && (
              <Badge variant="grey">
                {invites.filter((i) => i.status !== "COMPLETED").length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="review">
          <ReviewQueue />
        </TabsContent>

        <TabsContent value="campaigns">
          <Campaigns />
        </TabsContent>

        <TabsContent value="forms">
          <TemplateBuilder />
        </TabsContent>

        <TabsContent value="bulk">
          <BulkOnboarding />
        </TabsContent>

        <TabsContent value="invites">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-[15px] text-muted-foreground">
              Send a self-onboarding link to a candidate&apos;s personal email. They fill in their
              own details and documents; their official email and employee ID are generated when
              they finish.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <BulkInvitesDialog departments={departments} />
              <NewInviteDialog departments={departments} />
            </div>
          </div>
          <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidate</TableHead>
              <TableHead className="hidden md:table-cell">Role</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="hidden lg:table-cell">Joining</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : invites.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  No onboarding invites yet.
                </TableCell>
              </TableRow>
            ) : (
              invites.map((inv) => {
                const done = inv.status === "COMPLETED";
                return (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <div className="font-medium">{inv.firstName || "-"}</div>
                      <div className="text-xs text-muted-foreground">{inv.personalEmail}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div>{inv.designation || "-"}</div>
                      <div className="text-xs text-muted-foreground">{inv.departmentName || ""}</div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {inv.employmentType ? (
                        <Badge variant={TYPE_VARIANT[inv.employmentType] || "grey"}>
                          {employmentTypeLabel(inv.employmentType)}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {formatInviteDate(inv.joiningDate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[inv.status] || "grey"}>{inv.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {done ? (
                        <span className="text-xs text-muted-foreground">Completed</span>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => copyLink(inv.link)}>
                            <Copy className="mr-1 size-4" /> Copy link
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(inv)}>
                            <Pencil className="mr-1 size-4" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={resend.isPending}
                            onClick={() => resend.mutate(inv.id)}
                          >
                            <Mail className="mr-1 size-4" /> Resend
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(inv.id)}
                          >
                            <Trash2 className="mr-1 size-4" /> Delete
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <EditInviteDialog
        invite={editing}
        departments={departments}
        open={!!editing}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
      />
    </>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingPageInner />
    </Suspense>
  );
}
