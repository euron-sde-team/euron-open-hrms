/**
 * Ready-made onboarding templates, seeded into a tenant by the starter-content library.
 *
 * A builder that opens on an empty canvas is a builder nobody uses. These are complete,
 * working forms an organisation can send on day one and edit later, in the same spirit as
 * the starter policy library and the curated holiday calendar.
 *
 * INDIA_STANDARD is the joining form an Indian company actually needs: the documents
 * required before the first payroll run, the statutory identifiers PF and ESIC filing
 * depend on, the previous-employment record that supports a background check, and the
 * nominations gratuity and insurance are paid against.
 *
 * Every preset is validated by validateTemplate() in the tests, so a preset can never ship
 * with a field pointing somewhere it is not allowed to write.
 */
import type { OnboardingTemplateDoc, Section } from "./onboarding-template";

const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const MARITAL = ["Single", "Married", "Divorced", "Widowed", "Prefer not to say"];
const RELATIONS = ["Spouse", "Father", "Mother", "Son", "Daughter", "Brother", "Sister", "Guardian", "Other"];
const QUALIFICATIONS = [
  "Class 10", "Class 12", "Diploma", "Bachelor's degree", "Master's degree",
  "Doctorate", "Professional certification", "Other",
];

/* ── India standard ─────────────────────────────────────────────────────────────────── */

const personal: Section = {
  key: "personal",
  kind: "FIELDS",
  title: "Personal details",
  description: "As they appear on your government-issued ID. These are used on your offer letter, payslips and statutory filings.",
  fields: [
    { key: "firstName", label: "First name", type: "text", required: true, mapsTo: "firstName", maxLength: 80 },
    { key: "lastName", label: "Last name", type: "text", mapsTo: "lastName", maxLength: 80 },
    { key: "dob", label: "Date of birth", type: "date", required: true, mapsTo: "dob", help: "Must match your PAN and Aadhaar." },
    { key: "gender", label: "Gender", type: "select", options: GENDERS, mapsTo: "gender" },
    { key: "bloodGroup", label: "Blood group", type: "select", options: BLOOD, mapsTo: "bloodGroup", help: "Held for medical emergencies only." },
    { key: "maritalStatus", label: "Marital status", type: "select", options: MARITAL, mapsTo: "maritalStatus" },
    { key: "nationality", label: "Nationality", type: "text", mapsTo: "nationality", placeholder: "Indian" },
    { key: "personalEmail", label: "Personal email", type: "email", required: true, mapsTo: "personalEmail", help: "Where we write to you before your work address is live." },
    { key: "phone", label: "Mobile number", type: "phone", required: true, mapsTo: "phone" },
    { key: "altPhone", label: "Alternate number", type: "phone" },
  ],
};

const addresses: Section = {
  key: "addresses",
  kind: "FIELDS",
  title: "Addresses",
  description: "Your current address is used for correspondence; the permanent one appears on statutory records.",
  fields: [
    { key: "currentAddress", label: "Current address", type: "address", required: true, mapsTo: "currentAddress", proofCategory: "ADDRESS_CURRENT" },
    { key: "currentPincode", label: "PIN code", type: "text", required: true, pattern: "PINCODE" },
    { key: "permanentAddress", label: "Permanent address", type: "address", required: true, mapsTo: "permanentAddress", proofCategory: "ADDRESS_PERMANENT", help: "Tick \"same as current\" if they match." },
    { key: "permanentPincode", label: "PIN code", type: "text", pattern: "PINCODE" },
  ],
};

const emergency: Section = {
  key: "emergency",
  kind: "FIELDS",
  title: "Emergency contact",
  description: "Who we call if something happens to you at work. Please make sure they know.",
  fields: [
    { key: "ecName", label: "Contact name", type: "text", required: true, mapsTo: "emergencyContact.name" },
    { key: "ecRelation", label: "Relationship", type: "select", required: true, options: RELATIONS, mapsTo: "emergencyContact.relation" },
    { key: "ecPhone", label: "Contact number", type: "phone", required: true, mapsTo: "emergencyContact.phone" },
    { key: "ecAltPhone", label: "Alternate number", type: "phone" },
  ],
};

const governmentIds: Section = {
  key: "government_ids",
  kind: "FIELDS",
  title: "Government IDs",
  description: "PAN is required before your first payroll run. Upload a clear photo or scan of each document you enter.",
  fields: [
    { key: "pan", label: "PAN", type: "text", required: true, pattern: "PAN", mapsTo: "kyc.pan", proofCategory: "PAN", help: "Ten characters, e.g. ABCDE1234F." },
    { key: "aadhaar", label: "Aadhaar number", type: "text", required: true, pattern: "AADHAAR", mapsTo: "kyc.aadhaar", proofCategory: "AADHAAR", help: "Twelve digits, needed for PF and ESIC." },
    { key: "passport", label: "Passport number", type: "text", pattern: "PASSPORT_IN", mapsTo: "kyc.passport", proofCategory: "PASSPORT" },
    { key: "drivingLicence", label: "Driving licence", type: "text", mapsTo: "kyc.drivingLicence", proofCategory: "DRIVING_LICENCE" },
    { key: "voterId", label: "Voter ID (EPIC)", type: "text", mapsTo: "kyc.voterId", proofCategory: "VOTER_ID" },
  ],
};

const bank: Section = {
  key: "bank",
  kind: "BANK",
  title: "Salary account & statutory",
  description: "Your salary is paid to this account. Check the number twice, a wrong digit delays your first payslip.",
  fields: [
    { key: "accountName", label: "Account holder name", type: "text", required: true, mapsTo: "bank.name", help: "Exactly as it appears on your passbook." },
    { key: "account", label: "Account number", type: "text", required: true, pattern: "BANK_ACCOUNT", mapsTo: "bank.account" },
    { key: "accountConfirm", label: "Re-enter account number", type: "text", required: true, pattern: "BANK_ACCOUNT" },
    { key: "ifsc", label: "IFSC", type: "text", required: true, pattern: "IFSC", mapsTo: "bank.ifsc" },
    { key: "bankName", label: "Bank", type: "text", required: true, mapsTo: "bank.bankName" },
    { key: "branch", label: "Branch", type: "text", mapsTo: "bank.branch" },
    { key: "bankProof", label: "Cancelled cheque or passbook front page", type: "file", required: true, proofCategory: "BANK" },
    { key: "uan", label: "UAN", type: "text", pattern: "UAN", mapsTo: "kyc.uan", help: "From a previous employer's PF. Leave blank if this is your first job." },
    { key: "hasPf", label: "I have an existing PF account", type: "checkbox" },
    { key: "esic", label: "ESIC number", type: "text", pattern: "ESIC", mapsTo: "kyc.esic", help: "Only if you have been covered by ESIC before." },
  ],
};

const education: Section = {
  key: "education",
  kind: "EDUCATION",
  title: "Education",
  description: "Start with your highest qualification. Upload the certificate for each.",
  minRows: 1,
  maxRows: 8,
  fields: [
    { key: "qualification", label: "Qualification", type: "select", required: true, options: QUALIFICATIONS },
    { key: "specialisation", label: "Specialisation", type: "text", placeholder: "Computer Science" },
    { key: "institution", label: "Institution", type: "text", required: true },
    { key: "board", label: "Board or university", type: "text" },
    { key: "yearOfPassing", label: "Year of passing", type: "number", required: true, min: 1950, max: 2100 },
    { key: "grade", label: "Grade / percentage", type: "text" },
    { key: "certificate", label: "Certificate", type: "file", proofCategory: "EDUCATION" },
  ],
};

const employmentHistory: Section = {
  key: "employment_history",
  kind: "EMPLOYMENT_HISTORY",
  title: "Previous employment",
  description: "Most recent first. Leave this section empty if this is your first job.",
  optional: true,
  minRows: 0,
  maxRows: 12,
  fields: [
    { key: "employer", label: "Company", type: "text", required: true },
    { key: "designation", label: "Designation", type: "text", required: true },
    { key: "fromDate", label: "From", type: "date", required: true },
    { key: "toDate", label: "To", type: "date", required: true },
    { key: "lastCtc", label: "Last drawn annual CTC", type: "number", min: 0, help: "In rupees. Used only to verify your salary history." },
    { key: "reasonForLeaving", label: "Reason for leaving", type: "textarea", maxLength: 500 },
    { key: "uanThere", label: "UAN at this employer", type: "text", pattern: "UAN", help: "Helps us transfer your PF balance." },
    { key: "supervisorName", label: "Reporting manager", type: "text" },
    { key: "supervisorEmail", label: "Manager's email", type: "email", help: "For reference checks. We will tell you before contacting anyone." },
    { key: "supervisorPhone", label: "Manager's phone", type: "phone" },
    { key: "relievingLetter", label: "Relieving letter", type: "file", proofCategory: "PREV_RELIEVING" },
    { key: "payslips", label: "Last three payslips", type: "file", proofCategory: "PREV_PAYSLIP" },
  ],
};

const dependents: Section = {
  key: "dependents",
  kind: "DEPENDENTS",
  title: "Dependents & nominees",
  description: "Who your gratuity, PF and insurance are paid to. Nomination shares must add up to 100%.",
  minRows: 1,
  maxRows: 10,
  fields: [
    { key: "name", label: "Full name", type: "text", required: true },
    { key: "relation", label: "Relationship", type: "select", required: true, options: RELATIONS },
    { key: "dob", label: "Date of birth", type: "date", required: true },
    { key: "nominationPercent", label: "Nomination share (%)", type: "number", required: true, min: 0, max: 100 },
    { key: "isDependent", label: "Covered by company insurance", type: "checkbox" },
    { key: "aadhaar", label: "Aadhaar number", type: "text", pattern: "AADHAAR", help: "Required by PF for a nominee." },
  ],
};

const assets: Section = {
  key: "assets",
  kind: "ASSETS",
  title: "Company assets",
  description: "Confirm what you have been issued, and tell us about anything else you were handed.",
  assets: {
    mode: "BOTH",
    requireSerialConfirmation: true,
    issueCustodyForm: true,
  },
};

const acknowledgment: Section = {
  key: "policies",
  kind: "ACKNOWLEDGMENT",
  title: "Policies",
  description: "Please read each policy and confirm you accept it. You can find them all again under Policies once you are set up.",
  policyIds: [], // empty = every published policy in the tenant's library
};

const declaration: Section = {
  key: "declaration",
  kind: "DECLARATION",
  title: "Declaration",
  declarationText:
    "I confirm that the information and documents I have provided are true, complete and accurate to the best of my knowledge. " +
    "I understand that any statement later found to be false or deliberately misleading may result in the withdrawal of my offer, " +
    "or in disciplinary action up to and including termination of employment. " +
    "I agree that the organisation may verify these details, including with my previous employers and with the issuing authorities " +
    "for the documents I have uploaded.",
};

export const INDIA_STANDARD: OnboardingTemplateDoc = {
  name: "India, standard joining form",
  description:
    "The complete joining form for an Indian company: KYC, salary account, PF and ESIC identifiers, " +
    "education, previous employment, nominations, asset handover and policy acceptance.",
  isDefault: true,
  presetKey: "INDIA_STANDARD",
  version: 1,
  dueDays: 7,
  reminderOffsets: [-3, -1, 1, 3],
  escalateAfterDays: 3,
  appliesTo: { employmentTypes: [], departmentIds: [] },
  sections: [
    personal,
    addresses,
    emergency,
    governmentIds,
    bank,
    education,
    employmentHistory,
    dependents,
    assets,
    acknowledgment,
    declaration,
  ],
};

/* ── Minimal ────────────────────────────────────────────────────────────────────────── */

/**
 * For short engagements: interns, freelancers and contractors, where a full KYC pack is
 * disproportionate but PAN and a payment account are still needed to pay anyone at all.
 */
export const MINIMAL: OnboardingTemplateDoc = {
  name: "Short engagement",
  description: "A cut-down form for interns, freelancers and contractors: identity, PAN, payment account and a declaration.",
  presetKey: "MINIMAL",
  version: 1,
  dueDays: 5,
  reminderOffsets: [-1, 1],
  escalateAfterDays: 3,
  appliesTo: { employmentTypes: ["INTERN", "FREELANCER", "TEMPORARY"], departmentIds: [] },
  sections: [
    { ...personal, fields: personal.fields!.filter((f) => !["bloodGroup", "maritalStatus", "altPhone"].includes(f.key)) },
    { ...addresses, fields: addresses.fields!.filter((f) => f.key.startsWith("current")) },
    emergency,
    {
      ...governmentIds,
      description: "PAN is required before we can pay you.",
      fields: governmentIds.fields!.filter((f) => ["pan", "aadhaar"].includes(f.key)),
    },
    { ...bank, fields: bank.fields!.filter((f) => !["uan", "hasPf", "esic"].includes(f.key)) },
    assets,
    declaration,
  ],
};

export const PRESETS: OnboardingTemplateDoc[] = [INDIA_STANDARD, MINIMAL];

export const presetByKey = (key: string) => PRESETS.find((p) => p.presetKey === key) || null;
