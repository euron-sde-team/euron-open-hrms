import { ReactNode } from "react";

/**
 * Page title block. Apple large-title scale (34px), with the subtitle at body
 * size rather than caption size so it's actually readable, and no dividing
 * rule, spacing separates the header from content instead.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[34px] leading-[41px] font-bold tracking-[-0.024em]">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[16px] leading-[22px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {/*
        No `shrink-0` here. It and `flex-wrap` contradict each other: wrapping only
        happens once a flex container is squeezed below its max-content width, and
        `shrink-0` guarantees it never is. So the buttons kept full width and overflowed
        the page while the title block (which has min-w-0) absorbed all the pressure and
        collapsed to a few characters wide. Measured on /payroll at 834px: 120px of
        overflow and a one-word-per-line description. Letting this shrink lets the
        buttons wrap onto a second line instead, which is what was intended.
      */}
      {actions && <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">{actions}</div>}
    </div>
  );
}
