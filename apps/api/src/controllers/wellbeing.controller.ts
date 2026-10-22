/** HTTP adapter for well-being: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as wellbeing from "../services/wellbeing.service";

export const resources = async (req, res) => {
  res.json(await wellbeing.listResources(contextFrom(req)));
};

export const setSupport = async (req, res) => {
  res.json(await wellbeing.setSupport(contextFrom(req), req.body || {}));
};

export const me = async (req, res) => {
  res.json(await wellbeing.myCheckins(contextFrom(req)));
};

export const checkin = async (req, res) => {
  res.status(201).json(await wellbeing.checkIn(contextFrom(req), req.body || {}));
};

export const pulse = async (req, res) => {
  res.json(await wellbeing.pulse(contextFrom(req), req.query.from));
};
