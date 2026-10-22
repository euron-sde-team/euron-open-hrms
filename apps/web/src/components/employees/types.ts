import type { Employee } from "@open-hrms/types";

export interface EmployeeSalary {
  // The legacy scalars. Still written on every save and still what letters,
  // settlement and reports read.
  basic?: number;
  hra?: number;
  allowances?: number;
  deductions?: number;
  currency?: string;
  /** The generalized breakup the payroll engine consumes. */
  components?: { key: string; label: string; amount: number; taxable?: boolean }[];
  /** What HR actually agreed; the breakup above is derived from it. */
  annualCtc?: number;
  /** Which org salary structure produced the breakup. */
  structureId?: string;
  /** Per-employee eligibility and overrides for PF / ESI / professional tax. */
  statutory?: {
    pf?: { applicable?: boolean; restrictToCeiling?: boolean; uan?: string; override?: number };
    esi?: { applicable?: boolean; override?: number };
    professionalTax?: { applicable?: boolean; state?: string; override?: number };
  };
}

export type EnrichedEmployee = Employee & {
  department?: string;
  departmentName?: string;
  fullName?: string;
  salary?: EmployeeSalary | null;
  personalEmail?: string;
  officialEmail?: string;
  officeId?: string | null;
  joiningDate?: string | null;
  pan?: string;
  uan?: string;
  kyc?: { pan?: string; uan?: string } | null;
  bank?: { account?: string; ifsc?: string; bankName?: string } | null;
  /** The linked login's role, null when this person has no portal access. */
  portalRole?: string | null;
  portalRoleKeys?: string[];
  portalStatus?: string | null;
  /** The address this person actually signs in with. */
  loginEmail?: string | null;
  userId?: string | null;
  hasLogin?: boolean;
};

export type BadgeColour = "green" | "amber" | "red" | "blue" | "grey" | "violet";

/**
 * Portal roles, coloured by reach. Admin is deliberately the loudest: "who can change
 * everything in this workspace" is the question this column exists to answer at a glance.
 */
export const ROLE_VARIANT: Record<string, BadgeColour> = {
  ADMIN: "violet",
  HR: "blue",
  MANAGER: "amber",
  EMPLOYEE: "grey",
};

/** Human label for a portal role, tolerating custom role keys. */
export function roleLabel(role?: string | null): string {
  if (!role) return "No access";
  return role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, " ");
}

export const STATUS_VARIANT: Record<string, BadgeColour> = {
  ACTIVE: "green",
  ONBOARDING: "amber",
  NOTICE_PERIOD: "amber",
  ON_LEAVE: "amber",
  INVITED: "amber",
  EXITED: "grey",
  ABSCONDING: "red",
};

export const TYPE_VARIANT: Record<string, BadgeColour> = {
  FULL_TIME: "green",
  PART_TIME: "amber",
  INTERN: "blue",
  CONTRACT: "violet",
  OUTSOURCED: "grey",
};

/** Humanize an underscored enum value (e.g. NOTICE_PERIOD → "Notice Period"). */
export function statusLabel(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Statuses the inline grid offers. Exit states (EXITED, ABSCONDING, NOTICE_PERIOD)
 * are deliberately absent: those come with a separation record, clearance and letters,
 * so they belong to the Exit action rather than a spreadsheet cell. A row already in
 * one of them keeps it as an option so editing that row cannot silently reassign it.
 */
const GRID_STATUSES = ["ACTIVE", "ONBOARDING", "ON_LEAVE", "INVITED"];

export function statusOptions(current?: string | null): Array<{ value: string; label: string }> {
  const values = current && !GRID_STATUSES.includes(current) ? [...GRID_STATUSES, current] : GRID_STATUSES;
  return values.map((v) => ({ value: v, label: statusLabel(v) }));
}

/** Name for a manager / owner picker, disambiguated by employee code. */
export function employeeLabel(e: Pick<Employee, "firstName" | "lastName" | "code">): string {
  const name = `${e.firstName} ${e.lastName || ""}`.trim();
  return e.code ? `${name} (${e.code})` : name;
}
