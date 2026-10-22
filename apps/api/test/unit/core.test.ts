/**
 * Unit tests for pure and local modules: RBAC, validation, repo serialisation, TOTP,
 * sending-domain DNS, sender resolution, last-admin guards, identity, leave rules,
 * local storage and the outbox mailer. No database, no network (see test/setup-env.ts).
 */
import { it } from "vitest";
import assert from "node:assert";
import { requirePermission } from "../../src/middleware/auth";
import { isoDate } from "../../src/core/util";
import * as storage from "../../src/integrations/storage";
import { sendMail } from "../../src/integrations/mail/mailer";

const t = (name: string, fn: () => unknown) => it(name, fn as any);

// ── RBAC ────────────────────────────────────────────────────────────────────
import * as rbac from "../../src/security/rbac";
t("ADMIN is superuser (every permission)", () => { const p = rbac.resolvePermissions({ role: "ADMIN" }); assert(rbac.hasPerm(p, "anything")); assert(rbac.hasPerm(p, "settings.manage")); assert(rbac.isStaffPerms(p)); });
t("HR has payroll but NOT settings/users/roles", () => { const p = rbac.resolvePermissions({ role: "HR" }); assert(rbac.hasPerm(p, "payroll.manage")); assert(rbac.isStaffPerms(p)); assert(!rbac.hasPerm(p, "settings.manage")); assert(!rbac.hasPerm(p, "users.manage")); assert(!rbac.hasPerm(p, "roles.manage")); });
t("EMPLOYEE has nothing and is not staff", () => { const p = rbac.resolvePermissions({ role: "EMPLOYEE" }); assert(!rbac.hasPerm(p, "payroll.manage")); assert(!rbac.isStaffPerms(p)); });
t("custom role resolves from org.customRoles", () => { const org = { customRoles: { payroll_officer: { name: "PO", permissions: ["staff.access", "payroll.manage"] } } }; const p = rbac.resolvePermissions({ role: "payroll_officer" }, org); assert(rbac.hasPerm(p, "payroll.manage")); assert(rbac.isStaffPerms(p)); assert(!rbac.hasPerm(p, "settings.manage")); });
t("narrow custom role (leave.approve only) is NOT staff", () => { const org = { customRoles: { la: { name: "LA", permissions: ["leave.approve"] } } }; const p = rbac.resolvePermissions({ role: "la" }, org); assert(rbac.hasPerm(p, "leave.approve")); assert(!rbac.isStaffPerms(p)); });
t("unknown role resolves to empty", () => { const p = rbac.resolvePermissions({ role: "ghost" }, {}); assert(!rbac.isStaffPerms(p)); assert(!rbac.hasPerm(p, "staff.access")); });
t("multi-role unions permissions (EMPLOYEE + HR)", () => { const p = rbac.resolvePermissions({ role: "EMPLOYEE", roleKeys: ["HR"] }); assert(rbac.hasPerm(p, "payroll.manage")); assert(rbac.isStaffPerms(p)); });
t("multi-role mixes built-in + custom", () => { const org = { customRoles: { la: { name: "LA", permissions: ["leave.approve"] } } }; const p = rbac.resolvePermissions({ role: "EMPLOYEE", roleKeys: ["la"] }, org); assert(rbac.hasPerm(p, "leave.approve")); assert(!rbac.isStaffPerms(p)); });
t("userRoleKeys dedupes primary + extras", () => { assert.deepStrictEqual(rbac.userRoleKeys({ role: "HR", roleKeys: ["HR", "EMPLOYEE"] }), ["HR", "EMPLOYEE"]); });
t("userNeedsOrg only when a custom role is present", () => { assert(!rbac.userNeedsOrg({ role: "HR", roleKeys: ["EMPLOYEE"] })); assert(rbac.userNeedsOrg({ role: "HR", roleKeys: ["custom_x"] })); });
t("HR manages leave policies, letter templates and onboarding forms, but not settings/users/roles", () => {
  const p = rbac.resolvePermissions({ role: "HR" });
  for (const code of ["leave.manage", "documents.manage", "onboarding.manage"]) assert(rbac.hasPerm(p, code), code);
  for (const code of ["settings.manage", "users.manage", "roles.manage"]) assert(!rbac.hasPerm(p, code), code);
});
t("requirePermission lets in anyone holding one of the listed permissions", () => {
  const gate = requirePermission("leave.manage", "settings.manage");
  const run = (perms): any => { let out: any = "not called"; gate({ user: { perms } }, null, (err) => { out = err; }); return out; };
  assert.strictEqual(run(rbac.resolvePermissions({ role: "HR" })), undefined);
  assert.strictEqual(run(rbac.resolvePermissions({ role: "custom" }, { customRoles: { custom: { name: "C", permissions: ["staff.access", "settings.manage"] } } })), undefined);
  const denied = run(rbac.resolvePermissions({ role: "EMPLOYEE" }));
  assert(denied && denied.status === 403 && /one of these permissions: "leave\.manage", "settings\.manage"/.test(denied.message), denied && denied.message);
});

// ── Date normalization ──────────────────────────────────────────────────────
import { normalizeDate } from "../../src/core/util";
t("normalizeDate keeps a valid date", () => assert.strictEqual(normalizeDate("2026-04-30"), "2026-04-30"));
t("normalizeDate rejects an absurd year (0226)", () => assert.strictEqual(normalizeDate("0226-06-13"), null));
t("normalizeDate rejects garbage", () => assert.strictEqual(normalizeDate("not-a-date"), null));
t("normalizeDate rejects empty", () => assert.strictEqual(normalizeDate(""), null));

// ── Repo serializers (hot columns + data jsonb) ─────────────────────────────
import { readRow, splitRow } from "../../src/repositories/base.repository";
const EMP = { table: "employees", cols: ["orgId", "code", "status"], tenant: true };
t("readRow flattens hot cols + data and ISO-formats dates", () => {
  const f = readRow(EMP, { id: "e1", org_id: "o1", code: "E-1", status: "ACTIVE", data: { firstName: "A", salary: { basic: 1 } }, created_at: new Date("2026-01-01T00:00:00Z"), updated_at: new Date("2026-01-02T00:00:00Z") });
  assert.strictEqual(f.orgId, "o1"); assert.strictEqual(f.code, "E-1"); assert.strictEqual(f.firstName, "A");
  assert.strictEqual(f.salary.basic, 1); assert.strictEqual(f.createdAt, "2026-01-01T00:00:00.000Z");
});
t("splitRow separates hot cols (snake) from data, drops reserved keys", () => {
  const { hot, data }: { hot: any; data: any } = splitRow(EMP, { orgId: "o1", code: "E-1", status: "ACTIVE", firstName: "A", id: "e1", createdAt: "x" });
  assert.strictEqual(hot.org_id, "o1"); assert.strictEqual(hot.code, "E-1"); assert.strictEqual(data.firstName, "A");
  assert.ok(!("id" in data)); assert.ok(!("createdAt" in data)); assert.ok(!("orgId" in data));
});
t("readRow/splitRow round-trip preserves the record", () => {
  const orig = { orgId: "o1", code: "E-9", status: "ACTIVE", firstName: "Z", nested: { a: 1 } };
  const { hot, data } = splitRow(EMP, orig);
  const back = readRow(EMP, { id: "e9", ...hot, data, created_at: new Date(), updated_at: new Date() });
  assert.strictEqual(back.orgId, "o1"); assert.strictEqual(back.firstName, "Z"); assert.strictEqual(back.nested.a, 1);
});

// ── Password policy ─────────────────────────────────────────────────────────
import { assertStrongPassword, signMfaChallenge, verifyMfaChallenge } from "../../src/middleware/auth";
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
t("rejects too-short passwords", () => assert(throws(() => assertStrongPassword("Ab1"))));
t("rejects common passwords", () => assert(throws(() => assertStrongPassword("password1"))));
t("rejects single-class passwords", () => assert(throws(() => assertStrongPassword("aaaaaaaaaa"))));
t("accepts a strong password", () => assertStrongPassword("Str0ng-Pass"));

// ── MFA challenge token ──────────────────────────────────────────────────────
t("mfa challenge round-trips and exposes uid", () => { const tok = signMfaChallenge({ id: "u1" }); const p = verifyMfaChallenge(tok); assert(p && p.uid === "u1" && p.stage === "mfa"); });
t("verifyMfaChallenge rejects garbage", () => assert.strictEqual(verifyMfaChallenge("nope"), null));

// ── TOTP (RFC 6238) ──────────────────────────────────────────────────────────
import * as totp from "../../src/security/totp";
t("generated TOTP code verifies", () => { const s = totp.generateSecret(); assert(totp.verify(s, totp.generate(s))); });
t("TOTP rejects a wrong code", () => { const s = totp.generateSecret(); assert(!totp.verify(s, "000000")); });
t("TOTP rejects non-numeric input", () => { const s = totp.generateSecret(); assert(!totp.verify(s, "abcdef")); });
t("otpauthURL is well formed", () => { const url = totp.otpauthURL("ABCDEF234567", "a@b.com"); assert(url.startsWith("otpauth://totp/") && url.includes("secret=ABCDEF234567")); });

// ── Request validator ────────────────────────────────────────────────────────
import { validate } from "../../src/core/validate";
t("validate trims + lowercases email and enforces required", () => { const o = validate({ email: { required: true, email: true } }, { email: "  ME@X.COM " }); assert.strictEqual(o.email, "me@x.com"); });
t("validate rejects a missing required field", () => assert(throws(() => validate({ name: { required: true } }, {}))));
t("validate rejects a bad email", () => assert(throws(() => validate({ email: { email: true, required: true } }, { email: "nope" }))));
t("validate applies defaults for empty fields", () => assert.strictEqual(validate({ country: { default: "IN" } }, {}).country, "IN"));
t("validate enforces string length bounds", () => assert(throws(() => validate({ n: { min: 3 } }, { n: "ab" }))));
t("validate coerces + bounds numbers", () => { assert.strictEqual(validate({ n: { type: "number", max: 10 } }, { n: "5" }).n, 5); assert(throws(() => validate({ n: { type: "number", max: 10 } }, { n: 99 }))); });
t("validate handles arrays with element rules", () => { const o = validate({ codes: { type: "array", of: { enum: ["a", "b"] } } }, { codes: ["a", "b"] }); assert.deepStrictEqual(o.codes, ["a", "b"]); assert(throws(() => validate({ codes: { type: "array", of: { enum: ["a"] } } }, { codes: ["x"] }))); });
t("validate ignores unknown fields", () => { const o = validate({ a: {} }, { a: "1", evil: "x" }); assert(!("evil" in o)); });

// ── Custom sending domain ────────────────────────────────────────────────────
import * as sesDom from "../../src/integrations/mail/ses-domains";
t("validateDomain normalizes + accepts a subdomain", () => assert.strictEqual(sesDom.validateDomain(" Mail.Acme.COM. "), "mail.acme.com"));
t("validateDomain rejects junk", () => assert(throws(() => sesDom.validateDomain("not a domain"))));
t("isApex true for 2-label, false for subdomain", () => { assert(sesDom.isApex("acme.io")); assert(!sesDom.isApex("mail.acme.io")); });
t("buildDnsRecords yields DKIM x3 + MAIL FROM + SPF + DMARC", () => { const recs = sesDom.buildDnsRecords("mail.acme.io", ["t1", "t2", "t3"], "eu-west-1"); assert.strictEqual(recs.length, 7); assert.strictEqual(recs.filter((r) => r.purpose === "DKIM").length, 3); assert(recs.some((r) => r.purpose === "MAIL_FROM_MX" && r.priority === 10)); assert(recs.some((r) => r.purpose === "DMARC")); });

import { resolveTenantFrom, senderFor } from "../../src/integrations/mail/mailer";
t("resolveTenantFrom uses a VERIFIED custom domain", () => { const f = resolveTenantFrom({ name: "Acme", emailDomain: { status: "VERIFIED", fromAddress: "noreply@mail.acme.io", fromName: "Acme HR" } }); assert.strictEqual(f!.from, "Acme HR <noreply@mail.acme.io>"); });
t("resolveTenantFrom falls back (PENDING domain) to null", () => assert.strictEqual(resolveTenantFrom({ name: "Acme", emailDomain: { status: "PENDING", fromAddress: "x@mail.acme.io" } }), null));
t("resolveTenantFrom returns null with no domain", () => assert.strictEqual(resolveTenantFrom({ name: "Acme" }), null));

// senderFor always yields a sender AND says why a custom domain wasn't used. The
// NO_FROM_ADDRESS case is the one that shipped broken: VERIFIED with no From address
// silently sent from the platform identity with no signal anywhere.
t("senderFor reports NO_DOMAIN when none is configured", () => { const s = senderFor({ name: "Acme" }); assert.strictEqual(s.usingCustomDomain, false); assert.strictEqual(s.reason, "NO_DOMAIN"); assert(s.from); });
t("senderFor reports NOT_VERIFIED for a PENDING domain", () => assert.strictEqual(senderFor({ name: "Acme", emailDomain: { status: "PENDING", fromAddress: "x@mail.acme.io" } }).reason, "NOT_VERIFIED"));
t("senderFor reports NO_FROM_ADDRESS when VERIFIED but unset", () => { const s = senderFor({ name: "Acme", emailDomain: { status: "VERIFIED", domain: "mail.acme.io" } }); assert.strictEqual(s.usingCustomDomain, false); assert.strictEqual(s.reason, "NO_FROM_ADDRESS"); });
t("senderFor uses the custom domain and reports no reason", () => { const s = senderFor({ name: "Acme", emailDomain: { status: "VERIFIED", fromAddress: "hr@mail.acme.io", fromName: "Acme HR", replyTo: "people@acme.io" } }); assert.strictEqual(s.usingCustomDomain, true); assert.strictEqual(s.reason, null); assert.strictEqual(s.from, "Acme HR <hr@mail.acme.io>"); assert.strictEqual(s.replyTo, "people@acme.io"); });
t("senderFor keeps the org sender-name override over the platform address", () => { const s = senderFor({ name: "Acme", emailSenderName: "Acme People" }); assert(s.from.startsWith("Acme People <")); assert.strictEqual(s.usingCustomDomain, false); });

// regionOf() is read per call, so a region change cannot leave records and identity split.
t("regionOf tracks the env at call time", () => { const prev = process.env.SES_REGION; process.env.SES_REGION = "eu-west-1"; assert.strictEqual(sesDom.regionOf(), "eu-west-1"); process.env.SES_REGION = "eu-west-1"; assert.strictEqual(sesDom.regionOf(), "eu-west-1"); if (prev === undefined) delete process.env.SES_REGION; else process.env.SES_REGION = prev; });
t("isoDate survives every shape a timestamp arrives in", () => {
  // pg hands back real Date objects; String(date).slice(0,10) yields "Mon Aug 24" and that
  // bug only surfaces somewhere without JSON serialisation in the way, like a CSV export.
  assert.strictEqual(isoDate(new Date("2026-08-24T00:00:00Z")), "2026-08-24");
  assert.strictEqual(isoDate("2026-08-24T09:30:00.000Z"), "2026-08-24");
  assert.strictEqual(isoDate("2026-08-24"), "2026-08-24");
  assert.strictEqual(isoDate(null), "");
  assert.strictEqual(isoDate(""), "");
  assert.strictEqual(isoDate("not-a-date"), "");
});

t("TXT values carry no surrounding quotes, so they paste straight into a DNS manager", () => {
  // Quoting is BIND zone-file syntax, not part of the record. Hosted DNS managers add their
  // own, so a pre-quoted value publishes ""v=spf1 ..."" and verification fails with nothing
  // useful to go on. This was reported from a real failed verification.
  const recs = sesDom.buildDnsRecords("mail.acme.io", ["t1"], "eu-west-1");
  for (const r of recs.filter((x) => x.type === "TXT")) {
    assert(!r.value.startsWith('"') && !r.value.endsWith('"'), `${r.purpose} is quoted: ${r.value}`);
  }
  assert(recs.some((r) => r.purpose === "SENDING_SPF" && r.value === "v=spf1 include:amazonses.com ~all"));
  assert(recs.some((r) => r.purpose === "DMARC" && r.value.startsWith("v=DMARC1;")));
});

t("buildDnsRecords names the region it was built for", () => { const mx = sesDom.buildDnsRecords("mail.acme.io", ["t1"], "eu-west-1").find((r) => r.purpose === "MAIL_FROM_MX"); assert.strictEqual(mx!.value, "feedback-smtp.eu-west-1.amazonses.com"); });
t("regionFromRecords recovers the region of a legacy record set", () => assert.strictEqual(sesDom.regionFromRecords(sesDom.buildDnsRecords("mail.acme.io", ["t1"], "us-east-1")), "us-east-1"));
t("regionFromRecords returns null when there is nothing to read", () => { assert.strictEqual(sesDom.regionFromRecords([]), null); assert.strictEqual(sesDom.regionFromRecords(undefined), null); assert.strictEqual(sesDom.regionFromRecords([{ purpose: "MAIL_FROM_MX", value: "junk" }]), null); });

// assertEmailAvailable checks global address uniqueness in the database, so its tests
// live in test/integration/identity.int.test.ts.

// ── One person, one identity: last-admin protection ─────────────────────────
import * as guard from "../../src/services/org-guard.service";
import { splitName } from "../../src/domain/person";

// A minimal stand-in for the scoped repos object: only the calls org-guard makes.
const fakeRepos = (users, org: any = {}) => ({
  ctx: { orgId: "org1" },
  users: {
    all: async () => users,
    byId: async (id) => users.find((u) => u.id === id) || null,
    where: (f) => ({ one: async () => users.find((u) => Object.entries(f).every(([k, v]) => u[k] === v)) || null }),
  },
  organizations: { byId: async () => org },
});
const ADMIN = { id: "a1", email: "a@x.io", name: "A", role: "ADMIN", status: "ACTIVE" };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };

t("grantsSuperuser sees ADMIN, not HR/EMPLOYEE", () => { assert(guard.grantsSuperuser(["ADMIN"], {})); assert(!guard.grantsSuperuser(["HR", "EMPLOYEE"], {})); });
t("grantsSuperuser resolves a custom role from the org", () => { const org = { customRoles: { OWNER: { name: "Owner", permissions: ["*"] } } }; assert(guard.grantsSuperuser(["OWNER"], org)); assert(!guard.grantsSuperuser(["OWNER"], {})); });
t("canSignIn excludes DISABLED and INVITED", () => { assert(guard.canSignIn({ status: "ACTIVE" })); assert(guard.canSignIn({})); assert(!guard.canSignIn({ status: "DISABLED" })); assert(!guard.canSignIn({ status: "INVITED" })); });
t("assertNotLastAdmin blocks removing the only admin", async () => assert(await rejects(guard.assertNotLastAdmin(fakeRepos([ADMIN, { id: "e1", role: "EMPLOYEE", status: "ACTIVE" }]), "a1", "do that"))));
t("assertNotLastAdmin allows it when a second admin can sign in", async () => { await guard.assertNotLastAdmin(fakeRepos([ADMIN, { id: "a2", role: "ADMIN", status: "ACTIVE" }]), "a1", "do that"); assert(true); });
t("assertNotLastAdmin does not count an INVITED admin as cover", async () => assert(await rejects(guard.assertNotLastAdmin(fakeRepos([ADMIN, { id: "a2", role: "ADMIN", status: "INVITED" }]), "a1", "do that"))));
t("assertNotLastAdmin does not count a DISABLED admin as cover", async () => assert(await rejects(guard.assertNotLastAdmin(fakeRepos([ADMIN, { id: "a2", role: "ADMIN", status: "DISABLED" }]), "a1", "do that"))));
t("assertNotLastAdmin counts a custom superuser role as cover", async () => { const org = { customRoles: { OWNER: { name: "Owner", permissions: ["*"] } } }; await guard.assertNotLastAdmin(fakeRepos([ADMIN, { id: "a2", role: "OWNER", status: "ACTIVE" }], org), "a1", "do that"); assert(true); });
t("assertNotLastAdmin ignores non-admins entirely", async () => { await guard.assertNotLastAdmin(fakeRepos([ADMIN, { id: "e1", role: "EMPLOYEE", status: "ACTIVE" }]), "e1", "do that"); assert(true); });
t("assertEmployeeNotLastAdmin resolves through the employee link", async () => assert(await rejects(guard.assertEmployeeNotLastAdmin(fakeRepos([{ ...ADMIN, employeeId: "emp1" }]), "emp1", "remove them"))));
t("staffRolesOfEmployee reports staff roles, empty for a plain employee", async () => { assert.deepStrictEqual(await guard.staffRolesOfEmployee(fakeRepos([{ ...ADMIN, employeeId: "emp1" }]), "emp1"), ["ADMIN"]); assert.deepStrictEqual(await guard.staffRolesOfEmployee(fakeRepos([{ id: "e1", role: "EMPLOYEE", status: "ACTIVE", employeeId: "emp2" }]), "emp2"), []); });

t("splitName handles full, single-word and empty names", () => { assert.deepStrictEqual(splitName("Priya Nair", "x"), { firstName: "Priya", lastName: "Nair" }); assert.deepStrictEqual(splitName("Priya", "x"), { firstName: "Priya", lastName: "" }); assert.deepStrictEqual(splitName("  ", "fallback"), { firstName: "fallback", lastName: "" }); assert.deepStrictEqual(splitName("A B C", "x"), { firstName: "A", lastName: "B C" }); });

// ── Letter templates ────────────────────────────────────────────────────────
import * as lt from "../../src/domain/letter-templates";
import * as ltok from "../../src/domain/letter-tokens";

const SAMPLE_EMP = {
  firstName: "Priya", lastName: "Nair", code: "ACM-1024", designation: "Product Designer",
  employmentType: "FULL_TIME", joiningDate: "2026-09-01", probationMonths: 6,
  salary: { basic: 50000, hra: 20000, allowances: 10000 },
};
const SAMPLE_SUBJECT = {
  org: { name: "Acme", slug: "acme" },
  brand: { legalName: "Acme Technologies Pvt. Ltd.", signatory: { name: "Meera Nair", title: "Head of People" } },
  employee: SAMPLE_EMP, dept: { name: "Design" },
};

t("every letter kind has a default template", () => { for (const k of lt.LETTER_KINDS) assert(lt.DEFAULT_TEMPLATES[k.key], `missing default for ${k.key}`); });
t("templateFor falls back to the default, and prefers an override", () => { assert.strictEqual(lt.templateFor({}, "OFFER_LETTER").title, "Letter of Appointment"); assert.strictEqual(lt.templateFor({ letterTemplates: { OFFER_LETTER: { title: "Our Appointment Letter" } } }, "OFFER_LETTER").title, "Our Appointment Letter"); });
t("isCustomised only true once an override is stored", () => { assert(!lt.isCustomised({}, "OFFER_LETTER")); assert(lt.isCustomised({ letterTemplates: { OFFER_LETTER: { title: "x" } } }, "OFFER_LETTER")); });

// Every token a shipped template references must exist, or a signed letter silently prints
// a blank where a name or a date should be.
t("no default template references an unknown token", () => {
  const bad: string[] = [];
  for (const [kind, tpl] of Object.entries<any>(lt.DEFAULT_TEMPLATES)) {
    const texts = [tpl.title, tpl.marker || "", ...(tpl.recipientLines || [])];
    for (const b of tpl.blocks) {
      if (b.text) texts.push(b.text);
      if (b.items) texts.push(...b.items);
      if (b.pairs) for (const p of b.pairs) texts.push(p[0], p[1]);
    }
    for (const s of texts) for (const u of ltok.unknownTokens(s)) bad.push(`${kind}: {{${u}}}`);
  }
  assert.deepStrictEqual(bad, []);
});

// House style: no em or en dashes anywhere in letter copy. They are easy to introduce by
// copy-paste, render inconsistently across the bundled fonts, and are not house style.
t("no default template copy contains an em or en dash", () => {
  const bad: string[] = [];
  for (const [kind, tpl] of Object.entries<any>(lt.DEFAULT_TEMPLATES)) {
    const texts = [tpl.title, tpl.marker || "", ...(tpl.recipientLines || [])];
    for (const b of tpl.blocks) {
      if (b.text) texts.push(b.text);
      if (b.items) texts.push(...b.items);
    }
    for (const s of texts) if (/[\u2013\u2014]/.test(s)) bad.push(`${kind}: ${s.slice(0, 60)}`);
  }
  assert.deepStrictEqual(bad, []);
});

t("renderText substitutes known tokens", () => { const tk = ltok.buildTokens(SAMPLE_SUBJECT); assert.strictEqual(ltok.renderText("Dear {{employee.firstName}},", tk), "Dear Priya,"); assert.strictEqual(ltok.renderText("{{employee.fullName}} ({{employee.code}})", tk), "Priya Nair (ACM-1024)"); });
t("renderText drops an unknown token rather than printing it raw", () => assert.strictEqual(ltok.renderText("Hello {{nope.missing}}world", ltok.buildTokens(SAMPLE_SUBJECT)), "Hello world"));
t("renderText tidies space left by an empty token", () => { const tk = ltok.buildTokens(SAMPLE_SUBJECT); assert.strictEqual(ltok.renderText("Details: {{letter.reason}}", tk), "Details:"); assert.strictEqual(ltok.renderText("as {{employee.designation}} {{employee.managerName}}, effective", tk), "as Product Designer, effective"); });
t("buildTokens formats dates and money for print", () => { const tk = ltok.buildTokens(SAMPLE_SUBJECT); assert.strictEqual(tk["employee.joiningDate"], "01 September 2026"); assert(tk["salary.gross"].includes("80,000")); assert.strictEqual(tk["employee.employmentType"], "full-time"); });
t("buildTokens derives the confirmation date from probation length", () => assert.strictEqual(ltok.buildTokens(SAMPLE_SUBJECT)["employee.confirmationDate"], "01 March 2027"));
t("buildTokens uses they/them, never a guessed pronoun", () => { const tk = ltok.buildTokens(SAMPLE_SUBJECT); assert.strictEqual(tk["employee.pronounThem"], "them"); assert.strictEqual(tk["employee.pronounTheir"], "their"); });
t("buildTokens leaves every catalogue key defined", () => { const tk = ltok.buildTokens({ org: {}, brand: {}, employee: {} }); for (const k of ltok.TOKEN_KEYS) assert(typeof tk[k] === "string", `${k} is not a string`); });
t("probationEndDate handles a missing joining date or zero months", () => { assert.strictEqual(ltok.probationEndDate(null, 6), null); assert.strictEqual(ltok.probationEndDate("2026-09-01", 0), null); assert.strictEqual(ltok.probationEndDate("2026-09-01", 3), "2026-12-01"); });
t("unknownTokens reports only names outside the catalogue", () => { assert.deepStrictEqual(ltok.unknownTokens("{{employee.firstName}} {{employee.firstname}}"), ["employee.firstname"]); assert.deepStrictEqual(ltok.unknownTokens("no tokens here"), []); });

// ── Sign-in identity (official vs personal email) ───────────────────────────
import * as ident from "../../src/services/identity.service";

t("resolveLoginEmail prefers the official address", () => { assert.strictEqual(ident.resolveLoginEmail({ officialEmail: "p.nair@acme.com", personalEmail: "p@gmail.com" }), "p.nair@acme.com"); assert.strictEqual(ident.resolveLoginEmail({ personalEmail: "p@gmail.com" }), "p@gmail.com"); assert.strictEqual(ident.resolveLoginEmail({ email: "old@acme.com" }), "old@acme.com"); });
t("joiningEmail prefers the PERSONAL address", () => { assert.strictEqual(ident.joiningEmail({ officialEmail: "p.nair@acme.com", personalEmail: "p@gmail.com" }), "p@gmail.com"); assert.strictEqual(ident.joiningEmail({ officialEmail: "p.nair@acme.com" }), "p.nair@acme.com"); });
t("contactEmail prefers the official address", () => assert.strictEqual(ident.contactEmail({ officialEmail: "p.nair@acme.com", personalEmail: "p@gmail.com" }), "p.nair@acme.com"));
t("normaliseEmail trims and lowercases, tolerating null", () => { assert.strictEqual(ident.normaliseEmail("  P.Nair@ACME.com "), "p.nair@acme.com"); assert.strictEqual(ident.normaliseEmail(null), ""); assert.strictEqual(ident.normaliseEmail(undefined), ""); });
t("assertEmail rejects malformed addresses", () => { assert.strictEqual(ident.assertEmail("a@b.co", "x"), "a@b.co"); for (const badAddr of ["nope", "a@b", "a b@c.com", "@b.com"]) assert(throws(() => ident.assertEmail(badAddr, "x")), `${badAddr} should be rejected`); });

/*
 * A person's own login is not a clash with themselves.
 *
 * Shipped broken: editing any employee whose address matched their own login (which is every
 * employee created since one-person-one-identity) failed with "already the sign-in address
 * for someone in this workspace", even when only the joining date had changed.
 */


// ── Separation: choosing the exit paperwork ─────────────────────────────────
import * as sep from "../../src/domain/separation-config";

t("defaultDocumentsFor follows the type", () => { assert.deepStrictEqual(sep.defaultDocumentsFor({ type: "RESIGNATION" }), ["RELIEVING_LETTER"]); assert.deepStrictEqual(sep.defaultDocumentsFor({ type: "RETIREMENT" }), ["RETIREMENT_LETTER"]); });
t("a termination for misconduct drops the experience certificate", () => { assert.deepStrictEqual(sep.defaultDocumentsFor({ type: "TERMINATION", subReason: "MISCONDUCT" }), ["TERMINATION_LETTER"]); assert.deepStrictEqual(sep.defaultDocumentsFor({ type: "TERMINATION", subReason: "LAYOFF" }), ["TERMINATION_LETTER", "EXPERIENCE_LETTER"]); });
t("isForCause is only true for misconduct terminations", () => { assert(sep.isForCause({ type: "TERMINATION", subReason: "MISCONDUCT" })); assert(!sep.isForCause({ type: "TERMINATION", subReason: "LAYOFF" })); assert(!sep.isForCause({ type: "RESIGNATION", subReason: "MISCONDUCT" })); });
t("an explicit choice overrides the type default", () => assert.deepStrictEqual(sep.documentsFor({ type: "RESIGNATION", documents: ["RELIEVING_LETTER", "EXPERIENCE_LETTER"] }), ["RELIEVING_LETTER", "EXPERIENCE_LETTER"]));
t("choosing no documents is honoured, not treated as absent", () => assert.deepStrictEqual(sep.documentsFor({ type: "RESIGNATION", documents: [] }), []));
t("an absent choice falls back to the default", () => assert.deepStrictEqual(sep.documentsFor({ type: "RESIGNATION" }), ["RELIEVING_LETTER"]));
t("unknown letter keys are filtered out of a choice", () => assert.deepStrictEqual(sep.documentsFor({ type: "RESIGNATION", documents: ["RELIEVING_LETTER", "PAYSLIP"] }), ["RELIEVING_LETTER"]));

// ── Leave rules (monthly paid-leave limit, notice for long leave) ───────────
// October 2026: Thu 1, Fri 2 (Gandhi Jayanti), weekends 3-4, 10-11, 17-18, 24-25, 31.
import * as lrules from "../../src/domain/leave-rules";
const RULES_ON = lrules.normalizeLeaveRules({
  monthlyLimit: { enabled: true, newJoinerLimit: 1, newJoinerMonths: 3, limit: 2 },
  advanceNotice: { enabled: true, minDays: 3, noticeDays: 7 },
  workingDaysOnly: true,
});
const CAL = { workingDays: [1, 2, 3, 4, 5], holidays: new Set(["2026-10-02"]) };
const CASUAL = { name: "Casual Leave", paid: true };
const SICK = { name: "Sick Leave", paid: true };
const LOP = { name: "Loss of Pay", paid: false };
const span = (from, to = from) => ({ from, to });
const overages = (joiningDate, request, others: any[] = []) =>
  lrules.monthlyOverages({ rules: RULES_ON, cal: CAL, joiningDate, request, others });
const shortfall = (request, others: any[] = [], rules = RULES_ON) =>
  lrules.noticeShortfall({ rules, cal: CAL, today: "2026-10-15", request, others });

t("leave rules are all off by default", () => {
  const d = lrules.readLeaveRules({});
  assert(!d.monthlyLimit.enabled && !d.advanceNotice.enabled && !d.workingDaysOnly);
  assert.deepStrictEqual([d.monthlyLimit.newJoinerLimit, d.monthlyLimit.newJoinerMonths, d.monthlyLimit.limit], [1, 3, 2]);
  assert.deepStrictEqual([d.advanceNotice.minDays, d.advanceNotice.noticeDays], [3, 7]);
});
t("leave rules clamp bad numbers and fall back on garbage", () => {
  const r = lrules.normalizeLeaveRules({
    monthlyLimit: { enabled: 1, limit: -5, newJoinerLimit: "abc", newJoinerMonths: 100 },
    advanceNotice: { minDays: 0, noticeDays: "10" },
  });
  assert.strictEqual(r.monthlyLimit.enabled, true);
  assert.deepStrictEqual([r.monthlyLimit.limit, r.monthlyLimit.newJoinerLimit, r.monthlyLimit.newJoinerMonths], [0, 1, 24]);
  assert.deepStrictEqual([r.advanceNotice.minDays, r.advanceNotice.noticeDays], [1, 10]);
});
t("which leave types the rules apply to", () => {
  assert(lrules.countsTowardMonthlyLimit(CASUAL) && lrules.needsAdvanceNotice(CASUAL));
  assert(lrules.countsTowardMonthlyLimit(SICK) && !lrules.needsAdvanceNotice(SICK), "sick is unplanned");
  assert(!lrules.countsTowardMonthlyLimit({ key: "MATERNITY", name: "Maternity Leave", paid: true }), "block leave");
  assert(!lrules.countsTowardMonthlyLimit(LOP) && lrules.needsAdvanceNotice(LOP));
  assert(!lrules.countsTowardMonthlyLimit({ ...LOP, countsTowardMonthlyLimit: true }), "unpaid never counts");
  assert(!lrules.countsTowardMonthlyLimit({ ...CASUAL, countsTowardMonthlyLimit: false }), "explicit setting wins");
  assert(lrules.countsTowardMonthlyLimit({ name: "Work From Home Day", paid: true }), "custom paid types count");
});
t("addMonths clamps to the end of a shorter month", () => {
  assert.strictEqual(lrules.addMonths("2026-08-20", 3), "2026-11-20");
  assert.strictEqual(lrules.addMonths("2026-01-31", 1), "2026-02-28");
  assert.strictEqual(lrules.addMonths("2026-11-30", 3), "2027-02-28");
});
t("working-day counting skips weekends and holidays", () => {
  assert.deepStrictEqual(lrules.leaveDates("2026-10-16", "2026-10-19", RULES_ON, CAL), ["2026-10-16", "2026-10-19"]);
  assert.deepStrictEqual(lrules.leaveDates("2026-10-01", "2026-10-05", RULES_ON, CAL), ["2026-10-01", "2026-10-05"]);
  assert.strictEqual(lrules.leaveDates("2026-10-01", "2026-10-05", { ...RULES_ON, workingDaysOnly: false }, CAL).length, 5);
});
t("the new-joiner limit applies for the first months after joining", () => {
  const before = lrules.monthlyLimitOn("2026-11-19", "2026-08-20", RULES_ON);
  assert.deepStrictEqual(before, { limit: 1, newJoiner: true, newJoinerEnds: "2026-11-19" });
  assert.strictEqual(lrules.monthlyLimitOn("2026-11-20", "2026-08-20", RULES_ON).limit, 2);
  assert.strictEqual(lrules.monthlyLimitOn("2026-11-20", null, RULES_ON).limit, 2, "no joining date: regular limit");
});
t("a new joiner gets 1 paid day a month", () => {
  assert.deepStrictEqual(overages("2026-09-01", span("2026-10-20")), []);
  assert.deepStrictEqual(overages("2026-09-01", span("2026-10-20"), [span("2026-10-12")]), [
    { month: "2026-10", limit: 1, used: 1, requested: 1, newJoiner: true },
  ]);
});
t("after the new-joiner period the limit is 2 a month", () => {
  assert.deepStrictEqual(overages("2026-01-05", span("2026-10-20"), [span("2026-10-12")]), []);
  const o = overages("2026-01-05", span("2026-10-20", "2026-10-21"), [span("2026-10-12")]);
  assert.strictEqual(o.length, 1);
  assert.deepStrictEqual([o[0].limit, o[0].used, o[0].requested, o[0].newJoiner], [2, 1, 2, false]);
});
t("a weekend inside a request does not use up the limit", () => {
  assert.deepStrictEqual(overages("2026-01-05", span("2026-10-16", "2026-10-19")), []);
});
t("a day already covered by another request is not counted twice", () => {
  assert.deepStrictEqual(overages("2026-01-05", span("2026-10-12"), [span("2026-10-12"), span("2026-10-13")]), []);
});
t("a request across two months is checked month by month", () => {
  const o = overages("2026-01-05", span("2026-10-30", "2026-11-02"), [span("2026-10-28", "2026-10-29")]);
  assert.deepStrictEqual(o.map((x) => [x.month, x.used, x.requested]), [["2026-10", 2, 1]]);
});
t("rules that are off find nothing", () => {
  const off = lrules.readLeaveRules({});
  assert.deepStrictEqual(lrules.monthlyOverages({ rules: off, cal: CAL, joiningDate: "2026-10-01", request: span("2026-10-12", "2026-10-30"), others: [] }), []);
  assert.strictEqual(shortfall(span("2026-10-16", "2026-10-30"), [], off), null);
});
t("long leave needs notice; short or far-off leave does not", () => {
  assert.deepStrictEqual(shortfall(span("2026-10-19", "2026-10-21")), { runDays: 3, runFrom: "2026-10-19", runTo: "2026-10-21", daysAhead: 4 });
  assert.strictEqual(shortfall(span("2026-10-26", "2026-10-28")), null, "11 days ahead");
  assert.strictEqual(shortfall(span("2026-10-19", "2026-10-20")), null, "2 days is not long");
});
t("long leave split into short requests is judged as one run", () => {
  const s = shortfall(span("2026-10-19", "2026-10-20"), [span("2026-10-16")]);
  assert(s, "Fri + weekend + Mon-Tue is 3 working days in a row");
  assert.deepStrictEqual([s.runDays, s.runFrom, s.runTo], [3, "2026-10-16", "2026-10-20"]);
});
t("in calendar-day mode a weekend counts toward long leave", () => {
  assert(shortfall(span("2026-10-17", "2026-10-19"), [], { ...RULES_ON, workingDaysOnly: false }));
  assert.strictEqual(shortfall(span("2026-10-17", "2026-10-19")), null, "only Monday is a working day");
});
t("sick leave skips notice but still counts toward the monthly limit", () => {
  const problems = lrules.leaveRuleProblems({
    rules: RULES_ON, cal: CAL, today: "2026-10-15", joiningDate: "2026-09-01", type: SICK,
    request: span("2026-10-19", "2026-10-21"), others: [], audience: "applicant", checkNotice: true,
  });
  assert.deepStrictEqual(problems.map((p) => p.rule), ["MONTHLY_LIMIT"]);
  assert(/1 day a month for the first 3 months after joining/.test(problems[0].message), problems[0].message);
  assert(/only 1 is left\. Apply 1 as paid leave and the rest as Loss of Pay/.test(problems[0].message), problems[0].message);
});
t("loss of pay skips the monthly limit but needs notice when long", () => {
  const problems = lrules.leaveRuleProblems({
    rules: RULES_ON, cal: CAL, today: "2026-10-15", joiningDate: "2026-09-01", type: LOP,
    request: span("2026-10-19", "2026-10-21"), others: [{ ...span("2026-10-12"), type: CASUAL }],
    audience: "applicant", checkNotice: true,
  });
  assert.deepStrictEqual(problems.map((p) => p.rule), ["ADVANCE_NOTICE"]);
  assert(/3 or more working days .* at least 7 days .* starts in 4 days/.test(problems[0].message), problems[0].message);
});
t("only other requests of counting types use up the limit", () => {
  const problems = lrules.leaveRuleProblems({
    rules: RULES_ON, cal: CAL, today: "2026-10-15", joiningDate: "2026-09-01", type: CASUAL,
    request: span("2026-10-27"), others: [{ ...span("2026-10-12"), type: LOP }],
    audience: "applicant", checkNotice: true,
  });
  assert.deepStrictEqual(problems, []);
});
t("approvers are told what they would override", () => {
  const problems = lrules.leaveRuleProblems({
    rules: RULES_ON, cal: CAL, today: "2026-10-15", joiningDate: "2026-01-05", type: CASUAL,
    request: span("2026-10-27"), others: [{ ...span("2026-10-12", "2026-10-13"), type: CASUAL }],
    audience: "approver", checkNotice: false,
  });
  assert.strictEqual(problems.length, 1);
  assert(/^Approving this goes over the monthly paid-leave limit of 2 days a month: 2 days already approved in October 2026/.test(problems[0].message), problems[0].message);
});
t("monthly allowance shows what is used and when the new-joiner period ends", () => {
  const a = lrules.monthlyAllowance({
    rules: RULES_ON, cal: CAL, joiningDate: "2026-09-01", month: "2026-10", onDate: "2026-10-15",
    taken: [span("2026-10-12"), span("2026-11-03")],
  });
  assert.deepStrictEqual(a, { month: "2026-10", limit: 1, used: 1, remaining: 0, newJoiner: true, newJoinerEnds: "2026-11-30", carriedOver: 0 });
});

// Carry-over: unused paid days roll into the following months, within the calendar year.
// Joined 1 Sep 2026: Sep, Oct and Nov each add 1 day (new joiner), December adds 2.
const RULES_CARRY = lrules.normalizeLeaveRules({ ...RULES_ON, monthlyLimit: { ...RULES_ON.monthlyLimit, carryOver: true } });
const carry = (joiningDate, request, others: any[] = []) =>
  lrules.monthlyOverages({ rules: RULES_CARRY, cal: CAL, joiningDate, request, others });
t("carry-over is off by default", () => assert.strictEqual(lrules.readLeaveRules({}).monthlyLimit.carryOver, false));
t("carry-over: an unused month rolls into the next one", () => {
  assert.deepStrictEqual(carry("2026-09-01", span("2026-10-12", "2026-10-13")), [], "Sep + Oct = 2 days");
  assert.strictEqual(overages("2026-09-01", span("2026-10-12", "2026-10-13")).length, 1, "without carry-over it is over");
});
t("carry-over: never more than has built up", () => {
  const o = carry("2026-09-01", span("2026-10-12", "2026-10-14"));
  assert.deepStrictEqual(o.map((x) => [x.month, x.available, x.requested]), [["2026-10", 2, 3]]);
});
t("carry-over: days already used do not carry", () => {
  const o = carry("2026-09-01", span("2026-10-12", "2026-10-13"), [span("2026-09-14")]);
  assert.deepStrictEqual(o.map((x) => [x.available, x.requested]), [[1, 2]]);
});
t("carry-over: leave already booked later in the year keeps its days", () => {
  // Nov already has 2 days booked against 3 built up by then, so October can only add 1.
  const o = carry("2026-09-01", span("2026-10-12", "2026-10-13"), [span("2026-11-10", "2026-11-11")]);
  assert.deepStrictEqual(o.map((x) => [x.available, x.requested]), [[1, 2]]);
});
t("carry-over: the running total resets each calendar year", () => {
  // Joined Jan 2026 and took nothing all year, but January 2027 still only has its own 2 days.
  const o = carry("2026-01-05", span("2027-01-04", "2027-01-06"));
  assert.deepStrictEqual(o.map((x) => [x.month, x.available, x.requested]), [["2027-01", 2, 3]]);
});
t("carry-over: the messages explain the build-up", () => {
  const ask = (audience) => lrules.leaveRuleProblems({
    rules: RULES_CARRY, cal: CAL, today: "2026-10-01", joiningDate: "2026-09-01", type: CASUAL,
    request: span("2026-10-12", "2026-10-13"), others: [{ ...span("2026-09-14"), type: CASUAL }],
    audience, checkNotice: false,
  })[0].message;
  assert(/^Paid leave builds up at 1 paid day a month for the first 3 months after joining, then 2 a month, and unused days carry over\. 1 paid day is available for this request, but it needs 2\. Apply 1 as paid leave and the rest as Loss of Pay\.$/.test(ask("applicant")), ask("applicant"));
  assert(/^Approving this goes over the paid leave built up so far/.test(ask("approver")), ask("approver"));
});
t("carry-over: the allowance shows days carried over", () => {
  const a = lrules.monthlyAllowance({ rules: RULES_CARRY, cal: CAL, joiningDate: "2026-09-01", month: "2026-10", onDate: "2026-10-15", taken: [span("2026-10-12")] });
  assert.deepStrictEqual([a.limit, a.used, a.remaining, a.carriedOver], [2, 1, 1, 1]);
});

// ── Storage (local) + mailer (outbox) ───────────────────────────────────────
t("storage returns the exact bytes written", async () => {
  const buf = Buffer.from("unit-" + Math.random());
  await storage.putBuffer("uploads", "unit_test.bin", buf, "application/octet-stream");
  const back = await storage.getBuffer("uploads", "unit_test.bin");
  assert.strictEqual(back.toString(), buf.toString());
  await storage.remove("uploads", "unit_test.bin");
});

t("mailer (outbox) returns outbox mode", async () => {
  const r = await sendMail({ to: "unit@test.local", subject: "unit", html: "<b>hi</b>" });
  assert.strictEqual(r.mode, "outbox");
});
