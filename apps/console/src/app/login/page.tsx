"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock, ShieldCheck, KeyRound, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { productName } from "@/lib/runtime-env";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { PasswordInput } from "@open-hrms/ui/password-input";
import { Label, FieldHint } from "@open-hrms/ui/label";

export default function LoginPage() {
  const { login, verifyMfa, admin } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // MFA step
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (admin) router.replace("/overview");
  }, [admin, router]);

  useEffect(() => {
    if (mfaToken) codeRef.current?.focus();
  }, [mfaToken]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await login(email, password);
      if (res.mfaRequired && res.mfaToken) {
        setMfaToken(res.mfaToken);
        setCode("");
        return;
      }
      router.replace("/overview");
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
      await verifyMfa(mfaToken, code);
      router.replace("/overview");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-5">
      {/* Ambient control-plane glow, so the console never reads as a tenant screen. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-primary/12 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <div className="relative w-full max-w-[440px]">
        <div className="rounded-[22px] border border-border bg-card p-8 shadow-[var(--elev-5)] sm:p-10">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-[12px] bg-primary text-[20px] font-bold text-primary-foreground">
              e
            </span>
            <div>
              <div className="text-[19px] font-semibold tracking-[-0.02em]">{productName()}</div>
              <div className="text-[14px] text-muted-foreground">Operator Console</div>
            </div>
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-[14px] bg-primary/10 p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-[14px] leading-[20px] text-muted-foreground">
              SaaS control plane, for platform operators only. Every action here is monitored
              and written to the audit log.
            </p>
          </div>

          {!mfaToken ? (
            <form onSubmit={onSubmit} className="mt-8 space-y-6">
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
                <Label htmlFor="password">Password</Label>
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
            <form onSubmit={onVerify} className="mt-8 space-y-6">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                <KeyRound className="size-[18px] text-primary" /> Two-factor authentication
              </p>
              <div className="space-y-2.5">
                <Label htmlFor="mfa-code">Authentication code</Label>
                <Input
                  ref={codeRef}
                  id="mfa-code"
                  inputMode="numeric"
                  inputSize="lg"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  required
                  className="text-center text-[28px] font-semibold tracking-[0.4em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <FieldHint>Enter the 6-digit code from your authenticator app.</FieldHint>
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={busy || code.length !== 6}>
                {busy && <Loader2 className="animate-spin" />} Verify
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setMfaToken(null);
                  setCode("");
                }}
              >
                <ArrowLeft /> Back to sign in
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
          <Lock className="size-4" /> This console is monitored and audited.
        </p>
      </div>
    </div>
  );
}
