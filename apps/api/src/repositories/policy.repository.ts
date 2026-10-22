import { Repository } from "./repository";

/** Data access for `policies`: company policy documents, in display order. */
export class PolicyRepository extends Repository {
  /** Every policy in its display order. */
  async inOrder() {
    return (await this.all()).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
}
