/** HTTP adapter for AI token allowances: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as aiTokens from "../services/ai-token.service";

export const list = async (req, res) => {
  res.json(await aiTokens.listAllowances(contextFrom(req)));
};

export const grant = async (req, res) => {
  res.json(await aiTokens.grantAllowance(contextFrom(req), req.body || {}));
};

export const request = async (req, res) => {
  res.json(await aiTokens.requestTopUp(contextFrom(req), req.body || {}));
};

export const decide = async (req, res) => {
  res.json(await aiTokens.decideTopUp(contextFrom(req), req.params.id, req.body || {}));
};
