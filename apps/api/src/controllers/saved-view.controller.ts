/** HTTP adapter for saved views: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as views from "../services/saved-view.service";

export const list = async (req, res) => {
  res.json(await views.listViews(contextFrom(req), req.query.resource));
};

export const create = async (req, res) => {
  res.status(201).json(await views.createView(contextFrom(req), req.body || {}));
};

export const remove = async (req, res) => {
  res.json(await views.deleteView(contextFrom(req), req.params.id));
};
