/**
 * The document library: uploads, the searchable list, KYC completeness and verification.
 */
import path from "path";
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden, gone } from "../core/util";
import { isStaff } from "../middleware/auth";
import { scopedEmployeeIdsFor } from "./caller-scope";
import * as storage from "../integrations/storage";
import { extractDocument, isExtractable, EXTRACTABLE, aiConfig } from "../integrations/ai/document-extract";
import {
  DOC_CATEGORIES,
  KYC_CATEGORIES,
  VISIBILITIES,
  canRead,
  docCategoryLabel,
  isValidCategory,
  missingKyc,
  normalizeTags,
  normalizeVisibility,
  searchScore,
} from "../domain/documents";

/** An uploaded file as multer hands it over. */
export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const newName = (originalname) => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${path.extname(originalname)}`;

/** departmentIds arrives as an array (JSON) or a comma-separated string (multipart). */
const idList = (raw) => (Array.isArray(raw) ? raw : String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));

async function nameMap(ctx: RequestContext) {
  const emps = await ctx.data.employees.all();
  return Object.fromEntries(emps.map((e) => [e.id, `${e.firstName} ${e.lastName || ""}`.trim()]));
}
async function deptMap(ctx: RequestContext) {
  const depts = await ctx.data.departments.all();
  return Object.fromEntries(depts.map((d) => [d.id, d.name]));
}

/** The viewer's own department, needed to resolve DEPARTMENT-scoped documents. */
async function viewerContext(ctx: RequestContext) {
  let departmentId: string | null = null;
  if (ctx.user.employeeId) {
    const me = await ctx.data.employees.byId(ctx.user.employeeId);
    departmentId = me?.departmentId ?? null;
  }
  return { id: ctx.user.id, employeeId: ctx.user.employeeId, departmentId };
}

/** Attach the display fields the UI needs, in one pass. */
function decorate(d, names, depts) {
  const departmentIds = Array.isArray(d.departmentIds) ? d.departmentIds : [];
  return {
    ...d,
    visibility: normalizeVisibility(d.visibility),
    tags: Array.isArray(d.tags) ? d.tags : [],
    departmentIds,
    departmentNames: departmentIds.map((id) => depts[id]).filter(Boolean),
    categoryLabel: docCategoryLabel(d.category),
    employeeName: d.employeeId ? names[d.employeeId] || null : null,
  };
}

/** Decorate one document with freshly loaded name and department maps. */
async function decorateOne(ctx: RequestContext, d) {
  const [names, depts] = await Promise.all([nameMap(ctx), deptMap(ctx)]);
  return decorate(d, names, depts);
}

/** Categories, KYC set and visibility options for the UI. */
export function documentMeta() {
  return { categories: DOC_CATEGORIES, kyc: KYC_CATEGORIES, visibilities: VISIBILITIES };
}

/** Raw query-string filters, exactly as the client sent them. */
export interface DocumentFilters {
  q?: any;
  category?: any;
  departmentId?: any;
  employeeId?: any;
  tag?: any;
  visibility?: any;
  verified?: any;
}

/**
 * The searchable library.
 *
 * Staff see everything inside their RBAC scope. Employees see their own
 * documents plus anything published to their department or the whole org.
 */
export async function listDocuments(ctx: RequestContext, filters: DocumentFilters) {
  const [names, depts, viewer] = await Promise.all([nameMap(ctx), deptMap(ctx), viewerContext(ctx)]);
  let list = await ctx.data.documents.all();

  if (isStaff(ctx.user)) {
    // Scoped staff: only employee-linked docs for in-scope employees.
    // Library documents (no employeeId) stay visible to all staff.
    const inScope = await scopedEmployeeIdsFor(ctx); // null = org-wide
    if (inScope) list = list.filter((d) => !d.employeeId || inScope.has(d.employeeId));
  } else {
    list = list.filter((d) => canRead(d, viewer));
  }

  const { q, category, departmentId, employeeId, tag, visibility, verified } = filters;
  if (category) list = list.filter((d) => d.category === category);
  if (visibility) list = list.filter((d) => normalizeVisibility(d.visibility) === String(visibility).toUpperCase());
  if (departmentId) {
    list = list.filter((d) => (Array.isArray(d.departmentIds) ? d.departmentIds : []).includes(departmentId));
  }
  if (employeeId) {
    if (!isStaff(ctx.user) && employeeId !== ctx.user.employeeId) throw forbidden();
    list = list.filter((d) => d.employeeId === employeeId);
  }
  if (tag) {
    const t = String(tag).toLowerCase();
    list = list.filter((d) => (Array.isArray(d.tags) ? d.tags : []).some((x) => String(x).toLowerCase() === t));
  }
  if (verified === "true") list = list.filter((d) => !!d.verified);
  if (verified === "false") list = list.filter((d) => !d.verified);

  let decorated = list.map((d) => decorate(d, names, depts));

  if (q) {
    // Score first, then sort by relevance, a search result ordered by upload
    // date is not a search result.
    decorated = decorated
      .map((d) => ({ d, score: searchScore(d, String(q)) }))
      .filter((x) => x.score !== null)
      .sort((a, b) => (b.score as number) - (a.score as number))
      .map((x) => x.d);
  } else {
    decorated.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  return decorated;
}

/**
 * Which required KYC documents are missing.
 * Staff may ask about anyone in scope (?employeeId=); employees about themselves.
 */
export async function kycStatus(ctx: RequestContext, requestedEmployeeId?: any) {
  const employeeId = requestedEmployeeId || ctx.user.employeeId;
  if (!employeeId) throw bad("No employee to check");
  if (!isStaff(ctx.user) && employeeId !== ctx.user.employeeId) throw forbidden();
  const emp = await ctx.data.employees.byId(employeeId);
  if (!emp) throw notFound("Employee not found");
  if (!ctx.inScope(emp)) throw forbidden("Outside your assigned scope");

  const docs = await ctx.data.documents.forEmployee(employeeId);
  const missing = missingKyc(docs);
  const verifiedMissing = missingKyc(docs, { requireVerified: true });
  return {
    employeeId,
    uploaded: docs.length,
    missing,
    awaitingVerification: verifiedMissing.filter((m) => !missing.some((x) => x.value === m.value)),
    complete: missing.length === 0,
  };
}

/**
 * Upload one document.
 * Fields: title, category, description, tags, employeeId?, visibility, departmentIds
 */
export async function uploadDocument(ctx: RequestContext, file: UploadedFile | undefined, body: any) {
  if (!file) throw bad("A file is required");

  const category = String(body.category || "GENERAL").toUpperCase();
  if (!isValidCategory(category)) throw bad(`Unknown document category "${category}"`);

  let employeeId = body.employeeId || null;
  let visibility = normalizeVisibility(body.visibility);
  let departmentIds: string[] = [];

  if (!isStaff(ctx.user)) {
    // Employees only ever attach documents to themselves, privately.
    employeeId = ctx.user.employeeId;
    visibility = "PRIVATE";
  } else {
    if (visibility === "DEPARTMENT") {
      departmentIds = idList(body.departmentIds);
      if (!departmentIds.length) throw bad("Choose at least one department, or change the visibility");
      const known = new Set((await ctx.data.departments.all()).map((d) => d.id));
      const unknown = departmentIds.filter((id) => !known.has(id));
      if (unknown.length) throw bad(`Unknown department: ${unknown.join(", ")}`);
    }
    if (employeeId) {
      const emp = await ctx.data.employees.byId(employeeId);
      if (!emp) throw bad("Unknown employee");
      if (!ctx.inScope(emp)) throw forbidden("Outside your assigned scope");
    }
  }

  const filename = newName(file.originalname);
  await storage.putBuffer("uploads", filename, file.buffer, file.mimetype);
  const doc = await ctx.data.documents.create({
    employeeId,
    title: body.title || file.originalname,
    description: body.description || "",
    category,
    tags: normalizeTags(body.tags),
    visibility,
    departmentIds,
    storage: "uploads",
    filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    uploadedBy: ctx.user.id,
  });

  // Read the document with AI *after* it is safely stored, and never let a
  // provider failure cost the upload, extraction is a convenience, not a
  // precondition. Results are advisory and still require HR verification.
  let extraction: any = null;
  if (isExtractable(category)) {
    extraction = await extractDocument({
      buffer: file.buffer,
      mimeType: file.mimetype,
      category,
    });
    if (extraction.ok) {
      await ctx.data.documents.update(doc.id, {
        extraction: {
          provider: extraction.provider,
          model: extraction.model,
          at: new Date().toISOString(),
          // Only the normalised (and, for Aadhaar, masked) values are stored.
          fields: extraction.fields.map((f: any) => ({
            key: f.key, label: f.label, value: f.value, confidence: f.confidence, valid: f.valid,
          })),
          categoryMismatch: extraction.categoryMismatch ?? null,
        },
      });
    }
  }

  const saved = await ctx.data.documents.byId(doc.id);
  return { ...(await decorateOne(ctx, saved)), extraction };
}

/** What AI reading is available. */
export function extractionConfig() {
  const cfg = aiConfig();
  return {
    enabled: cfg.enabled,
    provider: cfg.provider,
    extractable: EXTRACTABLE,
    excluded: [...cfg.excluded],
  };
}

/** Staff: retitle, recategorise, re-scope, retag. */
export async function updateDocument(ctx: RequestContext, id: string, body: any) {
  if (!isStaff(ctx.user)) throw forbidden("Staff access required");
  const doc = await ctx.data.documents.byId(id);
  if (!doc) throw notFound("Document not found");

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title);
  if (body.description !== undefined) patch.description = String(body.description);
  if (body.tags !== undefined) patch.tags = normalizeTags(body.tags);
  if (body.category !== undefined) {
    const category = String(body.category).toUpperCase();
    if (!isValidCategory(category)) throw bad(`Unknown document category "${category}"`);
    patch.category = category;
  }
  if (body.visibility !== undefined) {
    const visibility = normalizeVisibility(body.visibility);
    patch.visibility = visibility;
    if (visibility === "DEPARTMENT") {
      const ids = idList(body.departmentIds);
      if (!ids.length) throw bad("Choose at least one department, or change the visibility");
      patch.departmentIds = ids;
    } else {
      patch.departmentIds = [];
    }
  } else if (body.departmentIds !== undefined) {
    patch.departmentIds = idList(body.departmentIds);
  }

  const updated = await ctx.data.documents.update(doc.id, patch);
  return decorateOne(ctx, updated);
}

/** Where a readable document's bytes live, for the controller to stream. */
export async function documentForDownload(ctx: RequestContext, id: string) {
  const doc = await ctx.data.documents.byId(id);
  if (!doc) throw notFound("Document not found");
  if (!isStaff(ctx.user) && !canRead(doc, await viewerContext(ctx))) throw forbidden();
  const prefix = doc.storage || "uploads";
  if (!(await storage.exists(prefix, doc.filename))) {
    // 410, not 404: the RECORD exists, its bytes do not. A bare 404 reached the UI as
    // "Request failed with status code 404" against a row that says "Issued", which tells
    // nobody what to do. This happens when storage is wiped, when a deploy switches
    // STORAGE=local to s3 without migrating the files, or when a file is removed by hand.
    // Generated documents can simply be re-issued, so say so.
    const reissuable = String(doc.category || "").endsWith("_LETTER") || doc.category === "PAYSLIP";
    throw gone(
      reissuable
        ? "The stored file for this document is missing. Issue it again to produce a fresh copy."
        : "The stored file for this document is missing. It may need to be uploaded again."
    );
  }
  return {
    prefix,
    filename: doc.filename as string,
    downloadName: doc.originalName,
    contentType: doc.mimeType || "application/pdf",
  };
}

/** Staff, or the owner of their own upload. */
export async function deleteDocument(ctx: RequestContext, id: string) {
  const doc = await ctx.data.documents.byId(id);
  if (!doc) throw notFound("Document not found");
  if (!isStaff(ctx.user) && doc.uploadedBy !== ctx.user.id) throw forbidden();
  await storage.remove(doc.storage || "uploads", doc.filename);
  await ctx.data.documents.remove(doc.id);
  return { ok: true };
}

/** Staff: mark a KYC/bank doc verified (or clear it with verified: false). */
export async function verifyDocument(ctx: RequestContext, id: string, body: any) {
  if (!isStaff(ctx.user)) throw forbidden("Staff access required");
  const doc = await ctx.data.documents.byId(id);
  if (!doc) throw notFound("Document not found");
  const verified = body.verified !== false;
  const updated = await ctx.data.documents.update(doc.id, {
    verified,
    verifiedBy: verified ? ctx.user.id : null,
    verifiedAt: verified ? new Date().toISOString() : null,
    verifyNote: body.note ? String(body.note) : "",
  });
  return decorateOne(ctx, updated);
}
