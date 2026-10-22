import { Repository } from "./repository";

/** Data access for `wellbeing`: one pulse check-in per employee per day. */
export class WellbeingRepository extends Repository {
  /** All of one employee's check-ins. employeeId is a hot col (indexed). */
  forEmployee(employeeId: string) {
    return this.where({ employeeId }).list();
  }

  /** The employee's check-in for one day. Indexed. */
  forDay(employeeId: string, date: string) {
    return this.where({ employeeId, date }).one();
  }

  /** Every check-in dated on or after `from` (YYYY-MM-DD). */
  since(from: string) {
    return this.find((w) => w.date >= from);
  }
}
