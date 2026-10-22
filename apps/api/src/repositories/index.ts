/**
 * The data-access surface a service works with: one repository per collection, all bound
 * to the same workspace-scoped store (and the same transaction, inside `transaction`).
 *
 *   const data = createRepositories(repos({ orgId }));
 *   await data.employees.byId(id);
 *   await data.transaction(async (tx) => { await tx.departments.create(...); });
 */
import { OrganizationRepository } from "./organization.repository";
import { UserRepository } from "./user.repository";
import { OfficeRepository } from "./office.repository";
import { DepartmentRepository } from "./department.repository";
import { LeaveTypeRepository } from "./leave-type.repository";
import { LeaveBalanceRepository } from "./leave-balance.repository";
import { LeaveRequestRepository } from "./leave-request.repository";
import { DocumentRepository } from "./document.repository";
import { AttendanceRepository } from "./attendance.repository";
import { PayslipRepository } from "./payslip.repository";
import { PayRunRepository } from "./pay-run.repository";
import { PayrollProfileRepository } from "./payroll-profile.repository";
import { ReimbursementRepository } from "./reimbursement.repository";
import { VendorRepository } from "./vendor.repository";
import { VendorBillRepository } from "./vendor-bill.repository";
import { OnboardingInviteRepository } from "./onboarding-invite.repository";
import { OnboardingTemplateRepository } from "./onboarding-template.repository";
import { OnboardingCampaignRepository } from "./onboarding-campaign.repository";
import { SeparationRepository } from "./separation.repository";
import { HolidayRepository } from "./holiday.repository";
import { PolicyRepository } from "./policy.repository";
import { BenefitRepository } from "./benefit.repository";
import { AnnouncementRepository } from "./announcement.repository";
import { PipRepository } from "./pip.repository";
import { AppraisalCycleRepository } from "./appraisal-cycle.repository";
import { AppraisalRepository } from "./appraisal.repository";
import { WorkLogRepository } from "./work-log.repository";
import { AiTokenRepository } from "./ai-token.repository";
import { AssetRepository } from "./asset.repository";
import { PerkRepository } from "./perk.repository";
import { FamilyBenefitRepository } from "./family-benefit.repository";
import { WellbeingRepository } from "./wellbeing.repository";
import { SavedViewRepository } from "./saved-view.repository";
import { ReminderRepository } from "./reminder.repository";
import { AuditLogRepository } from "./audit-log.repository";
import { NotificationRepository } from "./notification.repository";
import { PushSubscriptionRepository } from "./push-subscription.repository";
import { AuthTokenRepository } from "./auth-token.repository";
import { PlatformAdminRepository } from "./platform-admin.repository";
import { EmployeeRepository } from "./employee.repository";
import { OnboardingCaseRepository } from "./onboarding-case.repository";

export interface Repositories {
  organizations: OrganizationRepository;
  users: UserRepository;
  offices: OfficeRepository;
  departments: DepartmentRepository;
  leaveTypes: LeaveTypeRepository;
  leaveBalances: LeaveBalanceRepository;
  leaveRequests: LeaveRequestRepository;
  documents: DocumentRepository;
  attendance: AttendanceRepository;
  payslips: PayslipRepository;
  payRuns: PayRunRepository;
  payrollProfiles: PayrollProfileRepository;
  reimbursements: ReimbursementRepository;
  vendors: VendorRepository;
  vendorBills: VendorBillRepository;
  onboardingInvites: OnboardingInviteRepository;
  onboardingTemplates: OnboardingTemplateRepository;
  onboardingCampaigns: OnboardingCampaignRepository;
  separations: SeparationRepository;
  holidays: HolidayRepository;
  policies: PolicyRepository;
  benefits: BenefitRepository;
  announcements: AnnouncementRepository;
  pips: PipRepository;
  appraisalCycles: AppraisalCycleRepository;
  appraisals: AppraisalRepository;
  workLogs: WorkLogRepository;
  aiTokens: AiTokenRepository;
  assets: AssetRepository;
  perks: PerkRepository;
  familyBenefits: FamilyBenefitRepository;
  wellbeing: WellbeingRepository;
  savedViews: SavedViewRepository;
  reminders: ReminderRepository;
  auditLog: AuditLogRepository;
  notifications: NotificationRepository;
  pushSubscriptions: PushSubscriptionRepository;
  authTokens: AuthTokenRepository;
  platformAdmins: PlatformAdminRepository;
  employees: EmployeeRepository;
  onboardingCases: OnboardingCaseRepository;
  /** Run `fn` in one database transaction; every repository on `tx` shares it. */
  transaction<R>(fn: (tx: Repositories) => Promise<R>): Promise<R>;
}

export function createRepositories(repos: any): Repositories {
  return {
    organizations: new OrganizationRepository(repos.organizations),
    users: new UserRepository(repos.users),
    offices: new OfficeRepository(repos.offices),
    departments: new DepartmentRepository(repos.departments),
    leaveTypes: new LeaveTypeRepository(repos.leaveTypes),
    leaveBalances: new LeaveBalanceRepository(repos.leaveBalances),
    leaveRequests: new LeaveRequestRepository(repos.leaveRequests),
    documents: new DocumentRepository(repos.documents),
    attendance: new AttendanceRepository(repos.attendance),
    payslips: new PayslipRepository(repos.payslips),
    payRuns: new PayRunRepository(repos.payRuns),
    payrollProfiles: new PayrollProfileRepository(repos.payrollProfiles),
    reimbursements: new ReimbursementRepository(repos.reimbursements),
    vendors: new VendorRepository(repos.vendors),
    vendorBills: new VendorBillRepository(repos.vendorBills),
    onboardingInvites: new OnboardingInviteRepository(repos.onboardingInvites),
    onboardingTemplates: new OnboardingTemplateRepository(repos.onboardingTemplates),
    onboardingCampaigns: new OnboardingCampaignRepository(repos.onboardingCampaigns),
    separations: new SeparationRepository(repos.separations),
    holidays: new HolidayRepository(repos.holidays),
    policies: new PolicyRepository(repos.policies),
    benefits: new BenefitRepository(repos.benefits),
    announcements: new AnnouncementRepository(repos.announcements),
    pips: new PipRepository(repos.pips),
    appraisalCycles: new AppraisalCycleRepository(repos.appraisalCycles),
    appraisals: new AppraisalRepository(repos.appraisals),
    workLogs: new WorkLogRepository(repos.workLogs),
    aiTokens: new AiTokenRepository(repos.aiTokens),
    assets: new AssetRepository(repos.assets),
    perks: new PerkRepository(repos.perks),
    familyBenefits: new FamilyBenefitRepository(repos.familyBenefits),
    wellbeing: new WellbeingRepository(repos.wellbeing),
    savedViews: new SavedViewRepository(repos.savedViews),
    reminders: new ReminderRepository(repos.reminders),
    auditLog: new AuditLogRepository(repos.auditLog),
    notifications: new NotificationRepository(repos.notifications),
    pushSubscriptions: new PushSubscriptionRepository(repos.pushSubscriptions),
    authTokens: new AuthTokenRepository(repos.authTokens),
    platformAdmins: new PlatformAdminRepository(repos.platformAdmins),
    employees: new EmployeeRepository(repos.employees),
    onboardingCases: new OnboardingCaseRepository(repos.onboardingCases),
    /** Run `fn` in one database transaction; every repository on `tx` shares it. */
    transaction<R>(fn: (tx: Repositories) => Promise<R>): Promise<R> {
      return repos.transaction((trx: any) => fn(createRepositories(trx)));
    },
  };
}
