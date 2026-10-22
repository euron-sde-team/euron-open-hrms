"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { productName } from "@/lib/runtime-env";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { PasswordInput } from "@open-hrms/ui/password-input";
import { Label } from "@open-hrms/ui/label";
import { Checkbox } from "@open-hrms/ui/checkbox";

export default function LoginPage() {
  const { login, verifyMfa, user } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // MFA step
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await login(email, password);
      if (res.mfaRequired && res.mfaToken) setMfaToken(res.mfaToken);
      else router.replace("/dashboard");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true);
    try {
      await verifyMfa(mfaToken, code, trustDevice);
      router.replace("/dashboard");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={mfaToken ? "Two-factor verification" : "Welcome back"}
      subtitle={
        mfaToken
          ? "Enter the code from your authenticator app to continue."
          : "Sign in to your workspace."
      }
      headline="Run your people operations in one place."
      points={[
        "Attendance, leave and Indian payroll on autopilot",
        "Onboarding, performance and documents, connected",
        "Role-based access for every team, with optional 2FA",
      ]}
      footer={
        !mfaToken ? (
          <p className="text-center text-[15px] text-muted-foreground">
            Don&apos;t have a workspace yet?{" "}
            <Link href="/signup" className="font-semibold text-primary hover:underline">
              Create one
            </Link>
          </p>
        ) : undefined
      }
    >
      {!mfaToken ? (
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-2.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-[14px] font-medium text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Sign in
          </Button>
        </form>
      ) : (
        <form onSubmit={onVerify} className="space-y-6">
          <div className="flex items-start gap-3 rounded-[14px] border border-border bg-card p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-[15px] leading-[21px] text-muted-foreground">
              Open your authenticator app and enter the 6-digit code for {productName()}.
            </p>
          </div>

          <div className="space-y-2.5">
            <Label htmlFor="code">Authentication code</Label>
            <Input
              id="code"
              inputMode="numeric"
              inputSize="lg"
              autoFocus
              maxLength={6}
              placeholder="000000"
              className="text-center text-[28px] font-semibold tracking-[0.4em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>

          <Label className="gap-3">
            <Checkbox checked={trustDevice} onCheckedChange={(v) => setTrustDevice(!!v)} />
            Trust this device for 30 days
          </Label>

          <Button type="submit" size="lg" className="w-full" disabled={busy || code.length < 6}>
            {busy && <Loader2 className="animate-spin" />} Verify
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setMfaToken(null)}
          >
            <ArrowLeft /> Back to sign in
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
