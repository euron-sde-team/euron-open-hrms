/** HTTP adapter for separations: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as separation from "../services/separation.service";

export const list = async (req, res) => {
  res.json(await separation.listSeparations(contextFrom(req), req.query.status));
};

export const config = async (req, res) => {
  res.json(await separation.separationConfig(contextFrom(req)));
};

export const analytics = async (req, res) => {
  res.json(await separation.attritionAnalytics(contextFrom(req)));
};

export const initiate = async (req, res) => {
  res.status(201).json(await separation.initiateSeparation(contextFrom(req), req.body || {}));
};

export const resign = async (req, res) => {
  res.status(201).json(await separation.resign(contextFrom(req), req.body || {}));
};

export const managerApprove = async (req, res) => {
  res.json(await separation.managerApprove(contextFrom(req), req.params.id, req.body || {}));
};

export const managerDecline = async (req, res) => {
  res.json(await separation.managerDecline(contextFrom(req), req.params.id, req.body || {}));
};

export const accept = async (req, res) => {
  res.json(await separation.acceptResignation(contextFrom(req), req.params.id, req.body || {}));
};

export const decline = async (req, res) => {
  res.json(await separation.declineResignation(contextFrom(req), req.params.id, req.body || {}));
};

export const withdraw = async (req, res) => {
  res.json(await separation.withdrawResignation(contextFrom(req), req.params.id));
};

export const abscondingLetter = async (req, res) => {
  res.json(await separation.issueAbscondingLetter(contextFrom(req), req.params.id, req.body || {}));
};

export const confirmAbsconded = async (req, res) => {
  res.json(await separation.confirmAbsconded(contextFrom(req), req.params.id));
};

export const exitInterview = async (req, res) => {
  res.json(await separation.submitExitInterview(contextFrom(req), req.params.id, req.body || {}));
};

export const settlement = async (req, res) => {
  res.json(await separation.settlementEstimate(contextFrom(req), req.params.id, req.query.recoveries));
};

export const settlementStatement = async (req, res) => {
  res.json(await separation.issueSettlementStatement(contextFrom(req), req.params.id, req.body || {}));
};

export const update = async (req, res) => {
  res.json(await separation.updateSeparation(contextFrom(req), req.params.id, req.body || {}));
};

export const issueLetter = async (req, res) => {
  res.status(201).json(await separation.issueLetter(contextFrom(req), req.params.id, req.body || {}));
};

export const complete = async (req, res) => {
  res.json(await separation.completeSeparation(contextFrom(req), req.params.id, req.body || {}));
};
