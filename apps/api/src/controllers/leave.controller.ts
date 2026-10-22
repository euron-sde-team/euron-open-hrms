/** HTTP adapter for leave: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as leave from "../services/leave.service";

export const listTypes = async (req, res) => {
  res.json(await leave.listLeaveTypes(contextFrom(req)));
};

export const catalogue = async (_req, res) => {
  res.json(leave.leaveCatalogue());
};

export const entitlements = async (req, res) => {
  res.json(await leave.employeeEntitlements(contextFrom(req), { employeeId: req.query.employeeId, year: req.query.year }));
};

export const seedStandardTypes = async (req, res) => {
  res.status(201).json(await leave.seedStandardLeaveTypes(contextFrom(req)));
};

export const createType = async (req, res) => {
  res.status(201).json(await leave.createLeaveType(contextFrom(req), req.body || {}));
};

export const updateType = async (req, res) => {
  res.json(await leave.updateLeaveType(contextFrom(req), req.params.id, req.body || {}));
};

export const removeType = async (req, res) => {
  res.json(await leave.deleteLeaveType(contextFrom(req), req.params.id));
};

export const coverage = async (req, res) => {
  res.json(await leave.coverageConfig(contextFrom(req)));
};

export const setCoverage = async (req, res) => {
  res.json(await leave.setCoverageConfig(contextFrom(req), req.body || {}));
};

export const checkCoverage = async (req, res) => {
  res.json(await leave.previewCoverage(contextFrom(req), { employeeId: req.query.employeeId, from: req.query.from, to: req.query.to }));
};

export const rules = async (req, res) => {
  res.json(await leave.getLeaveRules(contextFrom(req)));
};

export const setRules = async (req, res) => {
  res.json(await leave.setLeaveRules(contextFrom(req), req.body || {}));
};

export const checkRules = async (req, res) => {
  res.json(await leave.checkLeaveRules(contextFrom(req), {
    employeeId: req.query.employeeId, leaveTypeId: req.query.leaveTypeId, from: req.query.from, to: req.query.to,
  }));
};

export const allowance = async (req, res) => {
  res.json(await leave.monthlyLeaveAllowance(contextFrom(req), { employeeId: req.query.employeeId, month: req.query.month }));
};

export const balance = async (req, res) => {
  res.json(await leave.leaveBalances(contextFrom(req), req.query.employeeId));
};

export const listRequests = async (req, res) => {
  res.json(await leave.listLeaveRequests(contextFrom(req), { scope: req.query.scope, employeeId: req.query.employeeId, status: req.query.status }));
};

export const bulkDecide = async (req, res) => {
  res.json(await leave.bulkDecide(contextFrom(req), req.body || {}));
};

export const exportCsv = async (req, res) => {
  const csv = await leave.exportLeaveRequestsCsv(contextFrom(req), req.query.status);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="leave-requests.csv"');
  res.send(csv);
};

export const apply = async (req, res) => {
  res.status(201).json(await leave.applyForLeave(contextFrom(req), req.body || {}));
};

export const decide = async (req, res) => {
  res.json(await leave.decideLeave(contextFrom(req), req.params.id, req.body || {}));
};

export const cancel = async (req, res) => {
  res.json(await leave.cancelApprovedLeave(contextFrom(req), req.params.id));
};

export const withdraw = async (req, res) => {
  res.json(await leave.withdrawLeaveRequest(contextFrom(req), req.params.id));
};
