/** HTTP adapter for sign-in, sessions and password recovery: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as auth from "../services/auth.service";

export const login = async (req, res) => {
  res.json(await auth.login({ email: req.body?.email, password: req.body?.password, trustToken: req.body && req.body.trustToken }));
};

export const loginMfa = async (req, res) => {
  res.json(await auth.loginWithMfa(req.body || {}));
};

export const me = async (req, res) => {
  res.json(await auth.me(contextFrom(req)));
};

export const tourComplete = async (req, res) => {
  res.json(await auth.completeTour(contextFrom(req)));
};

export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  res.json(await auth.changePassword(contextFrom(req), currentPassword, newPassword));
};

export const logoutAll = async (req, res) => {
  res.json(await auth.logoutAll(contextFrom(req)));
};

export const forgotPassword = async (req, res) => {
  res.json(await auth.forgotPassword(req.body && req.body.email));
};

export const resetPassword = async (req, res) => {
  res.json(await auth.resetPassword(req.body || {}));
};

export const acceptInvite = async (req, res) => {
  res.json(await auth.acceptInvite(req.body || {}));
};
