/** HTTP adapter for the audit log viewer: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as audit from "../services/audit.service";

export const actions = async (req, res) => {
  res.json(await audit.listActions(contextFrom(req)));
};

export const list = async (req, res) => {
  const { page, pageSize, action, q } = req.query;
  res.json(await audit.listAudit(contextFrom(req), { page, pageSize, action, q }));
};
