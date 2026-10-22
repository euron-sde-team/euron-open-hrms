/**
 * Tenant-plane session shapes: what `/api/auth/login` and `/api/auth/me` return.
 */

/** Built-in roles. Custom roles are free-form strings, hence the widening. */
export type BuiltInRole = "ADMIN" | "HR" | "MANAGER" | "EMPLOYEE" | "VENDOR";
export type Role = BuiltInRole | (string & {});

export interface Branding {
  /** Theme colour as a hex string, applied as the app's `--primary`. */
  color?: string;
  primaryColor?: string;
  logoUrl?: string;
  [k: string]: unknown;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  branding?: Branding | null;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isStaff: boolean;
  permissions: string[];
  employeeId: string | null;
  vendorId: string | null;
  status: string;
  hasReports: boolean;
  tourSeenAt: string | null;
  org: Org | null;
  employee: {
    id: string;
    code: string;
    employmentType?: string;
    departmentId?: string | null;
  } | null;
}

export interface LoginResponse {
  token?: string;
  user?: SessionUser;
  mfaRequired?: boolean;
  mfaToken?: string;
  trustToken?: string;
}

/** `GET /api/auth/me`. `impersonated` is set when an operator minted the token. */
export interface MeResponse {
  user: SessionUser;
  impersonated?: boolean;
}
