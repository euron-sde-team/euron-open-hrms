import { it } from "vitest";
/**
 * Unit tests for the onboarding template + case engine (no server or DB needed).
 * Run: npx tsx tests/onboarding.ts   (or via npm test)
 *
 * The emphasis is deliberate. Most of this file tests things that must NOT happen: a
 * template field writing to compensation, a PAN update wiping a UAN, a sent-back section
 * being resubmitted untouched. Those are the failures that would be silent in production.
 */
process.env.MAIL_MODE = "outbox";
process.env.STORAGE = "local";

import assert from "node:assert";
const t = (name: string, fn: () => void) => it(name, fn);
/** Assert that `fn` throws, and that the message mentions `needle`. */
const throws = (fn: () => any, needle: string) => {
  try { fn(); } catch (e: any) {
    assert.ok(
      e.message.toLowerCase().includes(needle.toLowerCase()),
      `expected a message mentioning "${needle}", got: ${e.message}`
    );
    return;
  }
  throw new Error("expected this to be rejected, but it was accepted");
};

import { validateTemplate, isMappable, pickTemplate, templateGapReason, sectionsFor, PATTERNS, MAPPABLE_PATHS } from "../../src/domain/onboarding-template";
import { PRESETS, INDIA_STANDARD, presetByKey } from "../../src/domain/onboarding-presets";
import { buildCaseData, validateAnswer, normaliseAnswer, checkSection, checkCase, computeProgress, canSubmit, applySectionValues, diffAgainstEmployee, buildEmployeePatch, getPath, setPath, OPEN_STATUSES } from "../../src/domain/onboarding-case";

const fieldsSection = (fields: any[], extra: any = {}) => ({
  name: "T", sections: [{ key: "s1", kind: "FIELDS", title: "S", fields, ...extra }],
});

t("both presets validate through the same validator a tenant's edits use", () => {
  for (const p of PRESETS) {
    const out = validateTemplate(p);
    assert.ok(out.sections.length > 0, `${p.presetKey} produced no sections`);
  }
});

t("the India preset covers the sections an Indian joiner form needs", () => {
  const kinds = INDIA_STANDARD.sections.map((s: any) => s.kind);
  for (const k of ["FIELDS", "BANK", "EDUCATION", "EMPLOYMENT_HISTORY", "DEPENDENTS", "ASSETS", "ACKNOWLEDGMENT", "DECLARATION"]) {
    assert.ok(kinds.includes(k), `preset is missing a ${k} section`);
  }
});

t("presetByKey finds a preset and returns null for an unknown one", () => {
  assert.strictEqual(presetByKey("INDIA_STANDARD")!.presetKey, "INDIA_STANDARD");
  assert.strictEqual(presetByKey("NOPE"), null);
});

// ── The mapsTo allowlist. This is the security boundary of the whole builder. ──

t("a field cannot be pointed at compensation", () =>
  throws(() => validateTemplate(fieldsSection([{ key: "p", label: "Pay", type: "number", mapsTo: "salary.basic" }])), "not allowed to set"));

t("a field cannot be pointed at employment status", () =>
  throws(() => validateTemplate(fieldsSection([{ key: "s", label: "St", type: "text", mapsTo: "status" }])), "not allowed to set"));

t("a field cannot be pointed at the employee code", () =>
  throws(() => validateTemplate(fieldsSection([{ key: "c", label: "C", type: "text", mapsTo: "code" }])), "not allowed to set"));

t("a field cannot be pointed at the reporting line", () =>
  throws(() => validateTemplate(fieldsSection([{ key: "m", label: "M", type: "text", mapsTo: "managerId" }])), "not allowed to set"));

t("the allowlist itself contains nothing compensation-, status- or identity-assigning", () => {
  const banned = ["salary", "code", "status", "managerId", "reportsTo", "departmentId", "joiningDate", "employmentType", "officialEmail"];
  for (const p of MAPPABLE_PATHS) {
    const root = p.path.split(".")[0];
    assert.ok(!banned.includes(root), `${p.path} should not be mappable`);
  }
});

t("every mappable path is tiered", () => {
  for (const p of MAPPABLE_PATHS) {
    assert.ok(["ROUTINE", "IDENTITY", "FINANCIAL"].includes(p.tier), `${p.path} has tier ${p.tier}`);
  }
  assert.ok(MAPPABLE_PATHS.some((p: any) => p.tier === "FINANCIAL"), "expected the bank paths to be FINANCIAL");
});

t("isMappable agrees with the list", () => {
  assert.ok(isMappable("kyc.pan"));
  assert.ok(isMappable("bank.ifsc"));
  assert.ok(!isMappable("salary.basic"));
  assert.ok(!isMappable(""));
  assert.ok(!isMappable(null));
});

t("two fields cannot write to the same employee path", () =>
  throws(() => validateTemplate({ name: "T", sections: [{ key: "s1", kind: "FIELDS", title: "S", fields: [
    { key: "a", label: "A", type: "text", mapsTo: "kyc.pan" },
    { key: "b", label: "B", type: "text", mapsTo: "kyc.pan" },
  ] }] }), "only one field"));

t("the same path in two DIFFERENT sections is caught too", () =>
  throws(() => validateTemplate({ name: "T", sections: [
    { key: "s1", kind: "FIELDS", title: "A", fields: [{ key: "a", label: "A", type: "text", mapsTo: "phone" }] },
    { key: "s2", kind: "FIELDS", title: "B", fields: [{ key: "b", label: "B", type: "text", mapsTo: "phone" }] },
  ] }), "only one field"));

// ── Other validator guards ──

t("author-supplied regex is refused (catastrophic backtracking is not detectable)", () =>
  throws(() => validateTemplate(fieldsSection([{ key: "r", label: "R", type: "text", pattern: "(a+)+$" }])), "not one we validate"));

t("a named pattern is accepted", () => {
  const out = validateTemplate(fieldsSection([{ key: "p", label: "PAN", type: "text", pattern: "pan" }]));
  assert.strictEqual(out!.sections[0].fields![0].pattern, "PAN"); // normalised
});

t("duplicate field keys are refused", () =>
  throws(() => validateTemplate(fieldsSection([{ key: "x", label: "A", type: "text" }, { key: "x", label: "B", type: "text" }])), "both use the key"));

t("duplicate section keys are refused", () =>
  throws(() => validateTemplate({ name: "T", sections: [
    { key: "s", kind: "FIELDS", title: "A", fields: [{ key: "a", label: "A", type: "text" }] },
    { key: "s", kind: "FIELDS", title: "B", fields: [{ key: "b", label: "B", type: "text" }] },
  ] }), "both use the key"));

t("an unknown document category is refused", () =>
  throws(() => validateTemplate({ name: "T", sections: [{ key: "d", kind: "DOCUMENTS", title: "D", documents: [{ category: "NOT_A_THING" }] }] }), "unknown document type"));

t("a dropdown with no options is refused", () =>
  throws(() => validateTemplate(fieldsSection([{ key: "s", label: "S", type: "select" }])), "at least one option"));

t("a select cannot list the same option twice", () =>
  throws(() => validateTemplate(fieldsSection([{ key: "s", label: "S", type: "select", options: ["A", "A"] }])), "same option twice"));

t("serial confirmation is refused on a declare-only assets section", () =>
  throws(() => validateTemplate({ name: "T", sections: [{ key: "a", kind: "ASSETS", title: "A", assets: { mode: "DECLARE", requireSerialConfirmation: true } }] }), "ACKNOWLEDGE or BOTH"));

t("an unknown assets mode is refused", () =>
  throws(() => validateTemplate({ name: "T", sections: [{ key: "a", kind: "ASSETS", title: "A", assets: { mode: "SOMETIMES" } }] }), "ACKNOWLEDGE, DECLARE or BOTH"));

t("a template with no sections is refused", () =>
  throws(() => validateTemplate({ name: "T", sections: [] }), "at least one section"));

t("a template with no name is refused", () =>
  throws(() => validateTemplate({ sections: [{ key: "s", kind: "FIELDS", title: "S", fields: [{ key: "a", label: "A", type: "text" }] }] }), "needs a name"));

t("more than one declaration is refused", () =>
  throws(() => validateTemplate({ name: "T", sections: [
    { key: "d1", kind: "DECLARATION", title: "D", declarationText: "x" },
    { key: "d2", kind: "DECLARATION", title: "D", declarationText: "y" },
  ] }), "only one declaration"));

t("an unknown employment type in assignment rules is refused", () =>
  throws(() => validateTemplate({ ...fieldsSection([{ key: "a", label: "A", type: "text" }]), appliesTo: { employmentTypes: ["WIZARD"] } }), "unknown employment type"));

t("reminder offsets are de-duplicated, sorted and stripped of zero", () => {
  const out = validateTemplate({ ...fieldsSection([{ key: "a", label: "A", type: "text" }]), reminderOffsets: [1, -3, 0, -3, -1] });
  assert.deepStrictEqual(out.reminderOffsets, [-3, -1, 1]);
});

t("an absurd deadline is refused", () =>
  throws(() => validateTemplate({ ...fieldsSection([{ key: "a", label: "A", type: "text" }]), dueDays: 0 }), "between 1 and 365"));

t("pickTemplate prefers the most specific active template", () => {
  const templates = [
    { id: "generic", status: "ACTIVE", isDefault: true, appliesTo: {} },
    { id: "byType", status: "ACTIVE", appliesTo: { employmentTypes: ["INTERN"] } },
    { id: "byBoth", status: "ACTIVE", appliesTo: { employmentTypes: ["INTERN"], departmentIds: ["d1"] } },
  ];
  assert.strictEqual(pickTemplate(templates, { employmentType: "INTERN", departmentId: "d1" })!.id, "byBoth");
  assert.strictEqual(pickTemplate(templates, { employmentType: "INTERN", departmentId: "d9" })!.id, "byType");
  assert.strictEqual(pickTemplate(templates, { employmentType: "PERMANENT", departmentId: "d1" })!.id, "generic");
});

t("pickTemplate ignores drafts and archived templates", () => {
  assert.strictEqual(pickTemplate([{ id: "d", status: "DRAFT", isDefault: true, appliesTo: {} }], {}), null);
  assert.strictEqual(pickTemplate([], {}), null);
});

// The regression these guard: an invite used to be minted and emailed without anyone
// checking that a form would resolve for the candidate. The gap surfaced as a bare 400 on
// the candidate's link, days later, to the one person who could not act on it.
t("templateGapReason stays silent when a form resolves", () => {
  const templates = [{ id: "generic", status: "ACTIVE", isDefault: true, appliesTo: {} }];
  assert.strictEqual(templateGapReason(templates, { employmentType: "PERMANENT" }), null);
});

t("templateGapReason points an org with no active form at the starter packs", () => {
  const reason = templateGapReason([{ id: "d", status: "DRAFT", isDefault: true, appliesTo: {} }], {
    employmentType: "PERMANENT",
  });
  assert.ok(reason && reason.includes("no active onboarding form"), String(reason));
  assert.ok(reason.includes("starter forms"), "must say how to fix it: " + reason);
});

t("templateGapReason distinguishes an unmatched employment type from an empty org", () => {
  const templates = [{ id: "interns", status: "ACTIVE", appliesTo: { employmentTypes: ["INTERN"] } }];
  const reason = templateGapReason(templates, { employmentType: "PERMANENT" });
  // A form exists, so telling HR to apply the starter packs would send them the wrong way.
  assert.ok(reason, "an unmatched type is still a gap");
  assert.ok(!reason.includes("starter forms"), "wrong remedy for this gap: " + reason);
  assert.ok(reason.includes("permanent"), "must name the type that found nothing: " + reason);
});

t("templateGapReason is satisfied by a default form that names other types", () => {
  // pickTemplate falls back to the default, so the guard must not block this send.
  const templates = [
    { id: "interns", status: "ACTIVE", appliesTo: { employmentTypes: ["INTERN"] } },
    { id: "generic", status: "ACTIVE", isDefault: true, appliesTo: {} },
  ];
  assert.strictEqual(templateGapReason(templates, { employmentType: "PERMANENT" }), null);
});

t("sectionsFor drops sections that do not apply to the employment type", () => {
  const tpl: any = { sections: [
    { key: "a", kind: "FIELDS", title: "A" },
    { key: "b", kind: "FIELDS", title: "B", employmentTypes: ["PERMANENT"] },
  ] };
  assert.strictEqual(sectionsFor(tpl, "INTERN").length, 1);
  assert.strictEqual(sectionsFor(tpl, "PERMANENT").length, 2);
});

const F = (over: any = {}) => ({ key: "f", label: "Field", type: "text", ...over });

t("a required field rejects blank, an optional one accepts it", () => {
  assert.ok(validateAnswer(F({ required: true }), ""));
  assert.strictEqual(validateAnswer(F(), ""), null);
  assert.strictEqual(validateAnswer(F(), undefined), null);
});

t("PAN accepts a valid number in either case and rejects a malformed one", () => {
  assert.strictEqual(validateAnswer(F({ pattern: "PAN" }), "ABCDE1234F"), null);
  assert.strictEqual(validateAnswer(F({ pattern: "PAN" }), "abcde1234f"), null, "lowercase should be accepted");
  assert.ok(validateAnswer(F({ pattern: "PAN" }), "ABCD1234F"));
});

t("Aadhaar accepts exactly twelve digits", () => {
  assert.strictEqual(validateAnswer(F({ pattern: "AADHAAR" }), "123456789012"), null);
  assert.ok(validateAnswer(F({ pattern: "AADHAAR" }), "12345678901"));
  assert.ok(validateAnswer(F({ pattern: "AADHAAR" }), "1234 5678 9012"), "spaces should not pass the raw pattern");
});

t("IFSC enforces the fifth-character zero", () => {
  assert.strictEqual(validateAnswer(F({ pattern: "IFSC" }), "HDFC0001234"), null);
  assert.ok(validateAnswer(F({ pattern: "IFSC" }), "HDFC1001234"));
});

t("a number honours min and max", () => {
  const f = F({ type: "number", min: 1950, max: 2100 });
  assert.strictEqual(validateAnswer(f, 1999), null);
  assert.ok(validateAnswer(f, 1900));
  assert.ok(validateAnswer(f, 3000));
  assert.ok(validateAnswer(f, "not a number"));
});

t("a select rejects a value not on the list", () => {
  const f = F({ type: "select", options: ["A", "B"] });
  assert.strictEqual(validateAnswer(f, "A"), null);
  assert.ok(validateAnswer(f, "C"));
});

t("a date must be ISO and real", () => {
  assert.strictEqual(validateAnswer(F({ type: "date" }), "2026-04-30"), null);
  assert.ok(validateAnswer(F({ type: "date" }), "30-04-2026"));
  assert.ok(validateAnswer(F({ type: "date" }), "banana"));
});

t("an email is checked", () => {
  assert.strictEqual(validateAnswer(F({ type: "email" }), "a@b.co"), null);
  assert.ok(validateAnswer(F({ type: "email" }), "a@b"));
});

t("maxLength is enforced", () => assert.ok(validateAnswer(F({ maxLength: 3 }), "abcd")));

t("normaliseAnswer uppercases formatted identifiers and trims the rest", () => {
  assert.strictEqual(normaliseAnswer(F({ pattern: "PAN" }), "  abcde1234f "), "ABCDE1234F");
  assert.strictEqual(normaliseAnswer(F(), "  Priya  "), "Priya");
  assert.strictEqual(normaliseAnswer(F({ type: "checkbox" }), true), true);
});

const TPL = validateTemplate({
  name: "Test",
  sections: [
    { key: "personal", kind: "FIELDS", title: "Personal", fields: [
      { key: "firstName", label: "First name", type: "text", required: true, mapsTo: "firstName" },
      { key: "pan", label: "PAN", type: "text", required: true, pattern: "PAN", mapsTo: "kyc.pan" },
      { key: "tshirt", label: "T-shirt size", type: "select", options: ["S", "M", "L"] },
    ] },
    { key: "history", kind: "EMPLOYMENT_HISTORY", title: "Previous employment", optional: true, minRows: 0, maxRows: 5, fields: [
      { key: "employer", label: "Company", type: "text", required: true },
      { key: "fromDate", label: "From", type: "date", required: true },
    ] },
  ],
});

t("a new case snapshots the template's sections", () => {
  const data = buildCaseData(TPL, {});
  assert.strictEqual(data.templateSnapshot.length, 2);
  assert.strictEqual(data.sections.personal.status, "EMPTY");
  assert.deepStrictEqual(data.sections.history.rows, []);
});

t("the snapshot is a copy: editing the template later cannot change a live case", () => {
  const data = buildCaseData(TPL, {});
  const before = data.templateSnapshot.length;
  TPL.sections.push({ key: "late", kind: "FIELDS", title: "Late", fields: [{ key: "z", label: "Z", type: "text" }] } as any);
  assert.strictEqual(data.templateSnapshot.length, before, "the case picked up a section added after it was created");
  TPL.sections.pop();
});

t("a case prefills from what the organisation already knows", () => {
  const data = buildCaseData(TPL, {}, { firstName: "Priya", kyc: { pan: "ABCDE1234F" } });
  assert.strictEqual(data.sections.personal.values.firstName, "Priya");
  assert.strictEqual(data.sections.personal.values.pan, "ABCDE1234F");
  assert.strictEqual(data.sections.personal.status, "PARTIAL");
});

t("prefill only fills mapped fields, never custom ones", () => {
  const data = buildCaseData(TPL, {}, { firstName: "Priya", tshirt: "L" });
  assert.strictEqual(data.sections.personal.values.tshirt, undefined);
});

t("a case only snapshots the sections that apply to the person", () => {
  const scoped = validateTemplate({ name: "S", sections: [
    { key: "a", kind: "FIELDS", title: "A", fields: [{ key: "x", label: "X", type: "text" }] },
    { key: "b", kind: "FIELDS", title: "B", employmentTypes: ["PERMANENT"], fields: [{ key: "y", label: "Y", type: "text" }] },
  ] });
  assert.strictEqual(buildCaseData(scoped, { employmentType: "INTERN" }).templateSnapshot.length, 1);
  assert.strictEqual(buildCaseData(scoped, { employmentType: "PERMANENT" }).templateSnapshot.length, 2);
});

const caseWith = (values: any = {}, over: any = {}) => {
  const d = buildCaseData(TPL, {});
  d.sections.personal.values = values;
  return { ...d, ...over };
};

t("an empty required section reports every missing field", () => {
  const c = checkSection(TPL.sections[0], caseWith());
  assert.strictEqual(c.status, "EMPTY");
  assert.strictEqual(c.errors.length, 2);
  assert.strictEqual(c.requiredTotal, 2);
});

t("a fully answered section is COMPLETE", () => {
  const c = checkSection(TPL.sections[0], caseWith({ firstName: "Priya", pan: "ABCDE1234F" }));
  assert.strictEqual(c.status, "COMPLETE");
  assert.deepStrictEqual(c.errors, []);
});

t("a partly answered section is PARTIAL and says what is left", () => {
  const c = checkSection(TPL.sections[0], caseWith({ firstName: "Priya" }));
  assert.strictEqual(c.status, "PARTIAL");
  assert.ok(c.errors[0].includes("PAN"));
});

t("an invalid answer keeps the section incomplete even when nothing is blank", () => {
  const c = checkSection(TPL.sections[0], caseWith({ firstName: "Priya", pan: "NOPE" }));
  assert.notStrictEqual(c.status, "COMPLETE");
});

t("an optional repeating section with no rows is complete", () => {
  const c = checkSection(TPL.sections[1], buildCaseData(TPL, {}));
  assert.deepStrictEqual(c.errors, []);
});

t("a started repeating section still has to be valid, row by row", () => {
  const d = buildCaseData(TPL, {});
  d.sections.history.rows = [{ employer: "Acme" }]; // fromDate missing
  const c = checkSection(TPL.sections[1], d);
  assert.ok(c.errors.some((e: string) => e.startsWith("Row 1")), `expected a row-scoped error, got ${JSON.stringify(c.errors)}`);
});

t("a missing required document blocks completion", () => {
  const withDoc = validateTemplate({ name: "D", sections: [
    { key: "docs", kind: "DOCUMENTS", title: "Docs", documents: [{ category: "PAN", required: true }] },
  ] });
  const d = buildCaseData(withDoc, {});
  assert.ok(checkSection(withDoc.sections[0], d).errors.length, "expected the missing PAN card to be reported");
  d.documents = [{ sectionKey: "docs", category: "PAN", documentId: "doc1" }];
  assert.deepStrictEqual(checkSection(withDoc.sections[0], d).errors, []);
});

t("a reviewer's verdict outranks a recomputed status", () => {
  const d = caseWith({});
  d.sections.personal.status = "APPROVED";
  assert.strictEqual(checkSection(TPL.sections[0], d).status, "APPROVED");
  d.sections.personal.status = "CHANGES_REQUESTED";
  assert.strictEqual(checkSection(TPL.sections[0], d).status, "CHANGES_REQUESTED");
});

t("progress counts only the sections that are actually required", () => {
  const d = caseWith({ firstName: "Priya", pan: "ABCDE1234F" });
  const p = computeProgress(checkCase(d));
  assert.strictEqual(p.total, 1, "the optional history section should not count toward the total");
  assert.strictEqual(p.done, 1);
  assert.strictEqual(p.percent, 100);
});

const check = (over: any = {}) => ({ key: "k", title: "T", optional: false, status: "COMPLETE", errors: [], filled: 1, requiredTotal: 1, ...over });

t("a complete case may be submitted", () => {
  const v = canSubmit([check(), check({ key: "k2" })]);
  assert.strictEqual(v.ok, true);
  assert.deepStrictEqual(v.blocking, []);
});

t("an incomplete REQUIRED section blocks, and says why", () => {
  const v = canSubmit([check({ status: "PARTIAL", errors: ["PAN is required"] })]);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.blocking[0].errors[0], "PAN is required");
});

t("an untouched OPTIONAL section warns instead of blocking", () => {
  const v = canSubmit([check({ optional: true, status: "EMPTY", errors: ["Company is required"] })]);
  assert.strictEqual(v.ok, true, "an optional section left blank must not block");
  assert.strictEqual(v.warnings.length, 1);
});

t("a STARTED optional section must still be valid", () => {
  const v = canSubmit([check({ optional: true, status: "PARTIAL", errors: ["Row 1: From is required"] })]);
  assert.strictEqual(v.ok, false, "half an entry is worse than none; it must block");
});

t("a section HR sent back blocks resubmission until it is edited", () => {
  const v = canSubmit([check({ status: "CHANGES_REQUESTED", errors: [] })]);
  assert.strictEqual(v.ok, false);
  assert.ok(v.blocking[0].errors[0].includes("changes HR asked for"));
});

t("an already-approved section never blocks", () => {
  const v = canSubmit([check({ status: "APPROVED", errors: ["stale complaint"] })]);
  assert.strictEqual(v.ok, true);
});

t("an empty case (no sections) is submittable rather than deadlocked", () => {
  assert.strictEqual(canSubmit([]).ok, true);
});

const state0 = () => ({ status: "EMPTY", values: {}, history: [] });

t("valid answers are stored normalised", () => {
  const { state, errors } = applySectionValues(TPL.sections[0], state0() as any, { values: { firstName: " Priya ", pan: "abcde1234f" } }, "u1");
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(state.values.firstName, "Priya");
  assert.strictEqual(state.values.pan, "ABCDE1234F");
  assert.strictEqual(state.status, "PARTIAL");
});

t("an invalid answer is reported but the rest of the section is still saved", () => {
  const { state, errors } = applySectionValues(TPL.sections[0], state0() as any, { values: { firstName: "Priya", pan: "NOPE" } }, "u1");
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(state.values.firstName, "Priya", "autosave must not discard the good answers");
});

t("a field the template does not ask for is silently dropped", () => {
  const { state } = applySectionValues(TPL.sections[0], state0() as any, { values: { firstName: "Priya", isAdmin: true } } as any, "u1");
  assert.strictEqual(state.values.isAdmin, undefined);
});

t("editing a sent-back section clears the flag and records who did it", () => {
  const sent = { status: "CHANGES_REQUESTED", values: {}, note: "PAN is unreadable", history: [] };
  const { state } = applySectionValues(TPL.sections[0], sent as any, { values: { firstName: "Priya" } }, "u1");
  assert.strictEqual(state.status, "PARTIAL");
  assert.strictEqual(state.note, "");
  assert.strictEqual(state.history!.at(-1)!.action, "EDITED_AFTER_CHANGES_REQUESTED");
});

t("editing does not un-approve an approved section", () => {
  const approved = { status: "APPROVED", values: {}, history: [] };
  const { state } = applySectionValues(TPL.sections[0], approved as any, { values: { firstName: "X" } }, "u1");
  assert.strictEqual(state.status, "APPROVED");
});

t("a repeating section caps its rows and stamps an id on each", () => {
  const { state, errors } = applySectionValues(
    TPL.sections[1], { status: "EMPTY", values: {}, rows: [] } as any,
    { rows: Array.from({ length: 9 }, () => ({ employer: "A", fromDate: "2020-01-01" })) }, "u1"
  );
  assert.strictEqual(state.rows!.length, 5, "maxRows should be enforced");
  assert.ok(errors.some((e: string) => e.includes("Only 5")));
  assert.ok(state.rows!.every((r: any) => !!r.id));
});

t("the submission gate composes with editing end to end", () => {
  const d = buildCaseData(TPL, {});
  assert.strictEqual(canSubmit(checkCase(d)).ok, false, "a blank case must not be submittable");
  d.sections.personal = applySectionValues(TPL.sections[0], d.sections.personal as any, { values: { firstName: "Priya", pan: "ABCDE1234F" } }, "u1").state;
  assert.strictEqual(canSubmit(checkCase(d)).ok, true, "a filled case should be submittable");
});

t("getPath reads a dotted path and tolerates gaps", () => {
  assert.strictEqual(getPath({ kyc: { pan: "X" } }, "kyc.pan"), "X");
  assert.strictEqual(getPath({}, "kyc.pan"), undefined);
  assert.strictEqual(getPath(null, "kyc.pan"), undefined);
});

t("setPath creates intermediate objects", () => {
  const o: any = {};
  setPath(o, "emergencyContact.phone", "+91");
  assert.strictEqual(o.emergencyContact.phone, "+91");
});

t("the diff reports only what actually changes", () => {
  const d = caseWith({ firstName: "Priya", pan: "ABCDE1234F" });
  const changes = diffAgainstEmployee(d, { firstName: "Priya", kyc: { pan: "OLDPA1234N" } });
  assert.strictEqual(changes.length, 1, "an unchanged name should not appear in the diff");
  assert.strictEqual(changes[0].path, "kyc.pan");
  assert.strictEqual(changes[0].from, "OLDPA1234N");
  assert.strictEqual(changes[0].to, "ABCDE1234F");
});

t("a blank answer never overwrites an existing value", () => {
  const d = caseWith({ firstName: "", pan: "" });
  assert.deepStrictEqual(diffAgainstEmployee(d, { firstName: "Priya", kyc: { pan: "ABCDE1234F" } }), []);
});

t("an unmapped custom field never reaches the employee record", () => {
  const d = caseWith({ firstName: "Priya", pan: "ABCDE1234F", tshirt: "L" });
  const { patch } = buildEmployeePatch(d, {});
  assert.strictEqual(patch.tshirt, undefined, "a custom question must stay on the case");
  assert.strictEqual(JSON.stringify(patch).includes("tshirt"), false);
});

// This is the bug the storage model invites: kyc is ONE jsonb blob, so writing kyc.pan
// naively would drop the siblings, and nothing would error because it is schemaless.
t("writing one nested key preserves its siblings", () => {
  const d = caseWith({ firstName: "Priya", pan: "ABCDE1234F" });
  const employee = { firstName: "Priya", kyc: { pan: "OLDPA1234N", aadhaar: "123456789012", uan: "100200300400" } };
  const { patch } = buildEmployeePatch(d, employee);
  assert.strictEqual(patch.kyc.pan, "ABCDE1234F");
  assert.strictEqual(patch.kyc.aadhaar, "123456789012", "aadhaar was dropped by a PAN update");
  assert.strictEqual(patch.kyc.uan, "100200300400", "uan was dropped by a PAN update");
});

t("a repeating section replaces its array rather than appending", () => {
  const d = buildCaseData(TPL, {});
  d.sections.history.rows = [{ id: "r1", employer: "Acme", fromDate: "2020-01-01" }];
  d.sections.history.updatedAt = new Date().toISOString();
  const { patch } = buildEmployeePatch(d, { employmentHistory: [{ id: "old", employer: "Old Co" }] });
  assert.strictEqual(patch.employmentHistory.length, 1);
  assert.strictEqual(patch.employmentHistory[0].employer, "Acme");
  assert.ok(patch.employmentHistory[0].verified, "committed history should be marked verified");
});

// Silent data loss, and the reason the `touched` check exists: an existing employee runs a
// data-collection campaign, never opens the optional "previous employment" section, and
// approval would otherwise replace their real history with an empty array. Nothing would
// error, because the column is jsonb.
t("an UNTOUCHED optional repeating section never wipes existing history", () => {
  const d = buildCaseData(TPL, {});
  d.sections.personal.values = { firstName: "Priya", pan: "ABCDE1234F" };
  const employee = { firstName: "Priya", employmentHistory: [{ id: "h1", employer: "Acme" }, { id: "h2", employer: "Globex" }] };
  const { patch, changes } = buildEmployeePatch(d, employee);
  assert.strictEqual(patch.employmentHistory, undefined, "an unopened section must not write");
  assert.ok(!changes.some((c: any) => c.path === "employmentHistory"));
});

t("but deliberately clearing the last row IS honoured", () => {
  const d = buildCaseData(TPL, {});
  d.sections.history = applySectionValues(TPL.sections[1], d.sections.history as any, { rows: [] }, "u1").state;
  const { patch, changes } = buildEmployeePatch(d, { employmentHistory: [{ id: "h1", employer: "Acme" }] });
  assert.deepStrictEqual(patch.employmentHistory, [], "an explicit edit to empty should apply");
  assert.strictEqual(changes!.find((c: any) => c.path === "employmentHistory")!.from, 1);
});

// Idempotency falls out of computing the patch as a DIFF against current state rather
// than blindly writing the answers: once applied, there is nothing left that differs, so a
// replayed approval is a no-op instead of a second identical write.
t("committing twice is a no-op the second time", () => {
  const d = caseWith({ firstName: "Priya", pan: "ABCDE1234F" });
  const employee = { kyc: { aadhaar: "123456789012" } };

  const first = buildEmployeePatch(d, employee);
  assert.strictEqual(first.changes.length, 2);
  assert.strictEqual(first.patch.kyc.pan, "ABCDE1234F");
  assert.strictEqual(first.patch.kyc.aadhaar, "123456789012", "the sibling must survive the write");

  const after = { ...employee, ...first.patch };
  const second = buildEmployeePatch(d, after);
  assert.deepStrictEqual(second.changes, [], "replaying an approval must change nothing");
  assert.deepStrictEqual(second.patch, {});
  assert.strictEqual(after.kyc.aadhaar, "123456789012");
});

t("the diff and the commit never disagree about what changes", () => {
  const d = caseWith({ firstName: "Meera", pan: "ABCDE1234F" });
  const employee = { firstName: "Priya", kyc: { pan: "OLDPA1234N" } };
  const shown = diffAgainstEmployee(d, employee).map((c: any) => c.path).sort();
  const applied = buildEmployeePatch(d, employee).changes
    .filter((c: any) => !["employmentHistory", "education", "dependents"].includes(c.path))
    .map((c: any) => c.path).sort();
  assert.deepStrictEqual(applied, shown);
});

import { dueReminders, offsetKey, readSettings, DEFAULT_SETTINGS } from "../../src/jobs/reminders/onboarding";

const DUE = "2026-09-10T00:00:00.000Z";
const at = (iso: string) => new Date(iso);
const kase = (over: any = {}) => ({ dueAt: DUE, reminderOffsets: [-3, -1, 1], remindersSent: [], escalateAfterDays: 3, ...over });

t("offsetKey reads as a schedule, not a number", () => {
  assert.strictEqual(offsetKey(-3), "T-3");
  assert.strictEqual(offsetKey(1), "T+1");
});

t("a case with no deadline is never due", () => {
  const v = dueReminders(kase({ dueAt: null }), at("2027-01-01T10:00:00Z"));
  assert.strictEqual(v.send, null);
  assert.strictEqual(v.escalate, false);
});

t("nothing fires before the first offset", () => {
  const v = dueReminders(kase(), at("2026-09-05T10:00:00Z")); // 5 days out, first offset is 3
  assert.deepStrictEqual(v.due, []);
  assert.strictEqual(v.send, null);
});

t("T-3 fires three days before", () => {
  const v = dueReminders(kase(), at("2026-09-07T10:00:00Z"));
  assert.deepStrictEqual(v.due, [-3]);
  assert.strictEqual(v.send, -3);
});

t("an already-sent offset never fires twice", () => {
  const v = dueReminders(kase({ remindersSent: ["T-3"] }), at("2026-09-07T10:00:00Z"));
  assert.deepStrictEqual(v.due, []);
  assert.strictEqual(v.send, null);
});

// The case that matters: a case left unswept over a long weekend, or created with a
// deadline already past, has several offsets due at once. Sending them all would land
// three emails in the same second.
t("several offsets due at once send ONE email but mark them all", () => {
  const v = dueReminders(kase(), at("2026-09-12T10:00:00Z")); // past T-3, T-1 and T+1
  assert.deepStrictEqual(v.due, [-3, -1, 1], "all three should be recognised as due");
  assert.strictEqual(v.send, 1, "only the latest should actually send");
});

t("the skipped offsets do not come back on the next sweep", () => {
  const first = dueReminders(kase(), at("2026-09-12T10:00:00Z"));
  const marked = first.due.map(offsetKey);
  const second = dueReminders(kase({ remindersSent: marked }), at("2026-09-13T10:00:00Z"));
  assert.deepStrictEqual(second.due, [], "a swept case must go quiet");
});

t("escalation waits for the grace period, then fires once", () => {
  assert.strictEqual(dueReminders(kase(), at("2026-09-12T10:00:00Z")).escalate, false, "2 days past due is too early");
  assert.strictEqual(dueReminders(kase(), at("2026-09-13T10:00:00Z")).escalate, true, "3 days past due should escalate");
  assert.strictEqual(dueReminders(kase({ remindersSent: ["ESCALATED"] }), at("2026-09-20T10:00:00Z")).escalate, false);
});

t("escalation can be switched off with 0", () => {
  assert.strictEqual(dueReminders(kase({ escalateAfterDays: 0 }), at("2027-01-01T10:00:00Z")).escalate, false);
});

t("a case with no offsets configured still gets a sensible default schedule", () => {
  const v = dueReminders(kase({ reminderOffsets: [] }), at("2026-09-09T10:00:00Z"));
  assert.ok(v.due.length > 0, "an empty schedule should fall back, not go silent");
});

t("reminders default to ON, unlike clock-in reminders", () => {
  assert.strictEqual(readSettings({}).enabled, true);
  assert.strictEqual(readSettings({ reminders: { onboarding: { enabled: false } } }).enabled, false);
  assert.strictEqual(DEFAULT_SETTINGS.expireAfterDays, 0, "cases should not expire by default");
});

t("settings fall back to sane values when the stored blob is junk", () => {
  const s = readSettings({ reminders: { onboarding: { time: "25:99", workingDays: [], timezone: "" } } });
  assert.strictEqual(s.time, "10:00");
  assert.deepStrictEqual(s.workingDays, [1, 2, 3, 4, 5]);
  assert.strictEqual(s.timezone, "Asia/Kolkata");
});

/**
 * The templates are rendered directly here rather than asserted on in the e2e, because mail
 * produced through the job queue is only observable if THIS process is the one that ran the
 * job, and on a shared database that is a race. Rendering the pure function instead makes the
 * two things that actually matter, the link and the deadline, deterministic.
 */
import { onboardingRequestEmail, onboardingReminderEmail, onboardingOverdueEmail, onboardingEscalationEmail, onboardingChangesRequestedEmail, onboardingApprovedEmail } from "../../src/integrations/mail/templates";

const ORG = { name: "Acme Robotics", slug: "acme" };
const EMP = { firstName: "Ana", lastName: "Alpha", code: "SC-1", officialEmail: "ana@example.com" };
const MGR = { firstName: "Ben", lastName: "Beta", officialEmail: "ben@example.com" };
const PORTAL = "https://hrms.example.com";
// 31 August 2026, chosen so the rendered en-GB form ("31 August 2026") differs from the ISO
// form. An assertion that passes for both proves nothing about what the reader sees.
const MAIL_DUE = "2026-08-31T00:00:00.000Z";

t("every employee-facing onboarding email links to the self-onboarding portal", () => {
  const mails = [
    onboardingRequestEmail({ org: ORG, employee: EMP, dueAt: MAIL_DUE, portalUrl: PORTAL }),
    onboardingReminderEmail({ org: ORG, employee: EMP, dueAt: MAIL_DUE, portalUrl: PORTAL }),
    onboardingOverdueEmail({ org: ORG, employee: EMP, dueAt: MAIL_DUE, portalUrl: PORTAL }),
    onboardingChangesRequestedEmail({ org: ORG, employee: EMP, sectionTitle: "Bank", note: "Blurry", portalUrl: PORTAL }),
  ];
  for (const m of mails) {
    assert.ok(m.html.includes(`${PORTAL}/onboarding/me`), `no portal deep link in: ${m.subject}`);
    assert.strictEqual(m.to, "ana@example.com");
  }
});

t("the deadline is spelled out for a human, not left as an ISO timestamp", () => {
  for (const m of [
    onboardingRequestEmail({ org: ORG, employee: EMP, dueAt: MAIL_DUE, portalUrl: PORTAL }),
    onboardingReminderEmail({ org: ORG, employee: EMP, dueAt: MAIL_DUE, portalUrl: PORTAL }),
    onboardingOverdueEmail({ org: ORG, employee: EMP, dueAt: MAIL_DUE, portalUrl: PORTAL }),
  ]) {
    assert.ok(m.html.includes("31 August 2026"), `no readable deadline in: ${m.subject}`);
    assert.ok(!m.html.includes("2026-08-31"), `leaked a raw timestamp in: ${m.subject}`);
  }
});

t("a request with no deadline still sends, without an empty due row", () => {
  const m = onboardingRequestEmail({ org: ORG, employee: EMP, dueAt: null, portalUrl: PORTAL });
  assert.ok(m.html.includes(`${PORTAL}/onboarding/me`));
  assert.ok(!/Please complete by/.test(m.html), "rendered an empty deadline row");
});

t("escalation goes to the manager and names the person, not the manager", () => {
  const m = onboardingEscalationEmail({ org: ORG, manager: MGR, employee: EMP, dueAt: MAIL_DUE, portalUrl: PORTAL });
  assert.strictEqual(m.to, "ben@example.com", "escalation must not go to the employee");
  assert.ok(m.subject.includes("Ana Alpha"));
  // The manager needs the HR review screen, not the employee's own form.
  assert.ok(m.html.includes(`${PORTAL}/onboarding`) && !m.html.includes(`${PORTAL}/onboarding/me`));
});

t("HR's message and note are escaped, so a form cannot inject markup into an email", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const req = onboardingRequestEmail({ org: ORG, employee: EMP, dueAt: MAIL_DUE, portalUrl: PORTAL, message: evil });
  const chg = onboardingChangesRequestedEmail({ org: ORG, employee: EMP, sectionTitle: evil, note: evil, portalUrl: PORTAL });
  for (const m of [req, chg]) {
    // Assert on what makes the payload dangerous, the unescaped angle bracket, NOT on the
    // substring "onerror=": that survives escaping as inert text and would pass either way.
    assert.ok(!m.html.includes("<img"), `unescaped tag in: ${m.subject}`);
    assert.ok(m.html.includes("&lt;img"), `expected the tag to be escaped, not dropped, in: ${m.subject}`);
  }
});

t("a name with markup in it cannot inject through the heading or the preview text", () => {
  // The title renders in an <h1> in the VISIBLE body as well as the <title> tag, so this is
  // the sharper of the two paths: the preheader is hidden, the heading is not.
  const evil = { firstName: '<script>x</script>', officialEmail: "ana@example.com" };
  for (const m of [
    onboardingRequestEmail({ org: ORG, employee: evil, dueAt: MAIL_DUE, portalUrl: PORTAL }),
    onboardingReminderEmail({ org: ORG, employee: evil, dueAt: MAIL_DUE, portalUrl: PORTAL }),
  ]) {
    assert.ok(!m.html.includes("<script>"), `unescaped tag reached the markup in: ${m.subject}`);
    assert.ok(m.html.includes("&lt;script&gt;"), `expected an escaped heading in: ${m.subject}`);
  }
});

t("an apostrophe in a name is escaped once, not twice", () => {
  // The regression risk of escaping centrally: a caller that also escaped its own title would
  // turn O'Brien into O&amp;#39;Brien. Every caller now passes raw, so this must hold.
  const m = onboardingRequestEmail({
    org: ORG, employee: { firstName: "O'Brien", officialEmail: "o@example.com" },
    dueAt: MAIL_DUE, portalUrl: PORTAL,
  });
  assert.ok(m.html.includes("O&#39;Brien"), "expected a single-escaped name");
  assert.ok(!m.html.includes("&amp;#39;"), "name was double-escaped");
});

t("a trailing slash on the portal URL does not produce a double slash", () => {
  const m = onboardingRequestEmail({ org: ORG, employee: EMP, dueAt: MAIL_DUE, portalUrl: PORTAL + "/" });
  assert.ok(m.html.includes(`${PORTAL}/onboarding/me`));
  assert.ok(!m.html.includes("//onboarding/me"));
});

t("the approval email confirms rather than asking for anything else", () => {
  const m = onboardingApprovedEmail({ org: ORG, employee: EMP, portalUrl: PORTAL });
  assert.strictEqual(m.to, "ana@example.com");
  assert.ok(/approved|complete|thank/i.test(m.subject + m.html));
});

t("OPEN_STATUSES are the ones a person can still edit", () => {
  assert.deepStrictEqual(OPEN_STATUSES, ["NOT_STARTED", "IN_PROGRESS", "CHANGES_REQUESTED"]);
  assert.ok(!OPEN_STATUSES.includes("APPROVED"));
  assert.ok(!OPEN_STATUSES.includes("SUBMITTED"));
});

t("every pattern compiles and its hint is non-empty", () => {
  for (const [key, p] of Object.entries(PATTERNS) as any) {
    new RegExp(p.regex);
    assert.ok(p.hint && p.label, `${key} is missing a hint or label`);
  }
});
