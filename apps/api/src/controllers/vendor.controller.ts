/** HTTP adapter for vendors and their bills: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import storage from "../integrations/storage";
import * as vendors from "../services/vendor.service";

export const list = async (req, res) => {
  res.json(await vendors.listVendors(contextFrom(req)));
};

export const create = async (req, res) => {
  res.status(201).json(await vendors.createVendor(contextFrom(req), req.body || {}));
};

export const update = async (req, res) => {
  res.json(await vendors.updateVendor(contextFrom(req), req.params.id, req.body || {}));
};

export const invite = async (req, res) => {
  res.json(await vendors.inviteVendor(contextFrom(req), req.params.id));
};

export const listBills = async (req, res) => {
  res.json(await vendors.listBills(contextFrom(req), { status: req.query.status, vendorId: req.query.vendorId }));
};

export const myBills = async (req, res) => {
  res.json(await vendors.myBills(contextFrom(req)));
};

export const me = async (req, res) => {
  res.json(await vendors.myProfile(contextFrom(req)));
};

export const raiseBill = async (req, res) => {
  res.status(201).json(await vendors.raiseBill(contextFrom(req), req.body || {}, req.file || null));
};

export const decideBill = async (req, res) => {
  res.json(await vendors.decideBill(contextFrom(req), req.params.id, req.body || {}));
};

export const invoice = async (req, res) => {
  const f = await vendors.billInvoice(contextFrom(req), req.params.id);
  await storage.sendDownload(res, f.prefix, f.filename, f.downloadName, f.contentType);
};
