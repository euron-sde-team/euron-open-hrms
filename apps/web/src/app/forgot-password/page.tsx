"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { http } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await http.post<{ message: string }>("/auth/forgot-password", { email });
      setMessage(res.message || "If an account exists for that email, a reset link has been sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={message ? "Check your email" : "Reset your password"}
      subtitle={
        message
          ? undefined
          : "Enter the email you sign in with and we'll send you a link to set a new password."
      }
      headline="Locked out? It happens."
      points={[
        "Reset links are single-use and expire",
        "Your session stays secure throughout",
        "Nothing else about your account changes",
      ]}
      footer={
        <p className="text-center text-[15px] text-muted-foreground">
          <Link href="/login" className="font-semibold text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      {message ? (
        <div className="flex items-start gap-4 rounded-[16px] border border-border bg-card p-5 shadow-[var(--elev-1)]">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="size-5" />
          </span>
          <p className="text-[16px] leading-[23px] text-muted-foreground">{message}</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-2.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
