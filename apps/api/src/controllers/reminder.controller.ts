/** HTTP adapter for reminders: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as reminders from "../services/reminder.service";

export const list = async (req, res) => {
  res.json(await reminders.listReminders(contextFrom(req), req.query.status));
};

export const count = async (req, res) => {
  res.json(await reminders.reminderCounts(contextFrom(req)));
};

export const today = async (req, res) => {
  res.json(await reminders.dueToday(contextFrom(req)));
};

export const create = async (req, res) => {
  res.status(201).json(await reminders.createReminder(contextFrom(req), req.body || {}));
};

export const update = async (req, res) => {
  res.json(await reminders.updateReminder(contextFrom(req), req.params.id, req.body || {}));
};

export const toggle = async (req, res) => {
  res.json(await reminders.toggleReminder(contextFrom(req), req.params.id));
};

export const remove = async (req, res) => {
  res.json(await reminders.deleteReminder(contextFrom(req), req.params.id));
};
