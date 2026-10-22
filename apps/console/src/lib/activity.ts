import type { FleetActivity } from "@open-hrms/types";

export type ActivityTone = "default" | "secondary" | "destructive" | "outline";

/**
 * Friendly labels and tone for the audit actions surfaced in the console.
 * Keep in step with PLATFORM_ACTIONS (and the tenant-scoped actions the
 * operator plane writes) in apps/api/src/operator/platform.routes.ts.
 */
export const ACTION_META: Record<string, { label: string; tone: ActivityTone }> = {
  TENANT_CREATE: { label: "Workspace created", tone: "default" },
  TENANT_SUSPEND: { label: "Workspace suspended", tone: "destructive" },
  TENANT_REACTIVATE: { label: "Workspace reactivated", tone: "default" },
  TENANT_DELETE: { label: "Workspace deleted", tone: "destructive" },
  IMPERSONATE: { label: "Impersonated admin", tone: "secondary" },
  TENANT_ADMIN_RESET: { label: "Admin password reset", tone: "secondary" },
  DATA_EXPORT: { label: "Data exported", tone: "outline" },
  STARTER_CONTENT_APPLIED: { label: "Starter content loaded", tone: "outline" },
  OPERATOR_LOGIN: { label: "Operator signed in", tone: "outline" },
  OPERATOR_CREATE: { label: "Operator added", tone: "default" },
  OPERATOR_STATUS: { label: "Operator status changed", tone: "secondary" },
  OPERATOR_MFA_ENABLE: { label: "Operator enabled 2FA", tone: "default" },
  OPERATOR_MFA_DISABLE: { label: "Operator disabled 2FA", tone: "destructive" },
};

/** Label for any action, known or not ("SOME_NEW_THING" reads as "some new thing"). */
export function actionMeta(action: string): { label: string; tone: ActivityTone } {
  return ACTION_META[action] ?? { label: action.replace(/_/g, " ").toLowerCase(), tone: "outline" };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");

/**
 * What the row is about. A workspace action names the workspace; a deleted
 * workspace has no org row any more (orgId is null), so its name comes from
 * the audit meta; operator events name the operator they concern.
 */
export function activitySubject(a: Pick<FleetActivity, "action" | "orgName" | "meta">): string {
  if (a.orgName) return a.orgName;
  const meta = a.meta ?? {};
  if (a.action === "TENANT_DELETE") return str(meta.name) || str(meta.slug) || "Deleted workspace";
  if (a.action.startsWith("OPERATOR_")) {
    const who = str(meta.email);
    if (a.action === "OPERATOR_STATUS" && who) return `${who} (${str(meta.status).toLowerCase() || "updated"})`;
    return who || "Operator";
  }
  return "-";
}
