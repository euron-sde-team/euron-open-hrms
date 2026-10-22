/** HTTP adapter for the workspace's custom sending domain. */
import { contextFrom } from "../core/context";
import * as sendingDomains from "../services/sending-domain.service";

export const get = async (req, res) => {
  res.json(await sendingDomains.getSendingDomain(contextFrom(req)));
};

export const add = async (req, res) => {
  const { created, domain } = await sendingDomains.addSendingDomain(contextFrom(req), req.body && req.body.domain);
  res.status(created ? 201 : 200).json(domain);
};

export const reprovision = async (req, res) => {
  res.json(await sendingDomains.reprovisionSendingDomain(contextFrom(req)));
};

export const check = async (req, res) => {
  res.json(await sendingDomains.checkSendingDomain(contextFrom(req)));
};

export const setSender = async (req, res) => {
  res.json(await sendingDomains.setSender(contextFrom(req), req.body || {}));
};

export const sendTest = async (req, res) => {
  res.json(await sendingDomains.sendTestEmail(contextFrom(req)));
};

export const remove = async (req, res) => {
  res.json(await sendingDomains.removeSendingDomain(contextFrom(req)));
};
