import { Repository } from "./repository";

/** Data access for `onboarding_cases`. */
export class OnboardingCaseRepository extends Repository {
  /** Cases opened for one employee, any status. */
  forEmployee(employeeId: string) {
    return this.where({ employeeId }).list();
  }

  /** Cases a pre-hire invite opened (normally one). */
  forInvite(inviteId: string) {
    return this.where({ inviteId }).list();
  }

  /** Whether a pre-hire invite has opened a case yet. */
  async inviteHasCase(inviteId: string) {
    return !!(await this.where({ inviteId }).one());
  }

  /** Cases a campaign opened. */
  forCampaign(campaignId: string) {
    return this.where({ campaignId }).list();
  }

  /** How many cases were created from a template, optionally only those in one status. */
  countForTemplate(templateId: string, status?: string) {
    return this.where(status ? { templateId, status } : { templateId }).count();
  }

  /** The case a pre-hire link resolves to; only the token's SHA-256 hash is stored. */
  byTokenHash(tokenHash: string) {
    return this.where({ tokenHash }).one();
  }
}
