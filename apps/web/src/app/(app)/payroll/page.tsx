"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveTab } from "@/lib/use-active-tab";
import { Plus, Loader2, Download, Receipt, Upload, FileSpreadsheet, FileDown, Globe, CalendarOff, Mail, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, useOrgPayroll } from "@/lib/currency";
import type { Employee } from "@open-hrms/types";
import { PageHeader } from "@open-hrms/ui/page-header";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
import { Field } from "@open-hrms/ui/field";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@open-hrms/ui/tabs";

// ── Local types (mirror the /api/salary contract) ───────────────────────────
interface AmountLine {
  key?: string;
  label: string;
  amount: number;
}
interface Payslip {
  id: string;
  employeeId: string;
  employeeName?: string;
  month: number;
  monthName?: string;
  year: number;
  gross: number;
  totalDeductions: number;
  net: number;
  currency?: string;
  country?: string;
  employerContributions?: AmountLine[];
  emailedAt?: string | null;
  createdAt?: string;
  /** Set on a payslip that covered only part of the month (an exit, or a mid-month join). */
  prorated?: boolean;
  payableDays?: number | null;
  daysInMonth?: number | null;
  lastWorkingDay?: string | null;
}

interface PayRun {
  id: string;
  source: string;
  file?: string | null;
  periods?: string[];
  processed: number;
  succeeded: number;
  failed: number;
  netTotal: number;
  emailed?: number;
  createdAt?: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Format an amount in a specific currency (per-payslip). */
const fmt = (n: number, currency = "INR", locale = "en-IN") =>
  formatMoney(n, currency, locale);

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-");

/** Download an authenticated payslip PDF via the api (blob) instance. */
async function downloadPayslip(id: string) {
  const res = await api.get(`/salary/payslips/${id}/download`, { responseType: "blob" });
  const url = window.URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payslip-${id}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/** Download any authenticated file via the api (blob) instance under a given name. */
async function downloadBlob(url: string, name: string) {
  const res = await api.get(url, { responseType: "blob" });
  const href = window.URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(href);
}

// Response shape of POST /salary/payslips/bulk (see salary.routes.js).
interface BulkRowResult {
  row: number;
  ok: boolean;
  employee?: string;
  net?: number;
  emailed?: boolean;
  period?: string;
  error?: string;
}
interface BulkResult {
  payRunId: string;
  periods: string[];
  processed: number;
  succeeded: number;
  failed: number;
  emailed: number;
  netTotal: number;
  results: BulkRowResult[];
}

// ── Single-payslip generate dialog (staff) ──────────────────────────────────

/** A recurring salary component, at full month and scaled to the days payable. */
interface RecurringLine {
  key: string;
  label: string;
  fullMonth: number;
  suggested: number;
}

/** What GET /salary/payslip-context returns: everything needed to prefill the form. */
interface PayslipContext {
  employee: { id: string; code: string | null; name: string; status: string | null; joiningDate: string | null };
  period: { month: number; year: number; monthName: string; daysInMonth: number };
  exit: {
    partial: boolean;
    daysInMonth: number;
    payableDays: number;
    periodStart: string | null;
    periodEnd: string | null;
    lastWorkingDay: string | null;
    reason: "EXIT" | "JOIN" | "BOTH" | null;
    afterExit: boolean;
    separationType: string | null;
    separationStatus: string | null;
    typeLabel: string | null;
    noticeWaived: boolean;
    noticeDays: number | null;
  };
  recurring: RecurringLine[];
  suggestions: { leaveEncashment?: number };
  exitEarningFields: { field: string; key: string; label: string }[];
  exitDeductionFields: { field: string; key: string; label: string }[];
  /** The org's own employee-side statutory deductions, with this person's opt-outs applied. */
  statutoryComponents: { key: string; label: string; applicable: boolean; manual: boolean }[];
  currency: string;
  locale: string;
  existing: { id: string; net: number; emailedAt: string | null } | null;
}

/** What POST /salary/payslip/preview returns: the payslip, computed but not written. */
interface PayslipPreview {
  earnings: AmountLine[];
  deductions: AmountLine[];
  employerContributions: AmountLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  currency: string;
  locale: string;
  prorated: boolean;
  payableDays: number;
  daysInMonth: number;
  lastWorkingDay: string | null;
}

/** A hand-added line: a label HR writes and an amount. */
interface CustomLine {
  label: string;
  amount: string;
}

type SlipForm = {
  employeeId: string;
  month: string;
  year: string;
  /** false = pay the whole month even though the person left part-way through it. */
  prorate: boolean;
  /** Blank = use the derived figure. */
  payableDays: string;
  /** Per-component overrides, keyed by component key. Blank = use the suggestion. */
  components: Record<string, string>;
  /**
   * Per-run statutory overrides, keyed by ruleset component key.
   *
   * Deliberately a separate map from `components` above even though both end up as
   * top-level body fields: earnings and statutory deductions are different key
   * spaces today, and merging them would make a future ruleset that happens to
   * name a component "basic" silently overwrite the basic salary.
   */
  statutory: Record<string, string>;
  incentive: string;
  reimbursement: string;
  bonus: string;
  severance: string;
  noticePay: string;
  leaveEncashment: string;
  lossOfPay: string;
  otherDeductions: string;
  noticeRecovery: string;
  earningLines: CustomLine[];
  deductionLines: CustomLine[];
  email: boolean;
};

function emptySlipForm(): SlipForm {
  const now = new Date();
  return {
    employeeId: "",
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
    prorate: true,
    payableDays: "",
    components: {},
    statutory: {},
    incentive: "",
    reimbursement: "",
    bonus: "",
    severance: "",
    noticePay: "",
    leaveEncashment: "",
    lossOfPay: "",
    otherDeductions: "",
    noticeRecovery: "",
    earningLines: [],
    deductionLines: [],
    email: false,
  };
}

const MONEY_FIELDS = [
  "incentive", "reimbursement", "bonus", "severance", "noticePay", "leaveEncashment",
  "lossOfPay", "otherDeductions", "noticeRecovery",
] as const;

const cleanLines = (lines: CustomLine[]) =>
  lines
    .filter((l) => l.label.trim() && Number(l.amount))
    .map((l) => ({ label: l.label.trim(), amount: Number(l.amount) }));

/**
 * The request body for both the preview and the commit.
 *
 * BLANK MEANS "use the suggestion", and that is the whole reason the per-component
 * inputs are placeholders rather than pre-filled values. If the form pre-filled the
 * prorated amounts as text, changing the days paid afterwards would leave the old
 * figures sitting in the boxes, the server would treat them as HR's own decision
 * and use them verbatim, and the payslip would ignore the day count on its face.
 * Sending only what was actually typed keeps the server's precedence rule
 * (stated > derived) true instead of accidental.
 */
function payslipBody(form: SlipForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    employeeId: form.employeeId,
    month: Number(form.month),
    year: Number(form.year),
    // Manual run: the server pays only what is typed here; a blank row is 0,
    // never the saved structure's figure.
    manual: true,
  };
  for (const k of MONEY_FIELDS) if (form[k] !== "") body[k] = Number(form[k]) || 0;
  for (const [key, value] of Object.entries(form.components)) {
    if (value !== "") body[key] = Number(value) || 0;
  }
  // An explicit 0 here means "charge nothing this run" and must survive; the server
  // treats a supplied statutory amount as an override, including zero.
  for (const [key, value] of Object.entries(form.statutory)) {
    if (value !== "") body[key] = Number(value) || 0;
  }
  if (!form.prorate) body.prorate = false;
  if (form.payableDays !== "") body.payableDays = Number(form.payableDays);
  const earningLines = cleanLines(form.earningLines);
  const deductionLines = cleanLines(form.deductionLines);
  if (earningLines.length) body.earningLines = earningLines;
  if (deductionLines.length) body.deductionLines = deductionLines;
  return body;
}

/** A labelled amount input, laid out as one row of a money table. */
function MoneyRow({
  label, hint, value, placeholder, onChange, disabled,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <Input
        type="number"
        inputMode="decimal"
        disabled={disabled}
        className="h-8 w-32 shrink-0 text-right tabular-nums"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Rows HR adds by hand, each with its own label so it prints as written. */
function CustomLines({
  lines, onChange, addLabel, placeholder,
}: {
  lines: CustomLine[];
  onChange: (lines: CustomLine[]) => void;
  addLabel: string;
  placeholder: string;
}) {
  const set = (i: number, patch: Partial<CustomLine>) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2 px-3 py-2">
      {lines.map((line, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            className="h-8 flex-1"
            placeholder={placeholder}
            value={line.label}
            onChange={(e) => set(i, { label: e.target.value })}
          />
          <Input
            type="number"
            inputMode="decimal"
            className="h-8 w-32 shrink-0 text-right tabular-nums"
            value={line.amount}
            onChange={(e) => set(i, { amount: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Remove line"
            onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => onChange([...lines, { label: "", amount: "" }])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  );
}

/** A titled group of money rows. */
function LineGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

function GeneratePayslipDialog({
  employees,
  open,
  onOpenChange,
}: {
  employees: Employee[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<SlipForm>(emptySlipForm());
  const set = (k: keyof SlipForm, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const setComponent = (key: string, v: string) =>
    setForm((f) => ({ ...f, components: { ...f.components, [key]: v } }));
  const setStatutory = (key: string, v: string) =>
    setForm((f) => ({ ...f, statutory: { ...f.statutory, [key]: v } }));


  /*
   * Exit context, refetched whenever the person or the period changes.
   *
   * This is what makes the dialog know that the employee left on the 14th before
   * HR types anything. Without it the form could only ever offer a full month,
   * which is what it did, and paying a leaver correctly meant doing the
   * arithmetic by hand.
   */
  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["payslip-context", form.employeeId, form.month, form.year],
    queryFn: () =>
      http.get<PayslipContext>(
        `/salary/payslip-context?employeeId=${encodeURIComponent(form.employeeId)}&month=${form.month}&year=${form.year}`,
      ),
    enabled: open && !!form.employeeId,
  });

  const exit = context?.exit;
  const prorating = !!exit?.partial && form.prorate;
  const currency = context?.currency ?? "INR";
  const locale = context?.locale ?? "en-IN";

  /*
   * Only what HR types is paid (blank = 0). Filling from the saved salary copies
   * the figures INTO the boxes as HR's own input, scaled to the days paid when
   * the person left part-way, so nothing reaches the payslip unseen. Same formula
   * as the server's prorateEarnings: round2(full x days / daysInMonth).
   */
  const recurring = context?.recurring ?? [];
  const daysInMonth = exit?.daysInMonth ?? 0;
  const daysPaid = form.payableDays !== "" ? Number(form.payableDays) : (exit?.payableDays ?? daysInMonth);
  const savedFigure = (full: number) =>
    prorating && daysInMonth > 0 && daysPaid < daysInMonth
      ? Math.round(full * (Math.max(0, daysPaid) / daysInMonth) * 100) / 100
      : full;
  const fillFromSaved = () =>
    setForm((f) => ({
      ...f,
      components: Object.fromEntries(recurring.map((l) => [l.key, String(savedFigure(l.fullMonth))])),
    }));

  // A hand-added "TDS" line works, but prints as a loose line instead of under the
  // tax row the payslip and reports read. Point HR at the real row.
  const manualTaxRow = context?.statutoryComponents?.find((c) => c.manual);
  const taxTypedAsCustom =
    !!manualTaxRow &&
    form.deductionLines.some((l) => /^\s*(tds|income\s*tax)\b/i.test(l.label));

  // The body is debounced before it reaches the preview so that typing an amount
  // does not fire a request per keystroke.
  const body = payslipBody(form);
  const bodyKey = JSON.stringify(body);
  const [debouncedKey, setDebouncedKey] = useState(bodyKey);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKey(bodyKey), 350);
    return () => clearTimeout(t);
  }, [bodyKey]);

  const { data: preview, error: previewError, isFetching: previewLoading } = useQuery({
    queryKey: ["payslip-preview", debouncedKey],
    queryFn: () => http.post<PayslipPreview>("/salary/payslip/preview", JSON.parse(debouncedKey)),
    enabled: open && !!form.employeeId,
    retry: false,
    // Hold the last good figures while the next request is in flight, so the net
    // does not blink to nothing between keystrokes.
    placeholderData: (prev) => prev,
  });

  const generate = useMutation({
    mutationFn: () =>
      http.post<{ payslip: Payslip; emailed: boolean }>("/salary/payslip", { ...body, email: form.email }),
    onSuccess: (res) => {
      toast.success(`Payslip ready · net ${fmt(res.payslip.net, res.payslip.currency)}${res.emailed ? " · emailed" : ""}`);
      qc.invalidateQueries({ queryKey: ["payslips"] });
      qc.invalidateQueries({ queryKey: ["payruns"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Generate a payslip</DialogTitle>
          <DialogDescription>
            Only the amounts you enter are paid; blank rows count as 0. Use Fill from saved salary to
            start from the employee&apos;s structure (scaled to the days worked for someone who left),
            then edit any figure.
          </DialogDescription>
        </DialogHeader>

        <form
          id="generate-payslip"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.employeeId) {
              toast.error("Select an employee");
              return;
            }
            generate.mutate();
          }}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4"
        >
          {/* Four columns with Employee across two of them, rather than an even
              three-up. SelectTrigger truncates its value to fit its cell by design, so
              an even split cut real names off mid-word ("Ravi Menon (EMP-1002"). Month
              and Year need far less room than a full name plus an employee code. */}
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Employee" className="sm:col-span-2">
              <EmployeeCombobox
                employees={employees}
                value={form.employeeId}
                // Typed salary figures are what gets paid, so they must never carry
                // over from one employee to the next.
                onValueChange={(id) => setForm((f) => ({ ...f, employeeId: id, components: {} }))}
              />
            </Field>
            <Field label="Month">
              <Select
                items={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                value={form.month}
                onValueChange={(v) => set("month", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Year">
              <Input type="number" value={form.year} onChange={(e) => set("year", e.target.value)} />
            </Field>
          </div>

          {context?.existing && (
            <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
              A payslip for this period already exists (net {fmt(context.existing.net, currency, locale)}). Generating
              again replaces it{context.existing.emailedAt ? "; it has already been emailed, and that record is kept" : ""}.
            </p>
          )}

          {/* The exit banner: the single most important thing the form can say. */}
          {exit?.afterExit && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
              This employee&apos;s last working day was <strong>{fmtDate(exit.lastWorkingDay ?? undefined)}</strong>, before
              this month began. There is nothing to pay for {context?.period.monthName} {context?.period.year}.
            </p>
          )}

          {exit?.partial && !exit.afterExit && (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 dark:border-amber-900 dark:bg-amber-950/40">
              <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <strong>
                    {exit.typeLabel ?? "Exit"} · last working day {fmtDate(exit.lastWorkingDay ?? undefined)}
                  </strong>
                  <div className="mt-0.5">
                    {exit.reason === "BOTH"
                      ? `Joined and left inside this month: ${exit.payableDays} of ${exit.daysInMonth} days are payable.`
                      : `${exit.payableDays} of ${exit.daysInMonth} days are payable.`}
                    {exit.noticeWaived ? " Notice was waived." : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Label className="text-xs">
                  <Checkbox checked={form.prorate} onCheckedChange={(v) => set("prorate", !!v)} />
                  Scale to the days worked when filling from saved salary
                </Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="payable-days" className="text-xs">Days paid</Label>
                  <Input
                    id="payable-days"
                    type="number"
                    inputMode="decimal"
                    disabled={!form.prorate}
                    className="h-8 w-20 text-right tabular-nums"
                    placeholder={String(exit.payableDays)}
                    value={form.payableDays}
                    onChange={(e) => set("payableDays", e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">of {exit.daysInMonth}</span>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <LineGroup title="Earnings">
                {recurring.length > 0 && (
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      Only amounts you enter are paid. Blank rows are 0.
                    </span>
                    <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={fillFromSaved}>
                      Fill from saved salary{prorating && daysPaid < daysInMonth ? ` (${daysPaid}/${daysInMonth} days)` : ""}
                    </Button>
                  </div>
                )}
                {contextLoading && !context ? (
                  <Skeleton className="m-3 h-24" />
                ) : (
                  recurring.map((line) => (
                    <MoneyRow
                      key={line.key}
                      label={line.label}
                      hint={`Saved: ${fmt(line.fullMonth, currency, locale)} a month`}
                      value={form.components[line.key] ?? ""}
                      placeholder="0"
                      onChange={(v) => setComponent(line.key, v)}
                    />
                  ))
                )}
                <MoneyRow label="Incentive" value={form.incentive} placeholder="0" onChange={(v) => set("incentive", v)} />
                <MoneyRow label="Reimbursement" value={form.reimbursement} placeholder="0" onChange={(v) => set("reimbursement", v)} />
                <MoneyRow label="Bonus / Other" value={form.bonus} placeholder="0" onChange={(v) => set("bonus", v)} />
                <CustomLines
                  lines={form.earningLines}
                  onChange={(l) => set("earningLines", l)}
                  addLabel="Add an earning"
                  placeholder="e.g. Retention payout"
                />
              </LineGroup>


              {/* Only shown for an actual exit: these lines are meaningless otherwise
                  and would just be four more empty boxes on every ordinary payslip. */}
              {exit?.partial && !exit.afterExit && (
                <LineGroup title="Exit payments">
                  <MoneyRow
                    label="Severance / ex-gratia"
                    value={form.severance}
                    placeholder="0"
                    onChange={(v) => set("severance", v)}
                  />
                  <MoneyRow
                    label="Notice pay in lieu"
                    hint={exit.noticeWaived ? "Notice was waived on this exit" : undefined}
                    value={form.noticePay}
                    placeholder="0"
                    onChange={(v) => set("noticePay", v)}
                  />
                  <MoneyRow
                    label="Leave encashment"
                    hint={
                      context?.suggestions.leaveEncashment
                        ? `Settlement estimate: ${fmt(context.suggestions.leaveEncashment, currency, locale)}`
                        : undefined
                    }
                    value={form.leaveEncashment}
                    placeholder="0"
                    onChange={(v) => set("leaveEncashment", v)}
                  />
                </LineGroup>
              )}
            </div>

            <div className="space-y-4">
              <LineGroup title="Deductions">
                {/* Statutory rows come from the ORG'S ruleset, not a hardcoded Indian
                    list, so a UK or US org sees its own components. Each is blank by
                    default and computed by the engine; typing a figure overrides it for
                    this run, and typing 0 charges nothing, which is how HR skips PF on
                    a final settlement without touching the employee's saved record. */}
                {(context?.statutoryComponents ?? []).map((c) => (
                  <MoneyRow
                    key={c.key}
                    label={c.label}
                    // Only the exceptional case gets a per-row hint. Repeating the same
                    // sentence under every statutory row tripled the height of the panel
                    // to say one thing; it is said once in the note below instead.
                    hint={
                      !c.applicable
                        ? "Switched off for this employee"
                        : c.manual
                          ? "Not calculated automatically, enter this month's figure"
                          : undefined
                    }
                    disabled={!c.applicable}
                    value={form.statutory[c.key] ?? ""}
                    placeholder={
                      c.applicable
                        ? String(preview?.deductions.find((d) => d.key === c.key)?.amount ?? 0)
                        : "-"
                    }
                    onChange={(v) => setStatutory(c.key, v)}
                  />
                ))}
                <MoneyRow label="Loss of pay" value={form.lossOfPay} placeholder="0" onChange={(v) => set("lossOfPay", v)} />
                <MoneyRow
                  label="Other deductions"
                  value={form.otherDeductions}
                  placeholder="0"
                  onChange={(v) => set("otherDeductions", v)}
                />
                {exit?.partial && !exit.afterExit && (
                  <MoneyRow
                    label="Notice shortfall recovery"
                    hint={exit.noticeDays ? `Notice on record: ${exit.noticeDays} days` : undefined}
                    value={form.noticeRecovery}
                    placeholder="0"
                    onChange={(v) => set("noticeRecovery", v)}
                  />
                )}
                <CustomLines
                  lines={form.deductionLines}
                  onChange={(l) => set("deductionLines", l)}
                  addLabel="Add a deduction"
                  placeholder="e.g. Laptop not returned"
                />
              </LineGroup>
              {taxTypedAsCustom && manualTaxRow && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {manualTaxRow.label} has its own row above. Enter the amount there so it prints as tax on
                  the payslip, and remove the extra line so it is not deducted twice.
                </p>
              )}
              <p className="px-1 text-xs text-muted-foreground">
                Statutory amounts are computed from the earnings above using this organisation&apos;s
                payroll rules. Enter a figure to override one for this run, or <strong>0</strong> to
                skip it. To exempt someone permanently instead, use Statutory deductions on their
                compensation record.
              </p>
            </div>
          </div>

          {/* Live preview: the figures that will be written, computed by the same
              code as the commit. */}
          <div className="rounded-lg border bg-muted/30 p-3">
            {!form.employeeId ? (
              <p className="text-xs text-muted-foreground">Select an employee to preview the payslip.</p>
            ) : previewError ? (
              <p className="text-xs text-red-600 dark:text-red-400">{apiError(previewError)}</p>
            ) : !preview ? (
              <Skeleton className="h-12" />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span>Gross <strong className="text-foreground tabular-nums">{fmt(preview.gross, preview.currency, preview.locale)}</strong></span>
                  <span>Deductions <strong className="text-foreground tabular-nums">{fmt(preview.totalDeductions, preview.currency, preview.locale)}</strong></span>
                  {preview.prorated && (
                    <span>Days paid <strong className="text-foreground tabular-nums">{preview.payableDays} / {preview.daysInMonth}</strong></span>
                  )}
                </div>
                <div className="text-sm">
                  Net pay{" "}
                  <strong className="tabular-nums">{fmt(preview.net, preview.currency, preview.locale)}</strong>
                  {previewLoading && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
                {/* The exact lines that will print, so HR can tick them off against
                    finance's sheet instead of reverse-engineering a total. */}
                <details className="w-full text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Line-by-line breakdown</summary>
                  <div className="mt-2 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                    {([
                      ["Earnings", preview.earnings, preview.gross],
                      ["Deductions", preview.deductions, preview.totalDeductions],
                    ] as const).map(([title, lines, total]) => (
                      <div key={title}>
                        <div className="mb-1 font-medium text-muted-foreground">{title}</div>
                        {lines.length === 0 && <div className="text-muted-foreground">None</div>}
                        {lines.map((l, i) => (
                          <div key={`${l.key ?? l.label}-${i}`} className="flex justify-between gap-3 py-0.5">
                            <span className="truncate">{l.label}</span>
                            <span className="tabular-nums">{fmt(l.amount, preview.currency, preview.locale)}</span>
                          </div>
                        ))}
                        <div className="mt-1 flex justify-between gap-3 border-t pt-1 font-medium">
                          <span>Total</span>
                          <span className="tabular-nums">{fmt(total, preview.currency, preview.locale)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>

          <Label className="text-sm">
            <Checkbox checked={form.email} onCheckedChange={(v) => set("email", !!v)} />
            Email the payslip to the employee
          </Label>
        </form>

        {/* mx-0 mb-0 is not cosmetic: DialogFooter ships a `-mx-6 -mb-6` bleed so it
            sits flush inside a dialog with the default p-6. This dialog is p-0, so the
            bleed pushes the footer 24px OUTSIDE the popup and `overflow-hidden` clips
            the buttons. shrink-0 keeps it at full height when the body is tall.
            Same fix as the payroll-settings dialog below. */}
        <DialogFooter className="mx-0 mb-0 shrink-0 border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="generate-payslip" disabled={generate.isPending || !form.employeeId}>
            {generate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Generate
            {preview ? ` · ${fmt(preview.net, preview.currency, preview.locale)}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk-upload payslips dialog (staff) ─────────────────────────────────────
function BulkUploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { currency, locale } = useOrgPayroll();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState(false);
  // Set when a run had failures: the dialog stays open showing the
  // per-row outcome instead of burying it in a vanishing toast.
  const [result, setResult] = useState<BulkResult | null>(null);

  const reset = () => {
    setFile(null);
    setEmail(false);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const upload = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("file", file as File);
      const res = await api.post<BulkResult>(
        `/salary/payslips/bulk${email ? "?email=1" : ""}`,
        formData,
      );
      return res.data;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["payslips"] });
      qc.invalidateQueries({ queryKey: ["payruns"] });
      const emailedSuffix = r.emailed ? ` · ${r.emailed} emailed` : "";
      if (r.failed === 0) {
        toast.success(
          `Bulk run complete · ${r.succeeded}/${r.processed} payslips · net ${fmt(r.netTotal, currency, locale)}${emailedSuffix}`,
        );
        reset();
        onOpenChange(false);
        return;
      }
      toast.error(`${r.failed} of ${r.processed} rows failed. Review the errors below.`);
      setResult(r);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const failures = result?.results.filter((x) => !x.ok) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk upload payslips</DialogTitle>
          <DialogDescription>
            Upload a filled-in .xlsx or .csv file to generate many payslips at once. Download the
            template first if you haven&apos;t already.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) {
              toast.error("Choose an .xlsx or .csv file");
              return;
            }
            upload.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Excel or CSV file">
            <Input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>

          <Label className="text-sm">
            <Checkbox checked={email} onCheckedChange={(v) => setEmail(!!v)} />
            Email each payslip to the employee
          </Label>

          {result && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">
                {result.succeeded}/{result.processed} payslips generated
                {result.succeeded > 0 ? ` · net ${fmt(result.netTotal, currency, locale)}` : ""} ·{" "}
                <span className="text-destructive">{result.failed} failed</span>
              </p>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {failures.map((f) => (
                  <p key={f.row} className="text-xs text-muted-foreground">
                    <span className="font-mono font-medium text-foreground">Row {f.row}</span>
                    {f.employee ? ` (${f.employee})` : ""}: {f.error}
                  </p>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Fix the rows above in your file and upload it again. Successful rows are safe to
                re-upload: same-period payslips are overwritten, not duplicated.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {result ? "Close" : "Cancel"}
            </Button>
            <Button type="submit" disabled={upload.isPending}>
              {upload.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {result ? "Upload again" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Payslips table (shared by staff + employee views) ───────────────────────
/**
 * Send, or re-send, a payslip that already exists.
 *
 * The address is shown and editable rather than assumed. The case that forces it
 * is the one this whole change is about: somebody who has left no longer reads
 * their work mailbox, and a re-send request almost always arrives after they have
 * gone. The default follows the same rule the server uses, so what the dialog
 * shows is what will actually be used if HR does not touch it.
 */
function EmailPayslipDialog({
  slip,
  employee,
  open,
  onOpenChange,
}: {
  slip: Payslip;
  employee?: Employee;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const gone = ["EXITED", "ABSCONDING"].includes(String(employee?.status ?? ""));
  const fallback = gone
    ? employee?.personalEmail || employee?.email || employee?.officialEmail
    : employee?.email || employee?.officialEmail || employee?.personalEmail;
  const [to, setTo] = useState(fallback ?? "");

  const send = useMutation({
    mutationFn: () => http.post<{ ok: boolean; to: string }>(`/salary/payslips/${slip.id}/email`, { to: to.trim() || undefined }),
    onSuccess: (r) => {
      toast.success(`Payslip emailed to ${r.to}`);
      qc.invalidateQueries({ queryKey: ["payslips"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const period = `${slip.monthName ?? MONTHS[slip.month] ?? ""} ${slip.year}`.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{slip.emailedAt ? "Re-send payslip" : "Email payslip"}</DialogTitle>
          <DialogDescription>
            {period}
            {slip.employeeName ? ` · ${slip.employeeName}` : ""}. The stored PDF is sent exactly as it
            was issued; nothing is recalculated.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Send to" htmlFor="payslip-email-to">
            <Input
              id="payslip-email-to"
              type="email"
              value={to}
              placeholder="employee@example.com"
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          {gone && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              This employee has left, so their personal address is used by default. Their work mailbox
              is normally closed on exit.
            </p>
          )}
          {slip.emailedAt && (
            <p className="text-xs text-muted-foreground">
              Last emailed {fmtDate(slip.emailedAt)}.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {slip.emailedAt ? "Re-send" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Delete a faulty payslip, with an optional reason.
 *
 * The server revokes the payslip's verification code rather than leaving it
 * live, so a copy that already went out stops verifying as genuine and shows the
 * reason given here. That is why the reason is asked for: it is what an
 * employee or a bank sees when they scan the QR on the withdrawn copy.
 */
function DeletePayslipDialog({
  slip,
  open,
  onOpenChange,
}: {
  slip: Payslip;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const period = `${slip.monthName ?? MONTHS[slip.month] ?? ""} ${slip.year}`.trim();

  const remove = useMutation({
    mutationFn: async () =>
      (await api.delete<{ ok: boolean }>(`/salary/payslips/${slip.id}`, { data: { reason: reason.trim() || undefined } })).data,
    onSuccess: () => {
      toast.success(`Payslip for ${period} deleted`);
      qc.invalidateQueries({ queryKey: ["payslips"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete payslip?</DialogTitle>
          <DialogDescription>
            {period}
            {slip.employeeName ? ` · ${slip.employeeName}` : ""} · net {fmt(slip.net, slip.currency)}. The payslip
            and its PDF are removed from payroll and from the employee&apos;s documents. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
          className="space-y-4"
        >
          {slip.emailedAt && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              This payslip was emailed on {fmtDate(slip.emailedAt)}. The employee keeps their copy, but its QR
              code will show it as withdrawn instead of genuine.
            </p>
          )}
          <Field label="Reason (optional)" htmlFor="payslip-delete-reason">
            <Input
              id="payslip-delete-reason"
              value={reason}
              maxLength={200}
              placeholder="e.g. Wrong TDS, re-issued"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete payslip
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayslipsTable({
  slips,
  isLoading,
  showEmployee,
  employees = [],
  canEmail = false,
  canDelete = false,
}: {
  slips: Payslip[];
  isLoading: boolean;
  showEmployee: boolean;
  employees?: Employee[];
  canEmail?: boolean;
  canDelete?: boolean;
}) {
  const { locale } = useOrgPayroll();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [emailing, setEmailing] = useState<Payslip | null>(null);
  const [deleting, setDeleting] = useState<Payslip | null>(null);
  const byEmployee = new Map(employees.map((e) => [e.id, e]));

  const onDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      await downloadPayslip(id);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDownloadingId(null);
    }
  };

  const colSpan = showEmployee ? 6 : 5;

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            {showEmployee && <TableHead>Employee</TableHead>}
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Deductions</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={colSpan}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
            ))
          ) : slips.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-muted-foreground">No payslips yet.</TableCell>
            </TableRow>
          ) : (
            slips.map((p) => (
              <TableRow key={p.id}>
                {showEmployee && <TableCell className="font-medium">{p.employeeName ?? "-"}</TableCell>}
                <TableCell>
                  {p.monthName ?? MONTHS[p.month] ?? "-"} {p.year}
                  <Badge variant={p.emailedAt ? "green" : "grey"} className="ml-2">
                    {p.emailedAt ? "Emailed" : "Not emailed"}
                  </Badge>
                  {/* A part-month payslip looks like an underpayment until you know
                      why, so the row says why rather than leaving HR to open the PDF. */}
                  {p.prorated && (
                    <Badge variant="amber" className="ml-2">
                      {p.payableDays}/{p.daysInMonth} days
                      {p.lastWorkingDay ? ` · left ${fmtDate(p.lastWorkingDay)}` : ""}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{fmt(p.gross, p.currency, locale)}</TableCell>
                <TableCell className="hidden text-right sm:table-cell">{fmt(p.totalDeductions, p.currency, locale)}</TableCell>
                <TableCell className="text-right font-semibold">{fmt(p.net, p.currency, locale)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={downloadingId === p.id}
                      onClick={() => onDownload(p.id)}
                    >
                      {downloadingId === p.id ? (
                        <Loader2 className="mr-1 size-4 animate-spin" />
                      ) : (
                        <Download className="mr-1 size-4" />
                      )}
                      PDF
                    </Button>
                    {canEmail && (
                      <Button size="sm" variant="ghost" onClick={() => setEmailing(p)}>
                        <Mail className="mr-1 size-4" />
                        {p.emailedAt ? "Re-send" : "Email"}
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete payslip for ${p.monthName ?? MONTHS[p.month] ?? ""} ${p.year}`}
                        onClick={() => setDeleting(p)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {emailing && (
        <EmailPayslipDialog
          // Keyed by payslip so the address input resets between rows rather than
          // keeping whatever was typed for the previous employee.
          key={emailing.id}
          slip={emailing}
          employee={byEmployee.get(emailing.employeeId)}
          open
          onOpenChange={(o) => !o && setEmailing(null)}
        />
      )}
      {deleting && (
        <DeletePayslipDialog
          key={deleting.id}
          slip={deleting}
          open
          onOpenChange={(o) => !o && setDeleting(null)}
        />
      )}
    </Card>
  );
}

// ── Pay-run history (staff) ─────────────────────────────────────────────────
function PayRunsTable({ runs, isLoading }: { runs: PayRun[]; isLoading: boolean }) {
  const { currency, locale } = useOrgPayroll();
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead className="hidden sm:table-cell">Source</TableHead>
            <TableHead className="hidden md:table-cell">Periods</TableHead>
            <TableHead className="text-right">Payslips</TableHead>
            <TableHead className="text-right">Net total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
            ))
          ) : runs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                No pay runs yet · generate a payslip to get started.
              </TableCell>
            </TableRow>
          ) : (
            runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{fmtDate(r.createdAt)}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant="grey">{r.source}</Badge>
                  {r.file ? <span className="ml-2 text-xs text-muted-foreground">{r.file}</span> : null}
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {(r.periods ?? []).join(", ") || "-"}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={r.failed ? "red" : "green"}>
                    {r.succeeded}/{r.processed}{r.failed ? ` · ${r.failed} failed` : ""}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-semibold">{fmt(r.netTotal, currency, locale)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

// ── Country & statutory-rules settings (staff) ──────────────────────────────
interface CountryOption {
  country: string;
  label: string;
  currency: string;
  locale: string;
  builtIn?: boolean;
}
interface RuleComponent {
  key: string;
  label: string;
  type: string;
  side: string;
  calc: string;
  rate?: number;
  cap?: number | null;
  enabled?: boolean;
}
interface ProfileResponse {
  settings: { country: string; currency: string; locale: string; ctcIncludesEmployerContributions?: boolean };
  ruleset: { country: string; label: string; currency: string; locale: string; components: RuleComponent[] };
}

function PayrollSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [country, setCountry] = useState<string>("");
  const [overrides, setOverrides] = useState<Record<string, { rate?: number; enabled?: boolean }>>({});
  // null until the saved value arrives, so an unsaved toggle is distinguishable
  // from "not loaded yet" and Save stays disabled until something really changed.
  const [ctcInclusive, setCtcInclusive] = useState<boolean | null>(null);

  const { data: countries = [] } = useQuery({
    queryKey: ["salary-countries"],
    queryFn: () => http.get<CountryOption[]>("/salary/countries"),
  });
  const { data: profile, isLoading } = useQuery({
    queryKey: ["salary-profile"],
    queryFn: () => http.get<ProfileResponse>("/salary/profile"),
  });

  // Initialise the country picker from the loaded profile.
  const activeCountry = country || profile?.settings.country || "IN";
  const picked = countries.find((c) => c.country === activeCountry);
  // Has the user picked a country different from the one currently saved?
  const countryChanged = !!profile && activeCountry !== profile.settings.country;

  // Preview the PICKED country's pack (base rates, no org overrides) without
  // saving, so the table shows the right components before the user commits.
  // While the saved country is selected we use the org's effective profile ruleset.
  const { data: preview } = useQuery({
    queryKey: ["salary-ruleset", activeCountry],
    queryFn: () => http.get<{ ruleset: ProfileResponse["ruleset"] }>(`/salary/ruleset/${activeCountry}`),
    enabled: countryChanged,
  });
  // The ruleset shown in the table: previewed pack when previewing a new country,
  // else the saved org profile.
  const shownRuleset = countryChanged ? preview?.ruleset : profile?.ruleset;

  const savedCtcInclusive = profile?.settings.ctcIncludesEmployerContributions === true;
  const effectiveCtcInclusive = ctcInclusive ?? savedCtcInclusive;
  const ctcChanged = !!profile && effectiveCtcInclusive !== savedCtcInclusive;

  // Single commit: saves the picked country (if changed) AND the component
  // overrides in one call. Picking a country alone changes nothing until Save.
  const saveRules = useMutation({
    mutationFn: () =>
      http.put<ProfileResponse>("/salary/profile", {
        ...(countryChanged && picked
          ? { country: picked.country, currency: picked.currency, locale: picked.locale }
          : {}),
        ...(ctcChanged ? { ctcIncludesEmployerContributions: effectiveCtcInclusive } : {}),
        components: Object.entries(overrides).map(([key, o]) => ({ key, ...o })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org"] });
      qc.invalidateQueries({ queryKey: ["salary-profile"] });
      setOverrides({});
      setCountry("");
      setCtcInclusive(null);
      toast.success("Payroll rules saved");
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const rateOf = (c: RuleComponent) => overrides[c.key]?.rate ?? c.rate ?? 0;
  const enabledOf = (c: RuleComponent) => overrides[c.key]?.enabled ?? c.enabled !== false;
  // Save is enabled when there's something to commit: a country switch or edits.
  const hasChanges = countryChanged || ctcChanged || Object.keys(overrides).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Payroll country &amp; statutory rules</DialogTitle>
          <DialogDescription>
            Choose the country this organisation runs payroll under. Statutory components,
            rates and currency follow the selected country and can be fine-tuned below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          <div className="grid gap-2">
            <Label>Country</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={activeCountry} onValueChange={(v) => setCountry(v ?? "")}>
                <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {countries.some((c) => c.builtIn) && (
                    <div className="px-2 py-1 text-[13px] font-medium text-muted-foreground">
                      Built-in statutory rates
                    </div>
                  )}
                  {countries.filter((c) => c.builtIn).map((c) => (
                    <SelectItem key={c.country} value={c.country}>
                      {c.label} · {c.currency}
                    </SelectItem>
                  ))}
                  {countries.some((c) => !c.builtIn) && (
                    <div className="mt-1 border-t px-2 pb-1 pt-2 text-[13px] font-medium text-muted-foreground">
                      Other countries, configure rates
                    </div>
                  )}
                  {countries.filter((c) => !c.builtIn).map((c) => (
                    <SelectItem key={c.country} value={c.country}>
                      {c.label} · {c.currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {picked && (
                <span className="text-xs text-muted-foreground">
                  Currency <strong>{picked.currency}</strong> · {picked.locale}
                </span>
              )}
            </div>
            {countryChanged && (
              <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                Previewing <strong>{picked?.label}</strong>. Click <strong>Save rules</strong> to switch
                this organisation&apos;s payroll country and apply these components.
              </p>
            )}
            {picked && !picked.builtIn && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                No built-in statutory pack for {picked.label} yet, the components below default to
                0%. Set your jurisdiction&apos;s rates and save. Income tax is entered per payslip.
              </p>
            )}
          </div>

          {/* The CTC convention. It belongs beside the statutory rates because it is
              the same kind of fact: a rule every salary on the system is read under,
              not a per-employee choice. */}
          <div className="space-y-2">
            <Label>Cost to company</Label>
            <div className="rounded-lg border p-3">
              <Label className="items-start text-sm font-normal">
                <Checkbox
                  className="mt-0.5"
                  checked={effectiveCtcInclusive}
                  onCheckedChange={(v) => setCtcInclusive(!!v)}
                />
                <span>
                  <span className="font-medium">CTC includes employer contributions</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {effectiveCtcInclusive ? (
                      <>
                        A quoted CTC covers the employer&apos;s PF, ESI and other contributions, so
                        they are reserved out of it and the take-home breakup is that much smaller.
                      </>
                    ) : (
                      <>
                        A quoted CTC is the gross salary only. Employer contributions are paid on top
                        of it, so the role costs more than the figure quoted.
                      </>
                    )}
                  </span>
                </span>
              </Label>
              {ctcChanged && (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  This changes how a CTC is split from the next time one is entered. Breakups already
                  saved against an employee are left exactly as they are, so nobody&apos;s agreed pay
                  moves because a setting was flipped. Re-enter their CTC to apply it.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Statutory components</Label>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="overflow-hidden rounded-lg border">
                {/* Column header */}
                <div className="grid grid-cols-[1fr_auto_7rem_3rem] items-center gap-3 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Component</span>
                  <span className="w-16 text-center">Side</span>
                  <span className="text-right">Rate / Amount</span>
                  <span className="text-center">On</span>
                </div>
                <div className="divide-y">
                  {(shownRuleset?.components ?? []).map((c) => {
                    const unit = c.calc === "PERCENT" ? "%" : c.calc === "FLAT" ? picked?.currency ?? "" : c.calc;
                    const isManual = c.calc === "SLAB";
                    return (
                      <div
                        key={c.key}
                        className="grid grid-cols-[1fr_auto_7rem_3rem] items-center gap-3 px-3 py-2.5"
                      >
                        {/* Component name + type */}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{c.label}</div>
                          <Badge variant="grey" className="mt-0.5 text-[13px]">
                            {c.type.replace(/_/g, " ").toLowerCase()}
                          </Badge>
                        </div>
                        {/* Side */}
                        <span className="w-16 text-center text-[13px] text-muted-foreground">
                          {c.side === "EMPLOYER" ? "Employer" : "Employee"}
                        </span>
                        {/* Rate + unit, aligned as one fixed-width group */}
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            type="number"
                            inputMode="decimal"
                            disabled={isManual}
                            className="h-8 w-20 text-right tabular-nums"
                            value={isManual ? "" : rateOf(c)}
                            placeholder={isManual ? "slab" : undefined}
                            onChange={(e) =>
                              setOverrides((o) => ({ ...o, [c.key]: { ...o[c.key], rate: Number(e.target.value) } }))
                            }
                          />
                          <span className="w-8 text-left text-xs text-muted-foreground">{unit}</span>
                        </div>
                        {/* Enabled toggle */}
                        <div className="flex justify-center">
                          <Checkbox
                            checked={enabledOf(c)}
                            onCheckedChange={(v) =>
                              setOverrides((o) => ({ ...o, [c.key]: { ...o[c.key], enabled: !!v } }))
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Rates are starting points, verify slabs/brackets (income tax, NI/PAYE) with finance.
              Income-tax/withholding amounts that depend on annual projections are entered per payslip.
            </p>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-b-xl border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            disabled={!hasChanges || saveRules.isPending}
            onClick={() => saveRules.mutate()}
          >
            {saveRules.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save rules
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayrollPageInner() {
  const { isStaff } = useAuth();
  const [tab, setTab] = useActiveTab("payslips");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloading, setDownloading] = useState<"template" | "csv" | null>(null);

  const onDownloadFile = async (kind: "template" | "csv") => {
    setDownloading(kind);
    try {
      if (kind === "template") {
        await downloadBlob("/salary/template", "payslip_bulk_template.xlsx");
      } else {
        await downloadBlob("/reports/export/payroll.csv", "payroll.csv");
      }
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDownloading(null);
    }
  };

  const { data: slips = [], isLoading: slipsLoading } = useQuery({
    queryKey: ["payslips"],
    queryFn: () => http.get<Payslip[]>("/salary/payslips"),
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ["payruns"],
    queryFn: () => http.get<PayRun[]>("/salary/payruns"),
    enabled: isStaff,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => http.get<Employee[]>("/employees"),
    enabled: isStaff,
  });

  // ── Employee view: only their own payslips ────────────────────────────────
  if (!isStaff) {
    return (
      <>
        <PageHeader
          title="My payslips"
          description="View and download your monthly payslips."
        />
        <PayslipsTable slips={slips} isLoading={slipsLoading} showEmployee={false} />
      </>
    );
  }

  // ── Staff view ────────────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Run payroll, generate payslips, and review pay-run history."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Globe className="mr-2 h-4 w-4" /> Country & rules
            </Button>
            <Button
              variant="outline"
              disabled={downloading === "template"}
              onClick={() => onDownloadFile("template")}
            >
              {downloading === "template" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-2 h-4 w-4" />
              )}
              Template
            </Button>
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Bulk upload
            </Button>
            <Button
              variant="outline"
              disabled={downloading === "csv"}
              onClick={() => onDownloadFile("csv")}
            >
              {downloading === "csv" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="mr-2 h-4 w-4" />
              )}
              Export CSV
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Generate payslip
            </Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="payslips">
            <Receipt className="mr-2 h-4 w-4" /> Payslips
          </TabsTrigger>
          <TabsTrigger value="runs">Pay-run history</TabsTrigger>
        </TabsList>
        <TabsContent value="payslips" className="mt-4">
          <PayslipsTable slips={slips} isLoading={slipsLoading} showEmployee employees={employees} canEmail canDelete />
        </TabsContent>
        <TabsContent value="runs" className="mt-4">
          <PayRunsTable runs={runs} isLoading={runsLoading} />
        </TabsContent>
      </Tabs>

      {dialogOpen && (
        <GeneratePayslipDialog
          employees={employees}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}

      {bulkOpen && <BulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} />}

      {settingsOpen && <PayrollSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />}
    </>
  );
}

export default function PayrollPage() {
  return (
    <Suspense fallback={null}>
      <PayrollPageInner />
    </Suspense>
  );
}
