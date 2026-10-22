/**
 * Everything a person can DO to their own onboarding case, with no opinion about how they
 * proved who they are.
 *
 * There are two populations and they authenticate completely differently: an existing
 * employee signs in and is resolved from the session, a pre-hire candidate holds a token in
 * an emailed link and has no login at all (nor an `employees` row) until HR approves them.
 * The operations in between, though, are identical: save a section, upload a proof, declare
 * an asset, accept the policies, sign, submit.
 *
 * Keeping them here rather than in either router is what stops the two flows drifting. The
 * original pre-hire route was a separate one-shot form, and the result was two definitions of
 * "onboarding" that disagreed about resumability, documents, review and even how previous
 * employment was stored. The routers are now thin: resolve a case, call one of these.
 *
 * Nothing here may write to `employees`. Staging onto the case is the whole point; only
 * commitCase() in onboarding-service.ts crosses that line, and only on HR approval.
 */
import path from "path";
import { randomUUID as uuid } from "crypto";
import { bad, notFound } from "../core/util";
import * as storage from "../integrations/storage";
import { isValidCategory, docCategoryLabel } from "./documents";
import { applySectionValues, isRepeating, checkCase, canSubmit, OPEN_STATUSES } from "./onboarding-case";
import { ASSET_CATEGORIES, type Section } from "./onboarding-template";

/** Who is acting, and from where. Employee id is null for a pre-hire. */
export interface ActorContext {
  actorId: string;
  employeeId?: string | null;
  ip?: string;
  userAgent?: string;
}

export const ALLOWED_UPLOAD_MIME = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp",
]);
export const MAX_DOCS_PER_CASE = 60;
const MAX_DECLARED_ASSETS = 20;

const uploadName = (originalname: string) =>
  `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(originalname)}`;

export const sectionOf = (caseRow: any, key: string): Section => {
  const s = (caseRow.templateSnapshot || []).find((x: Section) => x.key === key);
  if (!s) throw notFound(`This form has no section "${key}"`);
  return s;
};

export function assertEditable(caseRow: any) {
  if (!OPEN_STATUSES.includes(caseRow.status)) {
    throw bad(
      caseRow.status === "SUBMITTED"
        ? "This form has been submitted and is with HR. You will be told if anything needs changing."
        : caseRow.status === "APPROVED"
          ? "This form has already been approved."
          : "This form is no longer open."
    );
  }
}

/** Opening a form is what moves it off NOT_STARTED; every write funnels through this. */
const touched = (caseRow: any) => (caseRow.status === "NOT_STARTED" ? "IN_PROGRESS" : caseRow.status);

/* ── Sections ───────────────────────────────────────────────────────────────────────── */

export async function saveSection(repos: any, caseRow: any, key: string, body: any, ctx: ActorContext) {
  assertEditable(caseRow);
  const section = sectionOf(caseRow, key);
  const { state, errors } = applySectionValues(
    section,
    caseRow.sections?.[section.key] || { status: "EMPTY", values: {} },
    isRepeating(section) ? { rows: body?.rows } : { values: body?.values },
    ctx.actorId
  );
  const updated = await repos.onboardingCases.update(caseRow.id, {
    sections: { ...caseRow.sections, [section.key]: state },
    status: touched(caseRow),
  });
  return { case: updated, errors };
}

/* ── Policies and declaration ───────────────────────────────────────────────────────── */

export async function acknowledgePolicies(repos: any, caseRow: any, policyIds: any, ctx: ActorContext) {
  assertEditable(caseRow);
  const ids = (Array.isArray(policyIds) ? policyIds : []).map(String).filter(Boolean);
  if (!ids.length) throw bad("Select the policies you accept");

  const known = new Set((await repos.policies.all()).map((p: any) => p.id));
  if (ids.some((id: string) => !known.has(id))) {
    throw bad("One of those policies no longer exists. Reload the page and try again.");
  }

  const already = new Set((caseRow.acknowledgments || []).map((a: any) => a.policyId));
  const now = new Date().toISOString();
  const added = ids.filter((id: string) => !already.has(id)).map((policyId: string) => ({
    policyId,
    acceptedAt: now,
    // Recorded because an acknowledgment is evidence: "they accepted the POSH policy" is
    // only worth something if it says when, and from where.
    ip: ctx.ip,
    userAgent: String(ctx.userAgent || "").slice(0, 300),
  }));

  return repos.onboardingCases.update(caseRow.id, {
    acknowledgments: [...(caseRow.acknowledgments || []), ...added],
    status: touched(caseRow),
  });
}

export async function signDeclaration(repos: any, caseRow: any, rawName: any, ctx: ActorContext) {
  assertEditable(caseRow);
  const fullName = String(rawName || "").trim();
  if (fullName.length < 2) throw bad("Type your full name to sign the declaration");
  return repos.onboardingCases.update(caseRow.id, {
    declaration: {
      fullName,
      acceptedAt: new Date().toISOString(),
      ip: ctx.ip,
      userAgent: String(ctx.userAgent || "").slice(0, 300),
    },
    status: touched(caseRow),
  });
}

/* ── Assets ─────────────────────────────────────────────────────────────────────────── */

const assetsSection = (caseRow: any): Section => {
  const s = (caseRow.templateSnapshot || []).find((x: Section) => x.kind === "ASSETS");
  if (!s) throw bad("This form does not ask about assets");
  return s;
};

/**
 * What HR has already issued to this person, for the acknowledge block.
 *
 * Resolved by employee for the roster, and by CASE for a joiner: a candidate has no
 * `employees` row until approval, so their day-one laptop is staged against the case instead.
 * Both are the same question ("what have we handed you?") asked of whichever id exists.
 */
export async function listCaseAssets(repos: any, caseRow: any, employeeId?: string | null) {
  // `caseId` lives in the assets `data` jsonb, not a hot column, so it cannot go through
  // repo.where() (which refuses unknown columns rather than silently matching nothing).
  const owned = employeeId
    ? await repos.assets.where({ employeeId }).list()
    : (await repos.assets.all()).filter((a: any) => a.caseId === caseRow.id);
  const issued = owned.filter((a: any) => a.status === "PROVISIONED");
  const done = new Map((caseRow.assets?.acknowledged || []).map((a: any) => [a.assetId, a]));
  return {
    issued: issued.map((a: any) => ({ ...a, acknowledgment: done.get(a.id) || null })),
    declared: caseRow.assets?.declared || [],
  };
}

export async function acknowledgeAsset(repos: any, caseRow: any, assetId: string, body: any, ctx: ActorContext) {
  assertEditable(caseRow);
  const asset = await repos.assets.byId(assetId);
  // Owned either by the person (roster) or by the case itself (joiner, no employee row yet).
  const ownsIt = ctx.employeeId
    ? asset?.employeeId === ctx.employeeId
    : !asset?.employeeId && asset?.caseId === caseRow.id;
  if (!asset || !ownsIt) throw notFound("Asset not found");

  const section = assetsSection(caseRow);
  if (section.assets?.mode === "DECLARE") throw bad("This form does not ask you to confirm issued assets");

  const received = body?.received !== false;
  const serial = String(body?.serial || "").trim();
  if (received && section.assets?.requireSerialConfirmation && !serial) {
    throw bad("Enter the serial number printed on the item");
  }

  // A serial that does not match is recorded as a discrepancy rather than refused. The person
  // holding the laptop is not the one who mistyped it into the register, and refusing their
  // answer just teaches them to type whatever gets accepted.
  const entry = {
    assetId: asset.id,
    received,
    serial,
    serialConfirmed: !!serial && serial.toLowerCase() === String(asset.serial || "").toLowerCase(),
    discrepancy: received && !!serial && serial.toLowerCase() !== String(asset.serial || "").toLowerCase(),
    condition: String(body?.condition || "").trim() || asset.condition || "Good",
    note: String(body?.note || "").slice(0, 500),
    at: new Date().toISOString(),
  };

  const rest = (caseRow.assets?.acknowledged || []).filter((a: any) => a.assetId !== asset.id);
  const updated = await repos.onboardingCases.update(caseRow.id, {
    assets: { ...(caseRow.assets || {}), acknowledged: [...rest, entry] },
    status: touched(caseRow),
  });
  return { case: updated, acknowledgment: entry };
}

export async function declareAsset(repos: any, caseRow: any, body: any) {
  assertEditable(caseRow);
  const section = assetsSection(caseRow);
  if (section.assets?.mode === "ACKNOWLEDGE") throw bad("This form does not take extra items");

  const category = String(body?.category || "OTHER").toUpperCase();
  const allowed = section.assets?.allowedCategories?.length ? section.assets.allowedCategories : ASSET_CATEGORIES;
  if (!allowed.includes(category)) throw bad(`Choose one of: ${allowed.join(", ")}`);

  const name = String(body?.name || "").trim();
  if (!name) throw bad("What is it? Give the item a name.");

  const declared = [...(caseRow.assets?.declared || [])];
  if (declared.length >= MAX_DECLARED_ASSETS) throw bad("That is as many items as this form takes");

  // PENDING, not APPROVED. Nothing a person types about an asset reaches the register until
  // HR says so; commitCase() skips anything not explicitly approved.
  const entry = {
    id: uuid(),
    category,
    name,
    serial: String(body?.serial || "").trim(),
    condition: String(body?.condition || "Good").trim(),
    receivedOn: String(body?.receivedOn || "").trim() || null,
    note: String(body?.note || "").slice(0, 500),
    status: "PENDING",
  };

  const updated = await repos.onboardingCases.update(caseRow.id, {
    assets: { ...(caseRow.assets || {}), declared: [...declared, entry] },
    status: touched(caseRow),
  });
  return { case: updated, asset: entry };
}

export async function removeDeclaredAsset(repos: any, caseRow: any, entryId: string) {
  assertEditable(caseRow);
  return repos.onboardingCases.update(caseRow.id, {
    assets: {
      ...(caseRow.assets || {}),
      declared: (caseRow.assets?.declared || []).filter((a: any) => a.id !== entryId),
    },
  });
}

/* ── Documents ──────────────────────────────────────────────────────────────────────── */

/**
 * Store an upload and tie it to the case.
 *
 * `employeeId` is null for a pre-hire, which is legitimate: the file is real, the person is
 * not an employee yet. commitCase() attaches these to the employee record it creates, which
 * is why the case id is stored on the document rather than inferred later.
 */
export async function attachDocument(
  repos: any, caseRow: any,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  rawCategory: any, rawSectionKey: any, ctx: ActorContext
) {
  assertEditable(caseRow);
  if (!file) throw bad("Choose a file to upload");
  if (!ALLOWED_UPLOAD_MIME.has(file.mimetype)) throw bad("Upload a PDF or a photo (JPG, PNG or HEIC)");

  const category = String(rawCategory || "").toUpperCase();
  if (!isValidCategory(category)) throw bad("Unknown document type");
  if ((caseRow.documents || []).length >= MAX_DOCS_PER_CASE) throw bad("That is as many files as this form takes");

  const sectionKey = String(rawSectionKey || "");
  if (sectionKey) sectionOf(caseRow, sectionKey); // 404s early rather than storing an orphan

  const filename = uploadName(file.originalname);
  await storage.putBuffer("uploads", filename, file.buffer, file.mimetype);
  const doc = await repos.documents.insert({
    employeeId: ctx.employeeId || null,
    title: docCategoryLabel(category),
    description: "",
    category,
    tags: [],
    visibility: "PRIVATE",
    departmentIds: [],
    storage: "uploads",
    filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    uploadedBy: ctx.actorId,
    caseId: caseRow.id,
    sectionKey,
  });

  // Re-uploading a category replaces the previous file on the case rather than stacking a
  // second one the reviewer has to choose between.
  const kept = (caseRow.documents || []).filter(
    (d: any) => !(d.category === category && d.sectionKey === sectionKey)
  );
  const updated = await repos.onboardingCases.update(caseRow.id, {
    documents: [...kept, { sectionKey, category, documentId: doc.id, uploadedAt: new Date().toISOString() }],
    status: touched(caseRow),
  });
  return { case: updated, document: { id: doc.id, category, originalName: doc.originalName } };
}

/* ── Submit ─────────────────────────────────────────────────────────────────────────── */

export async function submitCase(repos: any, caseRow: any, employmentType?: string | null) {
  assertEditable(caseRow);
  const verdict = canSubmit(checkCase(caseRow, employmentType));
  if (!verdict.ok) {
    throw bad(`Some sections still need attention: ${verdict.blocking.map((b) => b.title).join(", ")}.`);
  }
  const updated = await repos.onboardingCases.update(caseRow.id, {
    status: "SUBMITTED",
    submittedAt: new Date().toISOString(),
  });
  return { case: updated, warnings: verdict.warnings };
}
