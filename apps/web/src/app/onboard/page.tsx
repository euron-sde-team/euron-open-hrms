"use client";

/**
 * Self-onboarding for a candidate who has not been hired yet.
 *
 * Reached from the token in an emailed invite, with no login and no session. It used to be a
 * single long form that created the employee, the login and the welcome email the moment it
 * was submitted, which meant candidates got a materially worse experience than the existing
 * roster (nothing was saved until the end, no documents could be attached, and nobody
 * reviewed what a stranger typed before it became the employee record).
 *
 * It now renders CaseWizard, the identical component the signed-in employee uses; only the
 * `base` prefix differs, because that is the only real difference between the two. The
 * employee record is created when HR approves, not here.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { apiError, http } from "@/lib/api";
import { employmentTypeLabel } from "@/lib/employment";
import { CaseWizard, type Policy } from "@/components/onboarding/case-wizard";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { dueLabel, formatDate, type OnboardingCase } from "@/lib/onboarding-forms";

interface PublicCaseResponse {
  case: OnboardingCase;
  completed: boolean;
  overdue?: boolean;
  org: { name: string };
  invite: {
    firstName: string;
    lastName: string;
    personalEmail: string;
    designation: string | null;
    employmentType: string;
    joiningDate: string | null;
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </div>
  );
}

function OnboardInner() {
  const qc = useQueryClient();
  const token = useSearchParams().get("token") ?? "";
  const key = ["public-onboarding", token];
  const base = `/onboarding/public/${token}`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: key,
    queryFn: () => http.get<PublicCaseResponse>(base),
    enabled: !!token,
    retry: false,
  });

  const { data: policies = [] } = useQuery({
    queryKey: [...key, "policies"],
    queryFn: () => http.get<Policy[]>(`${base}/policies`),
    enabled: !!data?.case,
  });

  if (!token) {
    return (
      <Shell>
        <Card className="p-10 text-center">
          <p className="text-[15px] font-medium">This link is not complete</p>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Open the link from your invitation email exactly as it was sent.
          </p>
        </Card>
      </Shell>
    );
  }

  if (isLoading) {
    return (
      <Shell>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="mt-5 h-64 w-full" />
      </Shell>
    );
  }

  if (isError || !data) {
    return (
      <Shell>
        <Card className="p-10 text-center">
          <p className="text-[15px] font-medium">This onboarding link is not valid</p>
          {/*
            apiError, not error.message: axios fills `message` with "Request failed with
            status code 400", which hid the server's actual sentence and left a candidate
            reading a stack-trace artefact instead of the reason HR needed to hear about.
          */}
          <p className="mt-1 text-[14px] text-muted-foreground">
            {error
              ? apiError(error)
              : "It may have already been used. Ask your HR contact to send a new one."}
          </p>
        </Card>
      </Shell>
    );
  }

  const { case: kase, org, invite, completed } = data;

  if (completed || kase.status === "APPROVED") {
    return (
      <Shell>
        <Card className="p-10 text-center">
          <CheckCircle2 className="mx-auto size-8 text-[color:var(--ok)]" />
          <p className="mt-3 text-[15px] font-medium">You are all set</p>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {org.name} has everything they need. Your login details have been emailed to you.
          </p>
        </Card>
      </Shell>
    );
  }

  if (kase.status === "SUBMITTED") {
    return (
      <Shell>
        <Card className="p-10 text-center">
          <Clock className="mx-auto size-8 text-[color:var(--warn)]" />
          <p className="mt-3 text-[15px] font-medium">Sent to {org.name}</p>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Their HR team is reviewing your details. If anything needs changing you will be
            emailed, and this link will reopen the form.
          </p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[13px] font-medium text-muted-foreground">{org.name}</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">
          Welcome{invite.firstName ? `, ${invite.firstName}` : ""}
        </h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {[invite.designation, employmentTypeLabel(invite.employmentType)].filter(Boolean).join(" · ")}
          {invite.joiningDate ? ` · joining ${formatDate(invite.joiningDate)}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {kase.dueAt && (
            <Badge variant={new Date(kase.dueAt) < new Date() ? "red" : "amber"} className="gap-1.5">
              <Clock className="size-3" />
              {formatDate(kase.dueAt)} · {dueLabel(kase.dueAt)}
            </Badge>
          )}
          {/* Says plainly why the form asks for a PAN and a bank account, and what happens next. */}
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Saved as you go. Nothing is shared until {org.name} reviews it.
          </span>
        </div>
      </header>

      <CaseWizard
        kase={kase}
        base={base}
        policies={policies}
        onChanged={(next) => qc.setQueryData(key, { ...data, case: next })}
        onRefetch={() => qc.invalidateQueries({ queryKey: key })}
        onSubmitted={() => qc.invalidateQueries({ queryKey: key })}
      />
    </Shell>
  );
}

export default function OnboardPage() {
  // useSearchParams needs a Suspense boundary under the app router.
  return (
    <Suspense fallback={<Shell><Skeleton className="h-64 w-full" /></Shell>}>
      <OnboardInner />
    </Suspense>
  );
}
