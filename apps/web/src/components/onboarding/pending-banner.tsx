"use client";

/**
 * "You have details to complete" banner.
 *
 * A campaign emails a deep link, but people who never open the email still need to find
 * this. A nav entry alone is not enough: nobody browses the sidebar looking for work they
 * did not know they had. So the dashboard says it, with the deadline, on the page everyone
 * lands on after signing in.
 *
 * Renders nothing when there is no open case, so it costs a single cached query and no
 * layout space for the majority of people who are up to date.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardList } from "lucide-react";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card } from "@open-hrms/ui/card";
import { cn } from "@open-hrms/ui/cn";
import { dueLabel, formatDate, type OnboardingCase } from "@/lib/onboarding-forms";

export function OnboardingPendingBanner({ className }: { className?: string }) {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["my-onboarding"],
    queryFn: () => http.get<{ case: OnboardingCase | null }>("/onboarding-cases/me"),
    enabled: !!user?.employeeId,
    staleTime: 60_000,
  });

  const kase = data?.case;
  // Submitted and approved cases are not the person's problem any more.
  if (!kase || !["NOT_STARTED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(kase.status)) return null;

  const overdue = !!kase.dueAt && new Date(kase.dueAt) < new Date();
  const sentBack = kase.status === "CHANGES_REQUESTED";

  return (
    <Card
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 p-5",
        overdue || sentBack ? "border-[color:var(--bad)]/40" : "border-[color:var(--warn)]/40",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg",
            overdue || sentBack ? "bg-[var(--bad-bg,var(--warn-bg))]" : "bg-[var(--warn-bg)]"
          )}
        >
          <ClipboardList className={cn("size-4", overdue || sentBack ? "text-[color:var(--bad)]" : "text-[color:var(--warn)]")} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">
            {sentBack ? "Your details need a change" : "Please complete your details"}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {sentBack
              ? "HR has asked for a correction on one section."
              : `${kase.progress.done} of ${kase.progress.total} sections done`}
            {kase.dueAt && ` · ${formatDate(kase.dueAt)}, ${dueLabel(kase.dueAt)}`}
          </p>
        </div>
      </div>
      {/* A styled Link, matching the dashboard's quick actions. The Button primitive has no
          `asChild`, and routing via window.location would drop the SPA and reload the app. */}
      <Link
        href="/onboarding/me"
        className="inline-flex shrink-0 items-center gap-2 rounded-[6px] border border-primary bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[var(--accent-700)]"
      >
        {sentBack ? "Review and fix" : "Continue"} <ArrowRight className="size-4" />
      </Link>
    </Card>
  );
}
