/** HTTP adapter for public self-signup: read the request, call the service, write the response. */
import * as signups from "../services/signup.service";

export const countries = async (_req, res) => {
  res.json(signups.signupCountries());
};

export const create = async (req, res) => {
  res.status(201).json(await signups.signup(req.body || {}));
};

export const verify = async (req, res) => {
  res.json(await signups.verifySignup(req.body && req.body.token));
};

export const resend = async (req, res) => {
  res.json(await signups.resendVerification(req.body && req.body.email));
};
