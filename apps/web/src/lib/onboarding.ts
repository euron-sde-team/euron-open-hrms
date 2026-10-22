/**
 * Shared shapes for onboarding invites, used by the onboarding page, the bulk
 * invite flow and the edit dialog.
 */

import { employmentTypeLabel, CURRENT_EMPLOYMENT_TYPES } from "@/lib/employment";
import type { MailResult } from "@/lib/mail";

export interface OnboardingInvite {
  id: string;
  token: string;
  personalEmail: string;
  firstName: string;
  lastName?: string | null;
  designation: string;
  departmentId: string | null;
  departmentName: string | null;
  employmentType: string;
  joiningDate: string;
  reportsTo?: string | null;
  salaryBasic?: number | null;
  annualCtc?: number | null;
  salaryStructureId?: string | null;
  status: "PENDING" | "SENT" | "COMPLETED" | string;
  link: string;
}

/** Department picker option (mirrors GET /api/departments). */
export interface InviteDepartment {
  id: string;
  name: string;
}

/** Minimal employee shape for the "Reports to" manager picker. */
export interface InviteManagerOption {
  id: string;
  firstName: string;
  lastName?: string;
  code?: string;
  status?: string;
}

/** One row of a batch POST /api/onboarding/invites. */
export interface InvitePayload {
  personalEmail: string;
  firstName: string;
  lastName: string;
  departmentId: string | null;
  employmentType: string;
  designation: string;
  joiningDate: string;
  reportsTo: string | null;
  salaryBasic?: number | null;
  annualCtc: number | null;
  salaryStructureId: string | null;
}

/** POST /api/onboarding/invites with `{ invites: [...] }`. */
export interface BatchInviteResponse {
  /** Created rows carry the real per-candidate mail delivery result. */
  created: (OnboardingInvite & { mail?: MailResult })[];
  failed: { index: number; personalEmail: string; error: string }[];
  skipped: { index: number; personalEmail: string; reason: string }[];
  sent: number;
}

/**
 * Employment types offered when inviting a candidate.
 *
 * This used to be a hand-maintained short list, because the invite endpoint validated
 * against its own stale copy that omitted Permanent, Freelancer, Temporary and Vendor,
 * so picking the commonest type of all failed with a 400 at submit time. The server now
 * validates against the shared catalogue, so the normal current-types list is correct
 * here and there is no second list to keep in sync.
 */
export const INVITE_EMPLOYMENT_TYPES = CURRENT_EMPLOYMENT_TYPES.map((t) => ({
  value: t.value,
  label: employmentTypeLabel(t.value),
}));

export const DEFAULT_INVITE_TYPE = "PERMANENT";

/** Today as YYYY-MM-DD, the format the invite endpoints expect. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Render a date string (YYYY-MM-DD or ISO) as a friendly day. */
export function formatInviteDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export interface ParsedCandidate {
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Turn a pasted block into candidate rows.
 *
 * Accepts newline, comma, semicolon or tab separated lists, and the shapes a
 * recruiter actually pastes out of a mail client or a sheet:
 *   asha@example.com
 *   Asha Rao <asha@example.com>
 *   "Asha Rao" asha@example.com
 * Anything that is not an email is treated as the name sitting beside it, so a
 * pasted "Name, email" sheet column fills both fields.
 */
export function parsePastedCandidates(text: string): ParsedCandidate[] {
  const out: ParsedCandidate[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    // Split a line only on separators that cannot appear inside an email, so
    // "Asha Rao <asha@example.com>" survives as one chunk.
    for (const chunk of rawLine.split(/[,;\t]+/)) {
      const piece = chunk.trim();
      if (!piece) continue;

      const angled = piece.match(/^(.*?)<\s*([^<>\s]+)\s*>$/);
      const email = angled ? (angled[2] ?? "").trim() : piece.split(/\s+/).find((t) => EMAIL_RE.test(t)) || "";
      if (!EMAIL_RE.test(email)) continue;

      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const namePart = (angled ? (angled[1] ?? "") : piece.replace(email, ""))
        .replace(/["']/g, "")
        .trim();
      const words = namePart.split(/\s+/).filter(Boolean);
      out.push({
        email: key,
        firstName: words[0] || "",
        lastName: words.slice(1).join(" "),
      });
    }
  }
  return out;
}
