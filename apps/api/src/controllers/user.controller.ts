/** HTTP adapter for workspace user management: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as users from "../services/user.service";

export const list = async (req, res) => {
  res.json(await users.listUsers(contextFrom(req)));
};

export const createEmployee = async (req, res) => {
  const out = await users.createEmployeeForUser(contextFrom(req), req.params.id, req.body || {});
  res.status(out.created ? 201 : 200).json(out);
};

export const invite = async (req, res) => {
  res.status(201).json(await users.inviteUser(contextFrom(req), req.body || {}));
};

export const resendInvite = async (req, res) => {
  res.json(await users.resendInvite(contextFrom(req), req.params.id));
};

export const setStatus = async (req, res) => {
  res.json(await users.setUserStatus(contextFrom(req), req.params.id, req.body?.status));
};

export const setRole = async (req, res) => {
  res.json(await users.setUserRole(contextFrom(req), req.params.id, req.body && req.body.role));
};

export const setRoles = async (req, res) => {
  res.json(await users.setAdditionalRoles(contextFrom(req), req.params.id, req.body && req.body.roleKeys));
};

export const setScope = async (req, res) => {
  res.json(await users.setUserScope(contextFrom(req), req.params.id, req.body || {}));
};
