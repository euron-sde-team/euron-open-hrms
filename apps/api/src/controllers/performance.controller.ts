/** HTTP adapter for performance (PIPs, appraisal cycles, appraisals): read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as performance from "../services/performance.service";

export const listPips = async (req, res) => {
  res.json(await performance.listPips(contextFrom(req), req.query.scope));
};

export const createPip = async (req, res) => {
  res.status(201).json(await performance.createPip(contextFrom(req), req.body || {}));
};

export const pipCheckin = async (req, res) => {
  res.json(await performance.addPipCheckin(contextFrom(req), req.params.id, req.body || {}));
};

export const updatePip = async (req, res) => {
  res.json(await performance.updatePip(contextFrom(req), req.params.id, req.body || {}));
};

export const listCycles = async (req, res) => {
  res.json(await performance.listCycles(contextFrom(req)));
};

export const openCycle = async (req, res) => {
  res.status(201).json(await performance.openCycle(contextFrom(req), req.body || {}));
};

export const closeCycle = async (req, res) => {
  res.json(await performance.closeCycle(contextFrom(req), req.params.id));
};

export const listAppraisals = async (req, res) => {
  res.json(await performance.listAppraisals(contextFrom(req), { cycleId: req.query.cycleId, scope: req.query.scope }));
};

export const selfReview = async (req, res) => {
  res.json(await performance.submitSelfReview(contextFrom(req), req.params.id, req.body || {}));
};

export const managerReview = async (req, res) => {
  res.json(await performance.submitManagerReview(contextFrom(req), req.params.id, req.body || {}));
};
