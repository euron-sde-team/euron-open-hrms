/**
 * Core people records as the tenant API returns them. Records are stored as
 * "hot columns + jsonb", so the index signatures are deliberate: pages read a
 * handful of extra fields without every one of them being part of the contract.
 */

export type EmployeeStatus =
  | "ACTIVE"
  | "ON_LEAVE"
  | "EXITED"
  | "NOTICE_PERIOD"
  | "ABSCONDING"
  | "INVITED";

export interface Employee {
  id: string;
  code: string;
  firstName: string;
  lastName?: string;
  email?: string;
  /** Work address. Normally closed on exit, which is why the personal one is kept too. */
  officialEmail?: string;
  personalEmail?: string;
  phone?: string;
  designation?: string;
  departmentId?: string | null;
  employmentType?: string;
  /** Contractual notice period in days. Null/absent falls back to the org default. */
  noticePeriodDays?: number | null;
  joiningDate?: string | null;
  status: EmployeeStatus | (string & {});
  reportsTo?: string | null;
  managerId?: string | null;
  joinedAt?: string;
  [k: string]: unknown;
}

export interface Department {
  id: string;
  name: string;
  description?: string;
  headId?: string | null;
}

export interface VendorBank {
  account?: string;
  ifsc?: string;
  bankName?: string;
  paypal?: string;
}

export interface Vendor {
  id: string;
  code: string;
  name: string;
  type: "VENDOR" | "CONSULTANT" | "PROVIDER" | "CONTRACTOR" | (string & {});
  email: string;
  phone?: string;
  company?: string;
  gstin?: string;
  pan?: string;
  services?: string;
  bank?: VendorBank;
  status: string;
  billsTotal?: number;
  [k: string]: unknown;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: string;
  from: string;
  to: string;
  days: number;
  reason?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | (string & {});
  [k: string]: unknown;
}
