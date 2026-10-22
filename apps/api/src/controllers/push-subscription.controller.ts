/** HTTP adapter for web push and clock-in reminders: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as push from "../services/push-subscription.service";

export const config = async (_req, res) => {
  res.json(push.pushConfig());
};

export const subscribe = async (req, res) => {
  const out = await push.subscribe(contextFrom(req), req.body || {}, req.headers["user-agent"]);
  res.status(out.created ? 201 : 200).json(out.body);
};

export const unsubscribe = async (req, res) => {
  res.json(await push.unsubscribe(contextFrom(req), (req.body || {}).endpoint));
};

export const getReminders = async (req, res) => {
  res.json(await push.getReminderSettings(contextFrom(req)));
};

export const updateReminders = async (req, res) => {
  res.json(await push.updateReminderSettings(contextFrom(req), req.body || {}));
};

export const previewReminders = async (req, res) => {
  res.json(await push.previewReminders(contextFrom(req)));
};

export const sendRemindersNow = async (req, res) => {
  res.json(await push.sendRemindersNow(contextFrom(req)));
};
