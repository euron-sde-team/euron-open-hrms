/**
 * Operator console (SaaS vendor's internal plane). Manages customer workspaces: list,
 * suspend/reactivate, support-impersonate a tenant admin (audited), and headline metrics.
 * NOT org-scoped: there is no caller workspace, so every function takes an
 * OperatorContext and names its target workspace explicitly.
 */
import crypto from "crypto";
import { systemRepos, repos } from "../repositories/base.repository";
import { createRepositories } from "../repositories";
import { bad, notFound, unauth, forbidden } from "../core/util";
import {
  signPlatformToken, checkPw, hashPw, signPlatformMfaChallenge, verifyPlatformMfaChallenge,
} from "../middleware/platform-auth";
import { signToken, hashPassword, assertStrongPassword } from "../middleware/auth";
import { logger } from "../core/logger";
import { provisionOrgDefaults, uniqueSlug } from "./provisioning.service";
import {
  PACKS,
  planStarterContent,
  applyStarterContent,
  normaliseOptions,
  INDIAN_STATES,
  curatedYears,
} from "../domain/starter-content";
import { createToken } from "../security/tokens";
import { resetEmail, staffInviteEmail } from "../integrations/mail/templates";
import { sendMailSafe, sendTenantMail } from "../integrations/mail/mailer";
import { exportOrg, exportFilename } from "./export.service";
import * as totp from "../security/totp";
import QRCode from "qrcode";
import { PRODUCT_NAME, OPERATOR_TOTP_ISSUER } from "../core/product";
import { shredDataKey } from "../security/pii";

/** Who is acting on the operator plane. Built by the controller after platformAuthRequired. */
export interface OperatorContext {
  /** The signed-in platform_admins row. */
  admin: any;
  ip?: string;
  requestId?: string;
}

const nowIso = () => new Date().toISOString();
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);
// Actions surfaced in the fleet Activity feed (tenant-scoped + operator-level).
const PLATFORM_ACTIONS = [
  "TENANT_CREATE", "TENANT_SUSPEND", "TENANT_REACTIVATE", "IMPERSONATE", "TENANT_ADMIN_RESET",
  "TENANT_DELETE", "DATA_EXPORT", "OPERATOR_LOGIN", "OPERATOR_CREATE", "OPERATOR_STATUS",
  "OPERATOR_MFA_ENABLE", "OPERATOR_MFA_DISABLE", "STARTER_CONTENT_APPLIED",
];

/** Cross-workspace repositories (the operator plane's default view). */
const system = () => createRepositories(systemRepos());

/**
 * One target workspace: `store` for the shared helpers that take a raw store (starter
 * content), `data` for everything else.
 */
function workspace(orgId: string) {
  const store = repos({ orgId });
  return { store, data: createRepositories(store) };
}

/** The target workspace's row, or 404. */
async function requireOrg(orgId: string) {
  const org = await system().organizations.byId(orgId);
  if (!org) throw notFound("Workspace not found");
  return org;
}

/**
 * Write a fleet-level audit row (operator action). orgId may be null for
 * operator-management/login events. Stored in audit_log via system repos.
 */
async function platformAudit(
  action: string,
  { orgId = null, byPlatformAdmin = null, meta = {} }: { orgId?: string | null; byPlatformAdmin?: string | null; meta?: Record<string, unknown> } = {},
) {
  try {
    await system().auditLog.create({ orgId, userId: null, action, meta: { byPlatformAdmin, ...meta }, at: nowIso() });
  } catch (e) { logger.warn({ err: e && (e as any).message, action }, "platform audit insert failed"); }
}

const adminPublic = (a) => ({ id: a.id, email: a.email, name: a.name, role: a.role || "OPERATOR", mfaEnabled: !!a.mfaEnabled });
const adminView = (a) => ({ id: a.id, email: a.email, name: a.name, role: a.role || "OPERATOR", status: a.status || "ACTIVE", mfaEnabled: !!a.mfaEnabled, createdAt: a.createdAt });

// ── Sign-in (before platformAuthRequired) ────────────────────────────────────

/** Step 1 (password). With MFA on, a password alone is not a session. */
export async function login(input: { email?: unknown; password?: unknown }) {
  const email = String(input.email || "").toLowerCase().trim();
  const password = String(input.password || "");
  const admin = email ? await system().platformAdmins.findByEmail(email) : null;
  if (!admin || !checkPw(password, admin.passwordHash)) throw unauth("Invalid email or password");
  if (admin.status === "DISABLED") throw forbidden("This operator account is disabled.");
  // Two-factor: if enabled, password alone isn't a session.
  if (admin.mfaEnabled) return { mfaRequired: true, mfaToken: signPlatformMfaChallenge(admin) };
  await platformAudit("OPERATOR_LOGIN", { byPlatformAdmin: admin.id, meta: { email: admin.email } });
  return { token: signPlatformToken(admin), admin: adminPublic(admin) };
}

/** Step 2 (TOTP), redeeming the short-lived challenge from step 1. */
export async function loginMfa(input: { mfaToken?: unknown; code?: unknown }) {
  const ch = verifyPlatformMfaChallenge(input.mfaToken);
  if (!ch) throw unauth("Two-factor session expired; please sign in again");
  const admin = await system().platformAdmins.byId(ch.pid);
  if (!admin || !admin.mfaEnabled) throw unauth("Invalid session");
  if (admin.status === "DISABLED") throw forbidden("This operator account is disabled.");
  if (!totp.verify(admin.mfaSecret, input.code)) throw bad("Invalid authentication code");
  await platformAudit("OPERATOR_LOGIN", { byPlatformAdmin: admin.id, meta: { email: admin.email, mfa: true } });
  return { token: signPlatformToken(admin), admin: adminPublic(admin) };
}

export function me(op: OperatorContext) {
  return { admin: adminPublic(op.admin) };
}

// ── Operator's own MFA (TOTP) ────────────────────────────────────────────────

/** A secret + otpauth URL + QR (not yet enabled). */
export async function enrollMfa(op: OperatorContext) {
  const secret = totp.generateSecret();
  await system().platformAdmins.update(op.admin.id, { mfaPending: secret });
  const otpauth = totp.otpauthURL(secret, op.admin.email, OPERATOR_TOTP_ISSUER);
  const qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 200 });
  return { secret, otpauth, qr };
}

/** Confirm the pending secret with a code, and enable two-factor. */
export async function verifyMfaEnrollment(op: OperatorContext, code: unknown) {
  const sys = system();
  const admin = (await sys.platformAdmins.byId(op.admin.id)) as any;
  if (!admin.mfaPending) throw bad("Start enrollment first");
  if (!totp.verify(admin.mfaPending, code)) throw bad("Invalid authentication code");
  await sys.platformAdmins.update(admin.id, { mfaEnabled: true, mfaSecret: admin.mfaPending, mfaPending: null });
  await platformAudit("OPERATOR_MFA_ENABLE", { byPlatformAdmin: admin.id });
  return { ok: true, mfaEnabled: true };
}

/** Turn two-factor off (needs both factors). */
export async function disableMfa(op: OperatorContext, input: { password?: unknown; code?: unknown }) {
  const sys = system();
  const admin = (await sys.platformAdmins.byId(op.admin.id)) as any;
  if (!admin.mfaEnabled) throw bad("Two-factor is not enabled");
  if (!checkPw(String(input.password || ""), admin.passwordHash)) throw bad("Password is incorrect");
  if (!totp.verify(admin.mfaSecret, input.code)) throw bad("Invalid authentication code");
  await sys.platformAdmins.update(admin.id, { mfaEnabled: false, mfaSecret: null, mfaPending: null });
  await platformAudit("OPERATOR_MFA_DISABLE", { byPlatformAdmin: admin.id });
  return { ok: true, mfaEnabled: false };
}

export async function mfaStatus(op: OperatorContext) {
  const admin = (await system().platformAdmins.byId(op.admin.id)) as any;
  return { enabled: !!admin.mfaEnabled };
}

// ── Workspaces ───────────────────────────────────────────────────────────────

/** All customer workspaces with headline counts. */
export async function listTenants(_op: OperatorContext) {
  const sys = system();
  const [orgs, users, employees] = await Promise.all([sys.organizations.all(), sys.users.all(), sys.employees.all()]);
  const usersByOrg = {}, empByOrg = {};
  for (const u of users) usersByOrg[u.orgId] = (usersByOrg[u.orgId] || 0) + 1;
  for (const e of employees) if (e.status !== "EXITED") empByOrg[e.orgId] = (empByOrg[e.orgId] || 0) + 1;
  return orgs.map((o) => ({
    id: o.id, name: o.name, slug: o.slug,
    status: o.status || "ACTIVE", signupSource: o.signupSource || "SEED", country: o.country || null,
    users: usersByOrg[o.id] || 0, employees: empByOrg[o.id] || 0, createdAt: o.createdAt,
  })).sort(newestFirst);
}

/** Detail + metrics for one workspace. */
export async function getTenant(_op: OperatorContext, orgId: string) {
  const org = await requireOrg(orgId);
  const { data } = workspace(org.id);
  const [employees, users, depts] = await Promise.all([data.employees.all(), data.users.all(), data.departments.all()]);
  return {
    org: { id: org.id, name: org.name, slug: org.slug, status: org.status || "ACTIVE", signupSource: org.signupSource || "SEED", country: org.country || null, createdAt: org.createdAt },
    metrics: {
      employees: employees.filter((e) => e.status !== "EXITED").length,
      exited: employees.filter((e) => e.status === "EXITED").length,
      users: users.length,
      pendingUsers: users.filter((u) => u.status === "INVITED").length,
      departments: depts.length,
    },
  };
}

async function setStatus(op: OperatorContext, orgId: string, reasonInput: unknown, status: string, action: string) {
  const org = await requireOrg(orgId);
  await system().organizations.update(org.id, { status });
  const reason = reasonInput || "";
  await workspace(org.id).data.auditLog.create({ action, userId: null, meta: { byPlatformAdmin: op.admin.id, status, reason } });
  return { id: org.id, status };
}

export const suspendTenant = (op: OperatorContext, orgId: string, reason: unknown) =>
  setStatus(op, orgId, reason, "SUSPENDED", "TENANT_SUSPEND");

export const reactivateTenant = (op: OperatorContext, orgId: string, reason: unknown) =>
  setStatus(op, orgId, reason, "ACTIVE", "TENANT_REACTIVATE");

/**
 * Mints a TENANT token for that workspace's admin, carrying the operator id as
 * `imp` so the tenant app knows the session is an impersonation. Audited.
 */
export async function impersonate(op: OperatorContext, orgId: string, reason: unknown) {
  const org = await requireOrg(orgId);
  const { data } = workspace(org.id);
  const admin = await data.users.findOne((u) => u.role === "ADMIN" && u.status !== "DISABLED");
  if (!admin) throw bad("This workspace has no admin to impersonate");
  await data.auditLog.create({ action: "IMPERSONATE", userId: admin.id, meta: { byPlatformAdmin: op.admin.id, at: nowIso(), reason: reason || "" } });
  return { token: signToken(admin, { imp: op.admin.id }), impersonating: { orgId: org.id, orgName: org.name, userId: admin.id, userEmail: admin.email } };
}

/** Fleet headline numbers + health. */
export async function fleetMetrics(_op: OperatorContext) {
  const sys = system();
  const [orgs, employees, users] = await Promise.all([sys.organizations.all(), sys.employees.all(), sys.users.all()]);
  const byStatus = {};
  for (const o of orgs) byStatus[o.status || "ACTIVE"] = (byStatus[o.status || "ACTIVE"] || 0) + 1;

  // Signups over the last 6 months (by createdAt), oldest → newest.
  const now = new Date();
  const months: { key: string; label: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString(undefined, { month: "short" }), count: 0 });
  }
  const monthIdx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  let last30 = 0;
  const cut30 = Date.now() - 30 * 86400000;
  for (const o of orgs) {
    if (!o.createdAt) continue;
    const c = new Date(o.createdAt);
    const k = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}`;
    if (k in monthIdx) months[monthIdx[k]].count++;
    if (c.getTime() >= cut30) last30++;
  }

  return {
    tenants: orgs.length,
    tenantsByStatus: byStatus,
    active: byStatus["ACTIVE"] || 0,
    suspended: byStatus["SUSPENDED"] || 0,
    pendingVerification: byStatus["PENDING_VERIFICATION"] || 0,
    selfSignup: orgs.filter((o) => o.signupSource === "SELF_SIGNUP").length,
    totalEmployees: employees.filter((e) => e.status !== "EXITED").length,
    totalUsers: users.length,
    newLast30Days: last30,
    signupsByMonth: months,
  };
}

/**
 * Operator manually creates a workspace + first ADMIN.
 * Input: { companyName, adminName, email, country?, sendInvite? }
 * Org is ACTIVE immediately; the admin gets a set-password invite by default.
 */
export async function createTenant(op: OperatorContext, b: Record<string, any>) {
  const companyName = String(b.companyName || b.name || "").trim();
  const adminName = String(b.adminName || "").trim();
  const email = String(b.email || "").toLowerCase().trim();
  if (!companyName) throw bad("Company name is required");
  if (!isEmail(email)) throw bad("A valid admin email is required");
  const sysStore = systemRepos();
  const sys = createRepositories(sysStore);
  if (await sys.users.where({ email }).one()) throw bad("An account with that email already exists");

  const slug = await uniqueSlug(sysStore, companyName);
  const org = await sys.organizations.create({ name: companyName, slug, address: "", status: "ACTIVE", signupSource: "ADMIN", country: b.country || "IN" });
  const { data } = workspace(org.id);
  const sendInvite = b.sendInvite !== false;
  const admin = await data.users.create({
    email, name: adminName || email.split("@")[0], role: "ADMIN", employeeId: null,
    // Without an invite the operator sets the first password, so it must meet the same
    // policy as any other; there is no default.
    passwordHash: hashPassword(sendInvite ? crypto.randomBytes(24).toString("base64url") : (assertStrongPassword(b.password), String(b.password))),
    status: sendInvite ? "INVITED" : "ACTIVE", emailVerifiedAt: sendInvite ? null : nowIso(), credentialsChangedAt: nowIso(),
  });
  await provisionOrgDefaults(org.id, { country: org.country, state: b.state ? String(b.state) : null });
  let invite: { to: string; mode: string } | null = null;
  if (sendInvite) {
    const token = await createToken({ type: "USER_INVITE", orgId: org.id, userId: admin.id, email });
    const mail = await sendMailSafe(staffInviteEmail({ to: email, orgName: org.name, inviterName: PRODUCT_NAME, role: "ADMIN", token }));
    invite = { to: email, mode: mail.mode };
  }
  await data.auditLog.create({ action: "TENANT_CREATE", userId: null, meta: { byPlatformAdmin: op.admin.id, orgId: org.id, name: org.name, email } });
  return { org: { id: org.id, name: org.name, slug: org.slug, status: org.status }, admin: { id: admin.id, email: admin.email, status: admin.status }, invite };
}

// ── Starter content (operator-side backfill) ───────────────────────────────
// Workspaces created outside the provisioning path (imported, or created before a
// pack existed) have no leave types, holidays, policies, benefits or departments,
// and nothing backfills them. These two let an operator inspect and repair that without having to log
// in as the tenant.

/** Dry run, writes nothing. */
export async function planTenantStarterContent(_op: OperatorContext, orgId: string, query: { year?: unknown; state?: unknown }) {
  const org = await requireOrg(orgId);
  const opts = normaliseOptions(
    {
      year: query.year ? Number(query.year) : undefined,
      state: query.state ? String(query.state) : null,
    },
    bad
  );
  return {
    org: { id: org.id, name: org.name },
    ...opts,
    // After `...opts`: the normalised options carry the selected pack ids under the same
    // key, and the console needs the pack catalogue (ids AND labels) here.
    packs: PACKS,
    states: INDIAN_STATES,
    verifiedYears: curatedYears(),
    plan: await planStarterContent(workspace(org.id).store, opts),
  };
}

/** Apply packs to a tenant. */
export async function applyTenantStarterContent(op: OperatorContext, orgId: string, input: Record<string, any>) {
  const org = await requireOrg(orgId);
  const opts = normaliseOptions(input, bad);
  const { store, data } = workspace(org.id);
  const results = await applyStarterContent(store, opts);
  const added = results.reduce((n, x) => n + x.added, 0);

  await data.auditLog.create({
    action: "STARTER_CONTENT_APPLIED",
    userId: null,
    meta: { byPlatformAdmin: op.admin.id, packs: opts.packs, year: opts.year, state: opts.state, added },
  });

  return { org: { id: org.id, name: org.name }, ...opts, added, results };
}

/** A tenant's login accounts. */
export async function listTenantUsers(_op: OperatorContext, orgId: string) {
  const org = await requireOrg(orgId);
  const users = await workspace(org.id).data.users.all();
  return users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status || "ACTIVE", employeeId: u.employeeId || null, createdAt: u.createdAt }))
    .sort(newestFirst);
}

/** Map an org-scoped audit row to a fleet-readable activity entry. */
function activityEntry(a, orgName) {
  return { id: a.id, action: a.action, orgId: a.orgId, orgName: orgName || null, meta: a.meta || a.data || {}, at: a.createdAt };
}

/** That tenant's recent audit trail. */
export async function tenantActivity(_op: OperatorContext, orgId: string) {
  const org = await requireOrg(orgId);
  const { data } = workspace(org.id);
  const [rows, users] = await Promise.all([data.auditLog.all(), data.users.all()]);
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  rows.sort(newestFirst);
  return rows.slice(0, 100).map((a) => ({
    ...activityEntry(a, org.name),
    actor: a.userId && userById[a.userId] ? userById[a.userId].name : (a.userId ? "User" : "Operator"),
  }));
}

/** Fleet-wide recent operator actions across all tenants. */
export async function fleetActivity(_op: OperatorContext) {
  const sys = system();
  const [rows, orgs] = await Promise.all([sys.auditLog.all(), sys.organizations.all()]);
  const orgName = Object.fromEntries(orgs.map((o) => [o.id, o.name]));
  const fleet = rows.filter((a) => PLATFORM_ACTIONS.includes(a.action)).sort(newestFirst);
  return fleet.slice(0, 100).map((a) => activityEntry(a, orgName[a.orgId]));
}

/** A full JSON snapshot of a tenant's data, audited, ready to download. */
export async function exportTenant(op: OperatorContext, orgId: string) {
  const bundle = await exportOrg(orgId);
  if (!bundle) throw notFound("Workspace not found");
  await workspace(orgId).data.auditLog.create({ action: "DATA_EXPORT", userId: null, meta: { byPlatformAdmin: op.admin.id, counts: bundle.meta.counts } });
  return { filename: exportFilename(bundle.organization), json: JSON.stringify(bundle, null, 2) };
}

/** Email a password-reset link to the tenant's admin. */
export async function resetTenantAdmin(op: OperatorContext, orgId: string) {
  const org = await requireOrg(orgId);
  const { data } = workspace(org.id);
  const admin = await data.users.findOne((u) => u.role === "ADMIN" && u.status !== "DISABLED");
  if (!admin) throw bad("This workspace has no active admin");
  const token = await createToken({ type: "PASSWORD_RESET", orgId: org.id, userId: admin.id, email: admin.email });
  const mail = await sendTenantMail(org, resetEmail({ to: admin.email, name: admin.name, token }));
  await data.auditLog.create({ action: "TENANT_ADMIN_RESET", userId: admin.id, meta: { byPlatformAdmin: op.admin.id } });
  return { ok: true, to: admin.email, mode: mail.mode };
}

/**
 * PERMANENTLY purge a workspace and ALL its data (every org-scoped table + jobs + the
 * org row). Irreversible.
 */
async function purgeOrg(orgId: string) {
  const organizations = system().organizations;
  await organizations.purgeWorkspaceData(orgId);
  // Last: destroying the workspace's data key crypto-shreds every sealed field it ever
  // wrote, including the copies that still sit in database backups.
  await shredDataKey(orgId);
  await organizations.deleteWorkspaceRow(orgId);
}

export async function deleteTenant(op: OperatorContext, orgId: string, input: { confirmName?: unknown; reason?: unknown }) {
  const org = await requireOrg(orgId);
  // Hard guardrail: caller must echo the exact workspace name to confirm, and the
  // workspace must be SUSPENDED first (forces a deliberate two-step destruction).
  const confirm = String(input.confirmName || "");
  if (confirm !== org.name) throw bad(`Type the workspace name exactly to confirm: "${org.name}"`);
  if ((org.status || "ACTIVE") !== "SUSPENDED") throw bad("Suspend the workspace before deleting it.");
  // Audit BEFORE purge (the org's audit rows are about to be wiped), fleet-level row.
  await platformAudit("TENANT_DELETE", { byPlatformAdmin: op.admin.id, meta: { orgId: org.id, name: org.name, slug: org.slug, reason: input.reason || "" } });
  await purgeOrg(org.id);
  logger.warn({ orgId: org.id, name: org.name, byPlatformAdmin: op.admin.id }, "TENANT_DELETE (workspace purged)");
  return { ok: true, deleted: { id: org.id, name: org.name } };
}

// ── Operator (platform admin) management ────────────────────────────────────

/** Operator accounts, newest first. */
export async function listOperators(_op: OperatorContext) {
  const list = await system().platformAdmins.all();
  return list.map(adminView).sort(newestFirst);
}

/** Create an operator. */
export async function createOperator(op: OperatorContext, input: { email?: unknown; name?: unknown; password?: unknown; role?: unknown }) {
  const email = String(input.email || "").toLowerCase().trim();
  const name = String(input.name || "").trim();
  const password = String(input.password || "");
  if (!isEmail(email)) throw bad("A valid email is required");
  if (password.length < 8) throw bad("Password must be at least 8 characters");
  const sys = system();
  if (await sys.platformAdmins.findByEmail(email)) throw bad("An operator with that email already exists");
  const admin = await sys.platformAdmins.create({
    email, name: name || email.split("@")[0], role: input.role === "SUPPORT" ? "SUPPORT" : "OPERATOR",
    status: "ACTIVE", passwordHash: hashPw(password),
  });
  await platformAudit("OPERATOR_CREATE", { byPlatformAdmin: op.admin.id, meta: { operatorId: admin.id, email: admin.email, role: admin.role } });
  return adminView(admin);
}

/** Enable or disable another operator's account. */
export async function setOperatorStatus(op: OperatorContext, id: string, requested: unknown) {
  if (id === op.admin.id) throw bad("You cannot change your own status");
  const sys = system();
  const admin = await sys.platformAdmins.byId(id);
  if (!admin) throw notFound("Operator not found");
  // Explicit only: an empty or misspelt request must never re-enable a disabled account.
  if (requested !== "ACTIVE" && requested !== "DISABLED") throw bad('status must be "ACTIVE" or "DISABLED"');
  const status = requested;
  const updated = await sys.platformAdmins.update(admin.id, { status });
  await platformAudit("OPERATOR_STATUS", { byPlatformAdmin: op.admin.id, meta: { operatorId: admin.id, email: admin.email, status } });
  return adminView(updated);
}
