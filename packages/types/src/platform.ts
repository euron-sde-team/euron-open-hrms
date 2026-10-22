/**
 * Operator-plane shapes: everything under `/api/platform`.
 */

/** Operator roles. SUPPORT is read-only; the API answers 403 to its writes. */
export const OPERATOR_ROLES = ["OPERATOR", "SUPPORT"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export interface Operator {
  id: string;
  email: string;
  name: string;
  role: OperatorRole | (string & {});
  /** Present on `/platform/me`; the operator list does not carry it. */
  mfaEnabled?: boolean;
  status?: "ACTIVE" | "DISABLED" | (string & {});
  createdAt?: string;
}

export interface OperatorLoginResponse {
  mfaRequired?: boolean;
  mfaToken?: string;
  token?: string;
  admin?: Operator;
}

/**
 * Workspace lifecycle. Self-signup creates PENDING_VERIFICATION until the admin
 * clicks the email link; SUSPENDED and CANCELLED block every tenant request.
 */
export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION", "CANCELLED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** Narrow an untyped status from the wire, so unknown values are handled explicitly. */
export function isTenantStatus(value: unknown): value is TenantStatus {
  return typeof value === "string" && (TENANT_STATUSES as readonly string[]).includes(value);
}

/** True when tenant users are locked out of the workspace. */
export function isWorkspaceBlocked(status: TenantStatus | string | null | undefined): boolean {
  return status === "SUSPENDED" || status === "CANCELLED";
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  signupSource: string;
  country: string | null;
  users: number;
  employees: number;
  createdAt: string;
}

export interface TenantDetail {
  org: {
    id: string;
    name: string;
    slug: string;
    status: TenantStatus;
    signupSource: string;
    country: string | null;
    createdAt: string;
  };
  metrics: { employees: number; exited: number; users: number; pendingUsers: number; departments: number };
}

export interface TenantUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  employeeId?: string | null;
  createdAt?: string;
}

export interface SignupBucket {
  key: string;
  label: string;
  count: number;
}

export interface FleetMetrics {
  tenants: number;
  tenantsByStatus: Record<string, number>;
  active: number;
  suspended: number;
  pendingVerification: number;
  selfSignup: number;
  totalEmployees: number;
  totalUsers: number;
  newLast30Days: number;
  signupsByMonth: SignupBucket[];
  [k: string]: unknown;
}

/**
 * One row of an audit feed. `orgId` is null for operator-level events
 * (logins, operator management, and TENANT_DELETE, whose org no longer exists:
 * its name survives in `meta.name`).
 */
export interface FleetActivity {
  id: string;
  action: string;
  orgId: string | null;
  orgName: string | null;
  meta: Record<string, unknown>;
  at: string;
  /** Tenant-scoped feed only: who did it. */
  actor?: string;
}

export interface ImpersonationResponse {
  token: string;
  impersonating: { orgId: string; orgName: string; userId: string; userEmail: string };
}
