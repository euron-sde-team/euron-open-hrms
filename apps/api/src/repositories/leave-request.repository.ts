import { Repository, type Row } from "./repository";

/** The fields every leave request carries (the rest stay loosely typed). */
export type LeaveRequestRow = Row & {
  employeeId: string;
  leaveTypeId: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD, inclusive
  days: number;
  status: string;
};

/** Data access for `leave_requests`. */
export class LeaveRequestRepository extends Repository<LeaveRequestRow> {
  /** One employee's requests in any of `statuses` (both pushed into SQL). */
  forEmployee(employeeId: string, statuses: string[]) {
    return this.where({ employeeId, status: statuses }).list();
  }

  /** True when any request references the leave type (it then cannot be deleted). */
  async anyOfType(leaveTypeId: string) {
    return !!(await this.findOne((r) => r.leaveTypeId === leaveTypeId));
  }
}
