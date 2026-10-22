/** HTTP adapter for onboarding campaigns: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import { sendCsv } from "../core/csv";
import * as campaigns from "../services/onboarding-campaign.service";

export const list = async (req, res) => {
  res.json(await campaigns.listCampaigns(contextFrom(req)));
};

export const preview = async (req, res) => {
  res.json(await campaigns.previewCampaign(contextFrom(req), req.body?.audience));
};

export const getReminderSettings = async (req, res) => {
  res.json(await campaigns.getReminderSettings(contextFrom(req)));
};

export const updateReminderSettings = async (req, res) => {
  res.json(await campaigns.updateReminderSettings(contextFrom(req), req.body || {}));
};

export const get = async (req, res) => {
  res.json(await campaigns.getCampaign(contextFrom(req), req.params.id));
};

export const create = async (req, res) => {
  res.status(201).json(await campaigns.createCampaign(contextFrom(req), req.body || {}));
};

export const update = async (req, res) => {
  res.json(await campaigns.updateCampaign(contextFrom(req), req.params.id, req.body || {}));
};

export const launch = async (req, res) => {
  res.json(await campaigns.launchCampaign(contextFrom(req), req.params.id));
};

export const cases = async (req, res) => {
  res.json(await campaigns.campaignCases(contextFrom(req), req.params.id));
};

export const casesCsv = async (req, res) => {
  const { filename, rows } = await campaigns.exportCampaignCases(contextFrom(req), req.params.id);
  sendCsv(res, filename, rows);
};

export const close = async (req, res) => {
  res.json(await campaigns.closeCampaign(contextFrom(req), req.params.id));
};

export const cancel = async (req, res) => {
  res.json(await campaigns.cancelCampaign(contextFrom(req), req.params.id));
};

export const runReminders = async (req, res) => {
  res.json(await campaigns.runReminders(contextFrom(req)));
};
