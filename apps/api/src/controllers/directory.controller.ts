/** HTTP adapter for the company directory: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as directory from "../services/directory.service";

export const list = async (req, res) => {
  res.json(await directory.listDirectory(contextFrom(req)));
};

export const orgChart = async (req, res) => {
  res.json(await directory.orgChart(contextFrom(req)));
};

export const company = async (req, res) => {
  res.json(await directory.companyInfo(contextFrom(req)));
};
