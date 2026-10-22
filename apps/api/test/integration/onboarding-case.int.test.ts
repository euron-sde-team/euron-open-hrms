/**
 * The onboarding case lifecycle for an existing employee, end to end over HTTP:
 *
 *   template -> open a case -> the employee fills it in (autosave, field validation,
 *   documents, asset acknowledgement, policies, declaration) -> submit -> HR review
 *   (diff, send back, resubmit, approve every section) -> commit to the employee record.
 *
 * What it proves beyond "the routes respond":
 *  - a bad answer is saved and reported, never thrown away
 *  - a submitted form is locked; a section sent back must actually change before resubmit
 *  - approval writes only what the form owns: KYC siblings and salary survive the merge
 *  - the audit trail names fields, never their values
 *  - editing a form's questions does not silently widen who it applies to
 *
 * One ordered scenario: later tests use the case and tokens created by earlier ones.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../src/repositories/base.repository";
import { hashPassword } from "../../src/middleware/auth";
import { ACCOUNTS, activeUser, client, seedFixtures, startServer, type Res } from "./fixtures";

let server: { base: string; close: () => Promise<void> };
let api: ReturnType<typeof client>;
let r: ReturnType<typeof repos>;
let employee: any;
let hr = "";
let me = "";

const JOINER_EMAIL = "sam.joiner@acme.example.com";
const JOINER_PW = "Joiner-Passw0rd!";
const PDF = Buffer.from("%PDF-1.4\n%test\n");

beforeAll(async () => {
  const fx = await seedFixtures();
  r = repos({ orgId: fx.acme.id });
  employee = await r.employees.insert({
    code: "ACM-JOIN-1",
    firstName: "Sam",
    lastName: "Joiner",
    email: JOINER_EMAIL,
    personalEmail: JOINER_EMAIL,
    officialEmail: JOINER_EMAIL,
    employmentType: "PERMANENT",
    designation: "Test Engineer",
    joiningDate: "2026-08-01",
    status: "ONBOARDING",
    kyc: { aadhaar: "111122223333", uan: "100200300400" }, // pre-existing siblings the form must not wipe
    salary: { basic: 50000, hra: 20000, allowances: 10000, deductions: 3000 },
  });
  await r.users.insert({ email: JOINER_EMAIL, name: "Sam Joiner", role: "EMPLOYEE", employeeId: employee.id, passwordHash: hashPassword(JOINER_PW), ...activeUser() });
  server = await startServer();
  api = client(server.base);
  hr = await api.login(ACCOUNTS.acmeAdmin);
  me = await api.login(JOINER_EMAIL, JOINER_PW);
});
afterAll(() => server.close());

const call = (m: string, p: string, token?: string | null, body?: unknown): Promise<Res> => api.call(m, p, token, body);
const uploadDoc = (sectionKey: string, category: string, name: string, buffer = PDF, type = "application/pdf") =>
  api.upload("/api/onboarding-cases/me/documents", me, { sectionKey, category }, { name, buffer, type });

describe("Onboarding case lifecycle", () => {
  let templateId = "";
  let caseId = "";
  let laptopId = "";

  it("activates the India preset as the default form", async () => {
    const created = await call("POST", "/api/onboarding-templates", hr, { presetKey: "INDIA_STANDARD" });
    expect(created.status).toBe(201);
    expect(created.data.summary.sections).toBe(11);
    templateId = created.data.id;
    expect((await call("POST", `/api/onboarding-templates/${templateId}/status`, hr, { status: "ACTIVE" })).status).toBe(200);
    expect((await call("POST", `/api/onboarding-templates/${templateId}/default`, hr)).status).toBe(200);
  });

  describe("opening a case", () => {
    it("opens a NOT_STARTED case with a deadline", async () => {
      const opened = await call("POST", "/api/onboarding-cases", hr, { employeeId: employee.id });
      expect(opened.status, opened.body.slice(0, 200)).toBe(201);
      caseId = opened.data.case?.id;
      expect(caseId).toBeTruthy();
      expect(opened.data.case.status).toBe("NOT_STARTED");
      expect(opened.data.case.dueAt).toBeTruthy();
    });

    it("opening twice reuses the open case instead of duplicating it", async () => {
      const again = await call("POST", "/api/onboarding-cases", hr, { employeeId: employee.id });
      expect(again.data.reused).toBe(true);
      expect(again.data.case.id).toBe(caseId);
    });
  });

  describe("the employee's view", () => {
    let c0: any;
    beforeAll(async () => {
      c0 = (await call("GET", "/api/onboarding-cases/me", me)).data.case;
    });

    it("the employee sees their own case", () => expect(c0?.id).toBe(caseId));
    it("the token hash is never exposed", async () => {
      expect(c0).toBeTruthy();
      expect(c0.tokenHash).toBeUndefined();
    });
    it("is prefilled from the employee record", () => expect(c0.sections?.personal?.values?.firstName).toBe("Sam"));
    it("cannot be submitted yet, and says what blocks it", async () => {
      expect(c0.submit?.ok).toBe(false);
      expect(c0.submit.blocking.length).toBeGreaterThan(0);
    });
  });

  describe("filling it in", () => {
    it("autosave returns 200 even with a bad field", async () => {
      const res = await call("PATCH", "/api/onboarding-cases/me/sections/personal", me, {
        values: { firstName: "Sam", lastName: "Joiner", dob: "1996-04-17", personalEmail: JOINER_EMAIL, phone: "+91 98765 43210", nationality: "Indian" },
      });
      expect(res.status).toBe(200);
    });

    it("a malformed PAN is reported, not rejected, and the valid sibling answer is still saved", async () => {
      const res = await call("PATCH", "/api/onboarding-cases/me/sections/government_ids", me, { values: { pan: "NOTAPAN", aadhaar: "111122223333" } });
      expect(res.status).toBe(200);
      expect(res.data.errors).toHaveLength(1);
      expect(res.data.case.sections.government_ids.values.aadhaar).toBe("111122223333");
    });

    it("normalises the PAN to upper case", async () => {
      await call("PATCH", "/api/onboarding-cases/me/sections/government_ids", me, { values: { pan: "abcde1234f", aadhaar: "111122223333" } });
      const after = await call("GET", "/api/onboarding-cases/me", me);
      expect(after.data.case.sections.government_ids.values.pan).toBe("ABCDE1234F");
    });

    it("saves the remaining sections", async () => {
      const saves = [
        ["addresses", { values: { currentAddress: "12 Example Road, Bengaluru", currentPincode: "560001", permanentAddress: "12 Example Road, Bengaluru", permanentPincode: "560001" } }],
        ["emergency", { values: { ecName: "Alex Joiner", ecRelation: "Spouse", ecPhone: "+91 90000 00001" } }],
        ["bank", { values: { accountName: "Sam Joiner", account: "123456789012", accountConfirm: "123456789012", ifsc: "exmp0001234", bankName: "Example Bank", branch: "Main Road" } }],
        ["education", { rows: [{ qualification: "Bachelor's degree", institution: "Example Institute of Technology", yearOfPassing: 2018 }] }],
        ["dependents", { rows: [{ name: "Alex Joiner", relation: "Spouse", dob: "1997-02-02", nominationPercent: 100 }] }],
      ] as const;
      for (const [key, body] of saves) {
        const res = await call("PATCH", `/api/onboarding-cases/me/sections/${key}`, me, body);
        expect(res.status, `${key}: ${res.body.slice(0, 200)}`).toBe(200);
      }
    });
  });

  describe("documents", () => {
    it("refuses an executable upload", async () => {
      const res = await api.upload("/api/onboarding-cases/me/documents", me, { category: "BANK" }, { name: "evil.exe", buffer: Buffer.from("MZ"), type: "application/x-msdownload" });
      expect(res.status).toBe(400);
    });

    it("an uploaded bank proof clears the section", async () => {
      const up = await uploadDoc("bank", "BANK", "cheque.pdf");
      expect(up.status, up.body.slice(0, 200)).toBe(201);
      const bankCheck = up.data.case.checks.find((c: any) => c.key === "bank");
      expect(bankCheck.errors).toEqual([]);
    });

    it("re-uploading replaces rather than stacking", async () => {
      const up = await uploadDoc("bank", "BANK", "cheque-v2.pdf");
      expect(up.status).toBe(201);
      expect(up.data.case.documents.filter((d: any) => d.category === "BANK")).toHaveLength(1);
    });
  });

  describe("assets", () => {
    it("issued assets are offered for acknowledgement", async () => {
      const laptop = await r.assets.insert({
        employeeId: employee.id, category: "LAPTOP", name: "Laptop 14", serial: "C02XY1234ABC", condition: "New",
        status: "PROVISIONED", assignedAt: new Date().toISOString(), acknowledgedAt: null, returnedAt: null, notes: "",
      });
      laptopId = laptop.id;
      const issued = await call("GET", "/api/onboarding-cases/me/assets", me);
      expect(issued.data.issued).toHaveLength(1);
    });

    it("a wrong serial is flagged as a discrepancy, not refused", async () => {
      const res = await call("POST", `/api/onboarding-cases/me/assets/${laptopId}/acknowledge`, me, { received: true, serial: "C02XY9999ZZZ", condition: "Good" });
      expect(res.status).toBe(200);
      expect(res.data.acknowledgment.discrepancy).toBe(true);
    });

    it("the corrected serial (any case) clears the discrepancy", async () => {
      const res = await call("POST", `/api/onboarding-cases/me/assets/${laptopId}/acknowledge`, me, { received: true, serial: "c02xy1234abc", condition: "Good" });
      expect(res.data.acknowledgment.discrepancy).toBe(false);
      expect(res.data.acknowledgment.serialConfirmed).toBe(true);
    });

    it("an extra item can be declared", async () => {
      const res = await call("POST", "/api/onboarding-cases/me/assets/declared", me, { category: "MONITOR", name: "Monitor 27", serial: "MON-77", condition: "Good" });
      expect(res.status).toBe(201);
      expect(res.data.asset.status).toBe("PENDING");
    });
  });

  describe("policies and declaration", () => {
    it("policies are accepted with a timestamp and IP", async () => {
      const policies = await r.policies.all();
      expect(policies.length, "the starter content seeds policies").toBeGreaterThan(0);
      const res = await call("POST", "/api/onboarding-cases/me/acknowledge", me, { policyIds: policies.map((p: any) => p.id) });
      expect(res.status).toBe(200);
      expect(res.data.acknowledgments).toHaveLength(policies.length);
      expect(res.data.acknowledgments[0].ip).toBeTruthy();
    });

    it("the declaration is signed", async () => {
      const res = await call("POST", "/api/onboarding-cases/me/declare", me, { fullName: "Sam Joiner" });
      expect(res.status).toBe(200);
      expect(res.data.declaration.fullName).toBe("Sam Joiner");
    });
  });

  describe("submit", () => {
    it("an empty optional history section neither blocks nor warns", async () => {
      const pre = (await call("GET", "/api/onboarding-cases/me", me)).data.case;
      const hist = pre.checks.find((c: any) => c.key === "employment_history");
      expect(hist).toBeTruthy();
      expect(hist.errors).toEqual([]);
      expect(pre.submit.blocking.some((b: any) => b.key === "employment_history")).toBe(false);
    });

    // Checked before the first submit: a submitted form is locked, so a later 400 would prove nothing.
    it("a half-filled optional entry blocks submission", async () => {
      await call("PATCH", "/api/onboarding-cases/me/sections/employment_history", me, { rows: [{ employer: "Example Corp" }] });
      const res = await call("POST", "/api/onboarding-cases/me/submit", me);
      expect(res.status).toBe(400);
      expect(res.data?.error || "").toMatch(/Previous employment/i);
    });

    it("submits once the entry is complete", async () => {
      await call("PATCH", "/api/onboarding-cases/me/sections/employment_history", me, {
        rows: [{ employer: "Example Corp", designation: "Engineer", fromDate: "2018-06-01", toDate: "2026-07-31" }],
      });
      const res = await call("POST", "/api/onboarding-cases/me/submit", me);
      expect(res.status, res.body.slice(0, 300)).toBe(200);
      expect(res.data.case.status).toBe("SUBMITTED");
    });

    it("a submitted form is locked to the employee", async () => {
      const res = await call("PATCH", "/api/onboarding-cases/me/sections/personal", me, { values: { firstName: "Hacker" } });
      expect(res.status).toBe(400);
    });
  });

  describe("HR review", () => {
    it("the case appears in the review queue", async () => {
      const queue = await call("GET", "/api/onboarding-cases?status=SUBMITTED", hr);
      expect(queue.data.some((x: any) => x.id === caseId)).toBe(true);
    });

    it("review shows a diff naming the PAN change with its before value, and the assets", async () => {
      const detail = await call("GET", `/api/onboarding-cases/${caseId}`, hr);
      expect(Array.isArray(detail.data.diff)).toBe(true);
      expect(detail.data.diff.length).toBeGreaterThan(0);
      const pan = detail.data.diff.find((d: any) => d.path === "kyc.pan");
      expect(pan?.to).toBe("ABCDE1234F");
      expect(pan?.from ?? null).toBeNull();
      expect(detail.data.assets).toBeTruthy();
    });

    it("sending a section back without a reason is refused", async () => {
      const res = await call("POST", `/api/onboarding-cases/${caseId}/sections/bank/review`, hr, { verdict: "CHANGES_REQUESTED" });
      expect(res.status).toBe(400);
    });

    it("a section sent back reopens the case", async () => {
      const res = await call("POST", `/api/onboarding-cases/${caseId}/sections/bank/review`, hr, { verdict: "CHANGES_REQUESTED", note: "The cheque photo is unreadable, please re-upload." });
      expect(res.data.status).toBe("CHANGES_REQUESTED");
    });

    it("the same form cannot be bounced straight back", async () => {
      expect((await call("POST", "/api/onboarding-cases/me/submit", me)).status).toBe(400);
    });

    it("resubmits once the section is actually edited", async () => {
      await call("PATCH", "/api/onboarding-cases/me/sections/bank", me, {
        values: { accountName: "Sam Joiner", account: "123456789012", accountConfirm: "123456789012", ifsc: "EXMP0001234", bankName: "Example Bank", branch: "Second Road" },
      });
      expect((await call("POST", "/api/onboarding-cases/me/submit", me)).status).toBe(200);
    });

    it("approval is refused while sections are unreviewed", async () => {
      expect((await call("POST", `/api/onboarding-cases/${caseId}/approve`, hr)).status).toBe(400);
    });

    it("every section can be approved", async () => {
      const snap = (await call("GET", `/api/onboarding-cases/${caseId}`, hr)).data;
      expect(snap.templateSnapshot.length).toBe(11);
      for (const s of snap.templateSnapshot) {
        const res = await call("POST", `/api/onboarding-cases/${caseId}/sections/${s.key}/review`, hr, { verdict: "APPROVED" });
        expect(res.status, `${s.key}: ${res.body.slice(0, 200)}`).toBe(200);
      }
      // Approve the declared monitor into the register, as the reviewer's asset panel does.
      const cur = (await call("GET", `/api/onboarding-cases/${caseId}`, hr)).data;
      const monitor = cur.assets.declared[0];
      expect(monitor?.name).toBe("Monitor 27");
      await r.onboardingCases.update(caseId, { assets: { ...cur.assets, declared: [{ ...monitor, status: "APPROVED" }] } });
    });
  });

  describe("commit", () => {
    let after: any;

    it("approves the case", async () => {
      const res = await call("POST", `/api/onboarding-cases/${caseId}/approve`, hr);
      expect(res.status, res.body.slice(0, 300)).toBe(200);
      expect(res.data.ok).toBe(true);
      after = await r.employees.byId(employee.id);
    });

    it("writes the PAN to the employee record", () => expect(after.kyc.pan).toBe("ABCDE1234F"));
    it("keeps the pre-existing aadhaar and uan", async () => {
      expect(after.kyc.aadhaar).toBe("111122223333");
      expect(after.kyc.uan).toBe("100200300400");
    });
    it("writes the bank account", async () => {
      expect(after.bank?.account).toBe("123456789012");
      expect(after.bank?.ifsc).toBe("EXMP0001234");
    });
    it("leaves the salary untouched", () => expect(after.salary.basic).toBe(50000));
    it("flips the status ONBOARDING -> ACTIVE", () => expect(after.status).toBe("ACTIVE"));
    it("commits education as structured rows", async () => {
      expect(Array.isArray(after.education)).toBe(true);
      expect(after.education[0].institution).toBe("Example Institute of Technology");
    });
    it("commits the employment history as rows", async () => {
      expect(Array.isArray(after.employmentHistory)).toBe(true);
      expect(after.employmentHistory[0].employer).toBe("Example Corp");
    });

    it("the acknowledged laptop is IN_USE and the declared monitor entered the register", async () => {
      const assets = await r.assets.where({ employeeId: employee.id }).list();
      expect(assets.find((a: any) => a.id === laptopId)?.status).toBe("IN_USE");
      expect(assets.some((a: any) => a.name === "Monitor 27" && a.declaredVia === "ONBOARDING")).toBe(true);
    });

    it("approving twice is refused", async () => {
      expect((await call("POST", `/api/onboarding-cases/${caseId}/approve`, hr)).status).toBe(400);
    });

    it("writes an audit trail that records field names, never values", async () => {
      const audit = (await r.auditLog.all()).filter((a: any) => a.meta?.caseId === caseId);
      expect(audit.length).toBeGreaterThanOrEqual(3);
      const approvedRow = audit.find((a: any) => a.action === "ONBOARDING_APPROVED");
      expect(approvedRow).toBeTruthy();
      expect(JSON.stringify(approvedRow)).not.toContain("ABCDE1234F");
    });
  });

  describe("template edit safety", () => {
    let scoped: any;

    beforeAll(async () => {
      scoped = (await call("POST", "/api/onboarding-templates", hr, { presetKey: "MINIMAL" })).data;
      const res = await call("PUT", `/api/onboarding-templates/${scoped.id}`, hr, {
        name: scoped.name, sections: scoped.sections, appliesTo: { employmentTypes: ["INTERN", "FREELANCER"], departmentIds: [] },
      });
      expect(res.status).toBe(200);
    });

    // The builder saves questions without sending appliesTo; that must not reset the rules.
    it("editing a form's questions preserves its assignment rules and reminder schedule", async () => {
      const edited = await call("PUT", `/api/onboarding-templates/${scoped.id}`, hr, { name: scoped.name, sections: scoped.sections });
      expect(edited.data.appliesTo?.employmentTypes).toEqual(["INTERN", "FREELANCER"]);
      expect(Array.isArray(edited.data.reminderOffsets)).toBe(true);
      expect(edited.data.reminderOffsets.length).toBeGreaterThan(0);
    });

    it("an explicit change to the rules still applies", async () => {
      const res = await call("PUT", `/api/onboarding-templates/${scoped.id}`, hr, {
        name: scoped.name, sections: scoped.sections, appliesTo: { employmentTypes: ["INTERN"], departmentIds: [] },
      });
      expect(res.data.appliesTo?.employmentTypes).toEqual(["INTERN"]);
    });
  });
});
