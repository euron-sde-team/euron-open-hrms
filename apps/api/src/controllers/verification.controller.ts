/** HTTP adapter for public document verification (no authentication). */
import * as verification from "../services/verification.service";

export const verify = async (req, res) => {
  res.json(await verification.verifyDocument(req.params.code, req.query.digest ? String(req.query.digest) : undefined));
};

export const qr = async (req, res) => {
  res.json(await verification.verificationQr(req.params.code));
};
