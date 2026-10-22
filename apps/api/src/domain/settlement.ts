/**
 * Full & final settlement estimate for a separation.
 *
 * Now includes statutory gratuity, which was previously excluded and left the
 * figure materially understated for anyone with five or more years of
 * service, exactly the people whose settlement matters most. PF and TDS are
 * still out of scope here: PF is remitted to EPFO rather than settled by us,
 * and TDS depends on the leaver's full-year projection.
 */
import { round2, compEarnings } from "../core/util";
import { computeGratuity, type GratuityResult } from "./payroll/gratuity";

export async function computeSettlement(repos, sep, employee, opts: any = {}) {
  const salary = employee.salary || { basic: 0, hra: 0, allowances: 0 };
  const currency = salary.currency || "INR";
  const gross = compEarnings(salary);
  const perDay = round2(gross / 30);
  const lwd = sep.lastWorkingDay ? new Date(sep.lastWorkingDay) : new Date();

  // Pending salary: days worked in the exit month (1..day-of-month of LWD), unpaid.
  const daysWorked = lwd.getUTCDate();
  const pendingSalary = round2(perDay * daysWorked);

  // Leave encashment: remaining balance of encashable (carry-forward) paid leave types.
  const [types, balances] = await Promise.all([
    repos.leaveTypes.all(),
    repos.leaveBalances.find((b) => b.employeeId === employee.id),
  ]);
  const encashable = new Set(types.filter((t) => t.paid && Number(t.carryForwardCap || 0) > 0).map((t) => t.id));
  const year = lwd.getUTCFullYear();
  let leaveDays = 0;
  for (const b of balances) {
    if (encashable.has(b.leaveTypeId) && Number(b.year) === year) leaveDays += Math.max(0, Number(b.total || 0) - Number(b.used || 0));
  }
  const leaveEncashment = round2(perDay * leaveDays);

  // Gratuity, computed on basic + DA, not gross, per the Payment of Gratuity
  // Act. Ineligible cases return a stated reason rather than a bare zero, so
  // HR can tell "not yet five years" apart from "we forgot to compute it".
  const gratuity: GratuityResult = computeGratuity({
    basic: Number(salary.basic || 0),
    da: Number(salary.da || 0),
    joiningDate: employee.joiningDate,
    lastWorkingDay: sep.lastWorkingDay || lwd.toISOString().slice(0, 10),
    employmentType: employee.employmentType,
    reason: sep.type || sep.reason,
  });

  const recoveries = round2(Math.max(0, Number(opts.recoveries || 0)));
  const net = round2(pendingSalary + leaveEncashment + gratuity.amount - recoveries);

  const assets = await repos.assets.find((a) => a.employeeId === employee.id && a.status !== "RETURNED");
  return {
    monthlyGross: gross, perDay, daysWorked, pendingSalary,
    encashableLeaveDays: leaveDays, leaveEncashment,
    gratuity: gratuity.amount,
    gratuityDetail: gratuity,
    recoveries, net, currency,
    unreturnedAssets: assets.length, lastWorkingDay: sep.lastWorkingDay || null,
    note: "Estimate only, includes statutory gratuity; excludes PF (remitted to EPFO) and TDS (depends on the full-year projection).",
  };
}
