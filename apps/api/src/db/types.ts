import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type AiToken = {
    id: string;
    org_id: string;
    employee_id: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Announcement = {
    id: string;
    org_id: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Appraisal = {
    id: string;
    org_id: string;
    cycle_id: string;
    employee_id: string;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type AppraisalCycle = {
    id: string;
    org_id: string;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Asset = {
    id: string;
    org_id: string;
    employee_id: string | null;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Attendance = {
    id: string;
    org_id: string;
    employee_id: string;
    date: string;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type AuditLog = {
    id: string;
    org_id: string | null;
    user_id: string | null;
    action: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type AuthToken = {
    id: string;
    type: string;
    token_hash: string;
    org_id: string | null;
    user_id: string | null;
    email: string | null;
    expires_at: Timestamp;
    used_at: Timestamp | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Benefit = {
    id: string;
    org_id: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Department = {
    id: string;
    org_id: string;
    name: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Document = {
    id: string;
    org_id: string;
    employee_id: string | null;
    category: string | null;
    visibility: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Employee = {
    id: string;
    org_id: string;
    department_id: string | null;
    code: string | null;
    email: string | null;
    status: string | null;
    employment_type: string | null;
    reports_to: string | null;
    manager_id: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type FamilyBenefit = {
    id: string;
    org_id: string;
    employee_id: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Holiday = {
    id: string;
    org_id: string;
    date: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Job = {
    id: string;
    type: string;
    status: Generated<string>;
    org_id: string | null;
    run_at: Timestamp;
    attempts: Generated<number>;
    max_attempts: Generated<number>;
    last_error: string | null;
    payload: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type LeaveBalance = {
    id: string;
    org_id: string;
    employee_id: string;
    leave_type_id: string;
    year: number;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type LeaveRequest = {
    id: string;
    org_id: string;
    employee_id: string;
    leave_type_id: string | null;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type LeaveType = {
    id: string;
    org_id: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Notification = {
    id: string;
    org_id: string;
    user_id: string;
    type: string | null;
    read_at: Timestamp | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Office = {
    id: string;
    org_id: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type OnboardingCampaign = {
    id: string;
    org_id: string;
    status: string | null;
    due_at: Timestamp | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type OnboardingCase = {
    id: string;
    org_id: string;
    employee_id: string | null;
    invite_id: string | null;
    campaign_id: string | null;
    template_id: string | null;
    status: string | null;
    due_at: Timestamp | null;
    token_hash: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type OnboardingInvite = {
    id: string;
    org_id: string;
    token: string;
    status: string | null;
    employee_id: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type OnboardingTemplate = {
    id: string;
    org_id: string;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Organization = {
    id: string;
    name: string;
    slug: string;
    address: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type PayrollProfile = {
    id: string;
    org_id: string;
    country: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type PayRun = {
    id: string;
    org_id: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Payslip = {
    id: string;
    org_id: string;
    employee_id: string;
    month: number;
    year: number;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Perk = {
    id: string;
    org_id: string;
    employee_id: string | null;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Pip = {
    id: string;
    org_id: string;
    employee_id: string;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type PlatformAdmin = {
    id: string;
    email: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Policy = {
    id: string;
    org_id: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type PushSubscription = {
    id: string;
    org_id: string;
    employee_id: string;
    user_id: string | null;
    endpoint: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Reimbursement = {
    id: string;
    org_id: string;
    employee_id: string;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Reminder = {
    id: string;
    org_id: string;
    user_id: string;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type SavedView = {
    id: string;
    org_id: string;
    user_id: string;
    resource: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Separation = {
    id: string;
    org_id: string;
    employee_id: string;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type User = {
    id: string;
    org_id: string;
    email: string;
    role: string;
    employee_id: string | null;
    vendor_id: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Vendor = {
    id: string;
    org_id: string;
    code: string | null;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type VendorBill = {
    id: string;
    org_id: string;
    vendor_id: string;
    status: string | null;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type Wellbeing = {
    id: string;
    org_id: string;
    employee_id: string;
    date: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type WorkLog = {
    id: string;
    org_id: string;
    employee_id: string;
    date: string;
    data: Generated<unknown>;
    created_at: Generated<Timestamp>;
    updated_at: Generated<Timestamp>;
};
export type OrgDataKey = {
    org_id: string;
    scheme: string;
    key_ref: string | null;
    wrapped_key: string;
    created_at: Generated<Timestamp>;
};
export type DB = {
    ai_tokens: AiToken;
    announcements: Announcement;
    appraisal_cycles: AppraisalCycle;
    appraisals: Appraisal;
    assets: Asset;
    attendance: Attendance;
    audit_log: AuditLog;
    auth_tokens: AuthToken;
    benefits: Benefit;
    departments: Department;
    documents: Document;
    employees: Employee;
    family_benefits: FamilyBenefit;
    holidays: Holiday;
    jobs: Job;
    leave_balances: LeaveBalance;
    leave_requests: LeaveRequest;
    leave_types: LeaveType;
    notifications: Notification;
    offices: Office;
    onboarding_campaigns: OnboardingCampaign;
    onboarding_cases: OnboardingCase;
    onboarding_invites: OnboardingInvite;
    onboarding_templates: OnboardingTemplate;
    org_data_keys: OrgDataKey;
    organizations: Organization;
    pay_runs: PayRun;
    payroll_profiles: PayrollProfile;
    payslips: Payslip;
    perks: Perk;
    pips: Pip;
    platform_admins: PlatformAdmin;
    policies: Policy;
    push_subscriptions: PushSubscription;
    reimbursements: Reimbursement;
    reminders: Reminder;
    saved_views: SavedView;
    separations: Separation;
    users: User;
    vendor_bills: VendorBill;
    vendors: Vendor;
    wellbeing: Wellbeing;
    work_logs: WorkLog;
};
