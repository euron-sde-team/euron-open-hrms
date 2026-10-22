"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ArrowLeft,
  Users,
  Info,
  PartyPopper,
} from "lucide-react";
import { toast } from "sonner";
import { http, apiError, downloadFile } from "@/lib/api";
import { employmentTypeLabel, CURRENT_EMPLOYMENT_TYPES } from "@/lib/employment";
import { cn } from "@open-hrms/ui/cn";
import { Button } from "@open-hrms/ui/button";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Label } from "@open-hrms/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@open-hrms/ui/table";

/* ── API shapes (mirror apps/api/src/onboarding-import.ts) ────────────────── */

interface RowIssue {
  field: string;
  message: string;
}

interface NormalizedEmployee {
  firstName: string;
  lastName: string;
  email: string;
  code: string;
  employmentType: string;
  departmentName: string;
  designation: string;
  joiningDate: string;
  monthlyGross: number;
  salary: { basic: number; hra: number; allowances: number; deductions: number };
}

interface ValidatedRow {
  row: number;
  value: NormalizedEmployee | null;
  errors: RowIssue[];
  warnings: RowIssue[];
}

interface PreviewResponse {
  summary: { total: number; valid: number; invalid: number; warnings: number };
  unknownHeaders: string[];
  missingRequired: string[];
  rows: ValidatedRow[];
  rawRows: Record<string, unknown>[];
}

interface ImportResponse {
  imported: number;
  skipped: number;
  invited: number;
  warnings: number;
  errors: { row: number; problems: RowIssue[] }[];
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const formatDate = (v?: string) => {
  if (!v) return "-";
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/* ── Step 1: the welcome board ───────────────────────────────────────────── */

const STEPS = [
  {
    n: 1,
    title: "Download the template",
    body: "An Excel file pre-filled with your departments, offices and designations, plus a guide to every field.",
    icon: Download,
  },
  {
    n: 2,
    title: "Fill in your people",
    body: "One row per person. Only name, email, employment type and joining date are required, everything else can follow later.",
    icon: FileSpreadsheet,
  },
  {
    n: 3,
    title: "Upload and review",
    body: "We check every cell and show you exactly what will be created, and anything that looks wrong, before saving.",
    icon: Upload,
  },
  {
    n: 4,
    title: "Confirm",
    body: "Employees, salary structures and portal logins are created together, and joining invites go out.",
    icon: CheckCircle2,
  },
];

function WelcomeBoard({
  onFile,
  busy,
}: {
  onFile: (file: File) => void;
  busy: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      await downloadFile("/employees/import/template", "employee-onboarding-template.xlsx");
      toast.success("Template downloaded");
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setDownloading(false);
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div className="space-y-6">
      {/* Hero */}
      <Card className="overflow-hidden border-none bg-primary p-0 text-primary-foreground">
        <div className="flex flex-col gap-6 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-semibold">
              <Users className="size-4" /> Bulk onboarding
            </div>
            <h2 className="mt-4 text-[30px] leading-[36px] font-bold tracking-[-0.024em]">
              Onboard your whole team in one go.
            </h2>
            <p className="mt-3 text-[16px] leading-[23px] text-primary-foreground/80">
              Download the template, fill in your people, including their salary structure, and
              upload it. Everyone gets an employee record, a salary structure and a portal login in
              a single step.
            </p>
          </div>
          <Button
            size="lg"
            variant="outline"
            className="shrink-0 border-transparent bg-white text-[color:var(--accent-700)] hover:bg-white/90"
            onClick={downloadTemplate}
            disabled={downloading}
          >
            {downloading ? <Loader2 className="animate-spin" /> : <Download />}
            Download template
          </Button>
        </div>
      </Card>

      {/* How it works */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.n} size="sm" className="h-full">
              <div className="px-6">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-[15px] font-semibold text-primary">
                    {s.n}
                  </span>
                  <Icon className="size-5 text-muted-foreground" />
                </div>
                <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.015em]">{s.title}</h3>
                <p className="mt-1.5 text-[14px] leading-[20px] text-muted-foreground">{s.body}</p>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Drop zone */}
      <Card className="p-0">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "m-6 flex flex-col items-center justify-center rounded-[16px] border-2 border-dashed px-6 py-14 text-center transition-colors duration-200",
            dragging ? "border-primary bg-primary/5" : "border-border bg-muted/40"
          )}
        >
          <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
            <Upload className="size-6" />
          </span>
          <h3 className="mt-5 text-[19px] font-semibold tracking-[-0.018em]">
            Drop your filled-in sheet here
          </h3>
          <p className="mt-2 max-w-md text-[15px] leading-[21px] text-muted-foreground">
            Accepts .xlsx, .xls and .csv, up to 10 MB and 2,000 people per file. Nothing is saved
            until you review and confirm.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
          <Button className="mt-6" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            {busy ? "Checking your file…" : "Choose a file"}
          </Button>
        </div>
      </Card>

      {/* Type reference, the choice has statutory consequences, so say so here */}
      <Card>
        <div className="px-6">
          <div className="flex items-center gap-2.5">
            <Info className="size-5 text-muted-foreground" />
            <h3 className="text-[17px] font-semibold tracking-[-0.015em]">
              What each employment type means
            </h3>
          </div>
          <p className="mt-1.5 text-[15px] text-muted-foreground">
            The type you enter decides which statutory deductions apply, so it is worth getting
            right. You can change it per employee afterwards.
          </p>
          <Table className="mt-5">
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>PF</TableHead>
                <TableHead>ESI</TableHead>
                <TableHead>Prof. tax</TableHead>
                <TableHead>Gratuity</TableHead>
                <TableHead>Leave</TableHead>
                <TableHead className="min-w-[280px]">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CURRENT_EMPLOYMENT_TYPES.map((t) => (
                <TableRow key={t.value}>
                  <TableCell className="font-medium">{t.label}</TableCell>
                  {[t.pf, t.esi, t.professionalTax, t.gratuityEligible, t.accruesLeave].map(
                    (on, i) => (
                      <TableCell key={i}>
                        <Badge variant={on ? "green" : "grey"}>{on ? "Yes" : "No"}</Badge>
                      </TableCell>
                    )
                  )}
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

/* ── Step 2: review ──────────────────────────────────────────────────────── */

function SummaryTile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad" | "plain";
  icon: React.ElementType;
}) {
  const toneClass = {
    ok: "text-[color:var(--ok)] bg-[color:var(--ok-bg)]",
    warn: "text-[color:var(--warn)] bg-[color:var(--warn-bg)]",
    bad: "text-[color:var(--bad)] bg-[color:var(--bad-bg)]",
    plain: "text-muted-foreground bg-muted",
  }[tone];

  return (
    <Card size="sm">
      <div className="flex items-center gap-4 px-5">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", toneClass)}>
          <Icon className="size-5" />
        </span>
        <div>
          <div className="text-[26px] leading-[30px] font-semibold tabular-nums">{value}</div>
          <div className="text-[14px] text-muted-foreground">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function ReviewStep({
  preview,
  fileName,
  onBack,
  onDone,
}: {
  preview: PreviewResponse;
  fileName: string;
  onBack: () => void;
  onDone: (result: ImportResponse) => void;
}) {
  const qc = useQueryClient();
  const [sendInvite, setSendInvite] = useState(true);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [filter, setFilter] = useState<"all" | "problems">(
    preview.summary.invalid > 0 ? "problems" : "all"
  );

  const { summary, rows } = preview;
  const canImport = summary.valid > 0 && (summary.invalid === 0 || skipInvalid);

  const shown = useMemo(
    () => (filter === "problems" ? rows.filter((r) => r.errors.length || r.warnings.length) : rows),
    [rows, filter]
  );

  const commit = useMutation({
    mutationFn: () =>
      http.post<ImportResponse>("/employees/import", {
        rows: preview.rawRows,
        sendInvite,
        skipInvalid,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["onboarding-invites"] });
      onDone(res);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const downloadErrors = async () => {
    try {
      await downloadFile("/employees/import/error-report", "onboarding-errors.xlsx", {
        method: "post",
        body: { rows: preview.rawRows },
      });
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back">
            <ArrowLeft />
          </Button>
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Review before importing</h2>
            <p className="text-[15px] text-muted-foreground">
              {fileName} · nothing has been saved yet
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Rows in file" value={summary.total} tone="plain" icon={FileSpreadsheet} />
        <SummaryTile label="Ready to import" value={summary.valid} tone="ok" icon={CheckCircle2} />
        <SummaryTile label="With problems" value={summary.invalid} tone="bad" icon={XCircle} />
        <SummaryTile label="Warnings" value={summary.warnings} tone="warn" icon={AlertTriangle} />
      </div>

      {preview.missingRequired.length > 0 && (
        <Card className="border-[color:var(--bad)]">
          <div className="flex items-start gap-3 px-6">
            <XCircle className="mt-0.5 size-5 shrink-0 text-[color:var(--bad)]" />
            <div>
              <h3 className="text-[16px] font-semibold">Required columns are missing</h3>
              <p className="mt-1 text-[15px] text-muted-foreground">
                The file has no {preview.missingRequired.join(", ")} column. Download a fresh
                template and copy your data into it.
              </p>
            </div>
          </div>
        </Card>
      )}

      {preview.unknownHeaders.length > 0 && (
        <Card>
          <div className="flex items-start gap-3 px-6">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[color:var(--warn)]" />
            <div>
              <h3 className="text-[16px] font-semibold">Some columns weren&apos;t recognised</h3>
              <p className="mt-1 text-[15px] text-muted-foreground">
                These were ignored: {preview.unknownHeaders.join(", ")}. Check for a typo if you
                expected them to import.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-6">
          <div className="flex gap-2">
            {(["all", "problems"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? `All ${rows.length}` : `Needs attention ${rows.filter((r) => r.errors.length || r.warnings.length).length}`}
              </Button>
            ))}
          </div>
          {summary.invalid > 0 && (
            <Button size="sm" variant="outline" onClick={downloadErrors}>
              <Download /> Download problem rows
            </Button>
          )}
        </div>

        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Row</TableHead>
              <TableHead>Person</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead className="hidden lg:table-cell">Joining</TableHead>
              <TableHead className="hidden lg:table-cell">Monthly gross</TableHead>
              <TableHead className="min-w-[320px]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  Nothing to show here.
                </TableCell>
              </TableRow>
            ) : (
              shown.map((r) => {
                const failed = r.errors.length > 0;
                return (
                  <TableRow key={r.row} className={cn(failed && "bg-[color:var(--bad-bg)]/40")}>
                    <TableCell className="tabular-nums text-muted-foreground">{r.row}</TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {r.value
                          ? `${r.value.firstName} ${r.value.lastName}`.trim()
                          : "-"}
                      </div>
                      <div className="text-[13px] text-muted-foreground">
                        {r.value?.email || "no email"}
                        {r.value?.designation ? ` · ${r.value.designation}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.value ? (
                        <Badge variant="blue">{employmentTypeLabel(r.value.employmentType)}</Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {formatDate(r.value?.joiningDate)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell tabular-nums">
                      {r.value ? inr(r.value.monthlyGross) : "-"}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {failed ? (
                        <ul className="space-y-1">
                          {r.errors.map((e, i) => (
                            <li key={i} className="flex gap-2 text-[14px] text-[color:var(--bad)]">
                              <XCircle className="mt-0.5 size-4 shrink-0" />
                              <span>
                                <strong className="font-semibold">{e.field}:</strong> {e.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : r.warnings.length ? (
                        <ul className="space-y-1">
                          {r.warnings.map((w, i) => (
                            <li key={i} className="flex gap-2 text-[14px] text-[color:var(--warn)]">
                              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                              <span>
                                <strong className="font-semibold">{w.field}:</strong> {w.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-[14px] text-[color:var(--ok)]">
                          <CheckCircle2 className="size-4" /> Ready
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Commit bar */}
      <Card>
        <div className="flex flex-col gap-5 px-6">
          <Label className="items-start gap-3">
            <Checkbox checked={sendInvite} onCheckedChange={(v) => setSendInvite(!!v)} />
            <span>
              <span className="text-[16px] font-medium">Send joining invites</span>
              <span className="block text-[14px] text-muted-foreground">
                Each person gets a portal login and an email with their temporary password.
                Vendors and contractors are created without a login.
              </span>
            </span>
          </Label>

          {summary.invalid > 0 && (
            <Label className="items-start gap-3">
              <Checkbox checked={skipInvalid} onCheckedChange={(v) => setSkipInvalid(!!v)} />
              <span>
                <span className="text-[16px] font-medium">
                  Import the {summary.valid} good rows and skip the {summary.invalid} with problems
                </span>
                <span className="block text-[14px] text-muted-foreground">
                  Otherwise nothing is imported until every row is fixed, which usually beats
                  discovering a half-loaded roster later.
                </span>
              </span>
            </Label>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="outline" onClick={onBack}>
              Choose a different file
            </Button>
            <Button size="lg" disabled={!canImport || commit.isPending} onClick={() => commit.mutate()}>
              {commit.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              Import {summary.valid} {summary.valid === 1 ? "person" : "people"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ── Step 3: done ────────────────────────────────────────────────────────── */

function DoneStep({ result, onAgain }: { result: ImportResponse; onAgain: () => void }) {
  return (
    <Card>
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-[color:var(--ok-bg)] text-[color:var(--ok)]">
          <PartyPopper className="size-8" />
        </span>
        <h2 className="mt-6 text-[28px] leading-[34px] font-bold tracking-[-0.024em]">
          {result.imported} {result.imported === 1 ? "person" : "people"} onboarded
        </h2>
        <p className="mt-3 max-w-lg text-[16px] leading-[23px] text-muted-foreground">
          Employee records and salary structures have been created.
          {result.invited > 0
            ? ` ${result.invited} joining ${result.invited === 1 ? "invite was" : "invites were"} emailed.`
            : " No invites were sent."}
          {result.skipped > 0 ? ` ${result.skipped} row(s) were skipped.` : ""}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button variant="outline" onClick={onAgain}>
            <Upload /> Import another file
          </Button>
          <Button onClick={() => (window.location.href = "/employees")}>
            <Users /> View employees
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ── Wizard ──────────────────────────────────────────────────────────────── */

export function BulkOnboarding() {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResponse | null>(null);

  const analyse = useMutation({
    mutationFn: (file: File) => http.upload<PreviewResponse>("/employees/import/preview", file),
    onSuccess: (res) => setPreview(res),
    onError: (e) => toast.error(apiError(e)),
  });

  const handleFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("That file is over 10 MB. Split it and upload again.");
      return;
    }
    setFileName(file.name);
    analyse.mutate(file);
  };

  const reset = () => {
    setPreview(null);
    setResult(null);
    setFileName("");
  };

  if (result) return <DoneStep result={result} onAgain={reset} />;
  if (preview)
    return (
      <ReviewStep
        preview={preview}
        fileName={fileName}
        onBack={reset}
        onDone={(r) => setResult(r)}
      />
    );
  return <WelcomeBoard onFile={handleFile} busy={analyse.isPending} />;
}
