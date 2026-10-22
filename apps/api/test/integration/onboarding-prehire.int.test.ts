/**
 * The PRE-HIRE candidate flow, end to end over the public token routes:
 *
 *   invite -> token link -> resumable form -> documents and assets -> submit -> HR review
 *   -> approve -> employee + login + welcome email.
 *
 * The property under test is the one a one-shot "create employee" form cannot give:
 * nothing the candidate types reaches the roster until HR approves. Every assertion about
 * the roster is therefore made twice, before approval (absent) and after (exact).
 *
 * One ordered scenario: later tests use the invite token and case opened by earlier ones.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../src/repositories/base.repository";
import { ACCOUNTS, MAIL_READABLE, client, mailSince, outboxMark, seedFixtures, startServer, type Res } from "./fixtures";

let server: { base: string; close: () => Promise<void> };
let api: ReturnType<typeof client>;
let r: ReturnType<typeof repos>;
let hr = "";

const CANDIDATE_EMAIL = "iris.noor@candidates.example.com";

beforeAll(async () => {
  const fx = await seedFixtures();
  r = repos({ orgId: fx.acme.id });
  server = await startServer();
  api = client(server.base);
  hr = await api.login(ACCOUNTS.acmeAdmin);
});
afterAll(() => server.close());

const call = (m: string, p: string, token?: string | null, body?: unknown): Promise<Res> => api.call(m, p, token, body);

/**
 * A value that actually satisfies the field. Keyed on the declared `pattern`, because the
 * named patterns are the contract: feeding "Filled" into a PIN code tests nothing except
 * that validation fires.
 */
const PATTERN_SAMPLE: Record<string, string> = {
  PAN: "ABCDE1234F",
  AADHAAR: "234567890123",
  UAN: "123456789012",
  ESIC: "12345678901234567",
  IFSC: "EXMP0001234",
  BANK_ACCOUNT: "12345678901",
  PINCODE: "560001",
  GSTIN: "29ABCDE1234F1Z5",
  PASSPORT_IN: "A1234567",
};

/** Identity answers are asserted against the employee record, so they carry known values. */
const BY_PATH: Record<string, any> = { firstName: "Iris", lastName: "Noor", dob: "1998-04-17", personalEmail: CANDIDATE_EMAIL };

function sampleValue(f: any): any {
  if (f.mapsTo && BY_PATH[f.mapsTo] !== undefined) return BY_PATH[f.mapsTo];
  if (f.pattern && PATTERN_SAMPLE[String(f.pattern).toUpperCase()]) return PATTERN_SAMPLE[String(f.pattern).toUpperCase()];
  switch (f.type) {
    case "date": return "1998-04-17";
    case "number": {
      // Honour the field's own bounds: "year of passing" is a number with a floor.
      const min = Number.isFinite(Number(f.min)) ? Number(f.min) : 1;
      const max = Number.isFinite(Number(f.max)) ? Number(f.max) : min + 1;
      return Math.min(Math.max(min, 2020), max);
    }
    case "select":
    case "multiselect": return f.options?.[0] ?? "x";
    case "checkbox": return true;
    case "email": return CANDIDATE_EMAIL;
    case "phone": return "9876500011";
    default: return "Filled";
  }
}

/** Smallest valid PNG, so document uploads are real multipart requests. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("Pre-hire onboarding", () => {
  let inviteId = "";
  let token = "";
  let caseId = "";
  let assetId = "";
  let employeeId = "";
  let first: any;
  let rosterSize = 0;
  let userCount = 0;
  let detail: Res;

  const noCandidateOnRoster = async () => {
    const emps = await r.employees.all();
    const users = await r.users.all();
    expect(emps.length).toBe(rosterSize);
    expect(users.length).toBe(userCount);
    expect(emps.some((e: any) => [e.email, e.personalEmail, e.officialEmail].includes(CANDIDATE_EMAIL) || e.firstName === "Iris")).toBe(false);
    expect(users.some((u: any) => u.email === CANDIDATE_EMAIL)).toBe(false);
  };

  describe("HR invites a candidate", () => {
    // A clean workspace has no form at all, so this one is made the default: the invite's
    // employment type must resolve to it.
    it("activates a default form for the invite to resolve against", async () => {
      rosterSize = (await r.employees.all()).length;
      userCount = (await r.users.all()).length;
      const tpl = await call("POST", "/api/onboarding-templates", hr, { presetKey: "MINIMAL" });
      expect(tpl.status).toBe(201);
      expect((await call("POST", `/api/onboarding-templates/${tpl.data.id}/status`, hr, { status: "ACTIVE" })).status).toBe(200);
      expect((await call("POST", `/api/onboarding-templates/${tpl.data.id}/default`, hr)).status).toBe(200);
    });

    it("creates the invite, carrying a link with a token", async () => {
      const mark = await outboxMark();
      const inv = await call("POST", "/api/onboarding/invites", hr, {
        firstName: "Iris", lastName: "Noor", personalEmail: CANDIDATE_EMAIL,
        employmentType: "PERMANENT", designation: "Analyst", joiningDate: "2026-09-01", salaryBasic: 50000,
      });
      expect(inv.status, inv.body.slice(0, 200)).toBe(201);
      inviteId = inv.data.invite.id;
      token = inv.data.invite.token;
      expect(token).toBeTruthy();
      expect(inv.data.invite.link || "").toMatch(/onboard\?token=/);
      if (MAIL_READABLE) {
        const sent = (await mailSince(mark)).filter((m) => m.to.includes(CANDIDATE_EMAIL));
        expect(sent, "the invite is mailed to the personal address").toHaveLength(1);
        expect(sent[0].text).toContain(token);
      }
    });
  });

  describe("the candidate opens the link", () => {
    it("opens a form without any login, and a case on first use", async () => {
      const res = await call("GET", `/api/onboarding/public/${token}`, null);
      expect(res.status).toBe(200);
      first = res.data;
      caseId = first.case?.id;
      expect(caseId).toBeTruthy();
    });

    it("the form is the workspace's, and names the candidate", async () => {
      expect(first.org?.name).toBe("Acme");
      expect(first.invite?.firstName).toBe("Iris");
    });

    it("HR's name prefills so nobody retypes the offer letter", async () => {
      expect(Object.values(first.case.sections || {}).some((s: any) => s.values?.firstName === "Iris")).toBe(true);
    });

    it("re-opening the same link resumes the SAME case", async () => {
      const again = await call("GET", `/api/onboarding/public/${token}`, null);
      expect(again.data.case.id).toBe(caseId);
    });
  });

  describe("filling it in over more than one sitting", () => {
    let firstSection = "";

    it("a section saves without submitting the whole form", async () => {
      firstSection = first.case.templateSnapshot[0].key;
      const saved = await call("PATCH", `/api/onboarding/public/${token}/sections/${firstSection}`, null, {
        values: { firstName: "Iris", lastName: "Noor", personalEmail: CANDIDATE_EMAIL, phone: "9876500011", dob: "1998-04-17" },
      });
      expect(saved.status).toBe(200);
    });

    it("what was typed is still there after closing the tab, with progress reported", async () => {
      const resumed = await call("GET", `/api/onboarding/public/${token}`, null);
      expect(resumed.data.case.sections[firstSection]?.values?.phone).toBe("9876500011");
      expect(resumed.data.case.progress?.total || 0).toBeGreaterThan(0);
    });

    it("an invalid answer is saved and explained, not thrown away", async () => {
      const bad = await call("PATCH", `/api/onboarding/public/${token}/sections/${firstSection}`, null, { values: { firstName: "Iris", dob: "not-a-date" } });
      expect(bad.status).toBe(200);
      expect((bad.data.errors || []).length).toBeGreaterThan(0);
    });

    it("nothing has touched the roster yet", noCandidateOnRoster);

    it("every section can be completed, including uploads with no login", async () => {
      const full = await call("GET", `/api/onboarding/public/${token}`, null);
      let uploaded = 0;
      for (const section of full.data.case.templateSnapshot) {
        const values: any = {};
        for (const f of section.fields || []) if (f.type !== "file") values[f.key] = sampleValue(f);

        // Repeating sections take rows, not values.
        if (["EMPLOYMENT_HISTORY", "EDUCATION", "DEPENDENTS"].includes(section.kind)) {
          const res = await call("PATCH", `/api/onboarding/public/${token}/sections/${section.key}`, null, { rows: [values] });
          expect(res.status).toBe(200);
        } else if (Object.keys(values).length) {
          const res = await call("PATCH", `/api/onboarding/public/${token}/sections/${section.key}`, null, { values });
          expect(res.status).toBe(200);
        }

        // Required proofs are `file` fields carrying a proofCategory, plus an optional documents list.
        const needed = [
          ...(section.documents || []).filter((d: any) => d.required !== false).map((d: any) => d.category),
          ...(section.fields || []).filter((f: any) => f.type === "file" && f.required).map((f: any) => f.proofCategory),
        ].filter(Boolean);
        for (const category of [...new Set(needed)] as string[]) {
          const up = await api.upload(`/api/onboarding/public/${token}/documents`, null, { category, sectionKey: section.key }, { name: `${category.toLowerCase()}.png`, buffer: PIXEL, type: "image/png" });
          expect(up.status, up.body.slice(0, 200)).toBe(201);
          uploaded++;
        }

        if (section.kind === "DECLARATION") {
          expect((await call("POST", `/api/onboarding/public/${token}/declare`, null, { fullName: "Iris Noor" })).status).toBe(200);
        }
        if (section.kind === "ACKNOWLEDGMENT") {
          const pol = await call("GET", `/api/onboarding/public/${token}/policies`, null);
          expect(pol.status, "policies are readable without a login").toBe(200);
          expect(Array.isArray(pol.data)).toBe(true);
          if (pol.data.length) {
            const ack = await call("POST", `/api/onboarding/public/${token}/acknowledge`, null, { policyIds: pol.data.map((p: any) => p.id) });
            expect(ack.status).toBe(200);
          }
        }
      }
      expect(uploaded, "a candidate with no login can upload their documents").toBeGreaterThan(0);
    });

    // Asserted outside the section loop: the minimal form has no acknowledgement section,
    // and the route must work for a candidate either way.
    it("policies are readable without a login", async () => {
      const pol = await call("GET", `/api/onboarding/public/${token}/policies`, null);
      expect(pol.status).toBe(200);
      expect(Array.isArray(pol.data)).toBe(true);
      expect(pol.data.length).toBe((await r.policies.all()).length);
      expect(pol.data.length).toBeGreaterThan(0);
    });
  });

  describe("assets for somebody who is not an employee yet", () => {
    let prov: Res;

    it("HR can provision an asset to a joiner with no employee record", async () => {
      prov = await call("POST", "/api/assets", hr, { caseId, category: "LAPTOP", name: "Laptop 13", serial: "SN-DAY-ONE", condition: "New" });
      expect(prov.status, prov.body.slice(0, 200)).toBe(201);
      assetId = prov.data.id;
    });

    it("it is held against the case, not against nobody", async () => {
      expect(prov.data.employeeId).toBeNull();
      expect(prov.data.caseId).toBe(caseId);
    });

    it("the register names the joiner rather than showing Unassigned", () => expect(prov.data.employeeName).toBe("Iris Noor"));

    it("the candidate sees it on their own form", async () => {
      const seen = await call("GET", `/api/onboarding/public/${token}/assets`, null);
      expect(seen.data?.issued).toHaveLength(1);
    });

    // The person holding the laptop is not the one who typed it into the register.
    it("the candidate can confirm receipt with no login; a mismatched serial is flagged, not refused", async () => {
      const ackd = await call("POST", `/api/onboarding/public/${token}/assets/${assetId}/acknowledge`, null, { received: true, serial: "SN-WRONG", condition: "Good" });
      expect(ackd.status).toBe(200);
      expect(ackd.data.acknowledgment.discrepancy).toBe(true);
      expect(ackd.data.acknowledgment.serialConfirmed).toBe(false);
    });

    it("a candidate cannot acknowledge an asset that is not theirs", async () => {
      const foreign = await call("POST", `/api/onboarding/public/${token}/assets/does-not-exist/acknowledge`, null, { received: true });
      expect(foreign.status).toBe(404);
    });
  });

  describe("submit and review", () => {
    it("the candidate can submit, handing the case to HR", async () => {
      const submitted = await call("POST", `/api/onboarding/public/${token}/submit`, null);
      expect(submitted.status, submitted.body.slice(0, 300)).toBe(200);
      expect(submitted.data.case?.status).toBe("SUBMITTED");
    });

    it("submitting STILL does not create an employee or a login", noCandidateOnRoster);

    it("the candidate appears in the review queue, named from the invite and flagged pre-hire", async () => {
      const queue = await call("GET", "/api/onboarding-cases?status=SUBMITTED", hr);
      const row = (queue.data || []).find((c: any) => c.id === caseId);
      expect(row).toBeTruthy();
      expect(row.employeeName).toBe("Iris Noor");
      expect(row.preHire).toBe(true);
    });

    it("the review drawer opens and carries the invite terms HR set", async () => {
      detail = await call("GET", `/api/onboarding-cases/${caseId}`, hr);
      expect(detail.status).toBe(200);
      expect(detail.data.preHire).toBe(true);
      expect(detail.data.invite?.designation).toBe("Analyst");
    });
  });

  describe("approval, and only now does the employee exist", () => {
    let approved: Res;
    let emp: any;
    let welcomeMark: Set<string>;

    it("approval succeeds and reports the employee it created", async () => {
      for (const s of detail.data.templateSnapshot) {
        const res = await call("POST", `/api/onboarding-cases/${caseId}/sections/${s.key}/review`, hr, { verdict: "APPROVED" });
        expect(res.status).toBe(200);
      }
      welcomeMark = await outboxMark();
      approved = await call("POST", `/api/onboarding-cases/${caseId}/approve`, hr);
      expect(approved.status, approved.body.slice(0, 300)).toBe(200);
      employeeId = approved.data.created?.employeeId;
      expect(employeeId).toBeTruthy();
      emp = await r.employees.byId(employeeId);
    });

    it("the one-time password is NOT returned to the reviewer", async () => {
      expect(JSON.stringify(approved.data).toLowerCase()).not.toContain("password");
    });

    it("the employee record exists with the candidate's own answers", async () => {
      expect(emp).toBeTruthy();
      expect(emp.firstName).toBe("Iris");
      expect(emp.dob).toBe("1998-04-17");
    });

    it("HR's terms come from the invite, not the candidate", async () => {
      expect(emp.designation).toBe("Analyst");
      expect(emp.employmentType).toBe("PERMANENT");
      expect(String(emp.joiningDate).slice(0, 10)).toBe("2026-09-01");
    });

    it("compensation comes from the invite, never from the form", () => expect(Number(emp.salary?.basic)).toBe(50000));

    it("they are given an official email and an employee code", async () => {
      expect(String(emp.officialEmail || "")).toMatch(/@/);
      expect(emp.code).toBeTruthy();
    });

    it("the staged asset now belongs to the new employee and is in use", async () => {
      const asset: any = await r.assets.byId(assetId);
      expect(asset.employeeId).toBe(employeeId);
      expect(asset.status).toBe("IN_USE");
    });

    it("a verified asset custody form is filed", async () => {
      const custody = (await r.documents.all()).filter((d: any) => d.employeeId === employeeId && d.title === "Asset Custody Form");
      expect(custody).toHaveLength(1);
      expect(custody[0].verified).toBe(true);
    });

    it("a portal login is created", async () => {
      const login = (await r.users.all()).find((u: any) => u.employeeId === employeeId);
      expect(login).toBeTruthy();
    });

    it("the invite is closed off and points at the employee", async () => {
      const inv: any = await r.onboardingInvites.byId(inviteId);
      expect(inv.status).toBe("COMPLETED");
      expect(inv.employeeId).toBe(employeeId);
    });

    it("approval is recorded in the audit trail", async () => {
      const audit = await r.auditLog.all();
      expect(audit.some((a: any) => a.action === "ONBOARDING_EMPLOYEE_CREATED" && a.meta?.caseId === caseId)).toBe(true);
    });

    it.skipIf(!MAIL_READABLE)("the welcome email goes to the personal inbox with the portal sign-in", async () => {
      const sent = (await mailSince(welcomeMark)).filter((m) => m.to.includes(CANDIDATE_EMAIL));
      expect(sent.length).toBeGreaterThanOrEqual(1);
      expect(sent.some((m) => m.text.includes(String(emp.officialEmail)))).toBe(true);
    });
  });

  describe("idempotency", () => {
    it("approving twice is refused rather than creating a second person", async () => {
      expect((await call("POST", `/api/onboarding-cases/${caseId}/approve`, hr)).status).toBe(400);
      expect((await r.employees.all()).filter((e: any) => e.firstName === "Iris" && e.lastName === "Noor")).toHaveLength(1);
      expect((await r.employees.all()).length).toBe(rosterSize + 1);
    });

    it("the candidate's link no longer offers an editable form", async () => {
      const res = await call("GET", `/api/onboarding/public/${token}`, null);
      expect(res.data?.completed === true || res.status >= 400, `status ${res.status}`).toBe(true);
    });
  });
});
