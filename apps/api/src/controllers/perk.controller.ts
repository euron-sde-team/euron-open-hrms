/** HTTP adapter for perks and family benefits: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as perks from "../services/perk.service";

export const list = async (req, res) => {
  res.json(await perks.listPerks(contextFrom(req), { type: req.query.type, employeeId: req.query.employeeId }));
};

export const distribute = async (req, res) => {
  res.status(201).json(await perks.distributePerk(contextFrom(req), req.body || {}));
};

export const claim = async (req, res) => {
  res.json(await perks.claimPerk(contextFrom(req), req.params.id));
};

export const listFamily = async (req, res) => {
  res.json(await perks.listFamilyBenefits(contextFrom(req)));
};

export const enrolFamily = async (req, res) => {
  res.status(201).json(await perks.enrolFamilyBenefit(contextFrom(req), req.body || {}));
};
