import { Repository } from "./repository";

/** Data access for `onboarding_campaigns`. */
export class OnboardingCampaignRepository extends Repository {
  /** Every campaign, newest first. */
  async newestFirst() {
    return (await this.all()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
}
