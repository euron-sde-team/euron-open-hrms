import { Repository } from "./repository";

/** Data access for `work_logs`: one log per employee per day. */
export class WorkLogRepository extends Repository {
  /** The employee's log for one day. Indexed (employeeId+date hot cols). */
  forDay(employeeId: string, date: string) {
    return this.where({ employeeId, date }).one();
  }

  /** Every log dated within [from, to] (inclusive, YYYY-MM-DD). */
  between(from: string, to: string) {
    return this.find((w) => w.date >= from && w.date <= to);
  }
}
