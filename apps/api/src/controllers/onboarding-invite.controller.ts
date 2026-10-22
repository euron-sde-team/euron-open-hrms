/** HTTP adapter for onboarding invites: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as invites from "../services/onboarding-invite.service";

export const list = async (req, res) => {
  res.json(await invites.listInvites(contextFrom(req)));
};

export const create = async (req, res) => {
  res.status(201).json(await invites.createInvites(contextFrom(req), req.body || {}));
};

export const update = async (req, res) => {
  res.json(await invites.updateInvite(contextFrom(req), req.params.id, req.body || {}));
};

export const resend = async (req, res) => {
  res.json(await invites.resendInvite(contextFrom(req), req.params.id));
};

export const remove = async (req, res) => {
  res.json(await invites.deleteInvite(contextFrom(req), req.params.id));
};
