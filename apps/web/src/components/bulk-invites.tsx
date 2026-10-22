"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Loader2, Plus, Settings2, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { cn } from "@open-hrms/ui/cn";
import {
  DEFAULT_INVITE_TYPE,
  INVITE_EMPLOYMENT_TYPES,
  isEmail,
  parsePastedCandidates,
  todayISO,
  type BatchInviteResponse,
  type InviteDepartment,
  type InviteManagerOption,
  type InvitePayload,
  type OnboardingInvite,
} from "@/lib/onboarding";
import { Badge } from "@open-hrms/ui/badge";
import { Button } from "@open-hrms/ui/button";
import { Card } from "@open-hrms/ui/card";
import { Input } from "@open-hrms/ui/input";
import { FieldHint, FieldError } from "@open-hrms/ui/label";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Textarea } from "@open-hrms/ui/textarea";
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

/** The server refuses anything larger, and says so; stop it before the round trip. */
const MAX_ROWS = 200;

/** Fields that can be set once for everyone and overridden per row. */
interface SharedDefaults {
  departmentId: string;
  employmentType: string;
  joiningDate: string;
  reportsTo: string;
  salaryBasic: string;
}

/** Only the keys a row actually overrode are stored, so editing a default still
 * flows through to every row that did not opt out. */
type RowOverrides = Partial<SharedDefaults>;

interface Row {
  key: string;
  personalEmail: string;
  firstName: string;
  lastName: string;
  designation: string;
  overrides: RowOverrides;
}

type OutcomeKind = "created" | "skipped" | "failed";
interface Outcome {
  kind: OutcomeKind;
  message: string;
}

let rowSeq = 0;
function newRow(partial: Partial<Row> = {}): Row {
  rowSeq += 1;
  return {
    key: `row-${rowSeq}`,
    personalEmail: "",
    firstName: "",
    lastName: "",
    designation: "",
    overrides: {},
    ...partial,
  };
}

function emptyDefaults(): SharedDefaults {
  return {
    departmentId: "",
    employmentType: DEFAULT_INVITE_TYPE,
    joiningDate: todayISO(),
    reportsTo: "",
    salaryBasic: "",
  };
}

/** A row is worth sending once it carries anything at all. */
function isBlank(r: Row): boolean {
  return !r.personalEmail.trim() && !r.firstName.trim() && !r.lastName.trim() && !r.designation.trim();
}

function toPayload(row: Row, defaults: SharedDefaults): InvitePayload {
  const merged = { ...defaults, ...row.overrides };
  return {
    personalEmail: row.personalEmail.trim().toLowerCase(),
    firstName: row.firstName.trim(),
    lastName: row.lastName.trim(),
    designation: row.designation.trim(),
    annualCtc: null,
    salaryStructureId: null,
    departmentId: merged.departmentId || null,
    employmentType: merged.employmentType,
    joiningDate: merged.joiningDate || todayISO(),
    reportsTo: merged.reportsTo || null,
    salaryBasic: Number(merged.salaryBasic) > 0 ? Number(merged.salaryBasic) : null,
  };
}

const OUTCOME_META: Record<OutcomeKind, { variant: "green" | "amber" | "red"; label: string }> = {
  created: { variant: "green", label: "Sent" },
  skipped: { variant: "amber", label: "Skipped" },
  failed: { variant: "red", label: "Failed" },
};

/* ── Paste box ───────────────────────────────────────────────────────────── */

function PasteEmails({ onAdd }: { onAdd: (rows: Row[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const parsed = useMemo(() => parsePastedCandidates(text), [text]);

  const add = () => {
    onAdd(
      parsed.map((c) =>
        newRow({ personalEmail: c.email, firstName: c.firstName, lastName: c.lastName }),
      ),
    );
    setText("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ClipboardPaste className="mr-2 size-4" /> Paste emails
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-[12px] border border-border bg-muted/40 p-3">
      <Field
        label="Paste a list of candidates"
        htmlFor="paste-emails"
        hint={
          <>
            Newline, comma, semicolon or tab separated. A name beside an address (Meera Nair
            &lt;meera@example.com&gt;) fills the name columns too.
          </>
        }
      >
        <Textarea
          id="paste-emails"
          rows={4}
          autoFocus
          placeholder={"asha@example.com, ravi@example.com\nMeera Nair <meera@example.com>"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={add} disabled={parsed.length === 0}>
          Add {parsed.length || ""} {parsed.length === 1 ? "row" : "rows"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setText("");
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── The dialog ──────────────────────────────────────────────────────────── */

export function BulkInvitesDialog({ departments }: { departments: InviteDepartment[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [defaults, setDefaults] = useState<SharedDefaults>(emptyDefaults);
  const [rows, setRows] = useState<Row[]>(() => [newRow(), newRow(), newRow()]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  // Managers are only needed once the dialog is open.
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => http.get<InviteManagerOption[]>("/employees"),
    enabled: open,
  });

  const managerItems = useMemo(
    () =>
      employees
        .filter((e) => e.status !== "EXITED")
        .map((e) => ({
          value: e.id,
          label: `${e.firstName} ${e.lastName || ""}`.trim() + (e.code ? ` (${e.code})` : ""),
        })),
    [employees],
  );
  const departmentItems = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })),
    [departments],
  );

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setOverride = (key: string, patch: RowOverrides) =>
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, overrides: { ...r.overrides, ...patch } } : r)),
    );

  const active = rows.filter((r) => !isBlank(r));
  const invalidEmails = active.filter((r) => !isEmail(r.personalEmail));

  // Client-side duplicate flag. The server is still the authority (it also
  // checks against invites created earlier), this just catches it sooner.
  const dupKeys = useMemo(() => {
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const r of active) {
      const email = r.personalEmail.trim().toLowerCase();
      if (!email) continue;
      if (seen.has(email)) dups.add(r.key);
      seen.add(email);
    }
    return dups;
  }, [active]);

  const tooMany = active.length > MAX_ROWS;
  const canSubmit = active.length > 0 && invalidEmails.length === 0 && !tooMany;

  const reset = () => {
    setRows([newRow(), newRow(), newRow()]);
    setDefaults(emptyDefaults());
    setOutcomes({});
    setExpanded(null);
  };

  const send = useMutation({
    mutationFn: async () => {
      // Snapshot the rows in submit order: the response reports failures and
      // skips by array index, and that is the only way back to a row.
      const submitted = active;
      const res = await http.post<BatchInviteResponse>("/onboarding/invites", {
        invites: submitted.map((r) => toPayload(r, defaults)),
      });
      return { res, submitted };
    },
    onSuccess: ({ res, submitted }) => {
      const byIndex = new Map<number, Outcome>();
      for (const f of res.failed) byIndex.set(f.index, { kind: "failed", message: f.error });
      for (const s of res.skipped) byIndex.set(s.index, { kind: "skipped", message: s.reason });

      // Anything the server did not report as failed or skipped was created.
      // `created[]` carries no index, so match on email to surface its mail result.
      const createdByEmail = new Map(
        res.created.map((c) => [String(c.personalEmail).toLowerCase(), c]),
      );
      const next: Record<string, Outcome> = {};
      submitted.forEach((row, i) => {
        const reported = byIndex.get(i);
        if (reported) {
          next[row.key] = reported;
          return;
        }
        const created = createdByEmail.get(row.personalEmail.trim().toLowerCase());
        next[row.key] = {
          kind: "created",
          message:
            created?.mail?.delivered === false
              ? `Invite created, but the email failed: ${created.mail?.error || "unknown error"}`
              : created?.mail?.mode === "outbox"
                ? "Invite created, email saved to outbox"
                : "Invite sent",
        };
      });
      setOutcomes(next);

      // The response holds the full invite records, so seed the list instead of
      // waiting for a refetch, then reconcile in the background.
      if (res.created.length) {
        qc.setQueryData<OnboardingInvite[]>(["onboarding-invites"], (old) =>
          old ? [...res.created, ...old] : res.created,
        );
      }
      qc.invalidateQueries({ queryKey: ["onboarding-invites"] });

      const parts = [`${res.created.length} sent`];
      if (res.skipped.length) parts.push(`${res.skipped.length} skipped`);
      if (res.failed.length) parts.push(`${res.failed.length} failed`);
      const summary = parts.join(", ");
      if (res.failed.length) toast.error(`Invites: ${summary}`);
      else toast.success(`Invites: ${summary}`);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const result = send.data?.res;
  const dropSettledRows = () =>
    setRows((rs) => {
      const kept = rs.filter((r) => outcomes[r.key]?.kind !== "created" && outcomes[r.key]?.kind !== "skipped");
      return kept.length ? kept : [newRow()];
    });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UsersRound className="mr-2 h-4 w-4" /> Invite several people
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Starting fresh next time is right: the rows just sent are now in
          // the invites table below.
          if (!next && result) reset();
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Invite a joining class</DialogTitle>
            <DialogDescription>
              Set what everyone shares once, paste or type the candidates, and send every
              onboarding link in one go. Each row can override the shared values.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Shared defaults */}
            <Card size="sm" className="gap-3 bg-muted/40 p-4">
              <div className="text-[15px] font-medium">Applies to every row</div>
              {/* Four across on large screens, which FormGrid does not express on its own. */}
              <FormGrid columns={2} className="lg:grid-cols-4">
                <Field label="Department">
                  <Select
                    items={departmentItems}
                    value={defaults.departmentId}
                    onValueChange={(v) => setDefaults((d) => ({ ...d, departmentId: String(v) }))}
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
                <Field label="Employment type">
                  <Select
                    items={INVITE_EMPLOYMENT_TYPES}
                    value={defaults.employmentType}
                    onValueChange={(v) => setDefaults((d) => ({ ...d, employmentType: String(v) }))}
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
                <Field label="Joining date" htmlFor="bulk-joining">
                  <Input
                    id="bulk-joining"
                    type="date"
                    value={defaults.joiningDate}
                    onChange={(e) => setDefaults((d) => ({ ...d, joiningDate: e.target.value }))}
                  />
                </Field>
                <Field label="Reports to">
                  <Select
                    items={managerItems}
                    value={defaults.reportsTo}
                    onValueChange={(v) => setDefaults((d) => ({ ...d, reportsTo: String(v) }))}
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
            </Card>

            {/* Rows */}
            <div className="space-y-2">
              <div className="hidden gap-3 px-1 text-[13px] text-muted-foreground sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                <span>Personal email</span>
                <span>First name</span>
                <span>Last name</span>
                <span>Designation</span>
                <span className="w-[76px]" />
              </div>

              {rows.map((row) => {
                const outcome = outcomes[row.key];
                const emailInvalid = !isBlank(row) && !isEmail(row.personalEmail);
                const overridden = Object.keys(row.overrides).length > 0;
                const merged = { ...defaults, ...row.overrides };
                return (
                  <div key={row.key} className="space-y-2">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                      <div className="space-y-1">
                        <Input
                          type="email"
                          aria-label="Personal email"
                          aria-invalid={emailInvalid || undefined}
                          placeholder="candidate@example.com"
                          value={row.personalEmail}
                          onChange={(e) => setRow(row.key, { personalEmail: e.target.value })}
                        />
                        {emailInvalid && <FieldError>Enter a valid email.</FieldError>}
                        {dupKeys.has(row.key) && !emailInvalid && (
                          <FieldHint>Duplicate of a row above; it will be skipped.</FieldHint>
                        )}
                      </div>
                      <Input
                        aria-label="First name"
                        placeholder="First"
                        value={row.firstName}
                        onChange={(e) => setRow(row.key, { firstName: e.target.value })}
                      />
                      <Input
                        aria-label="Last name"
                        placeholder="Last"
                        value={row.lastName}
                        onChange={(e) => setRow(row.key, { lastName: e.target.value })}
                      />
                      <Input
                        aria-label="Designation"
                        placeholder="Designation"
                        value={row.designation}
                        onChange={(e) => setRow(row.key, { designation: e.target.value })}
                      />
                      <div className="flex items-start gap-1">
                        <Button
                          type="button"
                          variant={overridden ? "secondary" : "ghost"}
                          size="icon"
                          aria-label="Row settings"
                          title="Override the shared values for this row"
                          onClick={() => setExpanded((k) => (k === row.key ? null : row.key))}
                        >
                          <Settings2 className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove row"
                          disabled={rows.length === 1}
                          onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>

                    {outcome && (
                      <div className="flex items-center gap-2 px-1">
                        <Badge variant={OUTCOME_META[outcome.kind].variant}>
                          {OUTCOME_META[outcome.kind].label}
                        </Badge>
                        <span
                          className={cn(
                            "text-[13px]",
                            outcome.kind === "failed" ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {outcome.message}
                        </span>
                      </div>
                    )}

                    {expanded === row.key && (
                      <FormGrid
                        columns={2}
                        className="rounded-[12px] border border-border bg-muted/40 p-3 lg:grid-cols-5"
                      >
                        <Field label="Department">
                          <Select
                            items={departmentItems}
                            value={merged.departmentId}
                            onValueChange={(v) => setOverride(row.key, { departmentId: String(v) })}
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
                        <Field label="Employment type">
                          <Select
                            items={INVITE_EMPLOYMENT_TYPES}
                            value={merged.employmentType}
                            onValueChange={(v) => setOverride(row.key, { employmentType: String(v) })}
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
                        <Field label="Joining date">
                          <Input
                            type="date"
                            value={merged.joiningDate}
                            onChange={(e) => setOverride(row.key, { joiningDate: e.target.value })}
                          />
                        </Field>
                        <Field label="Reports to">
                          <Select
                            items={managerItems}
                            value={merged.reportsTo}
                            onValueChange={(v) => setOverride(row.key, { reportsTo: String(v) })}
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
                        <Field label="Monthly basic">
                          <Input
                            type="number"
                            min={0}
                            placeholder="e.g. 60000"
                            value={merged.salaryBasic}
                            onChange={(e) => setOverride(row.key, { salaryBasic: e.target.value })}
                          />
                        </Field>
                        <div className="lg:col-span-5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={!overridden}
                            onClick={() => setRow(row.key, { overrides: {} })}
                          >
                            Use the shared values
                          </Button>
                        </div>
                      </FormGrid>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows((rs) => [...rs, newRow()])}
              >
                <Plus className="mr-2 size-4" /> Add row
              </Button>
              <PasteEmails onAdd={(added) => setRows((rs) => [...rs.filter((r) => !isBlank(r)), ...added])} />
              {result && (
                <Button type="button" variant="ghost" size="sm" onClick={dropSettledRows}>
                  Clear sent and skipped rows
                </Button>
              )}
              <span className="ml-auto text-[13px] text-muted-foreground">
                {active.length} of {MAX_ROWS}
              </span>
            </div>

            {tooMany && (
              <FieldError>
                Up to {MAX_ROWS} candidates per send. Remove {active.length - MAX_ROWS} row
                {active.length - MAX_ROWS === 1 ? "" : "s"} and send the rest separately.
              </FieldError>
            )}

            {result && (
              <div className="rounded-[12px] border border-border p-3 text-[15px]">
                <span className="font-medium">{result.created.length} sent</span>
                {result.skipped.length > 0 && <span>, {result.skipped.length} skipped</span>}
                {result.failed.length > 0 && (
                  <span className="text-destructive">, {result.failed.length} failed</span>
                )}
                <FieldHint className="mt-1">
                  Fix anything marked failed and send again. Rows already sent are skipped by the
                  server, so a second send cannot double-invite anyone.
                </FieldHint>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => send.mutate()} disabled={!canSubmit || send.isPending}>
              {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send {active.length || ""} {active.length === 1 ? "invite" : "invites"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
