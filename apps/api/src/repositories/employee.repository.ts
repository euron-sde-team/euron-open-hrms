import { isManagerOf } from "../domain/manager";
import { Repository } from "./repository";

/** Data access for `employees`. */
export class EmployeeRepository extends Repository {
  /** Everyone who has not exited. */
  active() {
    return this.find((e) => e.status !== "EXITED");
  }

  /** Active headcount of one department. */
  countActiveInDepartment(departmentId: string) {
    return this.count((e) => e.departmentId === departmentId && e.status !== "EXITED");
  }

  /** Active direct reports of one manager (either reporting column counts). */
  activeReportsOf(managerEmployeeId: string) {
    return this.find((e) => e.status !== "EXITED" && isManagerOf(e, managerEmployeeId));
  }

  /**
   * The record whose primary address is `email`, compared case-insensitively. Exited
   * records included: a soft-deleted person still owns their address.
   */
  findByEmail(email: string) {
    const wanted = String(email).toLowerCase();
    return this.findOne((e) => String(e.email || "").toLowerCase() === wanted);
  }

  /** Employee codes already in use, for generating the next ones. */
  async codes(): Promise<string[]> {
    return (await this.all()).map((e) => e.code).filter(Boolean);
  }
}
