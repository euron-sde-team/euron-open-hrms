/** HTTP adapter for announcements: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as announcements from "../services/announcement.service";

export const list = async (req, res) => {
  res.json(await announcements.listAnnouncements(contextFrom(req)));
};

export const create = async (req, res) => {
  res.status(201).json(await announcements.createAnnouncement(contextFrom(req), req.body || {}));
};

export const update = async (req, res) => {
  res.json(await announcements.updateAnnouncement(contextFrom(req), req.params.id, req.body || {}));
};

export const remove = async (req, res) => {
  res.json(await announcements.deleteAnnouncement(contextFrom(req), req.params.id));
};
