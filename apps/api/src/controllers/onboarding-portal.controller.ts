/**
 * HTTP adapter for the public, token-authenticated candidate portal. There is no session, so
 * there is no contextFrom(req): the service resolves the workspace from the link token.
 */
import * as portal from "../services/onboarding-portal.service";

const candidate = (req): portal.CandidateRequest => ({
  ip: req.ip,
  userAgent: String(req.headers["user-agent"] || ""),
});

export const get = async (req, res) => {
  res.json(await portal.getPortal(req.params.token));
};

export const policies = async (req, res) => {
  res.json(await portal.portalPolicies(req.params.token));
};

export const saveSection = async (req, res) => {
  res.json(await portal.saveSection(req.params.token, req.params.key, req.body || {}, candidate(req)));
};

export const acknowledge = async (req, res) => {
  res.json(await portal.acknowledgePolicies(req.params.token, req.body?.policyIds, candidate(req)));
};

export const declare = async (req, res) => {
  res.json(await portal.signDeclaration(req.params.token, req.body?.fullName, candidate(req)));
};

export const assets = async (req, res) => {
  res.json(await portal.listAssets(req.params.token));
};

export const acknowledgeAsset = async (req, res) => {
  res.json(await portal.acknowledgeAsset(req.params.token, req.params.assetId, req.body || {}, candidate(req)));
};

export const declareAsset = async (req, res) => {
  res.status(201).json(await portal.declareAsset(req.params.token, req.body || {}));
};

export const removeDeclaredAsset = async (req, res) => {
  res.json(await portal.removeDeclaredAsset(req.params.token, req.params.entryId));
};

export const attachDocument = async (req, res) => {
  res.status(201).json(await portal.attachDocument(req.params.token, req.file, req.body?.category, req.body?.sectionKey, candidate(req)));
};

export const submit = async (req, res) => {
  res.json(await portal.submit(req.params.token));
};
