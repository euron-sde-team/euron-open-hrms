"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { PasswordInput } from "@open-hrms/ui/password-input";
import { Label } from "@open-hrms/ui/label";
import { Badge } from "@open-hrms/ui/badge";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@open-hrms/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

interface MfaStatus { enabled: boolean }
interface EnrollResponse { secret: string; otpauth: string; qr: string }

function EnableMfaDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [enroll, setEnroll] = useState<EnrollResponse | null>(null);
  const [code, setCode] = useState("");

  const start = useMutation({
    mutationFn: () => http.post<EnrollResponse>("/mfa/enroll", {}),
    onSuccess: (res) => { setEnroll(res); setOpen(true); },
    onError: (e) => toast.error(apiError(e)),
  });
  const verify = useMutation({
    mutationFn: () => http.post("/mfa/enroll/verify", { code: code.trim() }),
    onSuccess: () => { toast.success("Two-factor authentication enabled"); close(); onDone(); },
    onError: (e) => toast.error(apiError(e)),
  });
  function close() { setOpen(false); setEnroll(null); setCode(""); }

  return (
    <>
      <Button disabled={start.isPending} onClick={() => start.mutate()}>
        {start.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        <ShieldCheck className="mr-2 h-4 w-4" /> Enable two-factor
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enable two-factor authentication</DialogTitle>
            <DialogDescription>
              Add an extra layer of security. You&apos;ll need an authenticator app such as Google
              Authenticator, Authy or 1Password.
            </DialogDescription>
          </DialogHeader>
          {enroll && (
            <form onSubmit={(e) => { e.preventDefault(); verify.mutate(); }} className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Open your authenticator app and add a new account.</li>
                <li>Scan the QR code, or enter the setup key manually.</li>
              </ol>
              <div className="flex justify-center">
                {/* QR is a data-URI from our backend; a plain img is the most robust here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enroll.qr} alt="Two-factor QR code" width={200} height={200} className="rounded-md border bg-white p-2" />
              </div>
              <div className="space-y-2">
                <Label>Setup key</Label>
                <Input readOnly value={enroll.secret} onFocus={(e) => e.currentTarget.select()} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mfaCode">Enter the 6-digit code to confirm</Label>
                <Input id="mfaCode" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                <Button type="submit" disabled={verify.isPending || code.length !== 6}>
                  {verify.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Verify &amp; enable
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DisableMfaDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const disable = useMutation({
    mutationFn: () => http.post("/mfa/disable", { password, code: code.trim() }),
    onSuccess: () => {
      toast.success("Two-factor authentication disabled");
      if (typeof window !== "undefined") window.localStorage.removeItem("hrms.trust");
      close(); onDone();
    },
    onError: (e) => toast.error(apiError(e)),
  });
  function close() { setOpen(false); setPassword(""); setCode(""); }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ShieldOff className="mr-2 h-4 w-4" /> Disable
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disable two-factor authentication</DialogTitle>
            <DialogDescription>Confirm your password and a current authenticator code to turn off 2FA.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); disable.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dpw">Password</Label>
              <PasswordInput id="dpw" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dcode">Authentication code</Label>
              <Input id="dcode" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={disable.isPending || !password || code.length !== 6}>
                {disable.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Disable
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Self-contained two-factor (TOTP) management card, used in Profile and Settings. */
export function TwoFactorCard({ className }: { className?: string }) {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: ["mfa-status"],
    queryFn: () => http.get<MfaStatus>("/mfa/status"),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["mfa-status"] });

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Two-factor authentication</CardTitle>
            <CardDescription>Protect your account with a time-based one-time code (TOTP).</CardDescription>
          </div>
          {!isLoading && (
            <Badge variant={status?.enabled ? "green" : "grey"}>{status?.enabled ? "Enabled" : "Disabled"}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-9 w-40" />
        ) : status?.enabled ? (
          <DisableMfaDialog onDone={refresh} />
        ) : (
          <EnableMfaDialog onDone={refresh} />
        )}
      </CardContent>
    </Card>
  );
}
