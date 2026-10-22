/** HTTP adapter for the workspace profile, branding images, offices and export. */
import { contextFrom } from "../core/context";
import * as organizations from "../services/organization.service";

export const get = async (req, res) => {
  res.json(await organizations.getOrganization(contextFrom(req)));
};

export const update = async (req, res) => {
  res.json(await organizations.updateOrganization(contextFrom(req), req.body || {}));
};

export const uploadLogo = async (req, res) => {
  res.json(await organizations.uploadLogo(contextFrom(req), req.file));
};

export const getLogo = async (req, res) => {
  const image = await organizations.getLogo(contextFrom(req));
  // nosniff stops MIME-sniffing into script, and the CSP means even a sanitiser miss on
  // an SVG cannot run script or phone home: 'none' blocks every fetch (inline script
  // included) and sandbox drops it to an opaque origin.
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader("Content-Disposition", "inline; filename=\"logo\"");
  res.send(image.body);
};

export const deleteLogo = async (req, res) => {
  res.json(await organizations.deleteLogo(contextFrom(req)));
};

export const uploadSignature = async (req, res) => {
  res.json(await organizations.uploadSignature(contextFrom(req), req.file));
};

export const getSignature = async (req, res) => {
  const image = await organizations.getSignature(contextFrom(req));
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Content-Disposition", 'inline; filename="signature.png"');
  res.send(image.body);
};

export const deleteSignature = async (req, res) => {
  res.json(await organizations.deleteSignature(contextFrom(req)));
};

export const exportData = async (req, res) => {
  const { filename, json } = await organizations.exportOrganization(contextFrom(req));
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(json);
};

export const listOffices = async (req, res) => {
  res.json(await organizations.listOffices(contextFrom(req)));
};

export const createOffice = async (req, res) => {
  res.status(201).json(await organizations.createOffice(contextFrom(req), req.body || {}));
};

export const updateOffice = async (req, res) => {
  res.json(await organizations.updateOffice(contextFrom(req), req.params.id, req.body || {}));
};

export const deleteOffice = async (req, res) => {
  res.json(await organizations.deleteOffice(contextFrom(req), req.params.id));
};
