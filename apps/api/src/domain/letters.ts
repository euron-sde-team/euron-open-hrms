/**
 * Official HR letters (PDF): offer/appointment, confirmation, appraisal, relieving,
 * experience, termination, retirement, absence notices and the settlement statement.
 *
 * Every letter is now produced from an EDITABLE TEMPLATE (see letter-templates.ts) by a
 * single renderer (letter-render.ts). The functions here are thin wrappers that resolve the
 * organisation's template and hand the renderer that letter's subject matter, so all the
 * existing callers (letters.routes.ts, separation.routes.ts, LETTER_GENERATORS) keep their
 * signatures and behaviour while organisations gain control of the wording.
 */
import { brandForAsync } from "./brand";
import { renderLetter } from "../pdf/letter-render";
import { templateFor } from "./letter-templates";
import { probationEndDate } from "./letter-tokens";

/** Shared preamble: resolve the brand and the org's template for this kind. */
async function prep(org: any, kind: string) {
  const brand = await brandForAsync(org);
  return { brand, template: templateFor(org, kind) };
}

/** Offer / Letter of Appointment. */
async function offerLetter({ org, employee, dept, verification = null }: any) {
  const { brand, template } = await prep(org, "OFFER_LETTER");
  return renderLetter({ kind: "OFFER_LETTER", template, org, brand, employee, dept, verification, filePrefix: "offer" });
}

/**
 * Confirmation of employment, issued when probation completes successfully.
 *
 * `effectiveDate` defaults to the date probation ends, derived from the joining date and
 * the probation length on record, so the common case needs no input from HR.
 */
async function confirmationLetter({ org, employee, dept, effectiveDate, verification = null }: any) {
  const { brand, template } = await prep(org, "CONFIRMATION_LETTER");
  return renderLetter({
    kind: "CONFIRMATION_LETTER", template, org, brand, employee, dept, verification,
    effectiveDate: effectiveDate || probationEndDate(employee.joiningDate, employee.probationMonths),
    filePrefix: "confirmation",
  });
}

/** Probation extension. */
async function probationExtensionLetter({ org, employee, dept, effectiveDate, verification = null }: any) {
  const { brand, template } = await prep(org, "PROBATION_EXTENSION_LETTER");
  return renderLetter({
    kind: "PROBATION_EXTENSION_LETTER", template, org, brand, employee, dept, verification,
    effectiveDate, filePrefix: "probation_extension",
  });
}

/** Appraisal / Increment. previousSalary = prior structure, employee.salary = revised. */
async function appraisalLetter({ org, employee, dept, previousSalary, effectiveDate, verification = null }: any) {
  const { brand, template } = await prep(org, "APPRAISAL_LETTER");
  return renderLetter({
    kind: "APPRAISAL_LETTER", template, org, brand, employee, dept, verification,
    salary: employee.salary, previousSalary, effectiveDate, filePrefix: "appraisal",
  });
}

/** Relieving / Experience letter, issued on a clean exit. */
async function relievingLetter({ org, employee, dept, lastWorkingDay, noticePeriodDays = null, verification = null }: any) {
  const { brand, template } = await prep(org, "RELIEVING_LETTER");
  return renderLetter({
    kind: "RELIEVING_LETTER", template, org, brand, employee, dept, verification,
    lastWorkingDay, noticePeriodDays, filePrefix: "relieving",
  });
}

/**
 * Experience / Service certificate.
 *
 * States service only, with none of the relieving letter's "dues settled" and "relieved of
 * all duties" language: it is issued for terminations not-for-cause, retirement and end of
 * contract, where those claims may not be true yet.
 */
async function experienceLetter({ org, employee, dept, lastWorkingDay, noticePeriodDays = null, verification = null }: any) {
  const { brand, template } = await prep(org, "EXPERIENCE_LETTER");
  return renderLetter({
    kind: "EXPERIENCE_LETTER", template, org, brand, employee, dept, verification,
    lastWorkingDay, noticePeriodDays, filePrefix: "experience",
  });
}

/**
 * Termination letter.
 *
 * `forCause` drops the closing goodwill paragraph. It is matched by content rather than by
 * index so that an organisation which has reordered or reworded the template still gets the
 * right paragraph withheld, and an organisation which has removed it entirely is unaffected.
 */
async function terminationLetter({ org, employee, dept, lastWorkingDay, reason, subReason, forCause, noticePeriodDays = null, verification = null }: any) {
  const { brand, template } = await prep(org, "TERMINATION_LETTER");
  const tpl = forCause
    ? { ...template, blocks: template.blocks.filter((b: any) => !(b.type === "paragraph" && /wish you well|wish you the best/i.test(b.text || ""))) }
    : template;
  return renderLetter({
    kind: "TERMINATION_LETTER", template: tpl, org, brand, employee, dept, verification,
    lastWorkingDay, reason, subReason, noticePeriodDays, filePrefix: "termination",
  });
}

/** Retirement / Superannuation. */
async function retirementLetter({ org, employee, dept, lastWorkingDay, verification = null }: any) {
  const { brand, template } = await prep(org, "RETIREMENT_LETTER");
  return renderLetter({
    kind: "RETIREMENT_LETTER", template, org, brand, employee, dept, verification,
    lastWorkingDay, filePrefix: "retirement",
  });
}

/** Absence notice (sequence 1 or 2). */
async function abscondingLetter({ org, employee, dept, sequence, daysAbsent, verification = null }: any) {
  const seq = sequence === 2 ? 2 : 1;
  const kind = seq === 2 ? "ABSCONDING_LETTER_2" : "ABSCONDING_LETTER_1";
  const { brand, template } = await prep(org, kind);
  return renderLetter({
    kind, template, org, brand, employee, dept, verification,
    daysAbsent, filePrefix: `absconding_${seq}`,
  });
}

/** Full & Final settlement statement. `settlement` = computeSettlement() result. */
async function settlementStatement({ org, employee, dept, settlement, lastWorkingDay, verification = null }: any) {
  const { brand, template } = await prep(org, "SETTLEMENT_STATEMENT");
  return renderLetter({
    kind: "SETTLEMENT_STATEMENT", template, org, brand, employee, dept, verification,
    settlement, lastWorkingDay: lastWorkingDay || (settlement && settlement.lastWorkingDay),
    filePrefix: "fnf",
  });
}

// Document kind -> generator, for the type-aware completion step in separation.
const LETTER_GENERATORS = {
  RELIEVING_LETTER: relievingLetter,
  EXPERIENCE_LETTER: experienceLetter,
  TERMINATION_LETTER: terminationLetter,
  RETIREMENT_LETTER: retirementLetter,
};

export {
  offerLetter, confirmationLetter, probationExtensionLetter, relievingLetter, appraisalLetter,
  experienceLetter, terminationLetter, retirementLetter, abscondingLetter, settlementStatement,
  LETTER_GENERATORS,
};
