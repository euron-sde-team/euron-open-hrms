/** HTTP adapter for the operator console (/api/platform). */
import * as platform from "../services/platform.service";
import type { OperatorContext } from "../services/platform.service";

/** The operator acting on this request (set by platformAuthRequired). */
const operator = (req): OperatorContext => ({ admin: req.admin, ip: req.ip, requestId: req.id ? String(req.id) : undefined });
const reasonOf = (req) => req.body && req.body.reason;

export const login = async (req, res) => {
  res.json(await platform.login(req.body || {}));
};

export const loginMfa = async (req, res) => {
  res.json(await platform.loginMfa(req.body || {}));
};

export const me = async (req, res) => {
  res.json(platform.me(operator(req)));
};

export const enrollMfa = async (req, res) => {
  res.json(await platform.enrollMfa(operator(req)));
};

export const verifyMfaEnrollment = async (req, res) => {
  res.json(await platform.verifyMfaEnrollment(operator(req), req.body && req.body.code));
};

export const disableMfa = async (req, res) => {
  res.json(await platform.disableMfa(operator(req), req.body || {}));
};

export const mfaStatus = async (req, res) => {
  res.json(await platform.mfaStatus(operator(req)));
};

export const listTenants = async (req, res) => {
  res.json(await platform.listTenants(operator(req)));
};

export const getTenant = async (req, res) => {
  res.json(await platform.getTenant(operator(req), req.params.orgId));
};

export const suspendTenant = async (req, res) => {
  res.json(await platform.suspendTenant(operator(req), req.params.orgId, reasonOf(req)));
};

export const reactivateTenant = async (req, res) => {
  res.json(await platform.reactivateTenant(operator(req), req.params.orgId, reasonOf(req)));
};

export const impersonate = async (req, res) => {
  res.json(await platform.impersonate(operator(req), req.params.orgId, reasonOf(req)));
};

export const metrics = async (req, res) => {
  res.json(await platform.fleetMetrics(operator(req)));
};

export const createTenant = async (req, res) => {
  res.status(201).json(await platform.createTenant(operator(req), req.body || {}));
};

export const planStarterContent = async (req, res) => {
  res.json(await platform.planTenantStarterContent(operator(req), req.params.orgId, { year: req.query.year, state: req.query.state }));
};

export const applyStarterContent = async (req, res) => {
  res.status(201).json(await platform.applyTenantStarterContent(operator(req), req.params.orgId, req.body || {}));
};

export const listTenantUsers = async (req, res) => {
  res.json(await platform.listTenantUsers(operator(req), req.params.orgId));
};

export const tenantActivity = async (req, res) => {
  res.json(await platform.tenantActivity(operator(req), req.params.orgId));
};

export const fleetActivity = async (req, res) => {
  res.json(await platform.fleetActivity(operator(req)));
};

export const exportTenant = async (req, res) => {
  const { filename, json } = await platform.exportTenant(operator(req), req.params.orgId);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(json);
};

export const resetTenantAdmin = async (req, res) => {
  res.json(await platform.resetTenantAdmin(operator(req), req.params.orgId));
};

export const deleteTenant = async (req, res) => {
  res.json(await platform.deleteTenant(operator(req), req.params.orgId, req.body || {}));
};

export const listOperators = async (req, res) => {
  res.json(await platform.listOperators(operator(req)));
};

export const createOperator = async (req, res) => {
  res.status(201).json(await platform.createOperator(operator(req), req.body || {}));
};

export const setOperatorStatus = async (req, res) => {
  res.json(await platform.setOperatorStatus(operator(req), req.params.id, req.body?.status));
};
