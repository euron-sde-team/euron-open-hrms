import { Repository } from "./repository";
import { isActive } from "../domain/separation-config";

/** Data access for `separations`: one row per exit (resignation, termination, absconding...). */
export class SeparationRepository extends Repository {
  /** Every separation an employee has had. employeeId is pushed to SQL (hot col). */
  forEmployee(employeeId: string) {
    return this.where({ employeeId }).list();
  }

  /** Whether the employee already has an open separation; isActive is evaluated over the small per-employee set. */
  async hasActive(employeeId: string) {
    return (await this.forEmployee(employeeId)).some(isActive);
  }
}
