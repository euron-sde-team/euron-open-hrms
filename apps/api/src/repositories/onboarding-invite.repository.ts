import { Repository, type Row } from "./repository";

/** An `onboarding_invites` row: the fields template resolution reads, over the open document. */
export type OnboardingInviteRow = Row & {
  employmentType?: string | null;
  departmentId?: string | null;
};

/** Data access for `onboarding_invites`. */
export class OnboardingInviteRepository extends Repository<OnboardingInviteRow> {
  /** Every invite, newest first. */
  async newestFirst() {
    return (await this.all()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** The invite a raw link token was minted for (pre-case links carry the raw token). */
  byToken(token: string) {
    return this.where({ token }).one();
  }
}
