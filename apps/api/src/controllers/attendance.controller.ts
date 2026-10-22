/** HTTP adapter for attendance: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as attendance from "../services/attendance.service";

export const checkIn = async (req, res) => {
  res.json(await attendance.checkIn(contextFrom(req), req.body || {}));
};

export const checkOut = async (req, res) => {
  res.json(await attendance.checkOut(contextFrom(req), req.body || {}));
};

export const mine = async (req, res) => {
  res.json(await attendance.myAttendance(contextFrom(req), req.query.month));
};

export const day = async (req, res) => {
  res.json(await attendance.dayRoster(contextFrom(req), { date: req.query.date, departmentId: req.query.departmentId }));
};

export const regularize = async (req, res) => {
  res.status(201).json(await attendance.regularize(contextFrom(req), req.body || {}));
};
