"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, XCircle } from "lucide-react";
import { http, apiError, tokenStore } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { PasswordInput } from "@open-hrms/ui/password-input";
import { Label, FieldHint, FieldError } from "@open-hrms/ui/label";
import type { LoginResponse } from "@open-hrms/types";

const PANEL = {
  headline: "You've been invited. Welcome aboard.",
  points: [
    "Set your name and a password to activate access",
    "Your workspace and role are already configured",
    "You'll land straight in your dashboard",
  ],
};

function AcceptInviteInner() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const { refresh } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await http.post<LoginResponse>("/auth/accept-invite", {
        token,
        name: name.trim() || undefined,
        password,
      });
      if (res.token) {
        tokenStore.set(res.token); // invite accepted → log the new teammate straight in
        await refresh();
        router.replace("/dashboard");
      } else {
        throw new Error("Accepting the invite did not return a session.");
      }
    } catch (err) {
      setError(apiError(err));
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
              This invitation link is missing its token. Ask your admin to send a new invite.
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
      title="Set up your account"
      subtitle="Choose how your name appears and set a password to get started."
      {...PANEL}
    >
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="space-y-2.5">
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
          />
        </div>

        <div className="space-y-2.5">
          <Label htmlFor="password">Password</Label>
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

        {error && <FieldError>{error}</FieldError>}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Accept invite &amp; continue
        </Button>
      </form>
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner />
    </Suspense>
  );
}
