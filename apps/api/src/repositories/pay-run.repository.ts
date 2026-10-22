import { Repository } from "./repository";

/** Data access for `pay_runs`: one row per payroll run (single generation or sheet upload). */
export class PayRunRepository extends Repository {
  /** The run history, most recent first. */
  async newestFirst() {
    return (await this.all()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
}
