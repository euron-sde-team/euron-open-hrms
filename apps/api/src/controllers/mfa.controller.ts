/** HTTP adapter for two-factor management: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as mfa from "../services/mfa.service";

export const status = async (req, res) => {
  res.json(mfa.mfaStatus(contextFrom(req)));
};

export const enroll = async (req, res) => {
  res.json(await mfa.startEnrollment(contextFrom(req)));
};

export const verifyEnrollment = async (req, res) => {
  res.json(await mfa.confirmEnrollment(contextFrom(req), req.body && req.body.code));
};

export const disable = async (req, res) => {
  res.json(await mfa.disableMfa(contextFrom(req), req.body || {}));
};
