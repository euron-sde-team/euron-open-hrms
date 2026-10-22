/** HTTP adapter for roles & permissions: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as roles from "../services/role.service";

export const catalog = async (_req, res) => {
  res.json(roles.permissionCatalog());
};

export const list = async (req, res) => {
  res.json(await roles.listRoles(contextFrom(req)));
};

export const create = async (req, res) => {
  res.status(201).json(await roles.createRole(contextFrom(req), req.body || {}));
};

export const update = async (req, res) => {
  res.json(await roles.updateRole(contextFrom(req), req.params.key, req.body || {}));
};

export const remove = async (req, res) => {
  res.json(await roles.deleteRole(contextFrom(req), req.params.key));
};
