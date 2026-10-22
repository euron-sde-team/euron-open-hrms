import { Repository } from "./repository";

/** Data access for `payslips`. employeeId, month and year are hot (indexed) columns. */
export class PayslipRepository extends Repository {
  /** One employee's payslip for a period (month is 0-based), if any. */
  forPeriod(employeeId: string, month: number, year: number) {
    return this.where({ employeeId, month, year }).one();
  }

  /** Every payslip for a period across the workspace (month is 0-based). */
  inPeriod(month: number, year: number) {
    return this.where({ month, year }).list();
  }
}
