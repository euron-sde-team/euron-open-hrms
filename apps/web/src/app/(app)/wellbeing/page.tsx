"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BookOpen,
  Loader2,
  HeartPulse,
  Phone,
  Users,
  LifeBuoy,
  Settings2,
  Wind,
} from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Label } from "@open-hrms/ui/label";
import { Field } from "@open-hrms/ui/field";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Input } from "@open-hrms/ui/input";
import { Separator } from "@open-hrms/ui/separator";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Textarea } from "@open-hrms/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@open-hrms/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@open-hrms/ui/table";

// Local interfaces, matching the /wellbeing backend contract ----------------
interface CheckIn {
  id: string;
  employeeId: string;
  date: string;
  mood: number;
  stress: number;
  workload: number;
  note: string;
  anonymous: boolean;
}

interface MyWellbeing {
  today: CheckIn | null;
  recent: CheckIn[];
}

interface PulseFlag {
  name: string;
  date: string;
  stress: number;
  mood: number;
  note: string;
}

interface Pulse {
  from: string;
  checkins: number;
  participants: number;
  avgMood: number;
  avgStress: number;
  avgWorkload: number;
  flags: PulseFlag[];
}

interface CheckInForm {
  mood: number;
  stress: number;
  workload: number;
  note: string;
  anonymous: boolean;
}

interface WellbeingResource {
  title: string;
  category: string;
  desc: string;
  content: string;
  action?: string | null;
  actionLabel?: string;
  eapPhone?: string | null;
}

const MOOD_LABELS: Record<number, string> = {
  1: "Very low",
  2: "Low",
  3: "Okay",
  4: "Good",
  5: "Great",
};

const STRESS_LABELS: Record<number, string> = {
  1: "Very calm",
  2: "Calm",
  3: "Moderate",
  4: "High",
  5: "Very high",
};

const WORKLOAD_LABELS: Record<number, string> = {
  1: "Very light",
  2: "Light",
  3: "Balanced",
  4: "Heavy",
  5: "Overloaded",
};

function moodVariant(mood: number): "green" | "amber" | "red" {
  if (mood >= 4) return "green";
  if (mood === 3) return "amber";
  return "red";
}

function stressVariant(stress: number): "green" | "amber" | "red" {
  if (stress >= 4) return "red";
  if (stress === 3) return "amber";
  return "green";
}

function ScalePicker({
  label,
  value,
  labels,
  onChange,
}: {
  label: string;
  value: number;
  labels: Record<number, string>;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="text-xs text-muted-foreground">{labels[value]}</span>
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            type="button"
            size="sm"
            variant={value === n ? "default" : "outline"}
            className="h-9 flex-1"
            onClick={() => onChange(n)}
          >
            {n}
          </Button>
        ))}
      </div>
    </div>
  );
}

function CheckInCard({ today }: { today: CheckIn | null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CheckInForm>({
    mood: today?.mood ?? 3,
    stress: today?.stress ?? 3,
    workload: today?.workload ?? 3,
    note: today?.note ?? "",
    anonymous: today?.anonymous ?? true,
  });
  const set = <K extends keyof CheckInForm>(k: K, v: CheckInForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => http.post<CheckIn>("/wellbeing/checkin", form),
    onSuccess: () => {
      toast.success(today ? "Check-in updated for today" : "Thanks for checking in");
      qc.invalidateQueries({ queryKey: ["wellbeing", "me"] });
      qc.invalidateQueries({ queryKey: ["wellbeing", "pulse"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-2">
        <HeartPulse className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">How are you feeling today?</h2>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        {today
          ? "You've already checked in today, feel free to update it."
          : "A quick pulse on your day. Only aggregates are shared with HR unless you opt out of anonymity."}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-5"
      >
        <ScalePicker label="Mood" value={form.mood} labels={MOOD_LABELS} onChange={(v) => set("mood", v)} />
        <ScalePicker label="Stress" value={form.stress} labels={STRESS_LABELS} onChange={(v) => set("stress", v)} />
        <ScalePicker label="Workload" value={form.workload} labels={WORKLOAD_LABELS} onChange={(v) => set("workload", v)} />

        <Field label="Anything on your mind? (optional)">
          <Textarea
            rows={3}
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Share what's going well or what's weighing on you."
          />
        </Field>

        <Label className="text-sm">
          <Checkbox checked={form.anonymous} onCheckedChange={(v) => set("anonymous", !!v)} />
          Keep my check-in anonymous to HR
        </Label>
        <p className="text-xs text-muted-foreground">
          If you turn this off and report high stress or low mood, HR may reach out to support you.
        </p>

        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {today ? "Update check-in" : "Submit check-in"}
        </Button>
      </form>
    </Card>
  );
}

function HistoryCard({ recent }: { recent: CheckIn[] }) {
  return (
    <Card>
      <div className="border-b p-4">
        <h2 className="font-semibold">Your recent check-ins</h2>
        <p className="text-sm text-muted-foreground">Your last 30 days of pulse check-ins.</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Mood</TableHead>
            <TableHead className="hidden sm:table-cell">Stress</TableHead>
            <TableHead className="hidden md:table-cell">Workload</TableHead>
            <TableHead className="hidden lg:table-cell">Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recent.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                No check-ins yet. Submit your first one above.
              </TableCell>
            </TableRow>
          ) : (
            recent.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="whitespace-nowrap font-medium">{w.date}</TableCell>
                <TableCell>
                  <Badge variant={moodVariant(w.mood)}>{MOOD_LABELS[w.mood] ?? w.mood}</Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={stressVariant(w.stress)}>{STRESS_LABELS[w.stress] ?? w.stress}</Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {WORKLOAD_LABELS[w.workload] ?? w.workload}
                </TableCell>
                <TableCell className="hidden lg:table-cell max-w-xs truncate text-sm text-muted-foreground">
                  {w.note || "-"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function PulseSection() {
  const { data: pulse, isLoading } = useQuery({
    queryKey: ["wellbeing", "pulse"],
    queryFn: () => http.get<Pulse>("/wellbeing/pulse"),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!pulse) return null;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Team well-being pulse</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Anonymised aggregate since {pulse.from}. Individual identities are never shown unless an
          employee opts out of anonymity while flagging high stress.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Avg mood" value={`${pulse.avgMood} / 5`} hint="Higher is better" />
        <StatTile label="Avg stress" value={`${pulse.avgStress} / 5`} hint="Lower is better" />
        <StatTile label="Avg workload" value={`${pulse.avgWorkload} / 5`} />
        <StatTile label="Check-ins" value={String(pulse.checkins)} hint="Last 14 days" />
        <StatTile label="Participants" value={String(pulse.participants)} hint="Unique employees" />
      </div>

      <Card>
        <div className="border-b p-4">
          <h3 className="font-semibold">Flagged for support</h3>
          <p className="text-sm text-muted-foreground">
            Non-anonymous check-ins reporting high stress or low mood.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Mood</TableHead>
              <TableHead>Stress</TableHead>
              <TableHead className="hidden md:table-cell">Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pulse.flags.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                  No one has flagged for support. That&apos;s a good sign.
                </TableCell>
              </TableRow>
            ) : (
              pulse.flags.map((f, i) => (
                <TableRow key={`${f.name}-${f.date}-${i}`}>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{f.date}</TableCell>
                  <TableCell>
                    <Badge variant={moodVariant(f.mood)}>{MOOD_LABELS[f.mood] ?? f.mood}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={stressVariant(f.stress)}>{STRESS_LABELS[f.stress] ?? f.stress}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell max-w-xs truncate text-sm text-muted-foreground">
                    {f.note || "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function MeSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["wellbeing", "me"],
    queryFn: () => http.get<MyWellbeing>("/wellbeing/me"),
  });

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <CheckInCard today={data?.today ?? null} />
      <HistoryCard recent={data?.recent ?? []} />
    </div>
  );
}

function SetEapDialog({ current }: { current: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(current ?? "");

  const save = useMutation({
    mutationFn: () => http.put<{ ok: boolean; eapPhone: string }>("/wellbeing/support", { eapPhone: phone }),
    onSuccess: () => {
      toast.success("EAP helpline updated");
      qc.invalidateQueries({ queryKey: ["wellbeing", "resources"] });
      setOpen(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setPhone(current ?? "");
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Settings2 className="mr-2 h-4 w-4" />
            Set EAP helpline
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set the EAP helpline</DialogTitle>
          <DialogDescription>
            This number is shown to everyone in the organisation on the Employee Assistance
            Programme card, with a click-to-call link.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <Field label="EAP helpline number" htmlFor="eap-phone">
            <Input
              id="eap-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 1800 123 4567"
              maxLength={40}
            />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline">Cancel</Button>} />
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Per-category icon + tint so cards read at a glance without shouty badges.
const CATEGORY_META: Record<
  string,
  { label: string; Icon: typeof LifeBuoy; chip: string }
> = {
  SUPPORT: {
    label: "Support",
    Icon: LifeBuoy,
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  },
  CRISIS: {
    label: "Crisis",
    Icon: Phone,
    chip: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  },
  MINDFULNESS: {
    label: "Mindfulness",
    Icon: Wind,
    chip: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400",
  },
  PHYSICAL: {
    label: "Physical",
    Icon: Activity,
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  },
  MANAGER: {
    label: "For managers",
    Icon: Users,
    chip: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400",
  },
};

const DEFAULT_META = {
  label: "Resource",
  Icon: HeartPulse,
  chip: "bg-muted text-muted-foreground",
};

/** Full guide content in a dialog, the API ships each resource's actual
 *  guidance (breathing exercises, ergonomics checklist, manager script…)
 *  as trusted first-party HTML; this is where it gets read. */
function ResourceGuideDialog({
  resource,
  label,
}: {
  resource: WellbeingResource;
  label: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <BookOpen className="mr-2 size-4" />
            {label}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{resource.title}</DialogTitle>
          <DialogDescription>{resource.desc}</DialogDescription>
        </DialogHeader>
        <div
          className="text-sm leading-relaxed [&_b]:font-semibold [&_p+p]:mt-3"
          dangerouslySetInnerHTML={{ __html: resource.content }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ResourceCard({ resource }: { resource: WellbeingResource }) {
  const meta = CATEGORY_META[resource.category] ?? DEFAULT_META;
  const isEap = resource.category === "SUPPORT";
  const isCrisis = resource.category === "CRISIS";
  // The crisis card's actionLabel belongs to its call button; the EAP
  // card's belongs to the phone block. Both get a distinct dialog label.
  const guideLabel = isCrisis
    ? "More helplines"
    : isEap
      ? "How it works"
      : (resource.actionLabel ?? "Read the guide");

  return (
    <Card className="flex h-full flex-col gap-3.5 p-5 transition-all hover:border-primary/30 hover:shadow-[0_4px_16px_rgba(20,24,30,0.08)]">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] ${meta.chip}`}>
          <meta.Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 pt-0.5">
          <div className="font-mono text-[13px] font-semibold text-muted-foreground">
            {meta.label}
          </div>
          <h3 className="mt-0.5 text-[15px] font-bold leading-tight tracking-tight">{resource.title}</h3>
        </div>
      </div>

      <p className="text-[13.5px] leading-relaxed text-muted-foreground">{resource.desc}</p>

      {isEap && (
        <div className="rounded-[8px] border bg-[var(--accent-50)] px-3.5 py-2.5">
          {resource.eapPhone ? (
            <a
              href={resource.action ?? `tel:${resource.eapPhone.replace(/\s+/g, "")}`}
              className="flex items-center gap-2 text-[15px] font-bold text-primary hover:underline"
            >
              <Phone className="h-4 w-4" />
              {resource.eapPhone}
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your HR team hasn&apos;t added the EAP number yet.
            </p>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3.5">
        {isCrisis && resource.action && (
          <Button size="sm" render={<a href={resource.action} />}>
            <Phone className="mr-2 size-4" />
            {resource.actionLabel ?? "Call now"}
          </Button>
        )}
        <ResourceGuideDialog resource={resource} label={guideLabel} />
      </div>
    </Card>
  );
}

function ResourcesSection() {
  const { isStaff } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["wellbeing", "resources"],
    queryFn: () => http.get<WellbeingResource[]>("/wellbeing/resources"),
  });

  const eapResource = data?.find((r) => r.category === "SUPPORT");
  const currentEap = eapResource?.eapPhone ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Resources &amp; support</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Confidential support, helplines and self-care resources for everyone.
          </p>
        </div>
        {isStaff && <SetEapDialog current={currentEap} />}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((r) => (
            <ResourceCard key={r.title} resource={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function WellbeingPage() {
  const { isStaff, user } = useAuth();
  const isEmployee = !!user?.employeeId;

  return (
    <>
      <PageHeader
        title="Well-being"
        description="Check in on how you're doing and find support when you need it."
      />

      {isEmployee && <MeSection />}

      {isStaff && (
        <>
          {isEmployee && <Separator className="my-8" />}
          <PulseSection />
        </>
      )}

      {!isEmployee && !isStaff && (
        <Card className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
          <Phone className="h-6 w-6" />
          <p>
            Well-being check-ins are available to employees. Reach out to HR if you need support.
          </p>
        </Card>
      )}

      {(isEmployee || isStaff) && <Separator className="my-8" />}
      <ResourcesSection />
    </>
  );
}
