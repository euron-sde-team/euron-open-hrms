import { Repository } from "./repository";

/** Data access for `attendance`. employeeId and date are hot (indexed) columns. */
export class AttendanceRepository extends Repository {
  /** One employee's record for one day, if any (indexed on employeeId+date). */
  forEmployeeOn(employeeId: string, date: string) {
    return this.where({ employeeId, date }).one();
  }

  /** Every record of one employee (employeeId pushed into SQL). */
  forEmployee(employeeId: string) {
    return this.where({ employeeId }).list();
  }

  /** Everyone's records for one day (date pushed into SQL). */
  onDate(date: string) {
    return this.where({ date }).list();
  }

  /** Records whose date falls in [from, to], inclusive. */
  between(from: string, to: string) {
    return this.find((a) => a.date >= from && a.date <= to);
  }
}
