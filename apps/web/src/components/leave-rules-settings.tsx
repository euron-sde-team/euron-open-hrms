"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { cn } from "@open-hrms/ui/cn";
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

/* ── API shape (mirrors apps/api/src/leave-rules.ts) ──────────────────────── */

export interface LeaveRules {
  monthlyLimit: {
    enabled: boolean;
    newJoinerLimit: number;
    newJoinerMonths: number;
    limit: number;
    /** Unused days roll into later months, until the end of the year. */
    carryOver: boolean;
  };
  advanceNotice: {
    enabled: boolean;
    minDays: number;
    noticeDays: number;
  };
  workingDaysOnly: boolean;
}

/** GET /leave/rules also returns the working week the rules count with (set under Reminders). */
export interface LeaveRulesResponse extends LeaveRules {
  /** 0 = Sunday .. 6 = Saturday. */
  workingDays: number[];
  timezone: string;
}

export const LEAVE_RULES_KEY = ["leave-rules"];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Monday first, as in the reminder settings.
const weekText = (days: number[]) =>
  [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]).join(", ") || "none";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const editable = (r: LeaveRules): LeaveRules => ({
  monthlyLimit: { ...r.monthlyLimit },
  advanceNotice: { ...r.advanceNotice },
  workingDaysOnly: r.workingDaysOnly,
});
const sameRules = (a: LeaveRules, b: LeaveRules) =>
  JSON.stringify(editable(a)) === JSON.stringify(editable(b));

/** A number input's value as a whole number in [min, max]. */
const wholeIn = (v: string, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.floor(Number(v) || 0)));

/** One rule: what it does beside its switch, with its settings underneath. */
function RuleSection({
  title,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-[12px] border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-medium">{title}</div>
          <FieldHint>{description}</FieldHint>
        </div>
        <Switch checked={checked} onCheckedChange={(v) => onCheckedChange(!!v)} aria-label={title} />
      </div>
      {children && <div className={cn("space-y-3", !checked && "opacity-60")}>{children}</div>}
    </div>
  );
}

export function LeaveRulesTab() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: LEAVE_RULES_KEY,
    queryFn: () => http.get<LeaveRulesResponse>("/leave/rules"),
  });

  const [form, setForm] = useState<LeaveRules | null>(null);
  useEffect(() => {
    if (data) setForm(editable(data));
  }, [data]);

  const save = useMutation({
    mutationFn: (rules: LeaveRules) => http.put<LeaveRulesResponse>("/leave/rules", rules),
    onSuccess: (res) => {
      qc.setQueryData(LEAVE_RULES_KEY, res);
      // Leave types list which rules apply to them, but only while a rule is on.
      qc.invalidateQueries({ queryKey: ["leave-types"] });
      toast.success("Leave rules saved");
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  // A server that predates leave rules 404s here. Say so rather than show a form that cannot save.
  if (isError || !data || !form) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leave rules</CardTitle>
          <CardDescription>
            Leave rules could not be loaded: {apiError(error)}. This server may not have them yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const setMonthly = (patch: Partial<LeaveRules["monthlyLimit"]>) =>
    setForm((f) => f && { ...f, monthlyLimit: { ...f.monthlyLimit, ...patch } });
  const setNotice = (patch: Partial<LeaveRules["advanceNotice"]>) =>
    setForm((f) => f && { ...f, advanceNotice: { ...f.advanceNotice, ...patch } });

  const m = form.monthlyLimit;
  const n = form.advanceNotice;
  const monthlySummary =
    m.newJoinerMonths > 0
      ? `New joiners can take ${plural(m.newJoinerLimit, "paid day")} a month for their first ${plural(m.newJoinerMonths, "month")}, then ${plural(m.limit, "paid day")} a month.`
      : `Everyone can take ${plural(m.limit, "paid day")} a month.`;
  const carrySummary = m.carryOver
    ? " Unused days carry over to later months, until the end of the year."
    : " Unused days lapse at the end of each month.";
  const noticeSummary =
    `Leave of ${n.minDays} or more ${form.workingDaysOnly ? "working days" : "days"} has to be applied ` +
    `for at least ${plural(n.noticeDays, "day")} before it starts.`;
  const dirty = !sameRules(form, data);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leave rules</CardTitle>
        <CardDescription>
          Company policy on top of each leave type&apos;s yearly quota. Each rule is off until you
          turn it on. Employees can&apos;t apply for leave that breaks a rule. HR can override one
          when applying on someone&apos;s behalf, and approvers can approve over the monthly limit.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <RuleSection
          title="Monthly paid-leave limit"
          description="Casual, sick, earned and other paid leave count together. Days over the limit have to be applied as Loss of Pay. Choose which leave types count under Leave types."
          checked={m.enabled}
          onCheckedChange={(enabled) => setMonthly({ enabled })}
        >
          <FormGrid columns={3}>
            <Field label="New joiners: paid days a month" htmlFor="lr-nj-limit">
              <Input
                id="lr-nj-limit"
                type="number"
                min={0}
                max={31}
                value={m.newJoinerLimit}
                onChange={(e) => setMonthly({ newJoinerLimit: wholeIn(e.target.value, 0, 31) })}
              />
            </Field>
            <Field label="New-joiner period, in months" htmlFor="lr-nj-months">
              <Input
                id="lr-nj-months"
                type="number"
                min={0}
                max={24}
                value={m.newJoinerMonths}
                onChange={(e) => setMonthly({ newJoinerMonths: wholeIn(e.target.value, 0, 24) })}
              />
            </Field>
            <Field label="After that: paid days a month" htmlFor="lr-limit">
              <Input
                id="lr-limit"
                type="number"
                min={0}
                max={31}
                value={m.limit}
                onChange={(e) => setMonthly({ limit: wholeIn(e.target.value, 0, 31) })}
              />
            </Field>
          </FormGrid>
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={m.carryOver} onCheckedChange={(v) => setMonthly({ carryOver: !!v })} />
            <span className="text-[15px]">Unused days carry over to the next month</span>
          </label>
          <FieldHint>{monthlySummary}{carrySummary}</FieldHint>
        </RuleSection>

        <RuleSection
          title="Advance notice for long leave"
          description="Leave that runs into other leave, even across a weekend, counts as one stretch. Sick and bereavement leave are exempt by default; change that under Leave types."
          checked={n.enabled}
          onCheckedChange={(enabled) => setNotice({ enabled })}
        >
          <FormGrid columns={2}>
            <Field label="Long leave: this many days or more" htmlFor="lr-min-days">
              <Input
                id="lr-min-days"
                type="number"
                min={1}
                max={366}
                value={n.minDays}
                onChange={(e) => setNotice({ minDays: wholeIn(e.target.value, 1, 366) })}
              />
            </Field>
            <Field label="Apply at least this many days ahead" htmlFor="lr-notice-days">
              <Input
                id="lr-notice-days"
                type="number"
                min={0}
                max={366}
                value={n.noticeDays}
                onChange={(e) => setNotice({ noticeDays: wholeIn(e.target.value, 0, 366) })}
              />
            </Field>
          </FormGrid>
          <FieldHint>{noticeSummary}</FieldHint>
        </RuleSection>

        <RuleSection
          title="Count working days only"
          description={`Weekly offs and public or company holidays inside a leave aren't counted. Working days are ${weekText(data.workingDays)}, as set under Reminders. Restricted holidays still count, since taking them is optional.`}
          checked={form.workingDaysOnly}
          onCheckedChange={(workingDaysOnly) => setForm((f) => f && { ...f, workingDaysOnly })}
        />

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={() => save.mutate(form)} disabled={!dirty || save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save leave rules
          </Button>
          {dirty && <span className="text-[13px] text-muted-foreground">Unsaved changes</span>}
        </div>
      </CardContent>
    </Card>
  );
}
