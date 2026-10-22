import { Repository } from "./repository";

/** Data access for `leave_balances`: one row per employee, leave type and calendar year. */
export class LeaveBalanceRepository extends Repository {
  /** The employee's balance of one leave type for one year, or null if none exists yet. */
  forYear(employeeId: string, leaveTypeId: string, year: number) {
    return this.findOne((b) => b.employeeId === employeeId && b.leaveTypeId === leaveTypeId && b.year === year);
  }
}
