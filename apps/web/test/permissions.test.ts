import { describe, expect, it } from "vitest";
import { can, isStaffUser } from "@/lib/permissions";

const user = (role: string, permissions: string[] = [], isStaff = false) => ({ role, permissions, isStaff });

describe("can", () => {
  it("denies when signed out", () => {
    expect(can(null, "employees.view")).toBe(false);
    expect(can(undefined, "employees.view")).toBe(false);
  });

  it("lets ADMIN through regardless of the permission list", () => {
    expect(can(user("ADMIN"), "payroll.run")).toBe(true);
  });

  it("honours the * wildcard", () => {
    expect(can(user("HR", ["*"]), "anything.at.all")).toBe(true);
  });

  it("requires the exact permission otherwise", () => {
    const manager = user("MANAGER", ["leave.approve"]);
    expect(can(manager, "leave.approve")).toBe(true);
    expect(can(manager, "leave.approve.all")).toBe(false);
    expect(can(manager, "payroll.view")).toBe(false);
  });

  it("tolerates a missing permission list", () => {
    expect(can({ role: "EMPLOYEE", permissions: undefined as unknown as string[] }, "x")).toBe(false);
  });
});

describe("isStaffUser", () => {
  it("treats ADMIN and HR as staff even without the flag", () => {
    expect(isStaffUser(user("ADMIN"))).toBe(true);
    expect(isStaffUser(user("HR"))).toBe(true);
  });

  it("follows the flag for custom roles", () => {
    expect(isStaffUser(user("PAYROLL_CLERK", [], true))).toBe(true);
    expect(isStaffUser(user("EMPLOYEE"))).toBe(false);
    expect(isStaffUser(null)).toBe(false);
  });
});
