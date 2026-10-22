"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Loader2,
  Search,
  Building2,
  User,
  CalendarDays,
  Hash,
} from "lucide-react";
import { apiBase, productName } from "@/lib/runtime-env";
import { ProductWordmark } from "@/components/product-wordmark";
import { cn } from "@open-hrms/ui/cn";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label, FieldHint } from "@open-hrms/ui/label";

/**
 * PUBLIC document verification page, the destination of the QR code and the
 * link printed on every payslip, letter and ID card.
 *
 * Deliberately unauthenticated and deliberately sparse: it answers "is this
 * genuine?" and shows only what the issuer chose to disclose. It must never
 * become a way to look up someone's salary from a code found on a discarded
 * printout.
 */

interface VerifyResult {
  found: boolean;
  valid: boolean;
  status: "VALID" | "REVOKED" | "EXPIRED" | "NOT_FOUND" | "TAMPERED";
  message: string;
  document?: {
    code: string;
    kindLabel: string;
    issuer: string;
    subjectName: string;
    subjectCode: string | null;
    issuedAt: string;
    validUntil: string | null;
    details: Record<string, unknown>;
    digest: string;
  };
}

const STATUS_STYLE = {
  VALID: {
    icon: ShieldCheck,
    ring: "bg-[color:var(--ok-bg)] text-[color:var(--ok)]",
    title: "Verified",
  },
  REVOKED: {
    icon: ShieldX,
    ring: "bg-[color:var(--bad-bg)] text-[color:var(--bad)]",
    title: "Revoked",
  },
  EXPIRED: {
    icon: ShieldAlert,
    ring: "bg-[color:var(--warn-bg)] text-[color:var(--warn)]",
    title: "Expired",
  },
  TAMPERED: {
    icon: ShieldX,
    ring: "bg-[color:var(--bad-bg)] text-[color:var(--bad)]",
    title: "Does not match",
  },
  NOT_FOUND: {
    icon: ShieldAlert,
    ring: "bg-muted text-muted-foreground",
    title: "Not found",
  },
} as const;

function formatDate(v?: string | null) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

const humanise = (k: string) =>
  k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

export default function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookup, setLookup] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${apiBase()}/verify/${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setResult(d); })
      .catch(() =>
        !cancelled &&
        setResult({
          found: false, valid: false, status: "NOT_FOUND",
          message: "We couldn't reach the verification service. Please try again shortly.",
        })
      )
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [code]);

  const style = STATUS_STYLE[result?.status ?? "NOT_FOUND"];
  const Icon = style.icon;
  const doc = result?.document;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-[color:var(--hairline)]">
        <div className="container-public flex h-[68px] items-center justify-between">
          <Link href="/" className="press inline-flex items-center gap-2.5 text-[19px] font-semibold tracking-[-0.02em]">
            <span className="grid size-9 place-items-center rounded-[10px] bg-primary text-[18px] font-bold text-primary-foreground">
              e
            </span>
            <ProductWordmark />
          </Link>
          <span className="text-[14px] text-muted-foreground">Document verification</span>
        </div>
      </header>

      <main className="container-public py-14 sm:py-20">
        <div className="mx-auto max-w-2xl">
          {loading ? (
            <div className="flex flex-col items-center py-24">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="mt-5 text-[16px] text-muted-foreground">Checking this document…</p>
            </div>
          ) : (
            <>
              <div className="rounded-[22px] border border-border bg-card p-8 shadow-[var(--elev-3)] sm:p-10">
                <div className="flex flex-col items-center text-center">
                  <span className={cn("grid size-20 place-items-center rounded-full", style.ring)}>
                    <Icon className="size-10" />
                  </span>
                  <h1 className="mt-6 text-[32px] leading-[38px] font-bold tracking-[-0.024em]">
                    {style.title}
                  </h1>
                  <p className="mt-3 max-w-lg text-[17px] leading-[24px] text-muted-foreground">
                    {result?.message}
                  </p>
                </div>

                {doc && (
                  <dl className="mt-9 divide-y divide-[color:var(--hairline)] border-t border-[color:var(--hairline)]">
                    {[
                      { icon: Hash, label: "Document", value: doc.kindLabel },
                      { icon: User, label: "Issued to", value: doc.subjectCode ? `${doc.subjectName} (${doc.subjectCode})` : doc.subjectName },
                      { icon: Building2, label: "Issued by", value: doc.issuer },
                      { icon: CalendarDays, label: "Issued on", value: formatDate(doc.issuedAt) },
                      ...(doc.validUntil ? [{ icon: CalendarDays, label: "Valid until", value: formatDate(doc.validUntil) }] : []),
                      ...Object.entries(doc.details).map(([k, v]) => ({
                        icon: Hash, label: humanise(k), value: String(v),
                      })),
                    ].map((row) => (
                      <div key={row.label} className="flex items-start gap-4 py-4">
                        <row.icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
                        <dt className="w-40 shrink-0 text-[15px] text-muted-foreground">{row.label}</dt>
                        <dd className="min-w-0 flex-1 text-[16px] font-medium">{row.value ?? "-"}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {doc && (
                  <div className="mt-8 rounded-[14px] bg-muted/60 p-5">
                    <p className="text-[13px] leading-[18px] text-muted-foreground">
                      Reference <span className="font-semibold text-foreground">{doc.code}</span>. The
                      issuer chooses what is shown here, figures such as salary are withheld by
                      default. To confirm the exact contents of a printed copy, compare its content
                      digest with the one below.
                    </p>
                    <p className="mt-2.5 font-mono text-[11px] leading-[16px] break-all text-muted-foreground">
                      {doc.digest}
                    </p>
                  </div>
                )}
              </div>

              {/* Let someone check a different document without hunting for the URL. */}
              <form
                className="mt-8 rounded-[18px] border border-border bg-card p-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = lookup.trim();
                  if (next) window.location.href = `/verify/${encodeURIComponent(next)}`;
                }}
              >
                <Label htmlFor="lookup">Check another document</Label>
                <div className="mt-2.5 flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="lookup"
                      value={lookup}
                      onChange={(e) => setLookup(e.target.value.toUpperCase())}
                      placeholder="ABCD-1234-EFGH"
                      className="pl-11 font-mono tracking-[0.08em]"
                    />
                  </div>
                  <Button type="submit" disabled={!lookup.trim()}>Verify</Button>
                </div>
                <FieldHint className="mt-2.5">
                  The reference is printed on the document, beneath the QR code.
                </FieldHint>
              </form>
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-[color:var(--hairline)] py-8">
        <div className="container-public text-center text-[14px] text-muted-foreground">
          Verification provided by {productName()}. Documents are checked against the issuing
          organisation&apos;s records at the moment you load this page.
        </div>
      </footer>
    </div>
  );
}
