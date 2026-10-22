"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ShieldOff, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@open-hrms/ui/card";
import { Badge } from "@open-hrms/ui/badge";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { PasswordInput } from "@open-hrms/ui/password-input";
import { Label } from "@open-hrms/ui/label";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@open-hrms/ui/dialog";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[12.5px]">
          {value}
        </code>
        <Button type="button" variant="outline" size="icon" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function EnableFlow({ onDone }: { onDone: () => void }) {
  const [enroll, setEnroll] = useState<{ secret: string; otpauth: string; qr: string } | null>(null);
  const [code, setCode] = useState("");

  const startEnroll = useMutation({
    mutationFn: () => http.post<{ secret: string; otpauth: string; qr: string }>("/platform/mfa/enroll"),
    onSuccess: (r) => setEnroll(r),
    onError: (e) => toast.error(apiError(e)),
  });

  const verify = useMutation({
    mutationFn: () => http.post<{ ok: boolean; mfaEnabled: boolean }>("/platform/mfa/enroll/verify", { code }),
    onSuccess: () => {
      toast.success("Two-factor authentication enabled");
      onDone();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!enroll) {
    return (
      <Button onClick={() => startEnroll.mutate()} disabled={startEnroll.isPending}>
        {startEnroll.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        <ShieldCheck className="mr-2 h-4 w-4" /> Enable two-factor
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Scan this QR code with an authenticator app (Google Authenticator, 1Password, Authy), then enter
        the 6-digit code it shows to finish. Can&apos;t scan? Enter the secret below manually.
      </p>
      {/* Scannable QR (data-URL from the server) on a white tile for contrast on the dark theme */}
      {enroll.qr && (
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="Two-factor QR code" width={200} height={200} className="rounded-lg bg-white p-2" />
        </div>
      )}
      <CopyField label="Secret (manual entry)" value={enroll.secret} />
      <form
        onSubmit={(e) => { e.preventDefault(); verify.mutate(); }}
        className="space-y-3"
      >
        <div className="space-y-2 max-w-[220px]">
          <Label htmlFor="enroll-code">Verification code</Label>
          <Input
            id="enroll-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
            placeholder="123456"
            className="text-center text-lg tracking-[0.4em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
        <Button type="submit" disabled={verify.isPending || code.length !== 6}>
          {verify.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Verify & enable
        </Button>
      </form>
    </div>
  );
}

function DisableDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const disable = useMutation({
    mutationFn: () => http.post<{ ok: boolean; mfaEnabled: boolean }>("/platform/mfa/disable", { password, code }),
    onSuccess: () => {
      toast.success("Two-factor authentication disabled");
      setOpen(false);
      setPassword("");
      setCode("");
      onDone();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <ShieldOff className="mr-2 h-4 w-4" /> Disable
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disable two-factor authentication</DialogTitle>
            <DialogDescription>
              Confirm your password and a current authenticator code to remove 2FA from your account.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); disable.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="disable-pw">Password</Label>
              <PasswordInput id="disable-pw" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="disable-code">Authentication code</Label>
              <Input
                id="disable-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                placeholder="123456"
                className="text-center text-lg tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={disable.isPending || !password || code.length !== 6}>
                {disable.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Disable 2FA
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function SecurityPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["mfa-status"],
    queryFn: () => http.get<{ enabled: boolean }>("/platform/mfa/status"),
  });
  const enabled = !!data?.enabled;
  const refresh = () => qc.invalidateQueries({ queryKey: ["mfa-status"] });

  return (
    <>
      <PageHeader title="Security" description="Manage how you sign in to the operator console." />
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Two-factor authentication</CardTitle>
            {!isLoading && (
              <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "enabled" : "disabled"}</Badge>
            )}
          </div>
          <CardDescription>
            Add a time-based one-time code (TOTP) from an authenticator app as a second factor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-9 w-40" />
          ) : enabled ? (
            <DisableDialog onDone={refresh} />
          ) : (
            <EnableFlow onDone={refresh} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
