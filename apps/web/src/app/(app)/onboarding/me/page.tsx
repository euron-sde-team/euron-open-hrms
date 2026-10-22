"use client";

/**
 * "Complete your details", the employee's own onboarding form.
 *
 * This is where a campaign's emailed deep link lands. It is behind the normal session, so
 * 2FA, lockout and every other sign-in rule apply, which is the whole reason the link is a
 * deep link rather than a token: the form behind it collects PAN, Aadhaar and a bank account.
 *
 * The form itself is CaseWizard, shared with the pre-hire candidate page at /onboard. This
 * page only decides what to show around it: nothing to do, in progress, or with HR.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock } from "lucide-react";
import { http } from "@/lib/api";
import { PageHeader } from "@open-hrms/ui/page-header";
import { CaseWizard, type Policy } from "@/components/onboarding/case-wizard";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { dueLabel, formatDate, type OnboardingCase } from "@/lib/onboarding-forms";

const BASE = "/onboarding-cases/me";

export default function MyOnboardingPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["my-onboarding"],
    queryFn: () => http.get<{ case: OnboardingCase | null; overdue?: boolean }>(BASE),
  });

  const { data: policies = [] } = useQuery({
    queryKey: ["policies"],
    queryFn: () => http.get<Policy[]>("/content/policies"),
    enabled: !!data?.case,
  });

  const kase = data?.case ?? null;

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!kase) {
    return (
      <>
        <PageHeader title="My details" />
        <Card className="p-10 text-center">
          <CheckCircle2 className="mx-auto size-8 text-[color:var(--ok)]" />
          <p className="mt-3 text-[15px] font-medium">Nothing to complete</p>
          <p className="mt-1 text-[14px] text-muted-foreground">
            You have no onboarding form open. HR will let you know if anything is needed.
          </p>
        </Card>
      </>
    );
  }

  if (kase.status === "SUBMITTED" || kase.status === "APPROVED") {
    const approved = kase.status === "APPROVED";
    return (
      <>
        <PageHeader title="My details" description={kase.templateName} />
        <Card className="p-10 text-center">
          {approved ? (
            <CheckCircle2 className="mx-auto size-8 text-[color:var(--ok)]" />
          ) : (
            <Clock className="mx-auto size-8 text-[color:var(--warn)]" />
          )}
          <p className="mt-3 text-[15px] font-medium">
            {approved ? "Your details have been approved" : "Submitted, with HR"}
          </p>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {approved
              ? "Everything is up to date. Thank you."
              : "HR is reviewing what you sent. If anything needs changing, you will be emailed and this form will reopen."}
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Complete your details"
        description={kase.templateName}
        actions={
          kase.dueAt ? (
            <Badge variant={new Date(kase.dueAt) < new Date() ? "red" : "amber"} className="gap-1.5">
              <Clock className="size-3" />
              {formatDate(kase.dueAt)} · {dueLabel(kase.dueAt)}
            </Badge>
          ) : undefined
        }
      />
      <CaseWizard
        kase={kase}
        base={BASE}
        policies={policies}
        onChanged={(next) => qc.setQueryData(["my-onboarding"], { case: next })}
        onRefetch={() => qc.invalidateQueries({ queryKey: ["my-onboarding"] })}
        onSubmitted={() => qc.invalidateQueries({ queryKey: ["my-onboarding"] })}
      />
    </>
  );
}
