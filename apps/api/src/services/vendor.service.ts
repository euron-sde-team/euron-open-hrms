/**
 * Vendors / consultants / providers, onboarding + billing.
 * HR onboards a vendor (optionally creating a VENDOR login). The vendor signs in
 * and raises bills/invoices (with an invoice attachment); HR approves / rejects /
 * marks them paid as part of accounts-payable / payroll processing.
 */
import path from "path";
import type { RequestContext } from "../core/context";
import { systemRepos } from "../repositories/base.repository";
import { bad, notFound, forbidden, round2, tempPassword, normalizeDate } from "../core/util";
import { PORTAL_URL } from "../core/config";
import { isStaff, hashPassword } from "../middleware/auth";
import { sendTenantMail } from "../integrations/mail/mailer";
import storage from "../integrations/storage";

const TYPES = ["VENDOR", "CONSULTANT", "PROVIDER", "CONTRACTOR"];

/** An uploaded invoice, as the controller hands it over. */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);

const billWithVendorM = (b, map) => {
  const v = map[b.vendorId];
  return { ...b, vendorName: v ? v.name : "-", vendorCode: v ? v.code : "", vendorType: v ? v.type : "" };
};

async function vendorMap(ctx: RequestContext) {
  const vs = await ctx.data.vendors.all();
  return Object.fromEntries(vs.map((v) => [v.id, v]));
}

async function billWithVendor(ctx: RequestContext, b) {
  const v = await ctx.data.vendors.byId(b.vendorId);
  return { ...b, vendorName: v ? v.name : "-", vendorCode: v ? v.code : "", vendorType: v ? v.type : "" };
}

function requireVendor(ctx: RequestContext) {
  if (!ctx.user.vendorId) throw forbidden("Vendor account required");
}

/* ── HR: manage vendors ───────────────────────────────────────────────────── */

/** Every vendor, newest first, with how many bills each has raised. */
export async function listVendors(ctx: RequestContext) {
  const list = (await ctx.data.vendors.all()).sort(newestFirst);
  const bills = await ctx.data.vendorBills.all();
  return list.map((v) => ({ ...v, billsTotal: bills.filter((b) => b.vendorId === v.id).length }));
}

export async function createVendor(ctx: RequestContext, b: Record<string, any>) {
  if (!b.name || !b.email) throw bad("Vendor name and email are required");
  if (!TYPES.includes(b.type)) throw bad("type must be VENDOR, CONSULTANT, PROVIDER or CONTRACTOR");
  const email = String(b.email).toLowerCase().trim();
  if (await systemRepos().users.where({ email }).one()) throw bad("A user with that email already exists");
  const code = `VEN-${1000 + (await ctx.data.vendors.count())}`;
  const vendor = await ctx.data.vendors.create({
    code, name: b.name, type: b.type, email, phone: b.phone || "",
    company: b.company || b.name, gstin: b.gstin || "", pan: b.pan || "",
    bank: { account: b.bankAccount || "", ifsc: b.bankIfsc || "", bankName: b.bankName || "", paypal: b.bankPaypal || "" },
    services: b.services || "", status: "ACTIVE",
  });
  let invite: any = null;
  if (b.sendInvite) invite = await createVendorLogin(ctx, vendor);
  return { vendor, invite };
}

export async function updateVendor(ctx: RequestContext, id: string, b: Record<string, any>) {
  const v = await ctx.data.vendors.byId(id);
  if (!v) throw notFound("Vendor not found");
  const patch: any = {};
  for (const k of ["name", "phone", "company", "gstin", "pan", "services", "status"]) if (b[k] !== undefined) patch[k] = b[k];
  if (b.type && TYPES.includes(b.type)) patch.type = b.type;
  if (b.bankAccount !== undefined || b.bankIfsc !== undefined || b.bankName !== undefined || b.bankPaypal !== undefined)
    patch.bank = { ...(v.bank || {}), account: b.bankAccount ?? v.bank.account, ifsc: b.bankIfsc ?? v.bank.ifsc, bankName: b.bankName ?? v.bank.bankName, paypal: b.bankPaypal ?? v.bank.paypal };
  return ctx.data.vendors.update(v.id, patch);
}

/** (Re)issue the vendor's portal login and mail them a temporary password. */
export async function inviteVendor(ctx: RequestContext, id: string) {
  const v = await ctx.data.vendors.byId(id);
  if (!v) throw notFound("Vendor not found");
  return { ok: true, invite: await createVendorLogin(ctx, v) };
}

async function createVendorLogin(ctx: RequestContext, vendor) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  if (!org) throw notFound("Organization not found");
  const pwd = tempPassword();
  const user = await ctx.data.users.where({ vendorId: vendor.id }).one(); // vendorId is a hot col (indexed)
  if (user) await ctx.data.users.update(user.id, { passwordHash: hashPassword(pwd) });
  else await ctx.data.users.create({ email: vendor.email, name: vendor.name, role: "VENDOR", vendorId: vendor.id, employeeId: null, passwordHash: hashPassword(pwd) });
  return await sendTenantMail(org, {
    to: vendor.email,
    subject: `${org.name} - Vendor portal access`,
    html: `<div style="font-family:Arial;max-width:560px">
      <h2 style="color:#0a66c2">${org.name} - Vendor portal</h2>
      <p>Hi ${vendor.name},</p>
      <p>You have been onboarded as a <b>${vendor.type.toLowerCase()}</b> for ${org.name}. You can sign in to raise
         and track your invoices/bills:</p>
      <table style="background:#eef3f8;border-radius:8px;width:100%">
        <tr><td style="padding:6px 10px">Portal</td><td style="padding:6px 10px"><a href="${PORTAL_URL}">${PORTAL_URL}</a></td></tr>
        <tr><td style="padding:6px 10px">Login</td><td style="padding:6px 10px"><b>${vendor.email}</b></td></tr>
        <tr><td style="padding:6px 10px">Temporary password</td><td style="padding:6px 10px"><b>${pwd}</b></td></tr>
      </table>
      <p>Regards,<br/>${org.name} Accounts</p></div>`,
  });
}

/* ── Bills ────────────────────────────────────────────────────────────────── */

/** HR: every bill, newest first, optionally filtered by status and vendor. */
export async function listBills(ctx: RequestContext, filter: { status?: string; vendorId?: string }) {
  const map = await vendorMap(ctx);
  let list = await ctx.data.vendorBills.all();
  if (filter.status) list = list.filter((b) => b.status === filter.status);
  if (filter.vendorId) list = list.filter((b) => b.vendorId === filter.vendorId);
  list.sort(newestFirst);
  return list.map((b) => billWithVendorM(b, map));
}

/** The signed-in vendor's own bills, newest first. */
export async function myBills(ctx: RequestContext) {
  requireVendor(ctx);
  const map = await vendorMap(ctx);
  const list = (await ctx.data.vendorBills.forVendor(ctx.user.vendorId)).sort(newestFirst);
  return list.map((b) => billWithVendorM(b, map));
}

/** The signed-in vendor's own profile. */
export async function myProfile(ctx: RequestContext) {
  requireVendor(ctx);
  return ctx.data.vendors.byId(ctx.user.vendorId);
}

/** A vendor raises a bill (HR may raise one on a vendor's behalf by passing vendorId). */
export async function raiseBill(ctx: RequestContext, input: Record<string, any>, file?: UploadedFile | null) {
  const vendorId = isStaff(ctx.user) && input.vendorId ? input.vendorId : ctx.user.vendorId;
  if (!vendorId) throw forbidden("Vendor account required");
  const vendor = await ctx.data.vendors.byId(vendorId);
  if (!vendor) throw notFound("Vendor not found");
  const amount = round2(input.amount);
  if (!amount || amount <= 0) throw bad("A positive amount is required");
  const taxAmount = round2(input.taxAmount || 0);
  // Validate optional period dates (reject typos like year 226).
  const periodFrom = input.periodFrom ? normalizeDate(input.periodFrom) : null;
  const periodTo = input.periodTo ? normalizeDate(input.periodTo) : null;
  if (input.periodFrom && !periodFrom) throw bad("Invalid 'period from' date");
  if (input.periodTo && !periodTo) throw bad("Invalid 'period to' date");
  if (periodFrom && periodTo && periodTo < periodFrom) throw bad("'Period to' must be after 'period from'");
  let attachmentFilename: string | null = null;
  if (file) {
    attachmentFilename = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${path.extname(file.originalname)}`;
    await storage.putBuffer("uploads", attachmentFilename, file.buffer, file.mimetype);
  }
  const bill = await ctx.data.vendorBills.create({
    vendorId,
    invoiceNumber: input.invoiceNumber || `INV-${Date.now()}`,
    amount, taxAmount, totalAmount: round2(amount + taxAmount), currency: "INR",
    description: input.description || "",
    periodFrom, periodTo,
    attachmentFilename,
    attachmentOriginalName: file ? file.originalname : null,
    status: "SUBMITTED", decidedBy: null, decidedAt: null, note: "",
  });
  return billWithVendor(ctx, bill);
}

/** HR decides a bill: APPROVED|REJECTED (while SUBMITTED) or PAID (once APPROVED). */
export async function decideBill(ctx: RequestContext, id: string, input: { decision?: string; note?: string }) {
  const b = await ctx.data.vendorBills.byId(id);
  if (!b) throw notFound("Bill not found");
  const decision = input.decision as string;
  if (!["APPROVED", "REJECTED", "PAID"].includes(decision)) throw bad("Invalid decision");
  if (decision === "PAID" && b.status !== "APPROVED") throw bad("Only approved bills can be marked paid");
  if ((decision === "APPROVED" || decision === "REJECTED") && b.status !== "SUBMITTED") throw bad("Bill already decided");
  const updated = await ctx.data.vendorBills.update(b.id, { status: decision, decidedBy: ctx.user.id, decidedAt: new Date().toISOString(), note: input.note || b.note });
  return billWithVendor(ctx, updated);
}

/** Where a bill's invoice attachment lives, after checking the caller may read it. */
export async function billInvoice(ctx: RequestContext, id: string) {
  const b = await ctx.data.vendorBills.byId(id);
  if (!b) throw notFound("Bill not found");
  if (!isStaff(ctx.user) && b.vendorId !== ctx.user.vendorId) throw forbidden();
  if (!b.attachmentFilename) throw notFound("No invoice attached");
  if (!(await storage.exists("uploads", b.attachmentFilename))) throw notFound("Invoice missing in storage");
  return {
    prefix: "uploads",
    filename: b.attachmentFilename as string,
    downloadName: (b.attachmentOriginalName || "invoice") as string,
    contentType: (b.attachmentMime || "application/octet-stream") as string,
  };
}
