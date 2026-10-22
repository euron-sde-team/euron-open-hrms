"use client";

import { useMemo, useState } from "react";
import { SalaryStructureEditor, type SalaryValue } from "@/components/salary/salary-structure-editor";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Banknote, DoorOpen, FileText, Loader2, Mail, Pencil, Plus, Search, Table2, Upload, Download, X } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EMPLOYMENT_TYPES, employmentTypeLabel } from "@/lib/employment";
import { mailToast, type MailResult } from "@/lib/mail";
import type { Department } from "@open-hrms/types";
import { PageHeader } from "@open-hrms/ui/page-header";
import { EmployeeBulkEditGrid } from "@/components/employees/bulk-edit-grid";
import { BulkOfferLettersDialog, OfferLetterCell, useOfferLetterStatus } from "@/components/employees/offer-letters";
import { ProbationReviewsCard } from "@/components/employees/probation-reviews";
import { IssueLetterAction } from "@/components/employees/issue-letter";
import { RemoveEmployeeAction } from "@/components/employees/remove-employee";
import {
  STATUS_VARIANT,
  TYPE_VARIANT,
  ROLE_VARIANT,
  roleLabel,
  employeeLabel,
  statusLabel,
  type EnrichedEmployee,
} from "@/components/employees/types";
import { PhoneField, joinPhone, splitPhone } from "@/components/phone-field";
import { DesignationField } from "@/components/designation-field";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Textarea } from "@open-hrms/ui/textarea";
import { Checkbox } from "@open-hrms/ui/checkbox";
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
  DialogDescription,
  DialogTitle,
} from "@open-hrms/ui/dialog";

/** Statuses where an exit is already underway or done, hide Start exit. */
const NO_EXIT_STATUSES = ["EXITED", "ABSCONDING", "NOTICE_PERIOD"];

/**
 * How HR states the notice period. Mirrors NOTICE_MODES in
 * apps/api/src/separation-config.ts.
 *
 * The server resolves the real dates itself on every write; what happens here is
 * a preview, so HR can see the last working day a choice implies BEFORE they
 * commit to it. That preview is the point of the control: "skip notice" used to
 * be a checkbox whose consequences were invisible, and which the server then
 * ignored entirely.
 */
const NOTICE_MODES = [
  { value: "DEFAULT", label: "Serve contractual notice" },
  { value: "DAYS", label: "Serve a set number of days" },
  { value: "UNTIL", label: "Serve until a date" },
  { value: "SKIP", label: "Skip notice, exit immediately" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

/** The last working day a notice choice implies, for display only. */
function previewLastWorkingDay(
  mode: string,
  days: string,
  until: string,
  contractualDays: number,
): string {
  if (mode === "SKIP") return todayIso();
  if (mode === "UNTIL") return until || todayIso();
  if (mode === "DAYS") {
    const n = Number(days);
    return addDaysIso(Number.isFinite(n) && n >= 0 ? n : 0);
  }
  return addDaysIso(contractualDays);
}

// Staff-initiated exit types and their sub-reasons. Mirrors TYPES in
// apps/api/src/separation-config.ts. RESIGNATION is
// excluded: it is employee-initiated, and the backend coerces it to
// TERMINATION on this endpoint anyway.
const EXIT_TYPES = [
  { value: "TERMINATION", label: "Termination" },
  { value: "ABSCONDING", label: "Absconding" },
  { value: "RETIREMENT", label: "Retirement" },
  { value: "END_OF_CONTRACT", label: "End of contract" },
];

const EXIT_SUB_REASONS: Record<string, Array<{ value: string; label: string }>> = {
  TERMINATION: [
    { value: "PERFORMANCE", label: "Performance" },
    { value: "MISCONDUCT", label: "Misconduct" },
    { value: "LAYOFF", label: "Layoff" },
  ],
};

/** Terminal letters that can be issued on an exit, whatever the type. */
const EXIT_DOCUMENTS = [
  { value: "RELIEVING_LETTER", label: "Relieving and experience letter" },
  { value: "EXPERIENCE_LETTER", label: "Experience certificate" },
  { value: "TERMINATION_LETTER", label: "Termination letter" },
  { value: "RETIREMENT_LETTER", label: "Superannuation letter" },
];

/**
 * What each exit type suggests. A suggestion, not a rule: HR ticks whatever the situation
 * calls for. Mirrors the server's defaults so the dialog opens on the same answer the
 * server would have chosen if nothing were sent.
 */
const DEFAULT_EXIT_DOCUMENTS: Record<string, string[]> = {
  TERMINATION: ["TERMINATION_LETTER", "EXPERIENCE_LETTER"],
  RETIREMENT: ["RETIREMENT_LETTER"],
  END_OF_CONTRACT: ["EXPERIENCE_LETTER"],
  ABSCONDING: [],
};

/** Staff-only editor for an employee's monthly compensation. This is the
 *  source the payslip generator reads when no per-run amounts are given. */
function CompensationDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EnrichedEmployee;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const s = employee.salary ?? {};
  // Seeded from what is on record, so reopening the dialog shows the CTC and the
  // statutory choices that were saved rather than an empty form.
  const [value, setValue] = useState<SalaryValue>({
    annualCtc: s.annualCtc ?? null,
    structureId: s.structureId ?? null,
    statutory: s.statutory ?? undefined,
  });

  const save = useMutation({
    // The salary route, not PUT /employees/:id: it is the one that derives the
    // breakup from the CTC and maintains components[] for the payroll engine.
    mutationFn: () => http.put(`/salary/structure/${employee.id}`, { salary: value }),
    onSuccess: () => {
      toast.success("Compensation updated");
      qc.invalidateQueries({ queryKey: ["employees"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Set compensation: {employee.firstName} {employee.lastName}
          </DialogTitle>
          <DialogDescription>
            State the annual CTC. The monthly breakup and what the role costs follow from it.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <SalaryStructureEditor
            value={value}
            onChange={setValue}
            employmentType={employee.employmentType}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !Number(value.annualCtc)}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Staff-only editor for an employee's basic profile fields. */
/** Small section heading used to group the edit form. */
function FormSection({ title }: { title: string }) {
  return (
    <div className="pt-1 text-[13px] font-medium text-muted-foreground">
      {title}
    </div>
  );
}

/**
 * Which address this person signs in with, and the one action that changes it.
 *
 * Deliberately not a form field. Editing an employee record is routine, while changing an
 * authentication identity signs the person out everywhere and emails both their old and new
 * addresses, so it is a separate, explicit act rather than something that happens silently
 * because somebody corrected a typo in a nearby box.
 */
function SignInAddress({ employee, officialEmail }: { employee: EnrichedEmployee; officialEmail: string }) {
  const qc = useQueryClient();
  const current = employee.loginEmail ?? null;
  const target = (officialEmail || "").trim().toLowerCase();

  const switchTo = useMutation({
    mutationFn: () => http.post<{ loginEmail: string }>(`/employees/${employee.id}/login-email`, {}),
    onSuccess: (res) => {
      toast.success(`Sign-in address changed to ${res.loginEmail}. Both addresses have been notified.`);
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!current) {
    return (
      <p className="text-xs text-muted-foreground">
        This person has no portal login yet, so there is no sign-in address to set.
      </p>
    );
  }

  const differs = !!target && target !== current.toLowerCase();

  return (
    <div className="rounded-md border p-3">
      <div className="text-sm">
        Signs in with <span className="font-medium">{current}</span>
      </div>
      {differs ? (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Their official email is different. Switching signs them out on all devices and emails
            both addresses. Save the official email first if you have just changed it.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={switchTo.isPending}
            onClick={() => switchTo.mutate()}
          >
            {switchTo.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Use {target} for sign-in
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          This is their official email, so nothing needs changing.
        </p>
      )}
    </div>
  );
}

function EditEmployeeDialog({
  employee,
  departments,
  employees,
  open,
  onOpenChange,
}: {
  employee: EnrichedEmployee;
  departments: Department[];
  employees: EnrichedEmployee[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const s = employee.salary ?? {};
  const bank = employee.bank ?? {};
  const initialPhone = splitPhone(employee.phone);
  const [form, setForm] = useState({
    firstName: employee.firstName ?? "",
    lastName: employee.lastName ?? "",
    dialCode: initialPhone.dialCode,
    phone: initialPhone.number,
    personalEmail: employee.personalEmail ?? "",
    officialEmail: employee.officialEmail ?? "",
    designation: employee.designation ?? "",
    departmentId: employee.departmentId ?? "",
    employmentType: employee.employmentType ?? "FULL_TIME",
    // Editable because it is wrong often enough to matter: it is the date every letter,
    // probation deadline and experience certificate is calculated from, and records created
    // by import or by the backfill inherit a joining date nobody chose.
    joiningDate: (employee.joiningDate as string) ?? "",
    reportsTo: (employee.reportsTo as string) ?? "",
    // Blank means "use the organisation's default", which is what most people are on.
    noticePeriodDays: employee.noticePeriodDays == null ? "" : String(employee.noticePeriodDays),
    basic: String(s.basic ?? ""),
    hra: String(s.hra ?? ""),
    allowances: String(s.allowances ?? ""),
    deductions: String(s.deductions ?? ""),
    pan: employee.pan ?? employee.kyc?.pan ?? "",
    uan: employee.uan ?? employee.kyc?.uan ?? "",
    bankAccount: bank.account ?? "",
    bankIfsc: bank.ifsc ?? "",
    bankName: bank.bankName ?? "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const managerItems = employees
    .filter((m) => m.id !== employee.id && m.status !== "EXITED")
    .map((m) => ({ value: m.id, label: employeeLabel(m) }));
  const departmentItems = departments.map((d) => ({ value: d.id, label: d.name }));

  const save = useMutation({
    mutationFn: () =>
      http.put(`/employees/${employee.id}`, {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: joinPhone(form.dialCode, form.phone),
        personalEmail: form.personalEmail,
        officialEmail: form.officialEmail,
        designation: form.designation,
        departmentId: form.departmentId,
        employmentType: form.employmentType,
        joiningDate: form.joiningDate || null,
        reportsTo: form.reportsTo || null,
        managerId: form.reportsTo || null,
        // Sent as "" when cleared, which the server reads as "back to the org default"
        // rather than as a zero-day notice period.
        noticePeriodDays: form.noticePeriodDays,
        pan: form.pan,
        uan: form.uan,
        salary: {
          basic: Number(form.basic) || 0,
          hra: Number(form.hra) || 0,
          allowances: Number(form.allowances) || 0,
          deductions: Number(form.deductions) || 0,
        },
        bank: {
          account: form.bankAccount,
          ifsc: form.bankIfsc,
          bankName: form.bankName,
        },
      }),
    onSuccess: () => {
      toast.success("Employee updated");
      qc.invalidateQueries({ queryKey: ["employees"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const text = (id: keyof typeof form, label: string, type = "text") => (
    <Field key={id} label={label} htmlFor={`edit-${id}`}>
      <Input
        id={`edit-${id}`}
        type={type}
        min={type === "number" ? 0 : undefined}
        value={form[id]}
        onChange={(e) => set(id, e.target.value)}
      />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Edit employee: {employee.firstName} {employee.lastName}
          </DialogTitle>
          <DialogDescription>
            Login email and employee code cannot be changed here.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <FormSection title="Profile" />
          <FormGrid columns={2}>
            {text("firstName", "First name")}
            {text("lastName", "Last name")}
            <Field label="Designation" htmlFor="edit-designation">
              <DesignationField id="edit-designation" value={form.designation} onChange={(v) => set("designation", v)} />
            </Field>
            <Field label="Department">
              <Select
                items={departmentItems}
                value={form.departmentId}
                onValueChange={(v) => set("departmentId", v ?? "")}
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
            {text("joiningDate", "Joining date", "date")}
            {/* No `hint` here on purpose. Field renders the hint BELOW the mt-auto
                control, so a hint on one cell of a two-up row lifts that cell's input
                clear of its neighbour's (see the KNOWN LIMIT note in ui/field.tsx).
                This cell pairs with "Joining date", which has none, so the guidance
                goes in the placeholder where it costs no vertical space. */}
            <Field label="Notice period (days)" htmlFor="edit-noticePeriodDays">
              <Input
                id="edit-noticePeriodDays"
                type="number"
                min={0}
                placeholder="Organisation default"
                value={form.noticePeriodDays}
                onChange={(e) => set("noticePeriodDays", e.target.value)}
              />
            </Field>
            <Field label="Employment type">
              <Select
                items={EMPLOYMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                value={form.employmentType}
                onValueChange={(v) => set("employmentType", v ?? "FULL_TIME")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Reports to">
              <Select
                items={managerItems}
                value={form.reportsTo}
                onValueChange={(v) => set("reportsTo", v ?? "")}
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

          <FormSection title="Contact" />
          <FormGrid columns={2}>
            <Field label="Phone" htmlFor="edit-phone" className="sm:col-span-2">
              <PhoneField
                id="edit-phone"
                dialCode={form.dialCode}
                number={form.phone}
                onDialCodeChange={(c) => set("dialCode", c)}
                onNumberChange={(v) => set("phone", v)}
              />
            </Field>
            {text("personalEmail", "Personal email", "email")}
            {text("officialEmail", "Official email", "email")}
          </FormGrid>
          <SignInAddress employee={employee} officialEmail={form.officialEmail} />

          <FormSection title="Compensation (monthly)" />
          <FormGrid columns={2}>
            {text("basic", "Basic", "number")}
            {text("hra", "HRA", "number")}
            {text("allowances", "Allowances", "number")}
            {text("deductions", "Statutory deductions (PF etc.)", "number")}
          </FormGrid>

          <FormSection title="IDs and bank" />
          <FormGrid columns={2}>
            {text("pan", "PAN")}
            {text("uan", "UAN")}
            {text("bankAccount", "Bank account")}
            {text("bankIfsc", "IFSC")}
            {text("bankName", "Bank name")}
          </FormGrid>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Staff-initiated separation (termination, absconding, retirement, end of
 *  contract). Resignations are raised by employees from the Separation page. */
function StartExitDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EnrichedEmployee;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState("TERMINATION");
  const [subReason, setSubReason] = useState("");
  const [noticeMode, setNoticeMode] = useState("DEFAULT");
  const [noticeDays, setNoticeDays] = useState("");
  const [lastWorkingDay, setLastWorkingDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState(true);
  const [documents, setDocuments] = useState<string[]>(DEFAULT_EXIT_DOCUMENTS.TERMINATION ?? []);
  const subReasons = EXIT_SUB_REASONS[type] ?? [];
  const forCause = type === "TERMINATION" && subReason === "MISCONDUCT";

  // The notice options the organisation has on record, so "Serve contractual
  // notice" can name the number instead of being an unexplained default.
  const { data: sepConfig } = useQuery({
    queryKey: ["separation-config"],
    queryFn: () => http.get<{ orgNoticeDays: number | null; fallbackNoticeDays: number }>("/separation/config"),
    enabled: open,
  });
  const contractualDays =
    Number(employee.noticePeriodDays ?? NaN) >= 0 && Number.isFinite(Number(employee.noticePeriodDays))
      ? Number(employee.noticePeriodDays)
      : (sepConfig?.orgNoticeDays ?? sepConfig?.fallbackNoticeDays ?? 30);
  const contractualSource = Number.isFinite(Number(employee.noticePeriodDays))
    ? "this employee's record"
    : sepConfig?.orgNoticeDays != null
      ? "the organisation default"
      : "the 30-day fallback";

  const resolvedLwd = previewLastWorkingDay(noticeMode, noticeDays, lastWorkingDay, contractualDays);
  const skipping = noticeMode === "SKIP" || resolvedLwd <= todayIso();

  const start = useMutation({
    mutationFn: () =>
      http.post("/separation", {
        employeeId: employee.id,
        type,
        ...(subReason ? { subReason } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        documents,
        // Issuing an experience certificate on a misconduct termination is allowed, but it
        // has to be asked for: the server refuses without this and records it when given.
        ...(forCause && documents.includes("EXPERIENCE_LETTER") ? { acknowledgeForCause: true } : {}),
        email,
        // Absconding always takes effect immediately; the backend ignores the
        // last working day for it.
        ...(type === "ABSCONDING"
          ? { noticeMode: "SKIP" }
          : {
              noticeMode,
              ...(noticeMode === "DAYS" ? { noticeDays: Number(noticeDays) || 0 } : {}),
              ...(noticeMode === "UNTIL" ? { lastWorkingDay } : {}),
            }),
      }),
    onSuccess: () => {
      toast.success("Exit started");
      qc.invalidateQueries({ queryKey: ["employees"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Start exit: {employee.firstName} {employee.lastName}
          </DialogTitle>
          <DialogDescription>Begin an HR-initiated separation for this employee.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
          className="space-y-4"
        >
          <FormGrid columns={2}>
            <Field label="Type">
              <Select
                items={EXIT_TYPES}
                value={type}
                onValueChange={(v) => {
                  const next = v ?? "TERMINATION";
                  setType(next);
                  setSubReason("");
                  // Follow the new type's suggestion, since the previous selection was
                  // about a different kind of exit.
                  setDocuments(DEFAULT_EXIT_DOCUMENTS[next] ?? []);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXIT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {subReasons.length > 0 && (
              <Field label="Sub-reason">
                <Select items={subReasons} value={subReason} onValueChange={(v) => setSubReason(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {subReasons.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </FormGrid>
          {type === "ABSCONDING" ? (
            <p className="text-xs text-muted-foreground">
              Absconding takes effect immediately; warning letters are issued from the Separation page.
            </p>
          ) : (
            <>
              <FormGrid columns={2}>
                <Field label="Notice period">
                  <Select items={NOTICE_MODES} value={noticeMode} onValueChange={(v) => setNoticeMode(v ?? "DEFAULT")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NOTICE_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.value === "DEFAULT" ? `${m.label} (${contractualDays} days)` : m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {noticeMode === "DAYS" && (
                  <Field label="Notice days" htmlFor="exit-notice-days">
                    <Input
                      id="exit-notice-days"
                      type="number"
                      min={0}
                      value={noticeDays}
                      placeholder={String(contractualDays)}
                      onChange={(e) => setNoticeDays(e.target.value)}
                    />
                  </Field>
                )}
                {noticeMode === "UNTIL" && (
                  <Field label="Last working day" htmlFor="exit-lwd">
                    <Input
                      id="exit-lwd"
                      type="date"
                      value={lastWorkingDay}
                      onChange={(e) => setLastWorkingDay(e.target.value)}
                    />
                  </Field>
                )}
              </FormGrid>
              {/* What the choice above actually does. Both consequences are stated,
                  because the status drives payroll proration and the directory, and
                  a silent "immediate exit" flag is what made this wrong before. */}
              <p
                className={
                  skipping
                    ? "rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                    : "rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                }
              >
                {skipping ? (
                  <>
                    Last working day <strong>{resolvedLwd}</strong>. No notice is served, so{" "}
                    {employee.firstName} is marked <strong>exited</strong> straight away and drops out
                    of the directory, attendance and reminders.
                  </>
                ) : (
                  <>
                    Last working day <strong>{resolvedLwd}</strong>.{" "}
                    {employee.firstName} stays on <strong>notice period</strong> until then, and their
                    final payslip is scaled to that date.
                    {noticeMode === "DEFAULT" ? ` Taken from ${contractualSource}.` : ""}
                  </>
                )}
              </p>
            </>
          )}
          <Field label="Reason" htmlFor="exit-reason">
            <Textarea
              id="exit-reason"
              placeholder="Internal note on why this exit was initiated"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          {/* Which letters this exit will produce. The type suggests a set; HR decides it.
              Editable later too, from the separation record, right up to completion. */}
          {type !== "ABSCONDING" && (
            <Field label="Letters to issue on completion">
              <div className="space-y-1.5">
                {EXIT_DOCUMENTS.map((d) => (
                  <Label key={d.value} className="flex items-start gap-2 text-sm font-normal">
                    <Checkbox
                      checked={documents.includes(d.value)}
                      onCheckedChange={(v) =>
                        setDocuments((cur) => (v ? [...cur, d.value] : cur.filter((x) => x !== d.value)))
                      }
                      className="mt-0.5"
                    />
                    <span>{d.label}</span>
                  </Label>
                ))}
                {forCause && documents.includes("EXPERIENCE_LETTER") && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    This is a termination for misconduct. An experience certificate vouches for the
                    person&apos;s service, so it is normally withheld. Issuing one is recorded in the
                    audit log.
                  </p>
                )}
                {documents.length === 0 && (
                  <p className="text-xs text-muted-foreground">No letters will be issued on completion.</p>
                )}
              </div>
            </Field>
          )}

          <Label className="flex items-start gap-2 text-sm font-normal">
            <Checkbox checked={email} onCheckedChange={(v) => setEmail(!!v)} className="mt-0.5" />
            <span>
              Email {employee.firstName} about this
              <span className="block text-xs text-muted-foreground">
                Sent to {employee.officialEmail || employee.personalEmail || employee.email}
              </span>
            </span>
          </Label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={start.isPending}>
              {start.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Start exit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Columns the /employees/import endpoint understands. departmentName is matched
// to an existing department by name; basic seeds salary (HRA/allowances derived).
const IMPORT_COLUMNS = [
  "firstName", "lastName", "email", "phone",
  "designation", "departmentName", "employmentType", "basic", "joiningDate",
];

interface ImportRow {
  firstName?: string; lastName?: string; email?: string; phone?: string;
  designation?: string; departmentName?: string; employmentType?: string;
  basic?: number | string; joiningDate?: string;
}

function BulkImportDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [sendInvite, setSendInvite] = useState(true);

  function reset() {
    setRows([]); setFileName(""); setParseError("");
  }

  function downloadTemplate() {
    const sample = [{
      firstName: "Jane", lastName: "Doe", email: "jane@company.com", phone: "+91 98765 43210",
      designation: "Software Engineer", departmentName: "Engineering", employmentType: "FULL_TIME",
      basic: 60000, joiningDate: "2026-01-15",
    }];
    const ws = XLSX.utils.json_to_sheet(sample, { header: IMPORT_COLUMNS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Employees");
    XLSX.writeFile(wb, "employee_import_template.xlsx");
  }

  async function onFile(file: File) {
    setParseError("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const firstSheet = wb.SheetNames[0];
      const sheet = firstSheet ? wb.Sheets[firstSheet] : undefined;
      if (!sheet) throw new Error("That workbook has no sheets.");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      // Normalise headers loosely (case/space-insensitive) onto the canonical keys.
      const norm = (k: string) => String(k).trim().toLowerCase().replace(/[\s_]/g, "");
      const keyMap: Record<string, string> = {};
      for (const col of IMPORT_COLUMNS) keyMap[norm(col)] = col;
      keyMap[norm("department")] = "departmentName";
      keyMap[norm("type")] = "employmentType";
      keyMap[norm("salary")] = "basic";
      const mapped: ImportRow[] = raw.map((r) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          const canon = keyMap[norm(k)];
          if (canon) out[canon] = v;
        }
        return out as ImportRow;
      }).filter((r) => r.firstName || r.email);
      if (!mapped.length) { setParseError("No rows found. Use the template and include at least a first name and email per row."); setRows([]); return; }
      setRows(mapped);
      setFileName(file.name);
    } catch {
      setParseError("Couldn't read that file. Upload a .csv or .xlsx using the template.");
      setRows([]);
    }
  }

  const valid = rows.filter((r) => r.firstName && r.email);
  const invalidCount = rows.length - valid.length;

  const importMut = useMutation({
    mutationFn: () => http.post<{ imported: number; skipped: number; invited: number; errors: { row: number; error: string }[] }>(
      "/employees/import", { rows: valid, sendInvite },
    ),
    onSuccess: (res) => {
      const parts = [`${res.imported} imported`];
      if (res.invited) parts.push(`${res.invited} emailed`);
      if (res.skipped) parts.push(`${res.skipped} skipped`);
      toast.success(parts.join(" · "));
      qc.invalidateQueries({ queryKey: ["employees"] });
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" /> Bulk import
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk import employees</DialogTitle>
            <DialogDescription>
              Upload a .csv or .xlsx of your existing employees. Download the template for the exact columns.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" /> Download template
            </Button>

            <Label className="cursor-pointer flex-col justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors hover:bg-muted/50">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {fileName || "Choose a .csv or .xlsx file"}
              </span>
              <span className="text-xs text-muted-foreground">Required columns: first name & email</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
              />
            </Label>

            {parseError && <p className="text-sm text-destructive">{parseError}</p>}

            {rows.length > 0 && (
              <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                <strong>{valid.length}</strong> employee{valid.length === 1 ? "" : "s"} ready to import
                {invalidCount > 0 && <span className="text-muted-foreground"> · {invalidCount} row{invalidCount === 1 ? "" : "s"} missing name/email (skipped)</span>}
              </div>
            )}

            <Label className="text-sm text-muted-foreground">
              <Checkbox checked={sendInvite} onCheckedChange={(v) => setSendInvite(!!v)} />
              Send each employee an onboarding email (login + set-password link)
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!valid.length || importMut.isPending} onClick={() => importMut.mutate()}>
              {importMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Import {valid.length || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const EMPTY_ADD_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  dialCode: "+91",
  phone: "",
  designation: "",
  departmentId: "",
  employmentType: "FULL_TIME",
  reportsTo: "",
  sendInvite: true,
  portalRole: "EMPLOYEE",
};

/**
 * Portal roles offerable from the employee form.
 *
 * Hiring an HR manager or an administrator is a fact about that person, so it belongs on
 * the form where they are created. Previously every new employee got an EMPLOYEE login and
 * making them an admin meant a second, separate invite from Settings > Users against the
 * same address, which produced a login with no employee record behind it.
 */
const PORTAL_ROLES = [
  { value: "EMPLOYEE", label: "Employee: their own attendance, leave and payslips" },
  { value: "MANAGER", label: "Manager: the above, plus approvals for their reports" },
  { value: "HR", label: "HR: manage people, payroll, documents and content" },
  { value: "ADMIN", label: "Admin: full access, including settings, users and roles" },
];

function AddEmployeeDialog({
  departments,
  employees,
}: {
  departments: Department[];
  employees: EnrichedEmployee[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_ADD_FORM);
  // Pay is stated as an annual CTC, the figure agreed with the candidate; the
  // server derives basic, HRA and the rest from the org's salary structure.
  const [pay, setPay] = useState<SalaryValue>({ annualCtc: null, structureId: null });

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const managerItems = employees
    .filter((m) => m.status !== "EXITED")
    .map((m) => ({ value: m.id, label: employeeLabel(m) }));

  // Set when the server reports the email belongs to an employee who was exited, so we can
  // offer to bring them back instead of showing a dead-end "email already exists".
  const [exited, setExited] = useState<{ message: string; employeeCode: string } | null>(null);
  // The email belongs to a login in this workspace that has no employee record (a staff
  // invite from Settings > Users). Such accounts never appear on the roster, so without
  // this the error names something HR cannot find anywhere.
  const [orphanUser, setOrphanUser] = useState<{ message: string; role: string } | null>(null);

  const create = useMutation({
    mutationFn: (opts?: { reactivate?: boolean; linkExistingUser?: boolean }) => {
      // dialCode is UI-only; fold it into a single phone string for the payload.
      const { dialCode, phone, reportsTo, ...rest } = form;
      return http.post<{ invite?: MailResult; reactivated?: boolean; linkedToExistingUser?: boolean }>("/employees", {
        ...rest,
        ...(opts?.reactivate ? { reactivate: true } : {}),
        ...(opts?.linkExistingUser ? { linkExistingUser: true } : {}),
        phone: joinPhone(dialCode, phone),
        // The server keeps the two in sync; both are sent to match the edit path.
        reportsTo: reportsTo || null,
        managerId: reportsTo || null,
        // The same payload Set compensation saves: the server runs the CTC through
        // the org's structure with the convention the editor previewed.
        salary: pay,
      });
    },
    onSuccess: (res) => {
      if (res?.linkedToExistingUser) toast.success("Employee record created and linked to the existing login");
      else if (res?.reactivated) toast.success("Employee reactivated with their previous record");
      // Surface the real onboarding-email delivery status, not a blanket success.
      else mailToast(res?.invite, "Employee onboarded");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["letters", "status"] });
      setExited(null);
      setOrphanUser(null);
      setOpen(false);
      setForm(EMPTY_ADD_FORM);
      setPay({ annualCtc: null, structureId: null });
    },
    onError: (e) => {
      // A 409 carries a JSON body naming the exited employee. Offer the fix rather than
      // printing "already exists" about somebody the roster no longer shows.
      const raw = apiError(e);
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.code === "EMPLOYEE_EXITED") {
          setExited({ message: parsed.message, employeeCode: parsed.employeeCode });
          return;
        }
        if (parsed?.code === "USER_WITHOUT_EMPLOYEE") {
          setOrphanUser({ message: parsed.message, role: parsed.role });
          return;
        }
      } catch {
        // not our structured conflict, fall through
      }
      toast.error(raw);
    },
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Add employee
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Onboard employee</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({});
          }}
          className="space-y-4"
        >
          <FormGrid columns={2}>
            <Field label="First name" htmlFor="firstName">
              <Input id="firstName" required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
            </Field>
            <Field label="Last name" htmlFor="lastName">
              <Input id="lastName" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="email" className="sm:col-span-2">
              <Input id="email" type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Phone" htmlFor="phone" className="sm:col-span-2">
              <PhoneField
                id="phone"
                dialCode={form.dialCode}
                number={form.phone}
                onDialCodeChange={(c) => set("dialCode", c)}
                onNumberChange={(v) => set("phone", v)}
              />
            </Field>
            <Field label="Designation" htmlFor="designation">
              <DesignationField id="designation" value={form.designation} onChange={(v) => set("designation", v)} />
            </Field>
            <Field label="Department">
              <Select
                items={departments.map((d) => ({ value: d.id, label: d.name }))}
                value={form.departmentId}
                onValueChange={(v) => set("departmentId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Employment type">
              <Select
                items={EMPLOYMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                value={form.employmentType}
                onValueChange={(v) => set("employmentType", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Reports to" className="sm:col-span-2">
              <Select
                items={managerItems}
                value={form.reportsTo}
                onValueChange={(v) => set("reportsTo", v ?? "")}
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
            <Field label="Portal access" className="sm:col-span-2">
              <Select
                items={PORTAL_ROLES}
                value={form.portalRole}
                onValueChange={(v) => set("portalRole", v ?? "EMPLOYEE")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PORTAL_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>
          <SalaryStructureEditor
            value={pay}
            onChange={setPay}
            employmentType={form.employmentType}
            dense
          />
          {/* The email belongs to somebody who was exited. They are not on the roster, so
              "already exists" alone leaves HR with nothing to click. Offer the way out. */}
          {orphanUser && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm">{orphanUser.message}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={create.isPending}
                  onClick={() => create.mutate({ linkExistingUser: true })}
                >
                  {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create and link to that login
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setOrphanUser(null)}>
                  Use a different email
                </Button>
              </div>
            </div>
          )}
          {exited && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm">{exited.message}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={create.isPending}
                  onClick={() => create.mutate({ reactivate: true })}
                >
                  {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Reactivate {exited.employeeCode}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setExited(null)}>
                  Use a different email
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !Number(pay.annualCtc)}>
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Onboard
            </Button>
          </DialogFooter>
        </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function EmployeesPage() {
  const { isStaff } = useAuth();
  const [compensationFor, setCompensationFor] = useState<EnrichedEmployee | null>(null);
  const [editFor, setEditFor] = useState<EnrichedEmployee | null>(null);
  const [exitFor, setExitFor] = useState<EnrichedEmployee | null>(null);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gridMode, setGridMode] = useState(false);
  const [gridDirty, setGridDirty] = useState(false);
  const [bulkLettersOpen, setBulkLettersOpen] = useState(false);

  const resendInvite = useMutation({
    mutationFn: (emp: EnrichedEmployee) =>
      http.post<{ invite?: MailResult }>(`/employees/${emp.id}/resend-invite`),
    onSuccess: (res) => mailToast(res?.invite, "Invite resent"),
    onError: (e) => toast.error(apiError(e)),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => http.get<Department[]>("/departments"),
  });

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: () => http.get<EnrichedEmployee[]>("/employees"),
  });

  const deptItems = [
    { value: "all", label: "All departments" },
    ...departments.map((d) => ({ value: d.id, label: d.name })),
  ];

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      if (dept !== "all" && e.departmentId !== dept) return false;
      if (q) {
        const s = q.toLowerCase();
        return `${e.firstName} ${e.lastName ?? ""} ${e.email ?? ""} ${e.code} ${e.designation ?? ""}`.toLowerCase().includes(s);
      }
      return true;
    });
  }, [employees, q, dept]);

  // Selection survives filtering (so you can search, tick, search again, tick more)
  // but every action only ever acts on what is currently on screen.
  const selectedVisible = useMemo(
    () => filtered.filter((e) => selected.has(e.id)),
    [filtered, selected],
  );

  const { data: letterStatus, isLoading: lettersLoading } = useOfferLetterStatus(isStaff);

  function toggleRow(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of filtered) {
        if (on) next.add(e.id);
        else next.delete(e.id);
      }
      return next;
    });
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));

  return (
    <>
      <PageHeader
        title="Employees"
        description="Everyone in your organisation."
        actions={isStaff ? (
          <div className="flex items-center gap-2">
            <BulkImportDialog />
            <AddEmployeeDialog departments={departments} employees={employees} />
          </div>
        ) : undefined}
      />

      {/* Sits above the roster and renders only when somebody is actually due a decision,
          so it reads as a prompt to act rather than a permanent fixture. */}
      <ProbationReviewsCard enabled={isStaff} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name, email, code..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select items={deptItems} value={dept} onValueChange={(v) => setDept(v ?? "all")}>
          <SelectTrigger className="sm:w-56">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            {deptItems.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isStaff && (
          <Button
            variant={gridMode ? "secondary" : "outline"}
            onClick={() => {
              // Leaving the grid unmounts it, and staged edits go with it.
              if (gridMode && gridDirty && !window.confirm("Discard your unsaved changes?")) return;
              setGridMode((v) => !v);
            }}
            title="Edit names, departments, managers and more directly in the table"
          >
            <Table2 className="mr-2 h-4 w-4" />
            {gridMode ? "Done editing" : "Bulk edit"}
          </Button>
        )}
      </div>

      {isStaff && selectedVisible.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-card px-3 py-2.5 shadow-[var(--elev-1)]">
          <span className="text-sm font-medium">
            {selectedVisible.length} selected
          </span>
          <Button variant="outline" size="sm" onClick={() => setBulkLettersOpen(true)}>
            <FileText className="mr-1.5 h-4 w-4" /> Issue offer letters
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            <X className="mr-1.5 h-4 w-4" /> Clear
          </Button>
        </div>
      )}

      {isStaff && gridMode ? (
        <EmployeeBulkEditGrid
          rows={filtered}
          allEmployees={employees}
          departments={departments}
          isLoading={isLoading}
          selected={selected}
          onToggleRow={toggleRow}
          onToggleAll={toggleAll}
          onDirtyChange={setGridDirty}
        />
      ) : (
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {isStaff && (
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    aria-label="Select all employees"
                    checked={allVisibleSelected}
                    onCheckedChange={(v) => toggleAll(!!v)}
                  />
                </TableHead>
              )}
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Designation</TableHead>
              <TableHead className="hidden lg:table-cell">Department</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead>Status</TableHead>
              {isStaff && <TableHead className="hidden md:table-cell">Access</TableHead>}
              {isStaff && <TableHead className="hidden lg:table-cell">Offer letter</TableHead>}
              {isStaff && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={isStaff ? 9 : 5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isStaff ? 9 : 5} className="py-12 text-center text-sm text-muted-foreground">
                  No employees found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((e) => (
                <TableRow key={e.id} data-state={selected.has(e.id) ? "selected" : undefined}>
                  {isStaff && (
                    <TableCell className="pl-4">
                      <Checkbox
                        aria-label={`Select ${e.firstName} ${e.lastName ?? ""}`.trim()}
                        checked={selected.has(e.id)}
                        onCheckedChange={(v) => toggleRow(e.id, !!v)}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="font-medium">
                      {e.firstName} {e.lastName}
                    </div>
                    <div
                      className="max-w-[16rem] truncate text-xs text-muted-foreground"
                      title={e.email ? `${e.code} · ${e.email}` : e.code}
                    >
                      {e.code} {e.email ? `· ${e.email}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{e.designation || "-"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{e.department || "-"}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {e.employmentType ? (
                      <Badge variant={TYPE_VARIANT[e.employmentType] || "grey"}>
                        {employmentTypeLabel(e.employmentType)}
                      </Badge>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[e.status] || "grey"}>{statusLabel(e.status)}</Badge>
                  </TableCell>
                  {isStaff && (
                    <TableCell className="hidden md:table-cell">
                      {e.portalRole ? (
                        <Badge variant={ROLE_VARIANT[e.portalRole] || "blue"}>{roleLabel(e.portalRole)}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">No access</span>
                      )}
                      {e.portalStatus === "DISABLED" && (
                        <span className="ml-1 text-xs text-muted-foreground">(disabled)</span>
                      )}
                    </TableCell>
                  )}
                  {isStaff && (
                    <TableCell className="hidden lg:table-cell">
                      <OfferLetterCell
                        employee={e}
                        row={letterStatus?.get(e.id)}
                        isLoading={lettersLoading}
                      />
                    </TableCell>
                  )}
                  {isStaff && (
                    <TableCell className="text-right">
                      <div className="flex items-start justify-end gap-1">
                        <Button
                          variant="ghost"
                          className="h-auto flex-col gap-1 px-2 py-1.5"
                          onClick={() => setEditFor(e)}
                        >
                          <Pencil className="size-3.5" />
                          <span className="text-[13px] font-medium leading-none">Edit</span>
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-auto flex-col gap-1 px-2 py-1.5"
                          onClick={() => setCompensationFor(e)}
                        >
                          <Banknote className="size-3.5" />
                          <span className="text-[13px] font-medium leading-none">Salary</span>
                        </Button>
                        <IssueLetterAction employee={e} />
                        <Button
                          variant="ghost"
                          className="h-auto flex-col gap-1 px-2 py-1.5"
                          disabled={resendInvite.isPending}
                          onClick={() => resendInvite.mutate(e)}
                        >
                          <Mail className="size-3.5" />
                          <span className="text-[13px] font-medium leading-none">Invite</span>
                        </Button>
                        {!NO_EXIT_STATUSES.includes(e.status) && (
                          <Button
                            variant="ghost"
                            className="h-auto flex-col gap-1 px-2 py-1.5"
                            onClick={() => setExitFor(e)}
                          >
                            <DoorOpen className="size-3.5" />
                            <span className="text-[13px] font-medium leading-none">Exit</span>
                          </Button>
                        )}
                        <RemoveEmployeeAction employee={e} />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      )}

      {bulkLettersOpen && (
        <BulkOfferLettersDialog
          open
          onOpenChange={setBulkLettersOpen}
          employees={employees}
          selectedIds={selectedVisible.map((e) => e.id)}
          statusById={letterStatus}
        />
      )}

      {compensationFor && (
        <CompensationDialog
          key={compensationFor.id}
          employee={compensationFor}
          open
          onOpenChange={(o) => {
            if (!o) setCompensationFor(null);
          }}
        />
      )}

      {editFor && (
        <EditEmployeeDialog
          key={editFor.id}
          employee={editFor}
          departments={departments}
          employees={employees}
          open
          onOpenChange={(o) => {
            if (!o) setEditFor(null);
          }}
        />
      )}

      {exitFor && (
        <StartExitDialog
          key={exitFor.id}
          employee={exitFor}
          open
          onOpenChange={(o) => {
            if (!o) setExitFor(null);
          }}
        />
      )}

    </>
  );
}
