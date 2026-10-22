/** HTTP adapter for letters: read the request, call the service, write the response. */
import { contextFrom } from "../core/context";
import * as letters from "../services/letter.service";

export const offerBulk = async (req, res) => {
  res.status(201).json(await letters.issueOfferLettersBulk(contextFrom(req), req.body || {}));
};

export const issuable = async (req, res) => {
  res.json(await letters.issuableLetters(contextFrom(req), req.params.employeeId));
};

export const issue = async (req, res) => {
  res.status(201).json(await letters.issueLetter(contextFrom(req), req.params.employeeId, req.body || {}));
};

export const status = async (req, res) => {
  res.json(await letters.letterStatus(contextFrom(req), req.query.status));
};

export const offer = async (req, res) => {
  res.status(201).json(await letters.issueOfferLetter(contextFrom(req), req.params.employeeId, req.body || {}));
};

export const confirmation = async (req, res) => {
  res.status(201).json(await letters.issueConfirmationLetter(contextFrom(req), req.params.employeeId, req.body || {}));
};

export const probationExtension = async (req, res) => {
  res.status(201).json(await letters.issueProbationExtensionLetter(contextFrom(req), req.params.employeeId, req.body || {}));
};

export const probationDue = async (req, res) => {
  res.json(await letters.probationDue(contextFrom(req), req.query.withinDays));
};

export const relieving = async (req, res) => {
  res.status(201).json(await letters.issueRelievingLetter(contextFrom(req), req.params.employeeId, req.body || {}));
};

export const appraisal = async (req, res) => {
  res.status(201).json(await letters.issueAppraisalLetter(contextFrom(req), req.params.employeeId, req.body || {}));
};
