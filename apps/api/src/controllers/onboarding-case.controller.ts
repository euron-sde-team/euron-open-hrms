/** HTTP adapter for onboarding cases: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import { sendCsv } from "../core/csv";
import * as cases from "../services/onboarding-case.service";

/** Recorded against acknowledgements and signatures, alongside the IP. */
const userAgent = (req) => String(req.headers["user-agent"] || "");

const filters = (req) => ({
  status: req.query.status,
  campaignId: req.query.campaignId,
  overdue: req.query.overdue,
  departmentId: req.query.departmentId,
});

/* ── Employee self-service ── */

export const getMine = async (req, res) => {
  res.json(await cases.getMyCase(contextFrom(req)));
};

export const saveMySection = async (req, res) => {
  res.json(await cases.saveMySection(contextFrom(req), req.params.key, req.body || {}, userAgent(req)));
};

export const acknowledgeMine = async (req, res) => {
  res.json(await cases.acknowledgeMyPolicies(contextFrom(req), req.body?.policyIds, userAgent(req)));
};

export const declareMine = async (req, res) => {
  res.json(await cases.signMyDeclaration(contextFrom(req), req.body?.fullName, userAgent(req)));
};

export const myAssets = async (req, res) => {
  res.json(await cases.listMyAssets(contextFrom(req)));
};

export const acknowledgeMyAsset = async (req, res) => {
  res.json(await cases.acknowledgeMyAsset(contextFrom(req), req.params.assetId, req.body || {}, userAgent(req)));
};

export const declareMyAsset = async (req, res) => {
  res.status(201).json(await cases.declareMyAsset(contextFrom(req), req.body || {}));
};

export const removeMyDeclaredAsset = async (req, res) => {
  res.json(await cases.removeMyDeclaredAsset(contextFrom(req), req.params.entryId));
};

export const attachMyDocument = async (req, res) => {
  res.status(201).json(await cases.attachMyDocument(contextFrom(req), req.file, req.body?.category, req.body?.sectionKey, userAgent(req)));
};

export const submitMine = async (req, res) => {
  res.json(await cases.submitMyCase(contextFrom(req)));
};

/* ── HR review ── */

export const list = async (req, res) => {
  res.json(await cases.listCases(contextFrom(req), filters(req)));
};

export const exportCsv = async (req, res) => {
  sendCsv(res, "onboarding-cases.csv", await cases.exportCases(contextFrom(req), filters(req)));
};

export const get = async (req, res) => {
  res.json(await cases.getCase(contextFrom(req), req.params.id));
};

export const reviewSection = async (req, res) => {
  res.json(await cases.reviewCaseSection(contextFrom(req), req.params.id, req.params.key, req.body || {}));
};

export const approve = async (req, res) => {
  res.json(await cases.approveCase(contextFrom(req), req.params.id));
};

export const cancel = async (req, res) => {
  res.json(await cases.cancelCase(contextFrom(req), req.params.id, req.body?.reason));
};

export const open = async (req, res) => {
  const { created, body } = await cases.openCase(contextFrom(req), req.body || {});
  if (!created) return res.json(body);
  res.status(201).json(body);
};
