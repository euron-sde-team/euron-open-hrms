"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { http, apiError } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@open-hrms/ui/button";
import { PasswordInput } from "@open-hrms/ui/password-input";
import { Label, FieldHint, FieldError } from "@open-hrms/ui/label";

const PANEL = {
  headline: "A new password, and you're back in.",
  points: [
    "This link is single-use and time-limited",
    "You'll sign in fresh once it's set",
    "Other sessions are unaffected",
  ],
};

function ResetPasswordInner() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await http.post<{ ok: boolean; message: string }>("/auth/reset-password", { token, password });
      setDone(true); // reset-password does not auto-login (OWASP), send them to sign in
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title="This link is incomplete" {...PANEL}>
        <div className="space-y-6">
          <div className="flex items-start gap-4 rounded-[16px] border border-border bg-card p-5 shadow-[var(--elev-1)]">
            <XCircle className="mt-0.5 size-6 shrink-0 text-destructive" />
            <p className="text-[16px] leading-[23px] text-muted-foreground">
              This reset link is missing its token. Request a fresh one and try again.
            </p>
          </div>
          <Button size="lg" className="w-full" onClick={() => router.replace("/forgot-password")}>
            Request a new link
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password updated" {...PANEL}>
        <div className="space-y-6">
          <div className="flex items-start gap-4 rounded-[16px] border border-border bg-card p-5 shadow-[var(--elev-1)]">
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-primary" />
            <p className="text-[16px] leading-[23px] text-muted-foreground">
              Your password has been reset. Sign in with your new password to continue.
            </p>
          </div>
          <Button size="lg" className="w-full" onClick={() => router.replace("/login")}>
            Go to sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Pick something you haven't used here before."
      {...PANEL}
      footer={
        <p className="text-center text-[15px] text-muted-foreground">
          <Link href="/login" className="font-semibold text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="space-y-2.5">
          <Label htmlFor="password">New password</Label>
          <PasswordInput
            id="password"
            required
            autoComplete="new-password"
            placeholder="Create a strong password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldHint>At least 8 characters, mixing letters, numbers or symbols.</FieldHint>
        </div>

        <div className="space-y-2.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <PasswordInput
            id="confirm"
            required
            autoComplete="new-password"
            placeholder="Repeat your new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {error && <FieldError>{error}</FieldError>}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Reset password
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
