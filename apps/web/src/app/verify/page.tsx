"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { http, apiError, tokenStore } from "@/lib/api";
import { ProductWordmark } from "@/components/product-wordmark";
import { useAuth } from "@/lib/auth";
import { Button } from "@open-hrms/ui/button";
import type { LoginResponse } from "@open-hrms/types";

function VerifyInner() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const { refresh } = useAuth();
  const [state, setState] = useState<"verifying" | "ok" | "error">("verifying");
  const [message, setMessage] = useState("");
  const ran = useRef(false); // guard against double-run in React strict mode

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    (async () => {
      try {
        const res = await http.post<LoginResponse>("/signup/verify", { token });
        if (res.token) {
          tokenStore.set(res.token); // single-use token consumed → log the admin straight in
          await refresh();
          setState("ok");
          setTimeout(() => router.replace("/dashboard"), 900);
        } else {
          throw new Error("Verification did not return a session.");
        }
      } catch (err) {
        setState("error");
        setMessage(apiError(err));
      }
    })();
  }, [token, refresh, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#15181d] p-5">
      <div className="w-full max-w-[380px] rounded-[10px] bg-card p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
        <div className="mb-4 flex items-center justify-center gap-2.5 text-[19px] font-extrabold tracking-tight text-foreground">
          <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-[#15181d] text-[18px] font-bold text-[#f4f1ea]">
            e
          </span>
          <ProductWordmark tailClassName="text-sm font-medium" />
        </div>

        {state === "verifying" && (
          <div className="space-y-3 py-4 text-muted-foreground">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
            <p className="text-sm">Verifying your workspace…</p>
          </div>
        )}

        {state === "ok" && (
          <div className="space-y-3 py-4">
            <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
            <p className="text-sm text-foreground">Workspace activated. Taking you in…</p>
          </div>
        )}

        {state === "error" && (
          <div className="space-y-4 py-2">
            <XCircle className="mx-auto h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{message || "We couldn't verify this link."}</p>
            <div className="flex flex-col gap-2">
              <Button onClick={() => router.replace("/login")} className="w-full">Go to sign in</Button>
              <a href="/signup" className="text-[13px] text-primary hover:underline">Create a new workspace</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}
