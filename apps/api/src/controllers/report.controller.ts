/** HTTP adapter for reports: read the request, call the service, write the response (JSON or CSV). */
import { contextFrom } from "../core/context";
import { sendCsv } from "../core/csv";
import * as reports from "../services/report.service";

const csv = (res, report: reports.CsvReport) => sendCsv(res, report.filename, report.rows);

export const dashboard = async (req, res) => {
  res.json(await reports.dashboard(contextFrom(req)));
};

export const reporting = async (req, res) => {
  res.json(await reports.reportingStructure(contextFrom(req)));
};

export const weekly = async (req, res) => {
  res.json(await reports.weeklyReport(contextFrom(req), { from: req.query.from, to: req.query.to }));
};

export const sendWeekly = async (req, res) => {
  res.json(await reports.sendWeeklyReport(contextFrom(req), { to: req.query.to, extraRecipients: req.body?.extraRecipients }));
};

export const employeesCsv = async (req, res) => {
  csv(res, await reports.employeesCsv(contextFrom(req)));
};

export const payrollCsv = async (req, res) => {
  csv(res, await reports.payrollCsv(contextFrom(req), { year: req.query.year, month: req.query.month }));
};

export const attendanceCsv = async (req, res) => {
  csv(res, await reports.attendanceCsv(contextFrom(req), req.query.date));
};

export const vendorBillsCsv = async (req, res) => {
  csv(res, await reports.vendorBillsCsv(contextFrom(req)));
};

export const reimbursementsCsv = async (req, res) => {
  csv(res, await reports.reimbursementsCsv(contextFrom(req)));
};
