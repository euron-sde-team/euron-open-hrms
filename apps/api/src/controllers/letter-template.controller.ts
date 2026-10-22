/** HTTP adapter for letter templates: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as letterTemplates from "../services/letter-template.service";

export const list = async (req, res) => {
  res.json(await letterTemplates.listLetterTemplates(contextFrom(req)));
};

export const tokens = async (_req, res) => res.json(letterTemplates.letterTokens());

export const get = async (req, res) => {
  res.json(await letterTemplates.getLetterTemplate(contextFrom(req), req.params.kind));
};

export const save = async (req, res) => {
  res.json(await letterTemplates.saveLetterTemplate(contextFrom(req), req.params.kind, req.body || {}));
};

export const reset = async (req, res) => {
  res.json(await letterTemplates.resetLetterTemplate(contextFrom(req), req.params.kind));
};

export const preview = async (req, res) => {
  const { buffer, filename } = await letterTemplates.previewLetterTemplate(contextFrom(req), req.params.kind, req.body || {});
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.send(buffer);
};
