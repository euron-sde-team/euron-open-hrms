/** HTTP adapter for work logs: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as worklogs from "../services/worklog.service";

const filterOf = (q) => ({ scope: q.scope, employeeId: q.employeeId, from: q.from, to: q.to });

export const list = async (req, res) => {
  res.json(await worklogs.listWorkLogs(contextFrom(req), filterOf(req.query)));
};

export const create = async (req, res) => {
  res.status(201).json(await worklogs.logWork(contextFrom(req), req.body || {}));
};

export const remove = async (req, res) => {
  res.json(await worklogs.deleteWorkLog(contextFrom(req), req.params.id));
};

export const summary = async (req, res) => {
  res.json(await worklogs.workLogSummary(contextFrom(req), filterOf(req.query)));
};
