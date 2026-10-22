"use client";

import { LogOut, PauseCircle } from "lucide-react";
import { Button } from "@open-hrms/ui/button";
import { productName } from "@/lib/runtime-env";

/**
 * Full-page notice for a signed-in user whose workspace is suspended or
 * cancelled. The API refuses every request with 403 WORKSPACE_SUSPENDED, so
 * rendering the app would only produce a wall of errors, and treating it as a
 * logout would send the user to a sign-in form that cannot succeed either.
 * Only an administrator (or the operator) can lift it, so that is what we say.
 */
export function WorkspaceSuspended({ orgName, onSignOut }: { orgName?: string | null; onSignOut: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-[460px] rounded-[22px] border border-border bg-card p-8 text-center shadow-[var(--elev-3)] sm:p-10">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--warn-bg)] text-[var(--warn)]">
          <PauseCircle className="size-7" />
        </span>
        <h1 className="mt-6 text-[28px] leading-[34px] font-bold tracking-[-0.022em]">Workspace suspended</h1>
        <p className="mt-3 text-[16px] leading-[23px] text-muted-foreground">
          {orgName ? (
            <>
              Access to <strong className="font-semibold text-foreground">{orgName}</strong> is paused.
            </>
          ) : (
            "Access to this workspace is paused."
          )}{" "}
          Your account and data are intact. Contact your administrator to have the workspace
          reactivated.
        </p>
        <Button variant="outline" size="lg" className="mt-8 w-full" onClick={onSignOut}>
          <LogOut /> Sign out
        </Button>
      </div>
      <p className="mt-6 text-[13px] text-muted-foreground">{productName()}</p>
    </div>
  );
}
