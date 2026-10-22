/**
 * Letters: offer, confirmation, probation extension, relieving, appraisal and the on-demand
 * letters (experience, termination, superannuation...), each rendered to PDF, filed as a
 * private document, optionally verifiable by QR, and emailed to the person it is about.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden, round2, HttpError } from "../core/util";
import {
  offerLetter, relievingLetter, appraisalLetter, confirmationLetter, probationExtensionLetter,
  experienceLetter, terminationLetter, retirementLetter,
} from "../domain/letters";
import { notifyAndEmail } from "./notification.service";
import { letterIssuedEmail } from "../integrations/mail/templates";
import { PORTAL_URL } from "../core/config";
import { probationEndDate } from "../domain/letter-tokens";
import { issueVerification, type VerifiableKind } from "../security/verification";
import * as storage from "../integrations/storage";
import { fullName } from "../domain/person";

/**
 * The employee a letter is about, their organisation and department.
 *
 * The scope check lives here so every per-employee letter route gets it: the offer,
 * confirmation, probation, relieving and appraisal routes once skipped it, which let a
 * department-scoped HR user issue (and, for appraisals, apply salary changes) for anyone.
 */
async function subject(ctx: RequestContext, employeeId: string) {
  const e: any = await ctx.data.employees.byId(employeeId);
  if (!e) throw notFound("Employee not found");
  if (!ctx.inScope(e)) throw forbidden("Outside your assigned scope");
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const dept = e.departmentId ? await ctx.data.departments.byId(e.departmentId) : null;
  return { e, org, dept };
}

/**
 * Issue a verification record for a letter about to be rendered.
 *
 * Called BEFORE generation so the QR, reference and content digest can be
 * printed onto the PDF itself. `facts` are hashed; `disclose` names the ones
 * safe to show on the public page, for employment letters the dates and
 * designation are the whole point of the check, so those are disclosed, while
 * compensation never is.
 */
async function issueForLetter(
  ctx: RequestContext, employee, kind: VerifiableKind, facts: Record<string, unknown>, disclose: string[] = []
) {
  const org: any = await ctx.data.organizations.byId(ctx.orgId);
  return issueVerification({
    kind,
    orgId: org.id,
    orgName: org.name,
    employeeId: employee.id,
    subjectName: `${employee.firstName} ${employee.lastName || ""}`.trim(),
    subjectCode: employee.code || null,
    facts,
    disclose,
    issuedBy: ctx.user.id,
  });
}

/** Save a generated letter as a (private) document so it's listed + downloadable. */
async function saveLetterDoc(ctx: RequestContext, employeeId, title, category, file, verification: any = null) {
  await storage.putBuffer("letters", file.fileName, file.buffer, "application/pdf");
  return ctx.data.documents.create({
    employeeId,
    title,
    category,
    visibility: "PRIVATE",
    storage: "letters",
    filename: file.fileName,
    originalName: title.replace(/[^\w-]+/g, "_") + ".pdf",
    uploadedBy: ctx.user.id,
    verifyCode: verification?.code ?? null,
    verifyUrl: verification?.url ?? null,
    verifyDigest: verification?.digest ?? null,
  });
}

/**
 * Send the letter to the person it is about, with the PDF attached.
 *
 * Letters were filed to the portal and nothing was sent, so an employee had no way of
 * knowing one existed. Attached rather than linked because the whole point of most of these
 * is to forward them to a bank, a landlord or a future employer, and a link behind a login
 * cannot be forwarded. On by default; `email: false` in the request body files it silently.
 */
async function emailLetter(ctx: RequestContext, body: any, employee, letterLabel, file, note?: string) {
  if (body?.email === false) return null;
  const org = await ctx.data.organizations.byId(ctx.orgId);
  return notifyAndEmail(
    ctx.repos, org, employee.id,
    { type: "DOCUMENT", title: `${letterLabel} issued`, body: "A letter has been issued to you.", link: "mydocs" },
    { email: true, ...letterIssuedEmail({
      org, name: employee.firstName, to: undefined,
      letterLabel, note, filename: file.fileName, buffer: file.buffer, portalUrl: PORTAL_URL,
    }) }
  );
}


/** The first argument that parses as a number, else 0. */
const num = (...v) => { for (const x of v) if (x !== undefined && x !== null && x !== "" && !Number.isNaN(Number(x))) return Number(x); return 0; };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Issue offer letters for many people.
 * Body: { employeeIds: string[] }, or omit to cover everyone currently in
 * ONBOARDING who has no offer letter on file yet.
 *
 * Generating these one employee at a time is the reason a joining class of
 * thirty never gets its paperwork. Letters are produced sequentially rather
 * than in parallel because each one renders a PDF, and a burst of thirty
 * concurrent renders is a good way to exhaust memory on a small dev box.
 */
export async function issueOfferLettersBulk(ctx: RequestContext, body: any) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const all = await ctx.data.employees.all();

  let targets = all;
  if (Array.isArray(body?.employeeIds) && body.employeeIds.length) {
    const wanted = new Set(body.employeeIds);
    targets = all.filter((e) => wanted.has(e.id));
  } else {
    targets = all.filter((e) => e.status === "ONBOARDING");
  }
  targets = targets.filter((e) => ctx.inScope(e));

  // Skip anyone who already has one, re-issuing silently would leave two
  // offer letters on file with different dates.
  const existing = await ctx.data.documents.ofCategory("OFFER_LETTER");
  const have = new Set(existing.map((d) => d.employeeId));

  const issued: string[] = [];
  const skipped: { employeeId: string; reason: string }[] = [];
  const failed: { employeeId: string; error: string }[] = [];

  for (const e of targets) {
    if (have.has(e.id)) { skipped.push({ employeeId: e.id, reason: "Already has an offer letter" }); continue; }
    if (!e.salary || !Number(e.salary.basic)) { skipped.push({ employeeId: e.id, reason: "No salary on record" }); continue; }
    try {
      const dept = e.departmentId ? await ctx.data.departments.byId(e.departmentId) : null;
      const verification = await issueForLetter(ctx, e, "OFFER_LETTER", {
        designation: e.designation || "",
        department: dept ? dept.name : "",
        joiningDate: e.joiningDate || "",
        employmentType: e.employmentType || "",
        employeeCode: e.code || "",
      }, ["designation", "department", "joiningDate", "employmentType"]);
      const file = await offerLetter({ org, employee: e, dept, verification });
      await saveLetterDoc(ctx, e.id, `Offer Letter - ${e.firstName} ${e.lastName || ""}`.trim(), "OFFER_LETTER", file, verification);
      issued.push(e.id);
    } catch (err) {
      // One bad record must not abandon the rest of the batch.
      failed.push({ employeeId: e.id, error: (err as Error).message });
    }
  }

  await ctx.data.auditLog.create({
    action: "OFFER_LETTERS_BULK",
    userId: ctx.user.id,
    meta: { issued: issued.length, skipped: skipped.length, failed: failed.length },
  });
  return { issued: issued.length, skipped, failed, employeeIds: issued };
}

/**
 * Letters that can be issued for one person on demand, outside any workflow.
 *
 * Every one of these was previously reachable only from the flow that happened to produce
 * it: a relieving letter needed an exit in progress, an experience certificate needed one
 * completing. Neither survives contact with what people actually ask for. A current employee
 * wants proof of employment for a visa or a loan, and somebody who left two years ago wants a
 * duplicate of a letter that predates this system entirely. Both are ordinary HR requests and
 * neither should require inventing a separation record.
 *
 * `dated` names the field that letter needs. `suggest` decides whether it is offered as
 * relevant to this person right now, which orders the picker without forbidding anything:
 * the letters are editable templates, so what a given letter may claim is the organisation's
 * call, not ours.
 */
const ISSUABLE = {
  EXPERIENCE_LETTER: {
    label: "Experience certificate", category: "EXPERIENCE_LETTER", gen: experienceLetter,
    verifiable: "EXPERIENCE_CERTIFICATE" as VerifiableKind, dated: "lastWorkingDay",
    suggest: (e) => e.status === "EXITED" || e.status === "NOTICE_PERIOD",
  },
  RELIEVING_LETTER: {
    label: "Relieving and experience letter", category: "RELIEVING_LETTER", gen: relievingLetter,
    verifiable: "RELIEVING_LETTER" as VerifiableKind, dated: "lastWorkingDay",
    suggest: (e) => e.status === "EXITED" || e.status === "NOTICE_PERIOD",
  },
  TERMINATION_LETTER: {
    label: "Termination letter", category: "TERMINATION_LETTER", gen: terminationLetter,
    verifiable: "TERMINATION_LETTER" as VerifiableKind, dated: "lastWorkingDay",
    suggest: (e) => e.status === "EXITED" || e.status === "NOTICE_PERIOD",
  },
  RETIREMENT_LETTER: {
    label: "Superannuation letter", category: "RETIREMENT_LETTER", gen: retirementLetter,
    verifiable: null, dated: "lastWorkingDay",
    suggest: (e) => e.status === "EXITED",
  },
  CONFIRMATION_LETTER: {
    label: "Confirmation of employment", category: "CONFIRMATION_LETTER", gen: confirmationLetter,
    verifiable: "CONFIRMATION_LETTER" as VerifiableKind, dated: "effectiveDate",
    suggest: (e) => e.status !== "EXITED" && !e.confirmedAt && Number(e.probationMonths || 0) > 0,
  },
  PROBATION_EXTENSION_LETTER: {
    label: "Probation extension", category: "PROBATION_EXTENSION_LETTER", gen: probationExtensionLetter,
    verifiable: "PROBATION_EXTENSION_LETTER" as VerifiableKind, dated: "effectiveDate",
    suggest: (e) => e.status !== "EXITED" && !e.confirmedAt && Number(e.probationMonths || 0) > 0,
  },
  /*
   * Listed here so there is ONE place to look for any letter, but issued by its own route.
   *
   * An appraisal letter is the only one that takes figures rather than a date: it needs the
   * revised salary, prints a before and after comparison, and can write the new figures back
   * to the employee. `form: "salary"` tells the picker to collect that instead of a date, and
   * the generic issue route refuses it rather than rendering a comparison against nothing.
   */
  APPRAISAL_LETTER: {
    label: "Appraisal and compensation revision", category: "APPRAISAL_LETTER", gen: null,
    verifiable: "APPRAISAL_LETTER" as VerifiableKind, dated: "effectiveDate", form: "salary",
    suggest: (e) => e.status !== "EXITED" && Number(e.salary?.basic || 0) > 0,
  },
};
const ISSUABLE_KINDS = Object.keys(ISSUABLE);

/**
 * The date a backdated letter should default to.
 *
 * For somebody who has left, the truthful answer lives on their separation record, so it is
 * preferred over anything derived. Falling back to today would silently print the wrong dates
 * on a letter about an exit that happened years ago, which is exactly the letter most likely
 * to be checked by a future employer.
 */
async function defaultLastWorkingDay(ctx: RequestContext, e) {
  const seps = await ctx.data.separations.where({ employeeId: e.id }).list();
  const withDate = seps.filter((s) => s.lastWorkingDay).sort((a, b) => (a.lastWorkingDay < b.lastWorkingDay ? 1 : -1));
  return withDate[0]?.lastWorkingDay || e.lastWorkingDay || e.exitDate || null;
}

/**
 * What can be issued for this person, what each one needs, and what has already been issued,
 * so the picker can lead with what fits their situation instead of listing everything flatly.
 */
export async function issuableLetters(ctx: RequestContext, employeeId: string) {
  const e = await ctx.data.employees.byId(employeeId);
  if (!e) throw notFound("Employee not found");
  if (!ctx.inScope(e)) throw forbidden("Outside your assigned scope");
  const docs = await ctx.data.documents.forEmployee(e.id);
  const lwd = await defaultLastWorkingDay(ctx, e);
  const confirmOn = probationEndDate(e.joiningDate, e.probationMonths);

  return {
    employeeId: e.id,
    name: `${e.firstName} ${e.lastName || ""}`.trim(),
    code: e.code,
    status: e.status,
    joiningDate: e.joiningDate || null,
    salary: e.salary || null,
    letters: ISSUABLE_KINDS.map((kind) => {
      const spec = ISSUABLE[kind];
      const issued = docs.filter((d) => d.category === spec.category)
        .sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : -1));
      return {
        kind,
        label: spec.label,
        dated: spec.dated,
        // "salary" means the picker collects revised figures instead of a single date.
        form: (spec as any).form || "date",
        suggested: spec.suggest(e),
        defaultDate: spec.dated === "lastWorkingDay" ? lwd : confirmOn,
        issuedCount: issued.length,
        lastIssuedAt: issued[0]?.createdAt || null,
        lastDocumentId: issued[0]?.id || null,
      };
    }),
  };
}

/**
 * Issue any of the on-demand letters for anybody, at any point, including long after they
 * left. Body: { kind, lastWorkingDay?, effectiveDate?, reason?, subReason?, email?, reissue? }
 *
 * Re-issuing is allowed but must be asked for, so a second click cannot quietly leave two
 * letters on file both looking equally current.
 */
export async function issueLetter(ctx: RequestContext, employeeId: string, body: any) {
  const kind = String(body?.kind || "");
  const spec = ISSUABLE[kind];
  if (!spec) throw bad(`"${kind}" is not a letter that can be issued on its own`);

  if ((spec as any).form === "salary") {
    throw bad("An appraisal letter needs the revised salary. Issue it from the appraisal form.");
  }

  const { e, org, dept } = await subject(ctx, employeeId);

  const existing = await ctx.data.documents.findForEmployee(e.id, spec.category);
  if (existing && !body?.reissue) {
    const label = spec.label.toLowerCase();
    throw new HttpError(409, JSON.stringify({
      code: "LETTER_ALREADY_ISSUED",
      message: `${/^[aeiou]/.test(label) ? "An" : "A"} ${label} has already been issued for ${e.firstName}. Re-issue to supersede it.`,
      documentId: existing.id,
    }));
  }

  // The date this letter turns on. Required rather than defaulted to today: a letter about
  // an exit that happened in 2023 must not silently claim it happened this morning.
  const supplied = String(body?.[spec.dated] || "").trim();
  const fallback = spec.dated === "lastWorkingDay"
    ? await defaultLastWorkingDay(ctx, e)
    : probationEndDate(e.joiningDate, e.probationMonths);
  const date = supplied || fallback;
  if (!date) {
    throw bad(
      spec.dated === "lastWorkingDay"
        ? "This letter states a last working day, and there is none on record. Enter the date they left."
        : "This letter states an effective date. Enter the date it takes effect."
    );
  }
  /*
   * A date before they joined would print an impossible service period.
   *
   * Backdating is the whole point of this route, so the date is not clamped to today, but a
   * letter reading "employed from 14 August 2026 to 31 March 2024" is worse than no letter:
   * it is the document a future employer checks, and it discredits every other letter the
   * organisation has issued.
   */
  if (e.joiningDate && date < e.joiningDate) {
    throw bad(
      `That date is before ${e.firstName} joined on ${e.joiningDate}. ` +
      `Check the date, or correct the joining date on their record.`
    );
  }

  const facts: Record<string, unknown> = {
    designation: e.designation || "",
    department: dept ? dept.name : "",
    joiningDate: e.joiningDate || "",
    employeeCode: e.code || "",
    [spec.dated]: date,
  };
  const verification = spec.verifiable
    ? await issueForLetter(ctx, e, spec.verifiable, facts, ["designation", "department", "joiningDate", spec.dated])
    : null;

  const file = await spec.gen({
    org, employee: e, dept, verification,
    lastWorkingDay: spec.dated === "lastWorkingDay" ? date : undefined,
    effectiveDate: spec.dated === "effectiveDate" ? date : undefined,
    reason: body?.reason || "",
    subReason: body?.subReason || null,
    forCause: false,
  });

  const title = `${spec.label} - ${e.firstName} ${e.lastName || ""}`.trim();
  const doc = await saveLetterDoc(ctx, e.id, title, spec.category, file, verification);
  const mail = await emailLetter(ctx, body, e, spec.label, file);
  await ctx.data.auditLog.create({
    action: "LETTER_ISSUED",
    userId: ctx.user.id,
    meta: { employeeId: e.id, kind, date, documentId: doc.id, reissue: !!body?.reissue },
  });
  return { ok: true, documentId: doc.id, kind, date, mail };
}

/** Letter categories this router can issue, in the order HR thinks about them. */
const LETTER_CATEGORIES = ["OFFER_LETTER", "CONFIRMATION_LETTER", "APPRAISAL_LETTER", "RELIEVING_LETTER"] as const;

/**
 * Answers "was a letter generated for this person, and where is it".
 *
 * There was previously no way to tell: the router was POST-only, the tenant app never
 * called it, and the only trace of an issued letter was a row in the generic Documents
 * library that HR had to eyeball against the roster. That Document row is already the
 * de-facto status flag (the bulk offer route uses exactly it as its own idempotency
 * check), so this reports it directly instead of inventing new state. No schema change.
 *
 * Optional status (e.g. ONBOARDING) narrows the roster.
 */
export async function letterStatus(ctx: RequestContext, statusFilter?: any) {
  const [employees, docs, depts] = await Promise.all([
    ctx.data.employees.all(),
    ctx.data.documents.all(),
    ctx.data.departments.all(),
  ]);
  const deptById = Object.fromEntries(depts.map((d) => [d.id, d]));

  // employeeId -> category -> newest document
  const latest = new Map<string, Record<string, any>>();
  for (const d of docs) {
    if (!d.employeeId || !LETTER_CATEGORIES.includes(d.category as any)) continue;
    const forEmp = latest.get(d.employeeId) || {};
    const prev = forEmp[d.category as string];
    if (!prev || String(prev.createdAt) < String(d.createdAt)) forEmp[d.category as string] = d;
    latest.set(d.employeeId, forEmp);
  }

  const wanted = String(statusFilter || "").toUpperCase();
  const roster = employees
    .filter((e) => ctx.inScope(e))
    .filter((e) => (wanted ? e.status === wanted : true));

  // Does each issued letter still have its bytes? A row can outlive its file (storage
  // wiped, STORAGE switched from local to s3 without migrating, file removed by hand), and
  // the UI previously showed "Issued" with a download that could only ever 404. Checked
  // once per document here rather than leaving the client to discover it by failing.
  const existsCache = new Map<string, boolean>();
  const fileExists = async (d: any) => {
    if (!d?.filename) return false;
    const key = `${d.storage || "letters"}/${d.filename}`;
    if (!existsCache.has(key)) {
      existsCache.set(key, await storage.exists(d.storage || "letters", d.filename).catch(() => false));
    }
    return existsCache.get(key)!;
  };

  return Promise.all(roster.map(async (e) => {
    const forEmp = latest.get(e.id) || {};
    const letters: Record<string, any> = {};
    for (const cat of LETTER_CATEGORIES) {
      const d = forEmp[cat];
      letters[cat] = d
        ? {
            issued: true,
            documentId: d.id,
            issuedAt: d.createdAt,
            filename: d.filename,
            storage: d.storage,
            verifyUrl: d.verifyUrl || null,
            // Issued, but the file is gone: the UI should offer to issue it again rather
            // than a download that cannot succeed.
            fileMissing: !(await fileExists(d)),
          }
        : { issued: false };
    }
    return {
      employeeId: e.id,
      code: e.code,
      name: `${e.firstName} ${e.lastName || ""}`.trim(),
      status: e.status,
      department: e.departmentId && deptById[e.departmentId] ? deptById[e.departmentId].name : null,
      // Offer letters need a salary on record; surfacing it here stops the bulk run
      // from silently skipping people for a reason HR cannot see beforehand.
      hasSalary: !!(e.salary && Number(e.salary.basic)),
      letters,
    };
  }));
}

/**
 * Issue one offer letter.
 *
 * Re-issuing is allowed but must be asked for: without the guard this created a second
 * Document row every call, so an employee accumulated duplicate "offer letter" entries
 * that all looked equally current. Pass { reissue: true } to deliberately supersede.
 */
export async function issueOfferLetter(ctx: RequestContext, employeeId: string, body: any) {
  // Resolved (and scope-checked) first, so a caller outside scope learns nothing about
  // which letters are on file for this person.
  const { e, org, dept } = await subject(ctx, employeeId);
  const existingOffer = await ctx.data.documents.findForEmployee(e.id, "OFFER_LETTER");
  if (existingOffer && !body?.reissue) {
    throw bad("An offer letter already exists for this employee. Pass reissue:true to issue a new one.");
  }

  const verification = await issueForLetter(ctx, e, "OFFER_LETTER", {
    designation: e.designation || "",
    department: dept ? dept.name : "",
    joiningDate: e.joiningDate || "",
    employmentType: e.employmentType || "",
    employeeCode: e.code || "",
  }, ["designation", "department", "joiningDate", "employmentType"]);
  const file = await offerLetter({ org, employee: e, dept, verification });
  const doc = await saveLetterDoc(ctx, e.id, `Offer Letter - ${fullName(e)}`, "OFFER_LETTER", file, verification);
  const mail = await emailLetter(ctx, body, e, "Offer letter", file, "Please review it and return a signed copy to confirm your acceptance.");
  return { ok: true, documentId: doc.id, mail };
}

/**
 * Issued when probation completes successfully. Body: { effectiveDate?, confirm? }
 *
 * `effectiveDate` defaults to the date probation ends, derived from the joining date and
 * the probation length on record, so the ordinary case needs no input. `confirm: true` also
 * records the confirmation against the employee, which is what stops the same person
 * appearing on the "probation ending" list for a second time.
 */
export async function issueConfirmationLetter(ctx: RequestContext, employeeId: string, body: any) {
  const { e, org, dept } = await subject(ctx, employeeId);
  const effectiveDate =
    body?.effectiveDate || probationEndDate(e.joiningDate, e.probationMonths) || today();
  const verification = await issueForLetter(ctx, e, "CONFIRMATION_LETTER", {
    designation: e.designation || "",
    department: dept ? dept.name : "",
    joiningDate: e.joiningDate || "",
    effectiveDate,
    employeeCode: e.code || "",
  }, ["designation", "department", "joiningDate", "effectiveDate"]);
  const file = await confirmationLetter({ org, employee: e, dept, effectiveDate, verification });
  const doc = await saveLetterDoc(ctx, e.id, `Confirmation Letter - ${e.firstName} ${e.lastName || ""}`.trim(), "CONFIRMATION_LETTER", file, verification);
  const mail = await emailLetter(ctx, body, e, "Confirmation of employment", file);
  if (body?.confirm) {
    await ctx.data.employees.update(e.id, { confirmedAt: effectiveDate, onProbation: false });
    await ctx.data.auditLog.create({ action: "EMPLOYEE_CONFIRMED", userId: ctx.user.id, meta: { employeeId: e.id, effectiveDate } });
  }
  return { ok: true, documentId: doc.id, effectiveDate, confirmed: !!body?.confirm, mail };
}

/**
 * The other outcome of a probation review. Body: { effectiveDate?, extendByMonths? }
 *
 * `extendByMonths` lengthens the probation on record so the person reappears on the review
 * list at the new date rather than dropping off it silently.
 */
export async function issueProbationExtensionLetter(ctx: RequestContext, employeeId: string, body: any) {
  const { e, org, dept } = await subject(ctx, employeeId);
  const effectiveDate =
    body?.effectiveDate || probationEndDate(e.joiningDate, e.probationMonths) || today();
  const extendBy = Number(body?.extendByMonths || 0);
  if (extendBy && (extendBy < 1 || extendBy > 12)) throw bad("Extend probation by between 1 and 12 months");
  const verification = await issueForLetter(ctx, e, "PROBATION_EXTENSION_LETTER", {
    designation: e.designation || "",
    department: dept ? dept.name : "",
    joiningDate: e.joiningDate || "",
    effectiveDate,
    employeeCode: e.code || "",
  }, ["designation", "department", "joiningDate", "effectiveDate"]);
  const file = await probationExtensionLetter({ org, employee: e, dept, effectiveDate, verification });
  const doc = await saveLetterDoc(ctx, e.id, `Probation Extension - ${e.firstName} ${e.lastName || ""}`.trim(), "PROBATION_EXTENSION_LETTER", file, verification);
  const mail = await emailLetter(ctx, body, e, "Probation extension", file);
  if (extendBy) {
    await ctx.data.employees.update(e.id, { probationMonths: Number(e.probationMonths || 0) + extendBy });
    await ctx.data.auditLog.create({ action: "PROBATION_EXTENDED", userId: ctx.user.id, meta: { employeeId: e.id, extendBy } });
  }
  return { ok: true, documentId: doc.id, effectiveDate, extendedByMonths: extendBy, mail };
}

/**
 * People whose probation ends soon.
 *
 * Answers "who is due a confirmation decision", which nothing did before: probation length
 * was recorded at onboarding and then never surfaced anywhere, so confirmation happened
 * only when somebody remembered. `withinDays` (default 30) sets the horizon; already
 * confirmed people drop off.
 */
export async function probationDue(ctx: RequestContext, withinDaysRaw?: any) {
  const withinDays = Math.max(0, Math.min(365, Number(withinDaysRaw) || 30));
  const horizon = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
  const [employees, depts, docs] = await Promise.all([
    ctx.data.employees.all(),
    ctx.data.departments.all(),
    ctx.data.documents.all(),
  ]);
  const deptById = Object.fromEntries(depts.map((d) => [d.id, d]));
  const issued = new Set(
    docs.filter((d) => d.category === "CONFIRMATION_LETTER" || d.category === "PROBATION_EXTENSION_LETTER")
      .map((d) => `${d.employeeId}:${d.category}`)
  );

  return employees
    .filter((e) => ctx.inScope(e))
    .filter((e) => e.status !== "EXITED" && !e.confirmedAt && Number(e.probationMonths || 0) > 0)
    .map((e) => ({ e, endsOn: probationEndDate(e.joiningDate, e.probationMonths) }))
    .filter((r) => r.endsOn && r.endsOn <= horizon)
    .sort((a, b) => (a.endsOn! < b.endsOn! ? -1 : 1))
    .map(({ e, endsOn }) => ({
      employeeId: e.id,
      code: e.code,
      name: `${e.firstName} ${e.lastName || ""}`.trim(),
      designation: e.designation || null,
      department: e.departmentId && deptById[e.departmentId] ? deptById[e.departmentId].name : null,
      joiningDate: e.joiningDate || null,
      probationMonths: Number(e.probationMonths || 0),
      probationEndsOn: endsOn,
      overdue: endsOn! < today(),
      confirmationIssued: issued.has(`${e.id}:CONFIRMATION_LETTER`),
      extensionIssued: issued.has(`${e.id}:PROBATION_EXTENSION_LETTER`),
    }));
}

/** Relieving letter. Body: { lastWorkingDay, markExited } */
export async function issueRelievingLetter(ctx: RequestContext, employeeId: string, body: any) {
  const { e, org, dept } = await subject(ctx, employeeId);
  const lastWorkingDay = body.lastWorkingDay || today();
  const verification = await issueForLetter(ctx, e, "RELIEVING_LETTER", {
    designation: e.designation || "",
    department: dept ? dept.name : "",
    joiningDate: e.joiningDate || "",
    lastWorkingDay,
    employeeCode: e.code || "",
  }, ["designation", "department", "joiningDate", "lastWorkingDay"]);
  const file = await relievingLetter({ org, employee: e, dept, lastWorkingDay, verification });
  const doc = await saveLetterDoc(ctx, e.id, `Relieving Letter - ${fullName(e)}`, "RELIEVING_LETTER", file, verification);
  const mail = await emailLetter(ctx, body, e, "Relieving and experience letter", file);
  if (body.markExited) await ctx.data.employees.update(e.id, { status: "EXITED" });
  return { ok: true, documentId: doc.id, mail };
}

/**
 * Appraisal and compensation revision.
 * Body: { salary:{basic,hra,allowances,deductions}, effectiveDate, applyIncrement }
 */
export async function issueAppraisalLetter(ctx: RequestContext, employeeId: string, body: any) {
  const { e, org, dept } = await subject(ctx, employeeId);
  const previousSalary = { ...e.salary };
  const s = body.salary || {};
  const revised = {
    basic: num(s.basic, previousSalary.basic),
    hra: num(s.hra, previousSalary.hra),
    allowances: num(s.allowances, previousSalary.allowances),
    deductions: num(s.deductions, previousSalary.deductions),
  };
  const effectiveDate = body.effectiveDate || today();
  const verification = await issueForLetter(ctx, e, "APPRAISAL_LETTER", {
    designation: e.designation || "",
    department: dept ? dept.name : "",
    effectiveDate,
    revisedGross: revised.basic + revised.hra + revised.allowances,
    employeeCode: e.code || "",
  }, ["designation", "effectiveDate"]);
  const file = await appraisalLetter({ org, employee: { ...e, salary: revised }, dept, previousSalary, effectiveDate, verification });
  const doc = await saveLetterDoc(ctx, e.id, `Appraisal Letter - ${fullName(e)}`, "APPRAISAL_LETTER", file, verification);
  const mail = await emailLetter(ctx, body, e, "Appraisal and compensation revision", file);
  if (body.applyIncrement) await ctx.data.employees.update(e.id, { salary: revised });
  const prevAnnual = round2((previousSalary.basic + previousSalary.hra + previousSalary.allowances) * 12);
  const newAnnual = round2((revised.basic + revised.hra + revised.allowances) * 12);
  return {
    ok: true, documentId: doc.id, applied: !!body.applyIncrement, mail,
    previousAnnualCtc: prevAnnual, revisedAnnualCtc: newAnnual,
    incrementPct: prevAnnual ? round2(((newAnnual - prevAnnual) / prevAnnual) * 100) : 0,
  };
}
