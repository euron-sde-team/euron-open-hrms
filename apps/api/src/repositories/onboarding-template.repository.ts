import { Repository } from "./repository";

/** Data access for `onboarding_templates`. */
export class OnboardingTemplateRepository extends Repository {
  /**
   * Exactly one default. Enforced in application code rather than as a partial unique index
   * because `isDefault` lives in the jsonb `data` column, so there is no column to index.
   */
  async clearDefaultsExcept(keepId: string) {
    const all = await this.all();
    for (const other of all) {
      if (other.id !== keepId && other.isDefault) {
        await this.update(other.id, { isDefault: false });
      }
    }
  }
}
