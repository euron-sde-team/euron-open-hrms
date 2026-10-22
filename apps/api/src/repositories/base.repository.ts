/**
 * Scoped repository factory, the single data-access path for the app.
 *
 * `repos(ctx)` returns one repository per collection. Built from request context
 * `{ orgId, userId }`, every read/write is automatically scoped to that org, so
 * tenant isolation is structural (you cannot forget the filter) rather than a
 * predicate each route remembers.
 *
 * Each repo preserves the OLD `collection()` verb surface so route conversion is
 * mechanical: `collection("employees")` -> `req.repos.employees`, then `await`.
 *   all() find(pred) findOne(pred) byId(id) insert(doc) update(id,patch)
 *   remove(id) count(pred)
 * Plus a structured builder `where({...}).list()/.count()/.one()` that pushes the
 * filter into SQL (use this for the hot paths instead of find(pred)).
 *
 * Storage model: "hot columns + data jsonb". Hot columns (org_id, FKs, status,
 * dates...) are real columns; everything else lives in `data`. The serializer
 * flattens `{ ...data, ...hotColumns, id, createdAt, updatedAt }` on read so the
 * returned object is byte-identical to the old JSON record, and splits hot
 * columns back out on write.
 *
 * System mode: `repos({ system: true })` (or no orgId) skips org scoping and
 * uses each doc's own orgId, used by seeding and the operator plane, which work
 * across orgs.
 *
 * Personal data: fields listed in pii.ts ENCRYPTED_FIELDS are sealed on every write
 * and opened on every read here, so callers always see plaintext and the database
 * only ever holds ciphertext for them.
 */
import { randomUUID as uuid } from "crypto";
// repo.ts builds queries from dynamic table/column strings (its hot-column + jsonb
// abstraction), so it uses the loosely-typed db view rather than the schema-typed one.
import { dbAny as defaultDb } from "../db/kysely";
import { syncManagerFields } from "../domain/manager";
import { sealFields, openFields } from "../security/pii";

// Transient connection errors (DNS blips on IPv6/NAT64 networks, dropped sockets).
// Reads are idempotent, so retry a couple of times before surfacing the failure.
const TRANSIENT = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED"]);
async function retryRead(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e: any) {
      last = e;
      const code = e && (e.code || (e.cause && e.cause.code));
      if (!TRANSIENT.has(code)) throw e;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw last;
}

// collection name -> { table, cols (camelCase hot columns), tenant }
// `tenant: false` means the table is not org-scoped (organizations is the root).
const TABLES = {
  organizations: { table: "organizations", cols: ["name", "slug", "address"], tenant: false },
  users: { table: "users", cols: ["orgId", "email", "role", "employeeId", "vendorId"], tenant: true },
  offices: { table: "offices", cols: ["orgId"], tenant: true },
  departments: { table: "departments", cols: ["orgId", "name"], tenant: true },
  employees: {
    table: "employees",
    cols: ["orgId", "departmentId", "code", "email", "status", "employmentType", "reportsTo", "managerId"],
    tenant: true,
  },
  leaveTypes: { table: "leave_types", cols: ["orgId"], tenant: true },
  leaveBalances: { table: "leave_balances", cols: ["orgId", "employeeId", "leaveTypeId", "year"], tenant: true },
  leaveRequests: { table: "leave_requests", cols: ["orgId", "employeeId", "leaveTypeId", "status"], tenant: true },
  documents: { table: "documents", cols: ["orgId", "employeeId", "category", "visibility"], tenant: true },
  attendance: { table: "attendance", cols: ["orgId", "employeeId", "date", "status"], tenant: true },
  payslips: { table: "payslips", cols: ["orgId", "employeeId", "month", "year"], tenant: true },
  payRuns: { table: "pay_runs", cols: ["orgId"], tenant: true },
  payrollProfiles: { table: "payroll_profiles", cols: ["orgId", "country"], tenant: true },
  reimbursements: { table: "reimbursements", cols: ["orgId", "employeeId", "status"], tenant: true },
  vendors: { table: "vendors", cols: ["orgId", "code", "status"], tenant: true },
  vendorBills: { table: "vendor_bills", cols: ["orgId", "vendorId", "status"], tenant: true },
  onboardingInvites: { table: "onboarding_invites", cols: ["orgId", "token", "status", "employeeId"], tenant: true },
  onboardingTemplates: { table: "onboarding_templates", cols: ["orgId", "status"], tenant: true },
  onboardingCases: {
    table: "onboarding_cases",
    cols: ["orgId", "employeeId", "inviteId", "campaignId", "templateId", "status", "dueAt", "tokenHash"],
    tenant: true,
  },
  onboardingCampaigns: { table: "onboarding_campaigns", cols: ["orgId", "status", "dueAt"], tenant: true },
  separations: { table: "separations", cols: ["orgId", "employeeId", "status"], tenant: true },
  holidays: { table: "holidays", cols: ["orgId", "date"], tenant: true },
  policies: { table: "policies", cols: ["orgId"], tenant: true },
  benefits: { table: "benefits", cols: ["orgId"], tenant: true },
  announcements: { table: "announcements", cols: ["orgId"], tenant: true },
  pips: { table: "pips", cols: ["orgId", "employeeId", "status"], tenant: true },
  appraisalCycles: { table: "appraisal_cycles", cols: ["orgId", "status"], tenant: true },
  appraisals: { table: "appraisals", cols: ["orgId", "cycleId", "employeeId", "status"], tenant: true },
  workLogs: { table: "work_logs", cols: ["orgId", "employeeId", "date"], tenant: true },
  aiTokens: { table: "ai_tokens", cols: ["orgId", "employeeId"], tenant: true },
  assets: { table: "assets", cols: ["orgId", "employeeId", "status"], tenant: true },
  perks: { table: "perks", cols: ["orgId", "employeeId", "status"], tenant: true },
  familyBenefits: { table: "family_benefits", cols: ["orgId", "employeeId"], tenant: true },
  wellbeing: { table: "wellbeing", cols: ["orgId", "employeeId", "date"], tenant: true },
  savedViews: { table: "saved_views", cols: ["orgId", "userId", "resource"], tenant: true },
  reminders: { table: "reminders", cols: ["orgId", "userId", "status"], tenant: true },
  auditLog: { table: "audit_log", cols: ["orgId", "userId", "action"], tenant: true },
  notifications: { table: "notifications", cols: ["orgId", "userId", "type", "readAt"], tenant: true },
  pushSubscriptions: { table: "push_subscriptions", cols: ["orgId", "employeeId", "userId", "endpoint"], tenant: true },
  // SaaS layer, global (not org-scoped).
  authTokens: { table: "auth_tokens", cols: ["type", "tokenHash", "orgId", "userId", "email", "expiresAt", "usedAt"], tenant: false },
  platformAdmins: { table: "platform_admins", cols: ["email"], tenant: false },
};

const COLLECTIONS = Object.keys(TABLES);

const snake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
const toIso = (v) => (v instanceof Date ? v.toISOString() : v == null ? v : String(v));

const RESERVED = new Set(["id", "createdAt", "updatedAt", "created_at", "updated_at"]);

/** DB row (snake_case cols + data jsonb) -> flat record (camelCase, ISO dates). */
function readRow(meta, row) {
  if (!row) return null;
  const out = { ...(row.data || {}) };
  out.id = row.id;
  for (const c of meta.cols) {
    const v = row[snake(c)];
    if (v !== undefined && v !== null) out[c] = v;
    else if (!(c in out)) out[c] = null;
  }
  out.createdAt = toIso(row.created_at);
  out.updatedAt = toIso(row.updated_at);
  return out;
}

/** Flat record -> { hot columns (snake), data jsonb } for insert/update. */
function splitRow(meta, doc) {
  const hot = {};
  const data = {};
  const hotSet = new Set(meta.cols);
  for (const [k, v] of Object.entries(doc)) {
    if (RESERVED.has(k)) continue;
    if (hotSet.has(k)) hot[snake(k)] = v === undefined ? null : v;
    else data[k] = v;
  }
  return { hot, data };
}

/** readRow plus opening of sealed personal-data fields. */
const decode = (meta, row) => (row ? openFields(meta.table, readRow(meta, row)) : Promise.resolve(null));
const decodeAll = (meta, rows) => Promise.all(rows.map((r) => decode(meta, r)));

function scopedRepo(name, ctx, ex) {
  const meta = TABLES[name];
  if (!meta) throw new Error(`Unknown collection: ${name}`);
  const scoped = meta.tenant && !ctx.system && ctx.orgId != null;

  const base = () => {
    let q = ex.selectFrom(meta.table);
    if (scoped) q = q.where("org_id", "=", ctx.orgId);
    return q;
  };
  // Retry reads on transient connection errors, but only outside a transaction
  // (a trx is bound to one connection; retrying its reads can't help).
  const R = ex === defaultDb ? retryRead : (fn) => fn();

  const api = {
    async all() {
      const rows = await R(() => base().selectAll().execute());
      return decodeAll(meta, rows);
    },
    async find(pred) {
      const rows = await api.all();
      return pred ? rows.filter(pred) : rows;
    },
    async findOne(pred) {
      const rows = await api.all();
      return rows.find(pred) || null;
    },
    async byId(id) {
      const row = await R(() => base().selectAll().where("id", "=", id).executeTakeFirst());
      return decode(meta, row);
    },
    async count(pred) {
      if (pred) return (await api.find(pred)).length;
      const r = await R(() => base().select((eb) => eb.fn.countAll().as("c")).executeTakeFirst());
      return Number(r ? r.c : 0);
    },
    /**
     * Server-side pagination (DB limit/offset). Equality filters + a free-text
     * `search` run on hot columns only (indexable). Returns a paginated envelope.
     * opts: { page, pageSize, orderBy (hot col | createdAt | updatedAt), dir,
     *         where: { hotCol: value }, search: { q, cols: [hotCol] } }
     */
    async page(opts: any = {}) {
      const ps = Math.max(1, Math.min(200, Number(opts.pageSize) || 25));
      const pg = Math.max(1, Number(opts.page) || 1);
      let q = base();
      for (const [k, v] of Object.entries(opts.where || {})) {
        if (meta.cols.includes(k)) q = Array.isArray(v) ? q.where(snake(k), "in", v) : q.where(snake(k), "=", v);
      }
      const s = opts.search;
      if (s && s.q && Array.isArray(s.cols)) {
        const cols = s.cols.filter((c) => meta.cols.includes(c));
        if (cols.length) { const term = `%${String(s.q)}%`; q = q.where((eb) => eb.or(cols.map((c) => eb(snake(c), "ilike", term)))); }
      }
      const totalRow = await R(() => q.select((eb) => eb.fn.countAll().as("c")).executeTakeFirst());
      const total = Number(totalRow ? totalRow.c : 0);
      const orderCol = opts.orderBy === "updatedAt" ? "updated_at"
        : opts.orderBy && meta.cols.includes(opts.orderBy) ? snake(opts.orderBy) : "created_at";
      const dir = opts.dir === "asc" ? "asc" : "desc";
      const rows = await R(() => q.selectAll().orderBy(orderCol, dir).limit(ps).offset((pg - 1) * ps).execute());
      return { items: await decodeAll(meta, rows), total, page: pg, pageSize: ps, pages: Math.max(1, Math.ceil(total / ps)) };
    },
    async insert(doc) {
      const now = new Date();
      const id = doc.id || uuid();
      const orgForRow = scoped ? ctx.orgId : doc.orgId;
      const withOrg = meta.tenant ? { ...doc, orgId: orgForRow } : doc;
      // employees stores the reporting line in two columns; keep them identical. See manager.ts.
      const normalized = meta.table === "employees" ? syncManagerFields(withOrg) : withOrg;
      const { hot, data } = splitRow(meta, normalized);
      const values = {
        id,
        ...hot,
        data: JSON.stringify(await sealFields(meta.table, normalized.orgId ?? null, id, data)),
        created_at: doc.createdAt ? new Date(doc.createdAt) : now,
        updated_at: doc.updatedAt ? new Date(doc.updatedAt) : now,
      };
      const row = await ex
        .insertInto(meta.table)
        .values(values)
        .returningAll()
        .executeTakeFirstOrThrow();
      return decode(meta, row);
    },
    async insertMany(docs) {
      const out: any[] = [];
      for (const d of docs) out.push(await api.insert(d));
      return out;
    },
    async update(id, patch) {
      const current = await api.byId(id);
      if (!current) return null;
      const merged = { ...current, ...patch };
      // Only when the caller actually supplied a manager field, so unrelated updates
      // never rewrite the reporting line. See manager.ts.
      const normalized = meta.table === "employees" ? syncManagerFields(merged, patch) : merged;
      const { hot, data } = splitRow(meta, normalized);
      const sealed = await sealFields(meta.table, normalized.orgId ?? null, id, data);
      let q = ex
        .updateTable(meta.table)
        .set({ ...hot, data: JSON.stringify(sealed), updated_at: new Date() })
        .where("id", "=", id);
      if (scoped) q = q.where("org_id", "=", ctx.orgId);
      const row = await q.returningAll().executeTakeFirst();
      return decode(meta, row);
    },
    async remove(id) {
      let q = ex.deleteFrom(meta.table).where("id", "=", id);
      if (scoped) q = q.where("org_id", "=", ctx.orgId);
      const res = await q.executeTakeFirst();
      return Number(res ? res.numDeletedRows : 0) > 0;
    },
    /**
     * Bulk-delete by hot-column equality (org-scoped). Used for cascading
     * deletes, e.g. removing all of an employee's dependent records. Returns the
     * number of rows deleted.
     */
    async removeWhere(filter) {
      let q = ex.deleteFrom(meta.table);
      for (const [k, v] of Object.entries(filter || {})) {
        if (!meta.cols.includes(k)) {
          throw new Error(`removeWhere(): "${k}" is not a hot column of ${name}`);
        }
        q = Array.isArray(v) ? q.where(snake(k), "in", v) : q.where(snake(k), "=", v);
      }
      if (scoped) q = q.where("org_id", "=", ctx.orgId);
      const res = await q.executeTakeFirst();
      return Number(res ? res.numDeletedRows : 0);
    },
    /** Structured filter that pushes equality into SQL (hot columns only). */
    where(filter) {
      let q = base();
      for (const [k, v] of Object.entries(filter || {})) {
        if (!meta.cols.includes(k)) {
          throw new Error(`where(): "${k}" is not a hot column of ${name}`);
        }
        q = Array.isArray(v) ? q.where(snake(k), "in", v) : q.where(snake(k), "=", v);
      }
      return {
        async list() {
          return decodeAll(meta, await R(() => q.selectAll().execute()));
        },
        async one() {
          return decode(meta, await R(() => q.selectAll().executeTakeFirst()));
        },
        async count() {
          const r = await R(() => q.select((eb) => eb.fn.countAll().as("c")).executeTakeFirst());
          return Number(r ? r.c : 0);
        },
      };
    },
  };
  return api;
}

/** Build the repos object bound to a given executor (db or transaction). */
function buildRepos(ctx, ex): any {
  const r: any = {};
  for (const name of COLLECTIONS) r[name] = scopedRepo(name, ctx, ex);
  r.transaction = (fn) => ex.transaction().execute((trx) => fn(buildRepos(ctx, trx)));
  r.ctx = ctx;
  return r;
}

/** Request-scoped repos: every query bound to ctx.orgId / ctx.userId. */
function repos(ctx?, ex = defaultDb): any {
  return buildRepos(ctx || {}, ex);
}

/** System (cross-org) repos for seeding and the importer. */
function systemRepos(ex = defaultDb): any {
  return buildRepos({ system: true }, ex);
}

export { repos, systemRepos, TABLES, COLLECTIONS, readRow, splitRow, snake };
