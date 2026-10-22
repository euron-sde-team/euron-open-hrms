/**
 * Documents, holidays, leave entitlements, Indian statutory payroll and lifecycle letters,
 * through the HTTP API of an Indian workspace:
 *
 *   documents   categories and visibility levels, legacy SHARED rows, search, KYC status
 *   holidays    per-state calendars, honest gaps for years without festival data, import
 *               with replaceYear, idempotent re-import
 *   leave       the statutory catalogue, explained entitlements, idempotent seeding
 *   payroll     per-state professional tax switching the component on and off, gratuity
 *   lifecycle   payslips filed into documents (re-runs replace), bulk offer letters
 *   access      an employee can do none of the HR actions and sees only their documents
 *
 * Each group sets up what it asserts on, so no check passes over an empty list.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../src/repositories/base.repository";
import { ACCOUNTS, arr, client, seedFixtures, startServer, type Res } from "./fixtures";

let server: { base: string; close: () => Promise<void> };
let api: ReturnType<typeof client>;
let fx: Awaited<ReturnType<typeof seedFixtures>>;
let r: ReturnType<typeof repos>;
let hr = "";
let emp = "";
let empEmployeeId = "";
/** The person HR acts on: the engineering lead, deliberately not the employee who signs in below. */
let someone = "";

beforeAll(async () => {
  fx = await seedFixtures();
  r = repos({ orgId: fx.acme.id });
  someone = fx.ids.lead;
  empEmployeeId = fx.ids.emp;
  server = await startServer();
  api = client(server.base);
  hr = await api.login(ACCOUNTS.acmeAdmin);
  emp = await api.login(ACCOUNTS.emp);
});
afterAll(() => server.close());

const call = (m: string, p: string, token: string | null = hr, body?: unknown): Promise<Res> => api.call(m, p, token, body);
const PDF = Buffer.from("%PDF-1.4\n%test\n");

describe("Documents", () => {
  let meta: Res;
  beforeAll(async () => {
    meta = await call("GET", "/api/documents/meta");
    const up = await api.upload("/api/documents", hr, { title: "Travel policy", category: "POLICY", visibility: "ORG" }, { name: "travel.pdf", buffer: PDF, type: "application/pdf" });
    expect(up.status, up.body.slice(0, 200)).toBe(201);
    // A row written before visibility had three levels.
    await r.documents.insert({ employeeId: null, title: "Old handbook", description: "", category: "POLICY", tags: [], visibility: "SHARED", departmentIds: [], storage: "uploads", filename: "old.pdf", originalName: "old.pdf", mimeType: "application/pdf", sizeBytes: 10, uploadedBy: null });
  });

  it("meta returns the category list and the KYC set", async () => {
    expect(meta.status).toBe(200);
    expect(meta.data.categories.length).toBeGreaterThan(20);
    expect(meta.data.kyc.length).toBeGreaterThanOrEqual(8);
  });

  it("there are exactly three visibility levels: PRIVATE, DEPARTMENT and ORG", async () => {
    expect(meta.data.visibilities).toHaveLength(3);
    expect(meta.data.visibilities.map((v: any) => v.value).sort()).toEqual(["DEPARTMENT", "ORG", "PRIVATE"]);
  });

  it("the list responds, normalises legacy SHARED to ORG and labels every row", async () => {
    const list = await call("GET", "/api/documents");
    expect(list.status).toBe(200);
    expect(list.data.length).toBeGreaterThanOrEqual(2);
    expect(list.data.find((d: any) => d.title === "Old handbook")?.visibility).toBe("ORG");
    expect(list.data.some((d: any) => d.visibility === "SHARED")).toBe(false);
    expect(list.data.every((d: any) => !!d.categoryLabel)).toBe(true);
  });

  it("search with no matches returns empty, not everything", async () => {
    expect((await call("GET", "/api/documents?q=zzzznotarealterm")).data).toHaveLength(0);
    expect((await call("GET", "/api/documents?q=travel")).data.map((d: any) => d.title)).toEqual(["Travel policy"]);
  });

  it("KYC status computes and lists what is missing", async () => {
    const kyc = await call("GET", `/api/documents/kyc-status?employeeId=${someone}`);
    expect(kyc.status).toBe(200);
    expect(Array.isArray(kyc.data.missing)).toBe(true);
    expect(kyc.data.missing.length).toBeGreaterThan(0);
  });

  it("an unknown category filter returns nothing rather than erroring", async () => {
    const res = await call("GET", "/api/documents?category=NOT_A_CATEGORY");
    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(0);
  });
});

describe("Holidays", () => {
  it("serves the state list", async () => {
    const states = await call("GET", "/api/content/holidays/states");
    expect(states.status).toBe(200);
    expect(states.data.states.length).toBeGreaterThanOrEqual(30);
  });

  it("previews a Karnataka calendar, marking what is already added, with Rajyotsava", async () => {
    const ka = await call("GET", "/api/content/holidays/preview?year=2026&state=KA");
    expect(ka.status).toBe(200);
    expect(ka.data.holidays.length).toBeGreaterThan(15);
    expect(ka.data.holidays.every((h: any) => "alreadyAdded" in h)).toBe(true);
    expect(ka.data.holidays.map((h: any) => h.name)).toContain("Kannada Rajyotsava");
  });

  it("Delhi does NOT get Rajyotsava", async () => {
    const dl = await call("GET", "/api/content/holidays/preview?year=2026&state=DL");
    expect(dl.status).toBe(200);
    expect(dl.data.holidays.length).toBeGreaterThan(0);
    expect(dl.data.holidays.map((h: any) => h.name)).not.toContain("Kannada Rajyotsava");
  });

  it("a year with no festival data says so, names the gaps and invents no Diwali", async () => {
    const far = await call("GET", "/api/content/holidays/preview?year=2033&state=KA");
    expect(far.data.hasVariableData).toBe(false);
    expect(far.data.missingVariable.length).toBeGreaterThan(5);
    expect(far.data.holidays.filter((h: any) => /Deepavali|Diwali/i.test(h.name))).toEqual([]);
  });

  it("rejects a bad year and a bad state", async () => {
    expect((await call("GET", "/api/content/holidays/preview?year=1500")).status).toBe(400);
    expect((await call("GET", "/api/content/holidays/preview?year=2026&state=ZZ")).status).toBe(400);
  });

  it("import with replaceYear persists the new calendar and clears the previous set", async () => {
    // A previous calendar for the year, so replaceYear has something to clear.
    const seeded = await call("POST", "/api/content/holidays/import", hr, { year: 2027, state: "KA" });
    expect(seeded.status).toBe(201);
    const before = (await call("GET", "/api/content/holidays?year=2027")).data.length;
    expect(before).toBeGreaterThan(0);

    const imported = await call("POST", "/api/content/holidays/import", hr, { year: 2027, state: "MH", replaceYear: true });
    expect(imported.status).toBe(201);
    expect(imported.data.added).toBeGreaterThan(0);
    expect(imported.data.removed).toBe(before);
    const after = (await call("GET", "/api/content/holidays?year=2027")).data;
    expect(after.length).toBe(imported.data.added);
  });

  it("re-importing adds nothing (idempotent)", async () => {
    const again = await call("POST", "/api/content/holidays/import", hr, { year: 2027, state: "MH" });
    expect(again.data.added).toBe(0);
    expect(again.data.skipped).toBeGreaterThan(0);
  });
});

describe("Leave", () => {
  it("serves the catalogue, including maternity at 182 days", async () => {
    const cat = await call("GET", "/api/leave/catalogue");
    expect(cat.status).toBe(200);
    expect(cat.data.length).toBeGreaterThanOrEqual(8);
    expect(cat.data.find((t: any) => t.key === "MATERNITY")?.maxPerYear).toBe(182);
  });

  it("computes entitlements, every row stating a reason", async () => {
    const ent = await call("GET", `/api/leave/entitlements?employeeId=${someone}`);
    expect(ent.status).toBe(200);
    expect(ent.data.entitlements.length).toBeGreaterThanOrEqual(8);
    expect(ent.data.entitlements.every((e: any) => e.reason?.length > 0)).toBe(true);
  });

  it("seeds the standard leave types, adding maternity", async () => {
    const before = (await call("GET", "/api/leave/types")).data;
    expect(before.some((t: any) => /maternity/i.test(t.name))).toBe(false);
    const seeded = await call("POST", "/api/leave/types/seed-standard");
    expect(seeded.status).toBe(201);
    const after = (await call("GET", "/api/leave/types")).data;
    expect(after.some((t: any) => /maternity/i.test(t.name))).toBe(true);
  });

  it("re-seeding adds nothing (idempotent)", async () => {
    const reseed = await call("POST", "/api/leave/types/seed-standard");
    expect(reseed.data.added).toHaveLength(0);
  });
});

describe("Payroll", () => {
  const ptComponent = (res: Res) => res.data.ruleset?.components?.find((c: any) => c.key === "professional_tax");

  it("serves the professional tax schedules: Delhi levies none, Karnataka does", async () => {
    const pt = await call("GET", "/api/salary/professional-tax/states");
    expect(pt.status).toBe(200);
    expect(pt.data.schedules.length).toBeGreaterThan(25);
    expect(pt.data.schedules.find((s: any) => s.state === "DL")?.levies).toBe(false);
    expect(pt.data.schedules.find((s: any) => s.state === "KA")?.levies).toBe(true);
  });

  it("setting Karnataka enables the PT component", async () => {
    const ka = await call("PUT", "/api/salary/professional-tax", hr, { state: "KA" });
    expect(ka.status).toBe(200);
    expect(ka.data.state).toBe("KA");
    expect(ptComponent(ka)?.enabled).toBe(true);
  });

  it("setting Delhi disables it", async () => {
    const dl = await call("PUT", "/api/salary/professional-tax", hr, { state: "DL" });
    expect(dl.status).toBe(200);
    expect(ptComponent(dl)?.enabled).toBe(false);
  });

  it("rejects an unknown state", async () => {
    expect((await call("PUT", "/api/salary/professional-tax", hr, { state: "ZZ" })).status).toBe(400);
  });

  it("the gratuity endpoint responds and always explains itself", async () => {
    const grat = await call("GET", `/api/salary/gratuity/${someone}?lastWorkingDay=2030-01-01`);
    expect(grat.status).toBe(200);
    expect("eligible" in grat.data).toBe(true);
    expect(grat.data.reason?.length).toBeGreaterThan(0);
  });
});

describe("Lifecycle", () => {
  const payslipDocs = async () => (await call("GET", `/api/documents?employeeId=${someone}`)).data.filter((d: any) => d.category === "PAYSLIP");

  it("files a generated payslip into the employee's documents, tagged for search", async () => {
    const slip = await call("POST", "/api/salary/payslip", hr, { employeeId: someone, month: 3, year: 2026, incentive: 1000 });
    expect(slip.status, slip.body.slice(0, 200)).toBe(201);
    const filed = await payslipDocs();
    expect(filed).toHaveLength(1);
    expect(filed[0].tags).toContain("payslip");
    expect((await call("GET", "/api/documents?q=payslip")).data.length).toBeGreaterThanOrEqual(1);
  });

  // The API takes a 1-based month and stores it 0-based, so assert on the title.
  it("re-running the same month replaces rather than duplicates", async () => {
    const again = await call("POST", "/api/salary/payslip", hr, { employeeId: someone, month: 3, year: 2026, incentive: 2000 });
    expect(again.status).toBe(201);
    const march = (await payslipDocs()).filter((d: any) => /March 2026/.test(d.title));
    expect(march).toHaveLength(1);
    expect(march[0].payslipYear).toBe(2026);
  });

  it("bulk offer letters issue, reporting issued/skipped/failed", async () => {
    const bulk = await call("POST", "/api/letters/offer/bulk", hr, { employeeIds: [someone] });
    expect(bulk.status, bulk.body.slice(0, 200)).toBe(201);
    for (const k of ["issued", "skipped", "failed"]) expect(bulk.data).toHaveProperty(k);
    expect(bulk.data.issued).toBe(1);
  });

  it("re-issuing skips someone who already has one", async () => {
    const again = await call("POST", "/api/letters/offer/bulk", hr, { employeeIds: [someone] });
    expect(again.data.issued).toBe(0);
    expect(again.data.skipped).toHaveLength(1);
  });
});

describe("Authorisation", () => {
  it("an employee cannot import holidays, set the PT state or bulk-issue offer letters", async () => {
    expect((await call("POST", "/api/content/holidays/import", emp, { year: 2028 })).status).toBe(403);
    expect((await call("PUT", "/api/salary/professional-tax", emp, { state: "KA" })).status).toBe(403);
    expect((await call("POST", "/api/letters/offer/bulk", emp, {})).status).toBe(403);
  });

  it("an employee cannot read another person's KYC status", async () => {
    expect(someone).not.toBe(empEmployeeId);
    expect((await call("GET", `/api/documents/kyc-status?employeeId=${someone}`, emp)).status).toBe(403);
  });

  it("an employee sees only permitted documents", async () => {
    // Premise: HR can see a private document belonging to somebody else (the filed payslip).
    const all = arr((await call("GET", "/api/documents")).data);
    expect(all.some((d: any) => d.employeeId && d.employeeId !== empEmployeeId)).toBe(true);
    const mine = await call("GET", "/api/documents", emp);
    expect(mine.status).toBe(200);
    expect(mine.data.every((d: any) => !d.employeeId || d.employeeId === empEmployeeId)).toBe(true);
    expect(mine.data.some((d: any) => d.title === "Travel policy"), "org-wide documents stay visible").toBe(true);
  });
});
