/**
 * Route order and the import pipeline, through the real employees router mounted on a bare
 * Express app with the workspace repos replaced by in-memory collections.
 *
 * The specific risk: `GET /import/template` must be registered before `GET /:id`, or
 * Express matches "import" as an employee id and the download 404s. Introspecting the
 * router stack does not prove the match order resolves that way, so this issues real
 * requests. The in-memory repos make every write observable directly; only the global
 * email-uniqueness check (systemRepos) reaches the database, which is why this lives with
 * the integration suites.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import employeeRoutes from "../../src/routes/employees.routes";
import { client, seedFixtures, type Res } from "./fixtures";

const ORG = { id: "org1", name: "Acme Technologies", slug: "acme-mem", designations: ["Product Designer", "Analyst"] };

const collection = (rows: any[]) => ({
  all: async () => rows,
  count: async () => rows.length,
  byId: async (id: string) => rows.find((r) => r.id === id) ?? null,
  find: async (fn: (r: any) => boolean) => rows.filter(fn),
  insert: async (doc: any) => {
    const row = { id: `id${rows.length + 1}`, ...doc };
    rows.push(row);
    return row;
  },
  update: async (id: string, patch: any) => Object.assign(rows.find((r) => r.id === id), patch),
  where: () => ({ one: async () => null }),
});

function fakeRepos() {
  const employees: any[] = [];
  const users: any[] = [];
  const auditLog: any[] = [];
  const repos: any = {
    ctx: { orgId: ORG.id },
    organizations: { ...collection([ORG]), byId: async () => ORG },
    departments: collection([{ id: "d1", name: "Engineering", orgId: ORG.id }]),
    offices: collection([{ id: "o1", name: "Main Office", orgId: ORG.id }]),
    employees: collection(employees),
    users: collection(users),
    auditLog: collection(auditLog),
  };
  repos.transaction = async (fn: (tx: any) => Promise<void>) => fn(repos);
  return { repos, employees, users };
}

const state = fakeRepos();
let server: http.Server;
let call: (method: string, p: string, token?: string | null, body?: unknown) => Promise<Res>;
let base = "";

beforeAll(async () => {
  // The uniqueness check reads real logins, so start from a known database.
  await seedFixtures();
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use((req: any, _res, next) => {
    // isStaff() reads the resolved permission set, not the role string, so the stub
    // carries `perms` the way authRequired would have populated it.
    req.user = { id: "u1", orgId: ORG.id, role: "ADMIN", employeeId: null, perms: new Set(["staff.access"]) };
    req.repos = state.repos;
    req.scope = null;
    req.inScope = () => true;
    next();
  });
  app.use("/api/employees", employeeRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ error: err.message || "error" }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ call } = client(base));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("Employee import routes", () => {
  describe("route reachability", () => {
    it("GET /employment-types lists the 6 current types, including the four newer ones", async () => {
      const res = await call("GET", "/api/employees/employment-types");
      expect(res.status).toBe(200);
      const values = res.data.current?.map((t: any) => t.value);
      expect(values).toHaveLength(6);
      expect(values).toEqual(expect.arrayContaining(["PERMANENT", "FREELANCER", "TEMPORARY", "VENDOR"]));
    });

    describe("GET /import/template", () => {
      let res: Response;
      let body: Buffer;
      beforeAll(async () => {
        res = await fetch(`${base}/api/employees/import/template`);
        body = Buffer.from(await res.arrayBuffer());
      });

      it("is NOT swallowed by /:id", () => expect(res.status).toBe(200));
      it("serves an xlsx content type", () => expect(String(res.headers.get("content-type"))).toContain("spreadsheetml"));
      it("sets a download filename", () => expect(String(res.headers.get("content-disposition"))).toContain(".xlsx"));
      it("is a real, non-trivial file", () => expect(body.length).toBeGreaterThan(5000));
      it("is a valid zip/xlsx container", () => expect(body.subarray(0, 2).toString()).toBe("PK"));
    });
  });

  describe("import commit", () => {
    const badRows = [
      { __row: 2, firstName: "Ok", email: "ok@imports.example.com", employmentType: "Permanent", joiningDate: "2026-01-01", monthlyGross: 50000 },
      { __row: 3, firstName: "Bad", email: "not-an-email", employmentType: "Permanent", joiningDate: "2026-01-01" },
    ];

    it("all-or-nothing: an invalid row rejects the whole batch with 422 and writes nothing", async () => {
      const res = await call("POST", "/api/employees/import", null, { rows: badRows, sendInvite: false });
      expect(res.status).toBe(422);
      expect(state.employees).toHaveLength(0);
    });

    it("skipInvalid imports exactly the one good row and reports the skipped one", async () => {
      const res = await call("POST", "/api/employees/import", null, { rows: badRows, sendInvite: false, skipInvalid: true });
      expect(res.status).toBe(201);
      expect(res.data.imported).toBe(1);
      expect(res.data.skipped).toBe(1);
      expect(state.employees).toHaveLength(1);
    });

    it("derives the salary from gross (50% basic) and generates a code", async () => {
      expect(state.employees[0]?.salary?.basic).toBe(25000);
      expect(state.employees[0]?.code).toBeTruthy();
    });

    it("creates vendors without a portal login, even when invites are requested", async () => {
      const usersBefore = state.users.length;
      const res = await call("POST", "/api/employees/import", null, {
        rows: [{ __row: 2, firstName: "Vend", email: "vend@imports.example.com", employmentType: "Vendor / contractor", joiningDate: "2026-01-01" }],
        sendInvite: true,
      });
      expect(res.status).toBe(201);
      expect(state.employees.some((e) => e.firstName === "Vend" && e.employmentType === "VENDOR")).toBe(true);
      expect(state.users.length).toBe(usersBefore);
      expect(state.users).toHaveLength(0);
    });

    it("rejects an empty rows[] with 400", async () => {
      expect((await call("POST", "/api/employees/import", null, { rows: [] })).status).toBe(400);
    });
  });
});
