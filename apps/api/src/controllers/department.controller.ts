/** HTTP adapter for departments: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as departments from "../services/department.service";

export const list = async (req, res) => {
  res.json(await departments.listDepartments(contextFrom(req)));
};

export const create = async (req, res) => {
  res.status(201).json(await departments.createDepartment(contextFrom(req), req.body || {}));
};

export const update = async (req, res) => {
  res.json(await departments.updateDepartment(contextFrom(req), req.params.id, req.body || {}));
};

export const remove = async (req, res) => {
  res.json(await departments.deleteDepartment(contextFrom(req), req.params.id));
};
