/** HTTP adapter for company content (holidays, policies, benefits, starter packs). */
import { contextFrom } from "../core/context";
import * as content from "../services/content.service";

const calendarQuery = (q) => ({ year: q.year, state: q.state, includeRestricted: q.includeRestricted });

// ── Holidays ───────────────────────────────────────────────────────────────
export const listHolidays = async (req, res) => {
  res.json(await content.listHolidays(contextFrom(req), req.query.year));
};

export const holidayStates = async (_req, res) => {
  res.json(content.holidayStates());
};

export const previewHolidays = async (req, res) => {
  res.json(await content.previewHolidays(contextFrom(req), calendarQuery(req.query)));
};

export const importHolidays = async (req, res) => {
  res.status(201).json(await content.importHolidays(contextFrom(req), req.body || {}));
};

export const createHoliday = async (req, res) => {
  res.status(201).json(await content.createHoliday(contextFrom(req), req.body || {}));
};

export const updateHoliday = async (req, res) => {
  res.json(await content.updateHoliday(contextFrom(req), req.params.id, req.body || {}));
};

export const deleteHoliday = async (req, res) => {
  res.json(await content.deleteHoliday(contextFrom(req), req.params.id));
};

// ── Policies ───────────────────────────────────────────────────────────────
export const listPolicies = async (req, res) => {
  res.json(await content.listPolicies(contextFrom(req)));
};

export const getPolicy = async (req, res) => {
  res.json(await content.getPolicy(contextFrom(req), req.params.id));
};

export const createPolicy = async (req, res) => {
  res.status(201).json(await content.createPolicy(contextFrom(req), req.body || {}));
};

export const updatePolicy = async (req, res) => {
  res.json(await content.updatePolicy(contextFrom(req), req.params.id, req.body || {}));
};

export const deletePolicy = async (req, res) => {
  res.json(await content.deletePolicy(contextFrom(req), req.params.id));
};

// ── Benefits ───────────────────────────────────────────────────────────────
export const listBenefits = async (req, res) => {
  res.json(await content.listBenefits(contextFrom(req)));
};

export const createBenefit = async (req, res) => {
  res.status(201).json(await content.createBenefit(contextFrom(req), req.body || {}));
};

export const updateBenefit = async (req, res) => {
  res.json(await content.updateBenefit(contextFrom(req), req.params.id, req.body || {}));
};

export const deleteBenefit = async (req, res) => {
  res.json(await content.deleteBenefit(contextFrom(req), req.params.id));
};

// ── Starter content ────────────────────────────────────────────────────────
export const starterCatalogue = async (req, res) => {
  res.json(await content.starterCatalogue(contextFrom(req), calendarQuery(req.query)));
};

export const applyStarter = async (req, res) => {
  res.status(201).json(await content.applyStarter(contextFrom(req), req.body || {}));
};
