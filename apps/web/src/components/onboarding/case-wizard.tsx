"use client";

/**
 * The onboarding form itself: step rail, progress, per-section autosave, submit.
 *
 * Shared by both populations on purpose. A signed-in employee completing a records refresh
 * and a candidate who has not been hired yet fill in exactly the same form; the only
 * difference is how they authenticated, which is entirely captured by `base`. The two used to
 * be separate implementations, and they drifted until the candidate's version had no
 * save-and-resume, no uploads and no review.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { SectionForm } from "@/components/onboarding/section-form";
import { Button } from "@open-hrms/ui/button";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { cn } from "@open-hrms/ui/cn";
import {
  isRepeatingKind,
  SECTION_STATUS_LABEL,
  SECTION_STATUS_VARIANT,
  type OnboardingCase,
} from "@/lib/onboarding-forms";

export interface Policy {
  id: string;
  title: string;
  category?: string;
}

export interface CaseWizardProps {
  kase: OnboardingCase;
  /** API prefix for this case's actions, no trailing slash. See SectionForm's `base`. */
  base: string;
  policies?: Policy[];
  /** Called with the server's updated case after every write, so the page can cache it. */
  onChanged: (next: OnboardingCase) => void;
  /**
   * Refetch the case from the server.
   *
   * Distinct from onChanged, and the distinction matters: uploads, asset acknowledgements and
   * policy acceptance are written by SectionForm through their own endpoints, which do not
   * hand the updated case back here. Passing the CURRENT case to onChanged after one of those
   * re-renders with stale data, so an uploaded document keeps showing as "Required" while the
   * server already has it.
   */
  onRefetch: () => void;
  /** Called after a successful submit, for whatever the page shows next. */
  onSubmitted?: () => void;
}

export function CaseWizard({ kase, base, policies = [], onChanged, onRefetch, onSubmitted }: CaseWizardProps) {
  const [step, setStep] = useState(0);
  // Local edits for the step being worked on. Flushed on step change and on submit, so
  // typing never triggers a request per keystroke.
  const [draftValues, setDraftValues] = useState<Record<string, unknown> | null>(null);
  const [draftRows, setDraftRows] = useState<Record<string, unknown>[] | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string[]>>({});

  const sections = useMemo(() => kase.templateSnapshot ?? [], [kase]);
  const current = sections[step];
  const editable = ["NOT_STARTED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(kase.status);

  useEffect(() => {
    if (!current) return;
    const state = kase.sections[current.key];
    setDraftValues({ ...(state?.values ?? {}) });
    setDraftRows([...(state?.rows ?? [])]);
  }, [current?.key, kase.id, kase.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (opts: { key: string; values?: Record<string, unknown>; rows?: Record<string, unknown>[] }) =>
      http.patch<{ case: OnboardingCase; errors: string[] }>(
        `${base}/sections/${opts.key}`,
        opts.rows ? { rows: opts.rows } : { values: opts.values }
      ),
    onSuccess: (res, vars) => {
      setSectionErrors((prev) => ({ ...prev, [vars.key]: res.errors }));
      onChanged(res.case);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  /** Push the current step's draft, then run `after`. */
  const flush = useCallback(
    async (after?: () => void) => {
      if (!current || !editable) return after?.();
      const repeating = isRepeatingKind(current.kind);
      await save.mutateAsync(
        repeating ? { key: current.key, rows: draftRows ?? [] } : { key: current.key, values: draftValues ?? {} }
      );
      after?.();
    },
    [current, editable, draftRows, draftValues, save]
  );

  const submit = useMutation({
    mutationFn: () => http.post<{ case: OnboardingCase }>(`${base}/submit`),
    onSuccess: (res) => {
      toast.success("Submitted. HR will review your details.");
      if (res?.case) onChanged(res.case);
      onSubmitted?.();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const check = kase.checks.find((c) => c.key === current?.key);
  const isLast = step === sections.length - 1;

  return (
    <>
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-[13px] text-muted-foreground">
          <span>
            {kase.progress.done} of {kase.progress.total} sections ready
          </span>
          <span>{kase.progress.percent}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${kase.progress.percent}%` }}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="space-y-1" aria-label="Form sections">
          {sections.map((s, i) => {
            const c = kase.checks.find((x) => x.key === s.key);
            const status = c?.status ?? "EMPTY";
            return (
              <button
                key={s.key}
                onClick={() => void flush(() => setStep(i))}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                  i === step ? "bg-primary/10 font-medium text-foreground" : "hover:bg-muted"
                )}
              >
                <span className="min-w-0 truncate">
                  {s.title}
                  {s.optional && <span className="ml-1 text-[11px] text-muted-foreground">(optional)</span>}
                </span>
                <Badge variant={SECTION_STATUS_VARIANT[status]} className="shrink-0 text-[10px]">
                  {status === "COMPLETE" ? "Ready" : status === "EMPTY" ? "-" : SECTION_STATUS_LABEL[status]}
                </Badge>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-6">
          <Card className="p-6">
            <h2 className="mb-1 text-[20px] font-semibold tracking-[-0.01em]">{current?.title}</h2>
            {check && !check.optional && (
              <p className="mb-5 text-[12px] text-muted-foreground">
                {check.filled} of {check.requiredTotal} required answers given
              </p>
            )}
            {current && draftValues !== null && draftRows !== null && (
              <SectionForm
                section={current}
                caseData={kase}
                base={base}
                errors={sectionErrors[current.key] ?? check?.errors ?? []}
                disabled={!editable || save.isPending}
                values={draftValues}
                rows={draftRows}
                onValues={setDraftValues}
                onRows={setDraftRows}
                onRefresh={onRefetch}
                policies={policies}
              />
            )}
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="outline"
              disabled={step === 0 || save.isPending}
              onClick={() => void flush(() => setStep((s) => Math.max(0, s - 1)))}
            >
              <ChevronLeft className="size-4" /> Back
            </Button>

            <div className="flex items-center gap-2">
              {save.isPending && (
                <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Saving
                </span>
              )}
              {!isLast ? (
                <Button disabled={save.isPending} onClick={() => void flush(() => setStep((s) => s + 1))}>
                  Next <ChevronRight className="size-4" />
                </Button>
              ) : (
                <Button
                  disabled={save.isPending || submit.isPending}
                  onClick={() => void flush(() => submit.mutate())}
                >
                  {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Submit for review
                </Button>
              )}
            </div>
          </div>

          {isLast && !kase.submit.ok && kase.submit.blocking.length > 0 && (
            <Card className="space-y-2 p-5">
              <p className="flex items-center gap-2 text-[14px] font-medium text-[color:var(--warn)]">
                <AlertTriangle className="size-4" /> Still needed before you can submit
              </p>
              <ul className="space-y-1.5 text-[13px]">
                {kase.submit.blocking.map((b) => (
                  <li key={b.key}>
                    <button
                      className="font-medium underline underline-offset-2"
                      onClick={() => setStep(sections.findIndex((s) => s.key === b.key))}
                    >
                      {b.title}
                    </button>
                    {b.errors.length > 0 && (
                      <span className="text-muted-foreground">: {b.errors.join("; ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
