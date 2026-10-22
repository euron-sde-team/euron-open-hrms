/** HTTP adapter for the document library: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as storage from "../integrations/storage";
import * as documents from "../services/document.service";

export const meta = async (_req, res) => {
  res.json(documents.documentMeta());
};

export const list = async (req, res) => {
  const { q, category, departmentId, employeeId, tag, visibility, verified } = req.query;
  res.json(await documents.listDocuments(contextFrom(req), { q, category, departmentId, employeeId, tag, visibility, verified }));
};

export const kycStatus = async (req, res) => {
  res.json(await documents.kycStatus(contextFrom(req), req.query.employeeId));
};

export const upload = async (req, res) => {
  res.status(201).json(await documents.uploadDocument(contextFrom(req), req.file, req.body || {}));
};

export const extractionConfig = async (_req, res) => {
  res.json(documents.extractionConfig());
};

export const update = async (req, res) => {
  res.json(await documents.updateDocument(contextFrom(req), req.params.id, req.body || {}));
};

export const download = async (req, res) => {
  const file = await documents.documentForDownload(contextFrom(req), req.params.id);
  await storage.sendDownload(res, file.prefix, file.filename, file.downloadName, file.contentType);
};

export const remove = async (req, res) => {
  res.json(await documents.deleteDocument(contextFrom(req), req.params.id));
};

export const verify = async (req, res) => {
  res.json(await documents.verifyDocument(contextFrom(req), req.params.id, req.body || {}));
};
