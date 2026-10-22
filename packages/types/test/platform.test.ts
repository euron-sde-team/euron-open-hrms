import { describe, expect, expectTypeOf, it } from "vitest";
import {
  isTenantStatus,
  isWorkspaceBlocked,
  OPERATOR_ROLES,
  TENANT_STATUSES,
  type Operator,
  type TenantStatus,
} from "../src";

describe("tenant status", () => {
  it("uses the API's PENDING_VERIFICATION spelling", () => {
    expect(TENANT_STATUSES).toContain("PENDING_VERIFICATION");
    expect(isTenantStatus("PENDING_VERIFICATION")).toBe(true);
    // The old client spelling never comes back from the API.
    expect(isTenantStatus("PENDING")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isTenantStatus(undefined)).toBe(false);
    expect(isTenantStatus(1)).toBe(false);
  });

  it("blocks exactly the statuses the API locks out", () => {
    const blocked = TENANT_STATUSES.filter((s) => isWorkspaceBlocked(s));
    expect(blocked).toEqual(["SUSPENDED", "CANCELLED"]);
    expect(isWorkspaceBlocked(null)).toBe(false);
  });

  it("is a closed union", () => {
    expectTypeOf<TenantStatus>().toEqualTypeOf<
      "ACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION" | "CANCELLED"
    >();
  });
});

describe("operator", () => {
  it("knows both roles", () => {
    expect(OPERATOR_ROLES).toEqual(["OPERATOR", "SUPPORT"]);
  });

  it("carries mfaEnabled", () => {
    expectTypeOf<Operator>().toHaveProperty("mfaEnabled").toEqualTypeOf<boolean | undefined>();
  });
});
