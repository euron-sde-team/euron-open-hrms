"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@open-hrms/ui/cn";
import { productName } from "@/lib/runtime-env";
import { ProductWordmark } from "@/components/product-wordmark";

function Mark({ light = false, size = 40 }: { light?: boolean; size?: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-3 text-[20px] font-semibold tracking-[-0.02em]",
        light ? "text-white" : "text-foreground"
      )}
    >
      <span
        className={cn(
          "grid place-items-center rounded-[11px] font-bold",
          light
            ? "bg-white/15 text-white backdrop-blur"
            : "bg-primary text-primary-foreground shadow-[var(--elev-2)]"
        )}
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        e
      </span>
      <span>
        <ProductWordmark tailClassName={light ? "text-white/60" : undefined} />
      </span>
    </span>
  );
}

/**
 * Shared frame for every unauthenticated screen (sign-in, sign-up, password
 * reset, invite acceptance) so they read as one product rather than four
 * separately-built forms.
 *
 * Desktop is a split: a deep-teal brand panel carrying the pitch, and a calm
 * form column. Below `lg` the panel drops away and the form gets the full
 * width, with the wordmark moved inline.
 */
export function AuthShell({
  title,
  subtitle,
  headline,
  points,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  /** Large headline shown on the desktop brand panel. */
  headline: string;
  /** Three or four short proof points under the headline. */
  points: string[];
  children: ReactNode;
  footer?: ReactNode;
  /** Use a wider form column for multi-field forms like sign-up. */
  wide?: boolean;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ── Brand panel (desktop only) ──────────────────────────────────── */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0b4f44] p-14 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-28 -top-28 size-[420px] rounded-full bg-[#2fb89c]/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 size-[460px] rounded-full bg-black/25 blur-3xl"
        />
        {/* faint grid, for depth without noise */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />

        <Link href="/" className="press relative w-fit">
          <Mark light />
        </Link>

        <div className="relative">
          <h1 className="max-w-md text-[40px] leading-[1.1] font-bold tracking-[-0.028em]">
            {headline}
          </h1>
          <ul className="mt-9 space-y-4">
            {points.map((line) => (
              <li key={line} className="flex items-start gap-3.5 text-[17px] leading-[24px] text-white/80">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white/15">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[14px] text-white/45">
          {productName()}
        </p>
      </div>

      {/* ── Form column ─────────────────────────────────────────────────── */}
      <div className="flex flex-col justify-center bg-background px-5 py-10 sm:px-10">
        <div className={cn("mx-auto w-full", wide ? "max-w-[520px]" : "max-w-[440px]")}>
          <Link href="/" className="press mb-9 inline-block lg:hidden">
            <Mark size={36} />
          </Link>

          <h2 className="text-[32px] leading-[38px] font-bold tracking-[-0.024em] text-foreground">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-2.5 text-[17px] leading-[24px] text-muted-foreground">{subtitle}</p>
          )}

          <div className="mt-9">{children}</div>

          {footer && <div className="mt-8">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
