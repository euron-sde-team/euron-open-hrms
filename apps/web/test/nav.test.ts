import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS,
  isNavItemVisible,
  navLabel,
  resolveActiveHref,
  visibleNavGroups,
  type NavViewer,
} from "@/lib/nav";

const hrefs = (viewer: NavViewer) => visibleNavGroups(viewer).flatMap((g) => g.items.map((i) => `${g.label}:${i.label}`));

const ADMIN_NO_PROFILE: NavViewer = { isStaff: true, hasEmployee: false };
const ADMIN_WITH_PROFILE: NavViewer = { isStaff: true, hasEmployee: true };
const EMPLOYEE: NavViewer = { isStaff: false, hasEmployee: true };
const VENDOR: NavViewer = { isStaff: false, hasEmployee: false };

describe("nav visibility", () => {
  it("hides staff-only entries from employees", () => {
    const items = hrefs(EMPLOYEE);
    expect(items).not.toContain("People:Employees");
    expect(items).not.toContain("Settings:Users");
    expect(items).toContain("Settings:Security");
  });

  it("shows the employee portal twins only to non-staff", () => {
    expect(hrefs(EMPLOYEE)).toContain("Finance:My payslips");
    expect(hrefs(EMPLOYEE)).toContain("Workplace:Resignation");
    expect(hrefs(ADMIN_WITH_PROFILE)).not.toContain("Finance:My payslips");
    expect(hrefs(ADMIN_WITH_PROFILE)).toContain("Finance:Payslips");
  });

  it("gates employee-only entries on a linked profile, staff included", () => {
    expect(hrefs(ADMIN_WITH_PROFILE)).toContain("People:My details");
    expect(hrefs(ADMIN_NO_PROFILE)).not.toContain("People:My details");
    expect(hrefs(VENDOR)).not.toContain("Finance:My payslips");
  });

  it("drops groups left empty", () => {
    for (const viewer of [ADMIN_NO_PROFILE, EMPLOYEE, VENDOR]) {
      for (const g of visibleNavGroups(viewer)) expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it("agrees with isNavItemVisible item by item", () => {
    const all = NAV_GROUPS.flatMap((g) => g.items);
    const visible = visibleNavGroups(EMPLOYEE).flatMap((g) => g.items);
    expect(visible).toEqual(all.filter((i) => isNavItemVisible(i, EMPLOYEE)));
  });
});

describe("navLabel", () => {
  const leave = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/leave")!;
  it("uses the employee label for non-staff", () => {
    expect(navLabel(leave, { isStaff: false })).toBe("My leave");
    expect(navLabel(leave, { isStaff: true })).toBe("Leave");
  });
});

describe("resolveActiveHref", () => {
  it("picks exactly one entry among tabs sharing a path", () => {
    expect(resolveActiveHref("/settings", "users")).toBe("/settings?tab=users");
    expect(resolveActiveHref("/performance", "pip")).toBe("/performance?tab=pip");
  });

  it("falls back to the tab-less entry for the default view", () => {
    expect(resolveActiveHref("/payroll", null)).toBe("/payroll");
  });

  it("falls back to the first entry when no tab-less one exists", () => {
    expect(resolveActiveHref("/settings", "nonsense")).toBe("/settings?tab=security");
  });

  it("matches nested paths but not prefixes of other words", () => {
    expect(resolveActiveHref("/onboarding/me", null)).toBe("/onboarding/me");
    expect(resolveActiveHref("/employees/123", null)).toBe("/employees");
    expect(resolveActiveHref("/employeesx", null)).toBeNull();
  });
});
