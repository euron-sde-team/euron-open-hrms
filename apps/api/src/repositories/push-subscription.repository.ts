import { Repository } from "./repository";

/** Data access for `push_subscriptions`. */
export class PushSubscriptionRepository extends Repository {
  /**
   * The subscription for one browser endpoint. `endpoint` is a hot column, so the lookup is
   * SQL. Anything that is not a string cannot match a stored endpoint, and must not reach
   * where() (an array there would turn into an IN list).
   */
  async findByEndpoint(endpoint: unknown) {
    if (typeof endpoint !== "string") return null;
    return this.where({ endpoint }).one();
  }
}
