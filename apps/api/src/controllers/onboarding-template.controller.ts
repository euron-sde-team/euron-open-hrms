/** HTTP adapter for onboarding form templates: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as templates from "../services/onboarding-template.service";

export const meta = async (_req, res) => {
  res.json(templates.templateMeta());
};

export const list = async (req, res) => {
  res.json(await templates.listTemplates(contextFrom(req), req.query.status));
};

export const resolve = async (req, res) => {
  res.json(await templates.resolveTemplateFor(contextFrom(req), {
    employmentType: req.query.employmentType ? String(req.query.employmentType) : null,
    departmentId: req.query.departmentId ? String(req.query.departmentId) : null,
  }));
};

export const get = async (req, res) => {
  res.json(await templates.getTemplate(contextFrom(req), req.params.id));
};

export const create = async (req, res) => {
  res.status(201).json(await templates.createTemplate(contextFrom(req), req.body || {}));
};

export const update = async (req, res) => {
  res.json(await templates.updateTemplate(contextFrom(req), req.params.id, req.body || {}));
};

export const setStatus = async (req, res) => {
  res.json(await templates.setTemplateStatus(contextFrom(req), req.params.id, req.body?.status));
};

export const makeDefault = async (req, res) => {
  res.json(await templates.makeDefaultTemplate(contextFrom(req), req.params.id));
};

export const duplicate = async (req, res) => {
  res.status(201).json(await templates.duplicateTemplate(contextFrom(req), req.params.id, req.body?.name));
};

export const remove = async (req, res) => {
  res.json(await templates.deleteTemplate(contextFrom(req), req.params.id));
};
