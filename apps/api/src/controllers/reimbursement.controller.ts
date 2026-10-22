/** HTTP adapter for reimbursement claims: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import storage from "../integrations/storage";
import * as claims from "../services/reimbursement.service";

export const list = async (req, res) => {
  res.json(await claims.listClaims(contextFrom(req), { scope: req.query.scope, employeeId: req.query.employeeId, status: req.query.status }));
};

export const submit = async (req, res) => {
  res.status(201).json(await claims.submitClaim(contextFrom(req), req.body || {}, req.file || null));
};

export const decide = async (req, res) => {
  res.json(await claims.decideClaim(contextFrom(req), req.params.id, req.body || {}));
};

export const receipt = async (req, res) => {
  const f = await claims.claimReceipt(contextFrom(req), req.params.id);
  await storage.sendDownload(res, f.prefix, f.filename, f.downloadName, f.contentType);
};

export const cancel = async (req, res) => {
  res.json(await claims.cancelClaim(contextFrom(req), req.params.id));
};
