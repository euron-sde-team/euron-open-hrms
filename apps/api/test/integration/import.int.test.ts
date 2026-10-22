/**
 * Bulk employee import end to end: the per-workspace xlsx template, a dry-run preview of a
 * deliberately messy sheet, the all-or-nothing commit, `skipInvalid`, replay safety and
 * who may import at all.
 *
 * The commit checks email uniqueness across every workspace through systemRepos(), so
 * this needs the real database; the parsing and validation rules themselves are covered
 * hermetically by the unit suite (import-roundtrip.test.ts).
 *
 * One ordered scenario: the commit tests replay the rows the preview returned.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { ACCOUNTS, client, seedFixtures, startServer, type Res } from "./fixtures";

let server: { base: string; close: () => Promise<void> };
let api: ReturnType<typeof client>;
let hr = "";
let emp = "";

beforeAll(async () => {
  await seedFixtures();
  server = await startServer();
  api = client(server.base);
  hr = await api.login(ACCOUNTS.acmeAdmin);
  emp = await api.login(ACCOUNTS.emp);
});
afterAll(() => server.close());

const call = (m: string, p: string, token?: string | null, body?: unknown): Promise<Res> => api.call(m, p, token, body);

/** Every address in the sheet is on this domain, so a search for it finds exactly the imports. */
const DOMAIN = "joiners.example.com";
const imported = async () => (await call("GET", `/api/employees?q=${DOMAIN}`, hr)).data as any[];

describe("Bulk import", () => {
  let depts: any[] = [];
  let preview: any;

  describe("template", () => {
    let res: Response;
    let buf: Buffer;

    beforeAll(async () => {
      res = await fetch(`${server.base}/api/employees/import/template`, { headers: { Authorization: `Bearer ${hr}` } });
      buf = Buffer.from(await res.arrayBuffer());
    });

    it("downloads as an xlsx file", async () => {
      expect(res.status).toBe(200);
      expect(String(res.headers.get("content-type"))).toContain("spreadsheetml");
    });

    it("is a real xlsx container", () => expect(buf.subarray(0, 2).toString()).toBe("PK"));

    it("has the Employees, Instructions and Reference sheets", async () => {
      const wb = XLSX.read(buf, { type: "buffer" });
      expect(wb.SheetNames).toEqual(expect.arrayContaining(["Employees", "Instructions", "Reference"]));
    });

    // Generated per workspace rather than shipped static, so the dropdowns are real.
    it("the Reference sheet lists the workspace's real departments", async () => {
      depts = (await call("GET", "/api/departments", hr)).data;
      expect(depts.length).toBeGreaterThan(0);
      const refText = JSON.stringify(XLSX.utils.sheet_to_json(XLSX.read(buf, { type: "buffer" }).Sheets["Reference"], { header: 1 }));
      for (const d of depts) expect(refText).toContain(d.name);
    });
  });

  describe("preview (dry run) of a messy sheet", () => {
    beforeAll(async () => {
      const dept = depts[0].name;
      const sheet = [
        ["First name", "Last name", "Personal email", "Employment type", "Joining date", "Department", "Monthly gross", "PAN", "IFSC", "Bank account number"],
        ["Zara", "Khan", `zara@${DOMAIN}`, "Permanent", "2026-04-01", dept, 90000, "ABCDE1234F", "EXMP0001234", "50100123456789"],
        ["Vikram", "Singh", `vikram@${DOMAIN}`, "Freelancer", "01/05/2026", dept, "₹1,20,000", "", "", ""],
        ["Meera", "Iyer", `meera@${DOMAIN}`, "Intern", "2026-06-01", "No Such Dept", 25000, "", "", ""],
        ["Broken", "Row", "not-an-email", "Astronaut", "2026-04-01", dept, 50000, "BADPAN", "NOPE", ""],
        ["Dupe", "Row", `zara@${DOMAIN}`, "Permanent", "2026-04-01", dept, 50000, "", "", ""],
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), "Employees");
      const res = await api.upload("/api/employees/import/preview", hr, {}, { name: "joiners.xlsx", buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer });
      expect(res.status, res.body.slice(0, 200)).toBe(200);
      preview = res.data;
    });

    const row = (first: string) => preview.rows.find((r: any) => r.value?.firstName === first);

    it("parses all 5 data rows: 3 valid, 2 invalid", async () => {
      expect(preview.summary.total).toBe(5);
      expect(preview.summary.valid).toBe(3);
      expect(preview.summary.invalid).toBe(2);
    });

    it("reads the day-first date 01/05/2026 as 2026-05-01", () => expect(row("Vikram")?.value?.joiningDate).toBe("2026-05-01"));
    it("parses '₹1,20,000' as a number", () => expect(row("Vikram")?.value?.monthlyGross).toBe(120000));
    it("gives a freelancer a single fee line with no PF deduction", async () => {
      expect(row("Vikram")?.value?.salary?.basic).toBe(120000);
      expect(row("Vikram")?.value?.salary?.deductions).toBe(0);
    });

    it("splits a permanent salary 50/40 with PF at the ceiling", async () => {
      const s = row("Zara")?.value?.salary;
      expect(s?.basic).toBe(45000);
      expect(s?.hra).toBe(18000);
      expect(s?.deductions).toBe(1800);
    });

    it("treats an unknown department as a warning, not an error", async () => {
      const meera = row("Meera");
      expect(meera?.errors).toEqual([]);
      expect(meera?.warnings?.some((w: any) => w.field === "Department")).toBe(true);
    });

    it("flags the broken row's email, type, PAN and IFSC", async () => {
      const broken = preview.rows.find((r: any) => r.row === 5);
      const fields = broken?.errors?.map((e: any) => e.field) || [];
      expect(fields).toEqual(expect.arrayContaining(["Personal email", "Employment type", "PAN", "IFSC"]));
    });

    it("rejects an email used twice in the same file", async () => {
      const dupe = preview.rows.find((r: any) => r.row === 6);
      expect(dupe?.errors?.some((e: any) => /more than once/i.test(e.message))).toBe(true);
    });

    it("writes nothing to the database", async () => expect(await imported()).toHaveLength(0));
  });

  describe("commit", () => {
    it("all-or-nothing: refuses a batch with bad rows with 422, reporting how many", async () => {
      const res = await call("POST", "/api/employees/import", hr, { rows: preview.rawRows, sendInvite: false });
      expect(res.status).toBe(422);
      expect(res.data.skipped).toBe(2);
      expect(await imported()).toHaveLength(0);
    });

    it("skipInvalid imports the 3 good rows and skips 2", async () => {
      const res = await call("POST", "/api/employees/import", hr, { rows: preview.rawRows, sendInvite: false, skipInvalid: true });
      expect(res.status).toBe(201);
      expect(res.data.imported).toBe(3);
      expect(res.data.skipped).toBe(2);
      expect(await imported()).toHaveLength(3);
    });

    it("persists the salary structure, type, department, code, bank and PAN", async () => {
      const zara = (await imported()).find((e: any) => e.firstName === "Zara");
      expect(zara.salary.basic).toBe(45000);
      expect(zara.salary.deductions).toBe(1800);
      expect(zara.employmentType).toBe("PERMANENT");
      expect(zara.departmentId).toBe(depts[0].id);
      expect(zara.code).toBeTruthy();
      expect(zara.bank?.ifsc).toBe("EXMP0001234");
      expect(zara.bank?.account).toBe("50100123456789");
      expect(zara.pan).toBe("ABCDE1234F");
    });

    it("gives every imported employee a DISTINCT code", async () => {
      const codes = (await imported()).map((e: any) => e.code);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it("stores the freelancer with no statutory deduction", async () => {
      const vikram = (await imported()).find((e: any) => e.firstName === "Vikram");
      expect(vikram.employmentType).toBe("FREELANCER");
      expect(vikram.salary.deductions).toBe(0);
    });

    it("re-uploading the same sheet imports nobody twice", async () => {
      const replay = await call("POST", "/api/employees/import", hr, { rows: preview.rawRows, sendInvite: false, skipInvalid: true });
      expect(replay.status === 400 || replay.data.imported === 0, `status ${replay.status}, imported ${replay.data?.imported}`).toBe(true);
      expect(await imported()).toHaveLength(3);
    });
  });

  describe("authorisation", () => {
    it("an employee cannot download the template", async () => {
      expect((await call("GET", "/api/employees/import/template", emp)).status).toBe(403);
    });

    it("an employee cannot import", async () => {
      const res = await call("POST", "/api/employees/import", emp, { rows: [{ firstName: "X", email: "x@example.com", employmentType: "Permanent" }] });
      expect(res.status).toBe(403);
    });
  });
});
