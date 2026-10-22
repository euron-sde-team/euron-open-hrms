"use client";

import { Input } from "@open-hrms/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-hrms/ui/select";
import { cn } from "@open-hrms/ui/cn";

// Common country dial codes (India first). Flags are emoji, they render as real flag
// images on macOS/iOS/Android; on Windows browsers they fall back to the country code.
export const DIAL_CODES: { code: string; flag: string; label: string }[] = [
  { code: "+91", flag: "🇮🇳", label: "India (+91)" },
  { code: "+1", flag: "🇺🇸", label: "USA / Canada (+1)" },
  { code: "+44", flag: "🇬🇧", label: "UK (+44)" },
  { code: "+61", flag: "🇦🇺", label: "Australia (+61)" },
  { code: "+971", flag: "🇦🇪", label: "UAE (+971)" },
  { code: "+65", flag: "🇸🇬", label: "Singapore (+65)" },
  { code: "+49", flag: "🇩🇪", label: "Germany (+49)" },
  { code: "+33", flag: "🇫🇷", label: "France (+33)" },
  { code: "+81", flag: "🇯🇵", label: "Japan (+81)" },
  { code: "+86", flag: "🇨🇳", label: "China (+86)" },
  { code: "+880", flag: "🇧🇩", label: "Bangladesh (+880)" },
  { code: "+92", flag: "🇵🇰", label: "Pakistan (+92)" },
  { code: "+94", flag: "🇱🇰", label: "Sri Lanka (+94)" },
  { code: "+977", flag: "🇳🇵", label: "Nepal (+977)" },
];

export const DEFAULT_DIAL_CODE = "+91";

/** Split a stored "+91 98765..." phone string into its dial code and local number. */
export function splitPhone(full?: string | null): { dialCode: string; number: string } {
  const s = (full ?? "").trim();
  if (!s) return { dialCode: DEFAULT_DIAL_CODE, number: "" };
  // Longest dial codes first so "+91" doesn't shadow "+977", etc.
  const match = [...DIAL_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => s.startsWith(c.code));
  if (match) return { dialCode: match.code, number: s.slice(match.code.length).trim() };
  return { dialCode: DEFAULT_DIAL_CODE, number: s };
}

/** Join a dial code and local number into a single stored phone string. */
export function joinPhone(dialCode: string, number: string): string {
  const n = (number ?? "").trim();
  return n ? `${dialCode || DEFAULT_DIAL_CODE} ${n}`.trim() : "";
}

/**
 * Phone input with a country dial-code + flag dropdown. Controlled via separate
 * `dialCode` / `number` values so callers can store them however they like (combine
 * with joinPhone on submit, split with splitPhone when loading).
 */
export function PhoneField({
  id,
  dialCode,
  number,
  onDialCodeChange,
  onNumberChange,
  placeholder = "Phone number",
  className,
  disabled,
}: {
  id?: string;
  dialCode: string;
  number: string;
  onDialCodeChange: (code: string) => void;
  onNumberChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Read-only rendering, e.g. the onboarding form preview in the template builder. */
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex gap-2", className)}>
      {/*
        A native <select> can't show a short label closed and a descriptive one open, the option's text drives both, which is what cropped this field. The shadcn
        Select renders the trigger separately, so the closed box stays compact
        ("🇮🇳 +91") while the list stays scannable ("🇮🇳 India (+91)").
      */}
      <Select
        items={DIAL_CODES.map((c) => ({ value: c.code, label: c.label }))}
        value={dialCode || DEFAULT_DIAL_CODE}
        onValueChange={(v) => onDialCodeChange(String(v))}
        disabled={disabled}
      >
        {/* Wide enough for the longest code (🇧🇩 +880) plus the chevron; px-3 trims the
            trigger's default padding so the value never truncates to "+…". */}
        <SelectTrigger aria-label="Country code" className="w-[124px] shrink-0 px-3">
          <SelectValue>
            {(value: unknown) => {
              const code = String(value ?? DEFAULT_DIAL_CODE);
              const c = DIAL_CODES.find((x) => x.code === code);
              return (
                <span className="whitespace-nowrap">
                  {c ? `${c.flag} ${c.code}` : code}
                </span>
              );
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {DIAL_CODES.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              {c.flag} {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        placeholder={placeholder}
        className="w-full min-w-0 flex-1"
        value={number}
        onChange={(e) => onNumberChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}
