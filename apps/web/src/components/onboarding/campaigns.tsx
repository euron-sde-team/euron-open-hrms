"use client";

/**
 * Campaigns: send one form to a slice of the roster, with a deadline.
 *
 * The create flow is deliberately two-step. You pick an audience and SEE it, by name, with
 * anyone who would be skipped and why, before a single email goes out. Emailing several
 * hundred colleagues is not something to find out you have done.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Rocket, Users, AlertTriangle, Send, Settings2, Download } from "lucide-react";
import { toast } from "sonner";
import { http, apiError, downloadFile } from "@/lib/api";
import { Button } from "@open-hrms/ui/button";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Input } from "@open-hrms/ui/input";
import { Textarea } from "@open-hrms/ui/textarea";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Field, FormGrid } from "@open-hrms/ui/field";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@open-hrms/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@open-hrms/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@open-hrms/ui/select";
import { formatDate, dueLabel, type Audience, type AudienceMode, type AudiencePreview, type Campaign, type OnboardingTemplate } from "@/lib/onboarding-forms";

const MODES: { value: AudienceMode; label: string; help: string }[] = [
  { value: "ALL", label: "Everyone", help: "Every active employee." },
  { value: "INCOMPLETE", label: "Anyone with gaps", help: "People missing a PAN, bank account, date of birth or emergency contact." },
  { value: "DEPARTMENT", label: "Chosen departments", help: "" },
  { value: "EMPLOYMENT_TYPE", label: "Chosen employment types", help: "" },
];

const STATUS_VARIANT: Record<Campaign["status"], "green" | "amber" | "blue" | "grey" | "red"> = {
  DRAFT: "grey", LAUNCHING: "amber", RUNNING: "blue", CLOSED: "green", CANCELLED: "red",
};

function CreateCampaignDialog({ templates }: { templates: OnboardingTemplate[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    templateId: "",
    message: "",
    dueAt: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  });
  const [audience, setAudience] = useState<Audience>({ mode: "ALL" });
  const [preview, setPreview] = useState<AudiencePreview | null>(null);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => http.get<{ id: string; name: string }[]>("/departments"),
    enabled: open,
  });

  const runPreview = useMutation({
    mutationFn: () => http.post<AudiencePreview>("/onboarding-campaigns/preview", { audience }),
    onSuccess: setPreview,
    onError: (e) => toast.error(apiError(e)),
  });

  const create = useMutation({
    mutationFn: () => http.post<Campaign>("/onboarding-campaigns", { ...form, audience }),
    onSuccess: () => {
      toast.success("Campaign created as a draft. Launch it when you are ready.");
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      setOpen(false);
      setPreview(null);
      setForm({ name: "", templateId: "", message: "", dueAt: form.dueAt });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const active = templates.filter((t) => t.status === "ACTIVE");

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={active.length === 0}>
        <Plus className="size-4" /> New campaign
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send a form to your team</DialogTitle>
            <DialogDescription>
              Everyone included gets an email with a link and the deadline. Reminders and
              escalation run on their own after that.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <FormGrid columns={2}>
              <Field label="Campaign name" htmlFor="c-name" required hint="Only you see this.">
                <Input
                  id="c-name"
                  value={form.name}
                  placeholder="Records refresh, Q3"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Deadline" htmlFor="c-due" required hint="Reminders are timed against this.">
                <Input
                  id="c-due"
                  type="date"
                  value={form.dueAt}
                  onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                />
              </Field>
            </FormGrid>

            <Field label="Form to send" htmlFor="c-tpl" required>
              <Select
                items={active.map((t) => ({ value: t.id, label: t.name }))}
                value={form.templateId}
                onValueChange={(v) => setForm({ ...form, templateId: String(v) })}
              >
                <SelectTrigger id="c-tpl"><SelectValue placeholder="Choose a form" /></SelectTrigger>
                <SelectContent>
                  {active.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.summary.sections} sections
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Who should get it?" htmlFor="c-mode">
              <Select
                items={MODES.map((m) => ({ value: m.value, label: m.label }))}
                value={audience.mode}
                onValueChange={(v) => { setAudience({ mode: v as AudienceMode }); setPreview(null); }}
              >
                <SelectTrigger id="c-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {MODES.find((m) => m.value === audience.mode)?.help && (
              <p className="-mt-3 text-[12px] text-muted-foreground">
                {MODES.find((m) => m.value === audience.mode)!.help}
              </p>
            )}

            {audience.mode === "DEPARTMENT" && (
              <div className="flex flex-wrap gap-2">
                {departments.map((d) => {
                  const on = audience.departmentIds?.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      onClick={() => {
                        const ids = new Set(audience.departmentIds ?? []);
                        if (on) ids.delete(d.id); else ids.add(d.id);
                        setAudience({ ...audience, departmentIds: [...ids] });
                        setPreview(null);
                      }}
                      className={
                        "rounded-full border px-3 py-1 text-[13px] transition-colors " +
                        (on ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted")
                      }
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
            )}

            <Field label="A line for the email" htmlFor="c-msg" hint="Optional. Added above the deadline.">
              <Textarea
                id="c-msg"
                rows={2}
                value={form.message}
                placeholder="We are updating everyone's records ahead of the new payroll year."
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </Field>

            <div>
              <Button variant="outline" size="sm" onClick={() => runPreview.mutate()} disabled={runPreview.isPending}>
                {runPreview.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Users className="size-3.5" />}
                Who will get this?
              </Button>
            </div>

            {preview && (
              <Card className="space-y-3 p-4">
                <p className="text-[14px] font-medium">
                  {preview.counts.included} {preview.counts.included === 1 ? "person" : "people"} will be emailed
                </p>
                {preview.included.length > 0 && (
                  <p className="text-[12px] text-muted-foreground">
                    {preview.included.slice(0, 8).map((p) => p.name).join(", ")}
                    {preview.included.length > 8 && ` and ${preview.included.length - 8} more`}
                  </p>
                )}
                {preview.skipped.length > 0 && (
                  <div className="rounded-lg border border-[color:var(--warn)]/30 p-3">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-[color:var(--warn)]">
                      <AlertTriangle className="size-3.5" /> {preview.skipped.length} skipped
                    </p>
                    <ul className="mt-1.5 space-y-0.5 text-[12px] text-muted-foreground">
                      {preview.skipped.slice(0, 6).map((s) => (
                        <li key={s.id}>{s.name}: {s.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.name.trim() || !form.templateId || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending && <Loader2 className="size-4 animate-spin" />} Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CampaignRow({ c }: { c: Campaign }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const act = useMutation({
    mutationFn: (action: "launch" | "close" | "cancel") =>
      http.post(`/onboarding-campaigns/${c.id}/${action}`),
    onSuccess: (_d, action) => {
      toast.success(action === "launch" ? "Sending. Refresh in a moment." : `Campaign ${action}d.`);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      setConfirming(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const s = c.stats;
  const done = s.approved;
  const pct = s.total ? Math.round((done / s.total) * 100) : 0;

  return (
    <>
      <TableRow>
        <TableCell>
          <p className="font-medium">{c.name}</p>
          <p className="text-[12px] text-muted-foreground">{c.templateName}</p>
        </TableCell>
        <TableCell>
          <Badge variant={STATUS_VARIANT[c.status]}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge>
        </TableCell>
        <TableCell className="text-[13px]">
          {c.dueAt ? (
            <>
              {formatDate(c.dueAt)}
              <span className="block text-[11px] text-muted-foreground">{dueLabel(c.dueAt)}</span>
            </>
          ) : "-"}
        </TableCell>
        <TableCell>
          {s.total > 0 ? (
            <div className="min-w-[140px]">
              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{done}/{s.total} approved</span>
                {s.overdue > 0 && <span className="text-[color:var(--bad)]">{s.overdue} overdue</span>}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {s.submitted} awaiting review · {s.inProgress} in progress · {s.notStarted} not started
              </p>
            </div>
          ) : (
            <span className="text-[13px] text-muted-foreground">Not sent yet</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          {c.status === "DRAFT" && (
            <Button size="sm" onClick={() => setConfirming(true)}>
              <Rocket className="size-3.5" /> Launch
            </Button>
          )}
          {c.status === "RUNNING" && (
            <Button size="sm" variant="outline" onClick={() => act.mutate("close")}>Close</Button>
          )}
        </TableCell>
      </TableRow>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Launch “{c.name}”?</DialogTitle>
            <DialogDescription>
              Everyone in the audience is emailed straight away, with a link and a deadline of{" "}
              {formatDate(c.dueAt)}. Reminders and escalation then run on their own. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button disabled={act.isPending} onClick={() => act.mutate("launch")}>
              {act.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


interface ReminderSettings {
  enabled: boolean;
  time: string;
  timezone: string;
  workingDays: number[];
  expireAfterDays: number;
  channels: { inApp: boolean; email: boolean };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * When chasing happens, and whether an overdue form eventually closes itself.
 *
 * The sweep has always read these off the organisation, but there was no way to set them, so
 * every tenant silently ran on 10:00 Asia/Kolkata and hard-expiry could not be turned on.
 */
function ReminderSettingsDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReminderSettings | null>(null);

  const { data } = useQuery({
    queryKey: ["onboarding-reminder-settings"],
    queryFn: () => http.get<ReminderSettings>("/onboarding-campaigns/reminder-settings"),
    enabled: open,
  });

  useEffect(() => {
    if (data && open && !draft) setDraft(data);
  }, [data, open, draft]);

  const save = useMutation({
    mutationFn: (body: ReminderSettings) => http.put<ReminderSettings>("/onboarding-campaigns/reminder-settings", body),
    onSuccess: () => {
      toast.success("Reminder settings saved.");
      qc.invalidateQueries({ queryKey: ["onboarding-reminder-settings"] });
      setOpen(false);
      setDraft(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const set = (patch: Partial<ReminderSettings>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings2 className="size-3.5" /> Reminder settings
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setDraft(null);
        }}
      >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reminder settings</DialogTitle>
          <DialogDescription>
            Applies to every onboarding form with a deadline.
          </DialogDescription>
        </DialogHeader>

        {!draft ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="space-y-5">
            <label className="flex items-start gap-3">
              <Checkbox checked={draft.enabled} onCheckedChange={(v) => set({ enabled: !!v })} />
              <span>
                <span className="block text-[14px] font-medium">Send reminders</span>
                <span className="block text-[12px] text-muted-foreground">
                  Turn this off to stop all chasing without cancelling anyone&apos;s form.
                </span>
              </span>
            </label>

            <FormGrid>
              <Field label="Send at">
                <Input type="time" value={draft.time} onChange={(e) => set({ time: e.target.value })} />
              </Field>
              <Field label="Timezone" hint="The employee's local time, not the server's.">
                <Input value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} placeholder="Asia/Kolkata" />
              </Field>
            </FormGrid>

            <Field label="Only on these days">
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const on = draft.workingDays.includes(i);
                  return (
                    <Button
                      key={d}
                      type="button"
                      size="sm"
                      variant={on ? "default" : "outline"}
                      onClick={() =>
                        set({
                          workingDays: on
                            ? draft.workingDays.filter((x) => x !== i)
                            : [...draft.workingDays, i].sort(),
                        })
                      }
                    >
                      {d}
                    </Button>
                  );
                })}
              </div>
            </Field>

            <Field
              label="Close overdue forms after"
              hint="0 keeps them open indefinitely. Locking somebody out of a form they are late on rarely helps."
            >
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  className="w-24"
                  value={draft.expireAfterDays}
                  onChange={(e) => set({ expireAfterDays: Math.max(0, Number(e.target.value) || 0) })}
                />
                <span className="text-[13px] text-muted-foreground">days past the deadline</span>
              </div>
            </Field>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={save.isPending} onClick={() => save.mutate(draft)}>
                {save.isPending && <Loader2 className="size-3.5 animate-spin" />} Save
              </Button>
            </div>
          </div>
        )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Campaigns() {
  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => http.get<Campaign[]>("/onboarding-campaigns"),
    // The launch fan-out happens in a background queue, so the counts fill in shortly after.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((c: Campaign) => c.status === "LAUNCHING") ? 3000 : false,
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["onboarding-templates"],
    queryFn: () => http.get<OnboardingTemplate[]>("/onboarding-templates"),
  });

  const runReminders = useMutation({
    mutationFn: () => http.post<{ queued: number; escalated: number }>("/onboarding-campaigns/run-reminders"),
    onSuccess: (r) =>
      toast.success(
        r.queued || r.escalated
          ? `${r.queued} reminder${r.queued === 1 ? "" : "s"} and ${r.escalated} escalation${r.escalated === 1 ? "" : "s"} sent.`
          : "Nothing was due."
      ),
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          Reminders go out automatically before and after the deadline.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadFile("/onboarding-cases/export.csv", "onboarding-cases.csv").catch(() =>
                toast.error("Could not export")
              )
            }
          >
            <Download className="size-3.5" /> Export
          </Button>
          <ReminderSettingsDialog />
          <Button variant="outline" size="sm" disabled={runReminders.isPending} onClick={() => runReminders.mutate()}>
            {runReminders.isPending && <Loader2 className="size-3.5 animate-spin" />} Send due reminders now
          </Button>
          <CreateCampaignDialog templates={templates} />
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-44 w-full" />
      ) : campaigns.length === 0 ? (
        <Card className="p-10 text-center">
          <Users className="mx-auto size-7 text-muted-foreground" />
          <p className="mt-3 text-[15px] font-medium">No campaigns yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {templates.some((t) => t.status === "ACTIVE")
              ? "Create one to ask your team for their details, with a deadline."
              : "Activate an onboarding form first, under the Forms tab."}
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => <CampaignRow key={c.id} c={c} />)}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
