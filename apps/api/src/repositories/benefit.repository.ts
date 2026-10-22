import { Repository } from "./repository";

/** Data access for `benefits`: company benefits, in display order. */
export class BenefitRepository extends Repository {
  /** Every benefit in its display order. */
  async inOrder() {
    return (await this.all()).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
}
