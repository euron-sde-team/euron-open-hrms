/** HTTP adapter for the in-app notification feed: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as feed from "../services/notification-feed.service";

export const list = async (req, res) => {
  res.json(await feed.listFeed(contextFrom(req), { unread: req.query.unread, limit: req.query.limit }));
};

export const count = async (req, res) => {
  res.json(await feed.unreadCount(contextFrom(req)));
};

export const markRead = async (req, res) => {
  res.json(await feed.markRead(contextFrom(req), req.params.id));
};

export const markAllRead = async (req, res) => {
  res.json(await feed.markAllRead(contextFrom(req)));
};
