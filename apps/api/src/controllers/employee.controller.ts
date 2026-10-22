/** HTTP adapter for the employee roster: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as employees from "../services/employee.service";
import * as access from "../services/employee-access.service";
import * as importer from "../services/employee-import.service";

/** Send a generated file as an attachment. */
const download = (res, file: importer.Download) => {
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.send(file.body);
};

export const list = async (req, res) => {
  const { departmentId, type, q, status } = req.query;
  res.json(await employees.listEmployees(contextFrom(req), { departmentId, type, q, status }));
};

export const myTeam = async (req, res) => {
  res.json(await employees.myTeam(contextFrom(req)));
};

export const employmentTypes = async (_req, res) => {
  res.json(employees.employmentTypes());
};

export const importTemplate = async (req, res) => {
  download(res, await importer.importTemplate(contextFrom(req)));
};

export const importPreview = async (req, res) => {
  res.json(await importer.previewImport(contextFrom(req), req.file?.buffer));
};

export const importErrorReport = async (req, res) => {
  download(res, await importer.importErrorReport(contextFrom(req), req.body && req.body.rows));
};

export const importCommit = async (req, res) => {
  const out = await importer.commitImport(contextFrom(req), req.body || {});
  res.status(out.committed ? 201 : 422).json(out.report);
};

export const get = async (req, res) => {
  res.json(await employees.getEmployee(contextFrom(req), req.params.id));
};

export const create = async (req, res) => {
  const out = await employees.createEmployee(contextFrom(req), req.body || {});
  res.status("reactivated" in out ? 200 : 201).json(out);
};

export const update = async (req, res) => {
  res.json(await employees.updateEmployee(contextFrom(req), req.params.id, req.body || {}));
};

export const bulkUpdate = async (req, res) => {
  res.json(await employees.bulkUpdateEmployees(contextFrom(req), req.body?.updates));
};

export const loginEmail = async (req, res) => {
  res.json(await access.changeLoginEmail(contextFrom(req), req.params.id, req.body?.email));
};

export const portalAccess = async (req, res) => {
  const out = await access.setPortalAccess(contextFrom(req), req.params.id, req.body?.role);
  res.status(out.created ? 201 : 200).json(out.body);
};

export const resendInvite = async (req, res) => {
  res.json(await access.resendCredentials(contextFrom(req), req.params.id));
};

export const deleteImpact = async (req, res) => {
  res.json(await employees.deleteImpact(contextFrom(req), req.params.id));
};

export const remove = async (req, res) => {
  res.json(await employees.deleteEmployee(contextFrom(req), req.params.id, {
    hard: req.query.hard === "1",
    confirmStaff: req.query.confirmStaff === "1",
    confirm: req.query.confirm || req.body?.confirm,
  }));
};
