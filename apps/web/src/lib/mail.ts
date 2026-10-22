import { toast } from "sonner";

// Shape returned by the API mailer (sendTenantMail in apps/api/src/mailer.ts).
export type MailResult = { mode?: string; delivered?: boolean; error?: string } | null | undefined;

/**
 * Toast that reflects the REAL mail delivery status instead of assuming success.
 * A failed SES/SMTP send (delivered:false) shows an error toast rather than a
 * misleading "sent". `prefix` is the action ("Employee onboarded"), `verb` the
 * success word ("sent" / "emailed").
 */
export function mailToast(mail: MailResult, prefix: string, verb = "sent") {
  if (!mail) return toast.success(prefix);
  if (mail.mode === "outbox") return toast.success(`${prefix} · email saved to outbox`);
  if (mail.delivered === false) return toast.error(`${prefix}, but email delivery failed: ${mail.error || "unknown error"}`);
  return toast.success(`${prefix} · email ${verb}`);
}
