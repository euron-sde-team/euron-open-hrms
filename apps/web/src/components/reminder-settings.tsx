"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { cn } from "@open-hrms/ui/cn";
import { Badge } from "@open-hrms/ui/badge";
import { Button } from "@open-hrms/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@open-hrms/ui/card";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Input } from "@open-hrms/ui/input";
import { FieldHint } from "@open-hrms/ui/label";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Switch } from "@open-hrms/ui/switch";
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

/* ── API shapes (mirror apps/api/src/routes/push.routes.ts) ───────────────── */

interface ReminderChannels {
  inApp: boolean;
  email: boolean;
  push: boolean;
}

interface ClockInReminder {
  enabled: boolean;
  /** "HH:MM" in `timezone`. */
  time: string;
  timezone: string;
  /** 0 = Sunday .. 6 = Saturday. */
  workingDays: number[];
  channels: ReminderChannels;
}

interface ReminderSettingsResponse {
  clockIn: ClockInReminder;
  pushAvailable: boolean;
}

interface ReminderPreview {
  localDate: string;
  localTime: string;
  isWorkingDay: boolean;
  holiday: boolean;
  count: number;
  employees: { id: string; code: string; name: string }[];
}

interface SendNowResponse {
  sent: number;
  candidates?: number;
  skipped?: string | null;
  date?: string;
}

const SETTINGS_KEY = ["reminder-settings"];
const PREVIEW_KEY = ["reminder-preview"];

// Monday first: it reads as a working week, not as a calendar.
const DAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/** A short list is enough for most orgs; the browser's full zone list is used when it exposes one. */
const FALLBACK_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

function timezoneOptions(current: string): { value: string; label: string }[] {
  let zones = FALLBACK_ZONES;
  const supported = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      zones = supported("timeZone");
    } catch {
      zones = FALLBACK_ZONES;
    }
  }
  // Never drop the saved zone, even if this browser does not list it.
  const all = zones.includes(current) ? zones : [current, ...zones];
  return all.filter(Boolean).map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
}

const sameSettings = (a: ClockInReminder, b: ClockInReminder) =>
  a.enabled === b.enabled &&
  a.time === b.time &&
  a.timezone === b.timezone &&
  a.workingDays.slice().sort().join(",") === b.workingDays.slice().sort().join(",") &&
  a.channels.inApp === b.channels.inApp &&
  a.channels.email === b.channels.email &&
  a.channels.push === b.channels.push;

/* ── Send now ────────────────────────────────────────────────────────────── */

function SendNowButton({ preview }: { preview?: ReminderPreview }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const send = useMutation({
    mutationFn: () => http.post<SendNowResponse>("/push/reminders/send-now", {}),
    onSuccess: (res) => {
      if (res.skipped) toast.message(`Nothing sent: ${res.skipped.replace(/-/g, " ")}`);
      else if (res.sent === 0) toast.message("Nobody needed a reminder right now");
      else toast.success(`Reminder sent to ${res.sent} of ${res.candidates ?? res.sent}`);
      setOpen(false);
      qc.invalidateQueries({ queryKey: PREVIEW_KEY });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Send className="mr-2 size-4" /> Send now
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send the reminder now?</DialogTitle>
            <DialogDescription>
              This messages everyone on the list right away, ignoring the scheduled time and the
              working-day rule. Anyone already reminded today is left alone.
            </DialogDescription>
          </DialogHeader>
          <p className="text-[15px]">
            {preview
              ? `${preview.count} ${preview.count === 1 ? "person has" : "people have"} not clocked in.`
              : "Loading the current list."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => send.mutate()} disabled={send.isPending}>
              {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Preview ─────────────────────────────────────────────────────────────── */

function ReminderPreviewCard() {
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: PREVIEW_KEY,
    queryFn: () => http.get<ReminderPreview>("/push/reminders/preview"),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Who would be reminded right now</CardTitle>
            <CardDescription>
              The live list, computed the same way the scheduled job does: active employees with no
              attendance record today, minus approved leave and holidays.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("mr-2 size-4", isFetching && "animate-spin")} /> Refresh
            </Button>
            <SendNowButton preview={data} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError || !data ? (
          <p className="text-[15px] text-muted-foreground">
            The list could not be loaded: {apiError(error)}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[15px]">
              <Badge variant="grey">
                {data.localDate} · {data.localTime}
              </Badge>
              {data.holiday ? (
                <Badge variant="amber">Holiday</Badge>
              ) : data.isWorkingDay ? (
                <Badge variant="green">Working day</Badge>
              ) : (
                <Badge variant="amber">Not a working day</Badge>
              )}
              <span className="text-muted-foreground">
                {data.count} {data.count === 1 ? "person has" : "people have"} not clocked in
              </span>
            </div>

            {data.count === 0 ? (
              <p className="text-[15px] text-muted-foreground">
                Nobody is outstanding, so a reminder now would go to no one.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {data.employees.map((e) => (
                  <Badge key={e.id} variant="secondary">
                    {e.name} · {e.code}
                  </Badge>
                ))}
                {data.count > data.employees.length && (
                  <Badge variant="grey">+{data.count - data.employees.length} more</Badge>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Settings ────────────────────────────────────────────────────────────── */

export function ReminderSettingsTab() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => http.get<ReminderSettingsResponse>("/push/reminders"),
  });

  const [form, setForm] = useState<ClockInReminder | null>(null);
  useEffect(() => {
    if (data) setForm(data.clockIn);
  }, [data]);

  const pushAvailable = !!data?.pushAvailable;
  const zones = useMemo(() => timezoneOptions(form?.timezone || "Asia/Kolkata"), [form?.timezone]);

  const save = useMutation({
    mutationFn: (clockIn: ClockInReminder) =>
      http.put<{ clockIn: ClockInReminder }>("/push/reminders", { clockIn }),
    onMutate: async (clockIn) => {
      await qc.cancelQueries({ queryKey: SETTINGS_KEY });
      const previous = qc.getQueryData<ReminderSettingsResponse>(SETTINGS_KEY);
      if (previous) qc.setQueryData<ReminderSettingsResponse>(SETTINGS_KEY, { ...previous, clockIn });
      return { previous };
    },
    onSuccess: (res) => {
      qc.setQueryData<ReminderSettingsResponse>(SETTINGS_KEY, (old) =>
        old ? { ...old, clockIn: res.clockIn } : old,
      );
      // Working days and timezone change who is due, so the preview is now stale.
      qc.invalidateQueries({ queryKey: PREVIEW_KEY });
      toast.success("Reminder settings saved");
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(SETTINGS_KEY, ctx.previous);
      toast.error(apiError(e));
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // A server that predates the reminder routes 404s here. Say so, rather than
  // spinning on a skeleton that will never resolve.
  if (isError || !form) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clock-in reminder</CardTitle>
          <CardDescription>
            Reminder settings could not be loaded: {apiError(error)}. This server may not have the
            reminder endpoints yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const set = (patch: Partial<ClockInReminder>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setChannel = (patch: Partial<ReminderChannels>) =>
    setForm((f) => (f ? { ...f, channels: { ...f.channels, ...patch } } : f));
  const toggleDay = (day: number, on: boolean) =>
    set({
      workingDays: on
        ? [...form.workingDays, day].sort((a, b) => a - b)
        : form.workingDays.filter((d) => d !== day),
    });

  const dirty = data ? !sameSettings(form, data.clockIn) : false;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Clock-in reminder</CardTitle>
              <CardDescription>
                A daily nudge to anyone who has not clocked in yet. Off by default, because a
                message to every employee every morning is not a safe thing to switch on for them.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-sm text-muted-foreground">{form.enabled ? "On" : "Off"}</span>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => set({ enabled: !!v })}
                aria-label="Clock-in reminder"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className={cn("space-y-6", !form.enabled && "opacity-60")}>
            <FormGrid columns={2}>
              <Field
                label="Send at"
                htmlFor="reminder-time"
                hint="Local to the timezone below, not to the server."
              >
                <Input
                  id="reminder-time"
                  type="time"
                  className="sm:w-40"
                  value={form.time}
                  onChange={(e) => set({ time: e.target.value || "10:00" })}
                />
              </Field>
              <Field label="Timezone" hint="Also decides which calendar day counts as today.">
                <Select
                  items={zones}
                  value={form.timezone}
                  onValueChange={(v) => set({ timezone: String(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((z) => (
                      <SelectItem key={z.value} value={z.value}>
                        {z.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FormGrid>

            <Field
              label="Working days"
              hint="Nothing is sent on other days, or on days in the holiday calendar."
            >
              <div className="flex flex-wrap gap-4">
                {DAYS.map((d) => (
                  <label key={d.value} className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={form.workingDays.includes(d.value)}
                      onCheckedChange={(v) => toggleDay(d.value, !!v)}
                    />
                    <span className="text-[15px]">{d.label}</span>
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Channels">
              <div className="space-y-3 rounded-[12px] border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-medium">In-app notification</div>
                    <FieldHint>Appears in the bell menu. Always recorded, even if off.</FieldHint>
                  </div>
                  <Switch
                    checked={form.channels.inApp}
                    onCheckedChange={(v) => setChannel({ inApp: !!v })}
                    aria-label="In-app notification"
                  />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-medium">Email</div>
                    <FieldHint>Sent to the employee&apos;s official address.</FieldHint>
                  </div>
                  <Switch
                    checked={form.channels.email}
                    onCheckedChange={(v) => setChannel({ email: !!v })}
                    aria-label="Email"
                  />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-medium">Push notification</div>
                    <FieldHint>
                      {pushAvailable
                        ? "Only reaches employees who have switched reminders on for their own device, under Attendance. Nothing you set here can enable it for them."
                        : "Unavailable on this server: web push is not configured yet. Ask your developer to install web-push, set the VAPID keys and run the migration."}
                    </FieldHint>
                  </div>
                  <Switch
                    checked={form.channels.push && pushAvailable}
                    disabled={!pushAvailable}
                    onCheckedChange={(v) => setChannel({ push: !!v })}
                    aria-label="Push notification"
                  />
                </div>
              </div>
            </Field>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => save.mutate(form)} disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save reminder
              settings
            </Button>
            {dirty && <span className="text-[13px] text-muted-foreground">Unsaved changes</span>}
          </div>
        </CardContent>
      </Card>

      <ReminderPreviewCard />
    </div>
  );
}
