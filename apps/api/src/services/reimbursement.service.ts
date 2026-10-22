/**
 * Reimbursement claims: an employee submits one (with a receipt), HR or the
 * reporting manager approves or rejects it, and HR marks approved claims paid.
 */
import path from "path";
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden, round2 } from "../core/util";
import { isStaff } from "../middleware/auth";
import { notifyEmployee } from "./notification.service";
import { scopedEmployeeIdsFor } from "./caller-scope";
import storage from "../integrations/storage";
import { isManagerOf } from "../domain/manager";

const CATEGORIES = ["TRAVEL", "INTERNET_WFH", "EQUIPMENT", "FOOD", "CLIENT_MEETING", "TRAINING", "OTHER"];

/** An uploaded receipt, as the controller hands it over. */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

const withEmployee = (r, e) => ({ ...r, employeeName: e ? `${e.firstName} ${e.lastName || ""}`.trim() : "-", employeeCode: e ? e.code : "" });

async function withName(ctx: RequestContext, r) {
  return withEmployee(r, await ctx.data.employees.byId(r.employeeId));
}

async function managesEmployee(ctx: RequestContext, employeeId) {
  if (!ctx.user.employeeId) return false;
  const e = await ctx.data.employees.byId(employeeId);
  return isManagerOf(e, ctx.user.employeeId);
}

/** Staff: all; manager (scope=team): their reports'; employee: own. Newest first. */
export async function listClaims(ctx: RequestContext, filter: { scope?: string; employeeId?: string; status?: string }) {
  const emps = await ctx.data.employees.all();
  const map = Object.fromEntries(emps.map((e) => [e.id, e]));
  let list = await ctx.data.reimbursements.all();
  if (filter.scope === "team" && ctx.user.employeeId) {
    const ids = new Set(Object.values(map).filter((e) => isManagerOf(e, ctx.user.employeeId)).map((e) => e.id));
    list = list.filter((r) => ids.has(r.employeeId));
  } else if (!isStaff(ctx.user)) list = list.filter((r) => r.employeeId === ctx.user.employeeId);
  else if (filter.employeeId) list = list.filter((r) => r.employeeId === filter.employeeId);
  const inScope = await scopedEmployeeIdsFor(ctx); // null = org-wide
  if (inScope) list = list.filter((r) => inScope.has(r.employeeId));
  if (filter.status) list = list.filter((r) => r.status === filter.status);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return list.map((r) => withEmployee(r, map[r.employeeId]));
}

export async function submitClaim(
  ctx: RequestContext,
  input: { employeeId?: string; category?: string; amount?: unknown; expenseDate?: string; description?: string },
  file?: UploadedFile | null,
) {
  const employeeId = isStaff(ctx.user) && input.employeeId ? input.employeeId : ctx.user.employeeId;
  if (!employeeId) throw bad("Only employees can submit reimbursements");
  const amount = round2(input.amount);
  if (!amount || amount <= 0) throw bad("A positive amount is required");
  let receiptFilename: string | null = null;
  if (file) {
    receiptFilename = `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${path.extname(file.originalname)}`;
    await storage.putBuffer("uploads", receiptFilename, file.buffer, file.mimetype);
  }
  const r = await ctx.data.reimbursements.create({
    employeeId,
    category: CATEGORIES.includes(input.category as string) ? input.category : "OTHER",
    amount,
    expenseDate: input.expenseDate || new Date().toISOString().slice(0, 10),
    description: input.description || "",
    receiptFilename,
    receiptOriginalName: file ? file.originalname : null,
    status: "PENDING",
    decidedBy: null, decidedAt: null, note: "",
  });
  return withName(ctx, r);
}

/** Decide a claim: APPROVED|REJECTED (staff or the reporting manager) or PAID (staff only). */
export async function decideClaim(ctx: RequestContext, id: string, input: { decision?: string; note?: string }) {
  const r = await ctx.data.reimbursements.byId(id);
  if (!r) throw notFound("Claim not found");
  const manager = await managesEmployee(ctx, r.employeeId);
  if (!isStaff(ctx.user) && !ctx.can("reimbursements.manage") && !manager) throw forbidden("Only HR or the reporting manager can decide");
  // Scoped staff (non-manager) may only decide claims for in-scope employees.
  if (!manager && r.employeeId !== ctx.user.employeeId && !ctx.inScope(await ctx.data.employees.byId(r.employeeId)))
    throw forbidden("Outside your assigned scope");
  if (input.decision === "PAID" && !isStaff(ctx.user)) throw forbidden("Only HR can mark a claim paid");
  const decision = input.decision as string;
  if (!["APPROVED", "REJECTED", "PAID"].includes(decision)) throw bad("Invalid decision");
  if (decision === "PAID" && r.status !== "APPROVED") throw bad("Only approved claims can be marked paid");
  if ((decision === "APPROVED" || decision === "REJECTED") && r.status !== "PENDING") throw bad("Claim already decided");
  const updated = await ctx.data.reimbursements.update(r.id, {
    status: decision, decidedBy: ctx.user.id, decidedAt: new Date().toISOString(), note: input.note || r.note,
  });
  await notifyEmployee(ctx.repos, r.employeeId, { type: "REIMBURSEMENT", title: `Reimbursement ${decision.toLowerCase()}`, body: `Your claim was ${decision.toLowerCase()}.`, link: "myreimbursements" });
  return withName(ctx, updated);
}

/** Where a claim's receipt lives, after checking the caller may read it. */
export async function claimReceipt(ctx: RequestContext, id: string) {
  const r = await ctx.data.reimbursements.byId(id);
  if (!r) throw notFound("Claim not found");
  if (!isStaff(ctx.user) && r.employeeId !== ctx.user.employeeId) throw forbidden();
  if (!r.receiptFilename) throw notFound("No receipt attached");
  if (!(await storage.exists("uploads", r.receiptFilename))) throw notFound("Receipt missing in storage");
  return {
    prefix: "uploads",
    filename: r.receiptFilename as string,
    downloadName: (r.receiptOriginalName || "receipt") as string,
    contentType: (r.receiptMime || "application/octet-stream") as string,
  };
}

/** The applicant (or staff) cancels a pending claim. */
export async function cancelClaim(ctx: RequestContext, id: string) {
  const r = await ctx.data.reimbursements.byId(id);
  if (!r) throw notFound("Claim not found");
  if (!isStaff(ctx.user) && r.employeeId !== ctx.user.employeeId) throw forbidden();
  if (r.status !== "PENDING") throw bad("Only pending claims can be cancelled");
  await ctx.data.reimbursements.remove(r.id);
  return { ok: true };
}
