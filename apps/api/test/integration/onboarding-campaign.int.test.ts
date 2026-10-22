/**
 * An onboarding CAMPAIGN end to end: audience preview, launch fan-out through the job
 * queue, the deadline sweep, reminder de-duplication, escalation and cancellation.
 *
 * The HTTP surface is the real API. The fan-out is drained in this process: the route's
 * contract is that it ENQUEUES a job, which is asserted from the `jobs` table, and the
 * job is then claimed and run by calling its registered handler, exactly as the worker
 * would. No background worker runs, so every step is deterministic.
 *
 * Mail content is read back from the outbox (MAIL_MODE=outbox); under smtp or ses only
 * those assertions are skipped and the rest of the scenario still runs.
 *
 * One ordered scenario: later tests use the campaign and cases created by earlier ones.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../src/repositories/base.repository";
import { hashPassword } from "../../src/middleware/auth";
import { db } from "../../src/db/kysely";
import { getHandler } from "../../src/jobs/queue";
import { registerAllHandlers } from "../../src/jobs/handlers";
import { dueReminders, offsetKey, sweepOrg } from "../../src/jobs/reminders/onboarding";
import { ACCOUNTS, MAIL_READABLE, activeUser, client, mailSince, outboxMark, seedFixtures, startServer, type Res } from "./fixtures";

let server: { base: string; close: () => Promise<void> };
let api: ReturnType<typeof client>;
let r: ReturnType<typeof repos>;
let org: any;
let hr = "";

/*
 *  Ana + Ben  have logins, so they are the campaign audience
 *  Cara       has no login, so the preview must call her out rather than drop her
 *  Dev        has a login but is kept OUT of the campaign, so the request email can be
 *             proved by invoking the handler directly, with no job row involved
 */
const PEOPLE = [["Ana", "Alpha"], ["Ben", "Beta"], ["Cara", "Gamma"], ["Dev", "Delta"]];
const employees: any[] = [];
const users: any[] = [];

beforeAll(async () => {
  registerAllHandlers();
  const fx = await seedFixtures();
  org = fx.acme;
  r = repos({ orgId: org.id });
  for (const [i, [first, last]] of PEOPLE.entries()) {
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@acme.example.com`;
    const e = await r.employees.insert({
      code: `ACM-CMP-${i}`, firstName: first, lastName: last,
      email, personalEmail: email, officialEmail: email,
      employmentType: "PERMANENT", designation: "Tester", joiningDate: "2026-01-01", status: "ACTIVE",
      salary: { basic: 40000, hra: 16000, allowances: 8000, deductions: 2400 },
    });
    employees.push(e);
    if (i !== 2) users.push(await r.users.insert({ email, name: `${first} ${last}`, role: "EMPLOYEE", employeeId: e.id, passwordHash: hashPassword("Campaign-Passw0rd!"), ...activeUser() }));
  }
  server = await startServer();
  api = client(server.base);
  hr = await api.login(ACCOUNTS.acmeAdmin);
});
afterAll(() => server.close());

const call = (m: string, p: string, token?: string | null, body?: unknown): Promise<Res> => api.call(m, p, token, body);

/**
 * Read back the jobs of one type the API enqueued and run them, claiming each row
 * QUEUED/FAILED -> RUNNING atomically first, exactly as the worker does, so a job is
 * never executed twice by this helper.
 */
async function runQueued(type: string, match: (payload: any) => boolean) {
  const fn = getHandler(type);
  if (!fn) throw new Error(`no handler registered for "${type}"`);
  const rows = await db.selectFrom("jobs").selectAll().where("type", "=", type).orderBy("created_at", "desc").execute();
  const jobs = rows
    .map((j: any) => ({ ...j, payload: typeof j.payload === "string" ? JSON.parse(j.payload) : j.payload }))
    .filter((j: any) => match(j.payload));
  for (const j of jobs) {
    const claimed = await db.updateTable("jobs").set({ status: "RUNNING", updated_at: new Date() })
      .where("id", "=", j.id).where("status", "in", ["QUEUED", "FAILED"]).executeTakeFirst();
    if (!Number(claimed?.numUpdatedRows || 0)) continue;
    await fn(j.payload, j);
    await db.updateTable("jobs").set({ status: "DONE", last_error: null, updated_at: new Date() }).where("id", "=", j.id).execute();
  }
  return jobs;
}

/** Re-run already-finished jobs, as a queue retry would. */
async function rerun(jobs: any[]) {
  for (const j of jobs) await getHandler(j.type)!(j.payload, j);
}

describe("Onboarding campaign", () => {
  let templateId = "";
  let campaignId = "";
  let ids: string[] = [];
  let cases: any[] = [];
  let target: any;

  it("starts with 4 employees, 3 with logins, and an active default form", async () => {
    expect(employees).toHaveLength(4);
    expect(users).toHaveLength(3);
    const tpl = await call("POST", "/api/onboarding-templates", hr, { presetKey: "MINIMAL" });
    expect(tpl.status).toBe(201);
    templateId = tpl.data.id;
    expect((await call("POST", `/api/onboarding-templates/${templateId}/status`, hr, { status: "ACTIVE" })).status).toBe(200);
    // The default form is what a case opened outside a campaign resolves to (Dev, below).
    expect((await call("POST", `/api/onboarding-templates/${templateId}/default`, hr)).status).toBe(200);
    ids = employees.slice(0, 3).map((e) => e.id); // Dev is deliberately excluded
  });

  describe("audience preview", () => {
    let preview: Res;
    beforeAll(async () => {
      preview = await call("POST", "/api/onboarding-campaigns/preview", hr, { audience: { mode: "SELECTED", employeeIds: ids } });
    });

    it("resolves the audience", () => expect(preview.status).toBe(200));
    it("skips the person with no login, with a reason", async () => {
      expect(preview.data.skipped.some((s: any) => s.name === "Cara Gamma" && /no portal login/i.test(s.reason))).toBe(true);
    });
    it("includes the other two", () => expect(preview.data.counts.included).toBe(2));
    it("refuses an empty department rule", async () => {
      expect((await call("POST", "/api/onboarding-campaigns/preview", hr, { audience: { mode: "DEPARTMENT", departmentIds: [] } })).status).toBe(400);
    });
  });

  describe("create and launch", () => {
    it("refuses a deadline in the past", async () => {
      const past = await call("POST", "/api/onboarding-campaigns", hr, { name: "Backdated", templateId, audience: { mode: "SELECTED", employeeIds: ids }, dueAt: "2020-01-01" });
      expect(past.status).toBe(400);
    });

    it("creates the campaign as a draft", async () => {
      const campaign = await call("POST", "/api/onboarding-campaigns", hr, {
        name: "Records refresh", templateId, audience: { mode: "SELECTED", employeeIds: ids },
        dueAt: new Date(Date.now() + 14 * 86400000).toISOString(), message: "We are bringing everyone's records up to date.",
      });
      expect(campaign.status).toBe(201);
      expect(campaign.data.status).toBe("DRAFT");
      campaignId = campaign.data.id;
    });

    it("accepts and queues the launch", async () => {
      const launched = await call("POST", `/api/onboarding-campaigns/${campaignId}/launch`, hr);
      expect(launched.status).toBe(200);
      expect(launched.data.status).toBe("LAUNCHING");
    });

    it("refuses a double launch", async () => {
      expect((await call("POST", `/api/onboarding-campaigns/${campaignId}/launch`, hr)).status).toBe(400);
    });
  });

  describe("fan-out", () => {
    let createJobs: any[] = [];

    it("launching enqueues exactly one fan-out job", async () => {
      const launchJobs = await runQueued("onboarding.campaign.launch", (p) => p.campaignId === campaignId);
      expect(launchJobs).toHaveLength(1);
    });

    it("the fan-out enqueues one job per person with a login, and none for the person without", async () => {
      createJobs = await runQueued("onboarding.case.create", (p) => p.campaignId === campaignId);
      expect(createJobs).toHaveLength(2);
      expect(createJobs.some((j) => j.payload.employeeId === employees[2].id)).toBe(false);
    });

    it("opens one case per person with a login", async () => {
      cases = await r.onboardingCases.where({ campaignId }).list();
      expect(cases).toHaveLength(2);
      expect(cases.some((c: any) => c.employeeId === employees[2].id)).toBe(false);
    });

    it("a retried fan-out does not open a second case", async () => {
      await rerun(createJobs);
      expect(await r.onboardingCases.where({ campaignId }).list()).toHaveLength(2);
    });

    it("every case carries the campaign deadline and a snapshot of the reminder schedule", async () => {
      expect(cases.every((c: any) => !!c.dueAt)).toBe(true);
      expect(cases.every((c: any) => Array.isArray(c.reminderOffsets))).toBe(true);
    });
  });

  // Dev is in no campaign, so the handler runs exactly once here and is the only sender.
  describe("the request email", () => {
    const dev = () => ({ orgId: org.id, campaignId: null, employeeId: employees[3].id });
    let mark: Set<string>;

    it("opening a case for a person creates it", async () => {
      mark = await outboxMark();
      await getHandler("onboarding.case.create")!(dev(), {} as any);
      expect(await r.onboardingCases.where({ employeeId: employees[3].id }).list()).toHaveLength(1);
    });

    it.skipIf(!MAIL_READABLE)("emails the person a link to the self-service portal", async () => {
      const sent = await mailSince(mark);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toContain(employees[3].email);
      expect(sent[0].text).toMatch(/onboarding\/me/);
    });

    it("a queue retry of that job opens no second case and sends no second email", async () => {
      const before = (await mailSince(mark)).length;
      await getHandler("onboarding.case.create")!(dev(), {} as any);
      expect(await r.onboardingCases.where({ employeeId: employees[3].id }).list()).toHaveLength(1);
      expect((await mailSince(mark)).length).toBe(before);
    });
  });

  describe("campaign status", () => {
    it("is RUNNING, counts the open cases and records the skipped person", async () => {
      const after = await call("GET", `/api/onboarding-campaigns/${campaignId}`, hr);
      expect(after.data.status).toBe("RUNNING");
      expect(after.data.stats.total).toBe(2);
      expect(after.data.stats.notStarted).toBe(2);
      expect(after.data.skipped || []).toHaveLength(1);
    });

    it("lists per-person progress", async () => {
      const perCase = await call("GET", `/api/onboarding-campaigns/${campaignId}/cases`, hr);
      expect(perCase.data).toHaveLength(2);
      expect(perCase.data[0].total).toBeGreaterThan(0);
    });
  });

  describe("deadline sweep", () => {
    let verdict: ReturnType<typeof dueReminders>;

    it("nothing is due while the deadline is far off", async () => {
      target = cases[0];
      expect(dueReminders(target).send).toBeNull();
    });

    it("an overdue case has reminders due", async () => {
      await r.onboardingCases.update(target.id, { dueAt: new Date(Date.now() - 2 * 86400000) });
      verdict = dueReminders(await r.onboardingCases.byId(target.id));
      expect(verdict.due.length).toBeGreaterThan(0);
      expect(verdict.send).not.toBeNull();
    });

    it("the sweep queues work and writes markers so a retry cannot double-send", async () => {
      const swept = await call("POST", "/api/onboarding-campaigns/run-reminders", hr);
      expect(swept.status).toBe(200);
      expect(swept.data.queued).toBeGreaterThanOrEqual(1);
      const marked = await r.onboardingCases.byId(target.id);
      expect(marked.remindersSent || []).toHaveLength(verdict.due.length);
      expect(marked.remindersSent).toContain(offsetKey(verdict.send!));
    });

    it("the sweep queued a reminder for the overdue case, and it is sent", async () => {
      const mark = await outboxMark();
      const remJobs = await runQueued("onboarding.reminder", (p) => p.caseId === target.id);
      expect(remJobs.length).toBeGreaterThanOrEqual(1);
      if (MAIL_READABLE) {
        const sent = await mailSince(mark);
        expect(sent.length, "the overdue reminder is actually sent").toBeGreaterThanOrEqual(1);
        expect(sent.some((m) => /overdue/i.test(m.text)), "an overdue reminder says so").toBe(true);
      }
    });

    it("a second sweep sends nothing", async () => {
      const second = await call("POST", "/api/onboarding-campaigns/run-reminders", hr);
      expect(second.data.queued).toBe(0);
    });
  });

  describe("escalation", () => {
    let manager: any;
    let escMark: Set<string>;

    it("a long-overdue case escalates, and only ever once", async () => {
      manager = employees[1];
      await r.employees.update(target.employeeId, { managerId: manager.id, reportsTo: manager.id });
      await r.onboardingCases.update(target.id, { dueAt: new Date(Date.now() - 10 * 86400000), remindersSent: [] });
      const escalated = await sweepOrg(org, { force: true });
      expect(escalated.escalated).toBeGreaterThanOrEqual(1);
      expect((await r.onboardingCases.byId(target.id)).remindersSent || []).toContain("ESCALATED");
      expect((await sweepOrg(org, { force: true })).escalated).toBe(0);
    });

    it("the escalation job was queued and run", async () => {
      escMark = await outboxMark();
      const escJobs = await runQueued("onboarding.escalate", (p) => p.caseId === target.id);
      expect(escJobs.length).toBeGreaterThanOrEqual(1);
    });

    it.skipIf(!MAIL_READABLE)("the manager is the one told, not the employee", async () => {
      const sent = await mailSince(escMark);
      expect(sent.some((m) => m.to.includes(manager.officialEmail || manager.email))).toBe(true);
    });

    // Escalation once sat inside an `if (manager)`, so anyone without a reporting line
    // escalated into silence. HR is told as well.
    it("is recorded in the audit trail, with HR notified too", async () => {
      const escAudit = (await r.auditLog.all()).filter((a: any) => a.action === "ONBOARDING_ESCALATED" && a.meta?.caseId === target.id);
      expect(escAudit.length).toBeGreaterThanOrEqual(1);
      expect(escAudit[0].meta?.notifiedHr).toBe(true);
    });

    it("the notification names who is overdue", async () => {
      // Resolve the overdue person from the case itself: list order is not guaranteed.
      const overdue = employees.find((e: any) => e.id === target.employeeId);
      expect(overdue, "the escalated case belongs to one of the campaign's employees").toBeTruthy();
      const name = `${overdue.firstName} ${overdue.lastName}`;
      expect((await r.notifications.all()).some((n: any) => String(n.title || "").includes(name))).toBe(true);
    });

    it("an approved case is never chased", async () => {
      await r.onboardingCases.update(cases[1].id, { status: "APPROVED" });
      const quiet = await sweepOrg(org, { force: true });
      expect(quiet.queued).toBe(0);
      expect(quiet.escalated).toBe(0);
    });
  });

  describe("cancel", () => {
    it("cancelling the campaign leaves started work alone", async () => {
      await r.onboardingCases.update(target.id, { status: "IN_PROGRESS" });
      const cancelled = await call("POST", `/api/onboarding-campaigns/${campaignId}/cancel`, hr);
      expect(cancelled.status).toBe(200);
      expect(cancelled.data.casesCancelled).toBe(0);
      expect(cancelled.data.status).toBe("CANCELLED");
      expect((await r.onboardingCases.byId(target.id)).status).toBe("IN_PROGRESS");
    });
  });
});
