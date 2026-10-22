"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@open-hrms/ui/cn";
import { disablePush, enablePush, pushSupported, readPushStatus, type PushStatus } from "@/lib/push";
import { productName } from "@/lib/runtime-env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Switch } from "@open-hrms/ui/switch";
import { FieldHint } from "@open-hrms/ui/label";

const STATUS_KEY = ["push-status"];

/**
 * Per-device switch for clock-in reminders.
 *
 * Push permission is granted to a browser, not to an account, so this has to be
 * turned on again on each phone or laptop. The copy says so, and says plainly
 * when the browser has blocked notifications, because that is the one state the
 * app cannot fix from here.
 */
export function PushRemindersCard({ className }: { className?: string }) {
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: STATUS_KEY,
    // Wrapped, not passed by reference: React Query would hand its own context
    // object to the optional argument.
    queryFn: () => readPushStatus(),
    // Permission can change in browser settings while the tab is open, so this
    // is the one place a focus refetch is worth it.
    refetchOnWindowFocus: true,
    staleTime: 0,
    enabled: typeof window !== "undefined",
  });

  const toggle = useMutation({
    mutationFn: (next: boolean) => (next ? enablePush() : disablePush()),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: STATUS_KEY });
      const previous = qc.getQueryData<PushStatus>(STATUS_KEY);
      // Flip the switch straight away; the browser permission prompt can sit
      // open for seconds and a lagging control reads as a dead control.
      if (previous) qc.setQueryData<PushStatus>(STATUS_KEY, { ...previous, subscribed: next });
      return { previous };
    },
    onSuccess: (result, next) => {
      qc.setQueryData<PushStatus>(STATUS_KEY, result.status);
      if (result.ok) {
        toast.success(next ? "Reminders on for this device" : "Reminders off for this device");
      } else {
        toast.error(result.message);
      }
    },
    onError: (_e, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(STATUS_KEY, ctx.previous);
      toast.error("Could not change the reminder setting.");
    },
  });

  if (isLoading || !status) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-4 w-72" />
        </CardHeader>
      </Card>
    );
  }

  const supported = pushSupported() && status.supported;
  const blocked = status.permission === "denied";
  const unavailable = supported && !status.available;
  const disabled = !supported || blocked || unavailable || toggle.isPending;

  const explanation = !supported
    ? `This browser cannot show push notifications. On iPhone and iPad, add ${productName()} to your home screen first, then turn reminders on from there.`
    : blocked
      ? "Notifications are blocked for this site in your browser settings. Only you can change that: open the padlock next to the address bar, allow notifications, then reload this page."
      : unavailable
        ? "Push notifications are not switched on for this workspace yet. Your admin still gets the in-app and email reminders."
        : status.subscribed
          ? "You will get a reminder on this device when you have not clocked in. Turn it on again separately on any other phone or laptop you use."
          : "Get a nudge on this device when you have not clocked in by the time your organization has set.";

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {status.subscribed && !blocked ? (
                <Bell className="size-[18px] text-primary" />
              ) : (
                <BellOff className="size-[18px] text-muted-foreground" />
              )}
              Clock-in reminders on this device
            </CardTitle>
            <CardDescription>{explanation}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-1">
            {toggle.isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            <Switch
              checked={status.subscribed && !blocked}
              disabled={disabled}
              onCheckedChange={(v) => toggle.mutate(!!v)}
              aria-label="Clock-in reminders on this device"
            />
          </div>
        </div>
      </CardHeader>
      {supported && !blocked && !unavailable && (
        <CardContent className="pt-0">
          <FieldHint>
            Your browser will ask for permission the first time. Reminders only go out on days
            your organization treats as working days.
          </FieldHint>
        </CardContent>
      )}
    </Card>
  );
}
