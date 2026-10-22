/** HTTP adapter for /api/salary: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as storage from "../integrations/storage";
import * as structures from "../services/salary-structure.service";
import * as settings from "../services/payroll-settings.service";
import * as payroll from "../services/payroll.service";
import * as sheets from "../services/payslip-import.service";

const runInput = (req) => ({ body: req.body || {}, query: req.query || {} });

/* ── Salary structures ────────────────────────────────────────────────────── */

export const listStructures = async (req, res) => {
  res.json(await structures.listSalaryStructures(contextFrom(req)));
};

export const saveStructures = async (req, res) => {
  res.json(await structures.saveSalaryStructures(contextFrom(req), req.body?.structures));
};

export const previewStructure = async (req, res) => {
  res.json(await structures.previewSalaryStructure(contextFrom(req), req.body || {}));
};

export const employeeSalary = async (req, res) => {
  res.json(await structures.getEmployeeSalary(contextFrom(req), req.params.employeeId));
};

export const updateEmployeeSalary = async (req, res) => {
  res.json(await structures.updateEmployeeSalary(contextFrom(req), req.params.employeeId, req.body?.salary || req.body || {}));
};

/* ── Payslips ─────────────────────────────────────────────────────────────── */

export const generatePayslip = async (req, res) => {
  res.status(201).json(await payroll.generatePayslip(contextFrom(req), req.body || {}));
};

export const payslipContext = async (req, res) => {
  res.json(await payroll.payslipContext(contextFrom(req), req.query));
};

export const previewPayslip = async (req, res) => {
  res.json(await payroll.previewPayslip(contextFrom(req), req.body || {}));
};

export const bulkPayslips = async (req, res) => {
  res.json(await sheets.bulkPayslips(contextFrom(req), req.file, runInput(req)));
};

export const commitSheet = async (req, res) => {
  const out = await sheets.commitSalarySheet(contextFrom(req), req.file, runInput(req));
  if ("rejected" in out) return res.status(422).json(out.rejected);
  res.json(out.run);
};

export const previewSheet = async (req, res) => {
  res.json(await sheets.previewSalarySheet(contextFrom(req), req.file, req.body || {}));
};

export const payRuns = async (req, res) => {
  res.json(await payroll.listPayRuns(contextFrom(req)));
};

export const listPayslips = async (req, res) => {
  res.json(await payroll.listPayslips(contextFrom(req), { employeeId: req.query.employeeId, month: req.query.month, year: req.query.year }));
};

export const emailPayslip = async (req, res) => {
  res.json(await payroll.emailPayslip(contextFrom(req), req.params.id, req.body || {}));
};

export const deletePayslip = async (req, res) => {
  res.json(await payroll.deletePayslip(contextFrom(req), req.params.id, req.body || {}));
};

/**
 * Content-Disposition is exposed to the browser. Both halves are needed: a
 * fetch/XHR download can only read that header when CORS says it may, and
 * without it the caller has nothing to name the file after but the payslip's id,
 * which is how twelve months of payslips ended up in Downloads as twelve UUIDs.
 */
export const downloadPayslip = async (req, res) => {
  const f = await payroll.payslipDownload(contextFrom(req), req.params.id);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  await storage.sendDownload(res, f.prefix, f.filename, f.downloadName);
};

export const template = async (req, res) => {
  const buf = await sheets.bulkTemplate(contextFrom(req));
  res.setHeader("Content-Disposition", "attachment; filename=payslip_bulk_template.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
};

/* ── Payroll rules ────────────────────────────────────────────────────────── */

export const countries = async (_req, res) => {
  res.json(settings.payrollCountries());
};

export const ruleset = async (req, res) => {
  res.json(settings.previewRuleset(req.params.country));
};

export const profile = async (req, res) => {
  res.json(await settings.payrollProfile(contextFrom(req)));
};

export const updateProfile = async (req, res) => {
  res.json(await settings.updatePayrollProfile(contextFrom(req), req.body || {}));
};

export const ptStates = async (req, res) => {
  res.json(await settings.professionalTaxStates(contextFrom(req)));
};

export const setPtState = async (req, res) => {
  res.json(await settings.setProfessionalTaxState(contextFrom(req), req.body?.state));
};

export const gratuity = async (req, res) => {
  res.json(await settings.gratuityFor(contextFrom(req), req.params.employeeId, { lastWorkingDay: req.query.lastWorkingDay, reason: req.query.reason }));
};
