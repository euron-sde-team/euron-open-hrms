/** HTTP adapter for assets: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as assets from "../services/asset.service";

export const list = async (req, res) => {
  res.json(await assets.listAssets(contextFrom(req), { employeeId: req.query.employeeId, caseId: req.query.caseId, status: req.query.status }));
};

export const provision = async (req, res) => {
  res.status(201).json(await assets.provisionAsset(contextFrom(req), req.body || {}));
};

export const acknowledge = async (req, res) => {
  res.json(await assets.acknowledgeAsset(contextFrom(req), req.params.id));
};

export const submit = async (req, res) => {
  res.json(await assets.submitAsset(contextFrom(req), req.params.id, req.body || {}));
};

export const accept = async (req, res) => {
  res.json(await assets.returnAsset(contextFrom(req), req.params.id, req.body || {}));
};

export const update = async (req, res) => {
  res.json(await assets.updateAsset(contextFrom(req), req.params.id, req.body || {}));
};
