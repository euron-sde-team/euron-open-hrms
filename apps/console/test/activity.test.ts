import { describe, expect, it } from "vitest";
import { ACTION_META, actionMeta, activitySubject } from "@/lib/activity";

describe("actionMeta", () => {
  it("labels every action the fleet feed can return", () => {
    // Mirrors PLATFORM_ACTIONS in apps/api/src/operator/platform.routes.ts.
    const fleet = [
      "TENANT_CREATE", "TENANT_SUSPEND", "TENANT_REACTIVATE", "IMPERSONATE", "TENANT_ADMIN_RESET",
      "TENANT_DELETE", "DATA_EXPORT", "OPERATOR_LOGIN", "OPERATOR_CREATE", "OPERATOR_STATUS",
      "OPERATOR_MFA_ENABLE", "OPERATOR_MFA_DISABLE",
    ];
    for (const a of fleet) expect(ACTION_META[a], a).toBeDefined();
    expect(ACTION_META.STARTER_CONTENT_APPLIED).toBeDefined();
  });

  it("degrades unknown actions to readable text", () => {
    expect(actionMeta("SOMETHING_NEW")).toEqual({ label: "something new", tone: "outline" });
  });
});

describe("activitySubject", () => {
  it("names the workspace when it still exists", () => {
    expect(activitySubject({ action: "TENANT_SUSPEND", orgName: "Acme", meta: {} })).toBe("Acme");
  });

  it("reads a deleted workspace's name from meta", () => {
    expect(activitySubject({ action: "TENANT_DELETE", orgName: null, meta: { name: "Acme", slug: "acme" } })).toBe("Acme");
    expect(activitySubject({ action: "TENANT_DELETE", orgName: null, meta: {} })).toBe("Deleted workspace");
  });

  it("names the operator for operator events", () => {
    expect(activitySubject({ action: "OPERATOR_LOGIN", orgName: null, meta: { email: "ops@example.com" } })).toBe(
      "ops@example.com"
    );
    expect(
      activitySubject({ action: "OPERATOR_STATUS", orgName: null, meta: { email: "ops@example.com", status: "DISABLED" } })
    ).toBe("ops@example.com (disabled)");
    expect(activitySubject({ action: "OPERATOR_MFA_ENABLE", orgName: null, meta: {} })).toBe("Operator");
  });
});
