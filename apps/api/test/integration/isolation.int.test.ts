/**
 * Tenant isolation, swept across the whole tenant API rather than spot-checked.
 *
 * The route inventory is read from the source (every router mounted behind
 * authRequired in app.ts), so a new route is covered the day it is added. Then, signed
 * in as the admin of workspace B (who holds every permission in B), the sweep calls
 * every parameterised route with the real ids of workspace A's records:
 *
 *   GET     responses must never contain A's data (its people's emails and codes)
 *   writes  PUT / PATCH / POST / DELETE must not change a single row of A
 *
 * A's rows are fingerprinted (id, updated_at, data) before the sweep and compared after.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, dbAny } from "../../src/db/kysely";
import { TABLES } from "../../src/repositories/base.repository";
import { ACCOUNTS, client, seedFixtures, startServer } from "./fixtures";

const SRC = path.join(__dirname, "..", "..", "src");
const SKIP_MOUNTS = new Set(["/api/auth", "/api/mfa", "/api/signup", "/api/platform", "/api/platform/auth", "/api/onboarding/public", "/api/verify"]);

type Route = { method: string; path: string };

/** Every route with a path parameter, on routers mounted behind authRequired. */
function inventory(): Route[] {
  const app = fs.readFileSync(path.join(SRC, "app.ts"), "utf8");
  const files = new Map<string, string>();
  for (const m of app.matchAll(/import (\w+) from "\.\/(routes\/[\w.-]+)";/g)) files.set(m[1], m[2]);
  const routes: Route[] = [];
  for (const m of app.matchAll(/app\.use\("(\/api\/[^"]+)", authRequired, (\w+)\)/g)) {
    const [, mount, ident] = m;
    if (SKIP_MOUNTS.has(mount) || !files.has(ident)) continue;
    const text = fs.readFileSync(path.join(SRC, files.get(ident)! + ".ts"), "utf8");
    for (const r of text.matchAll(/router\.(get|put|patch|post|delete)\("([^"]*:[a-zA-Z]+[^"]*)"/g)) {
      routes.push({ method: r[1].toUpperCase(), path: mount + r[2] });
    }
  }
  return routes;
}

async function fingerprint(orgId: string) {
  const out = new Map<string, string>();
  for (const meta of Object.values(TABLES) as any[]) {
    if (!meta.tenant) continue;
    const rows = await dbAny.selectFrom(meta.table).select(["id", "updated_at", "data"]).where("org_id", "=", orgId).execute();
    for (const r of rows) out.set(`${meta.table}:${r.id}`, crypto.createHash("sha1").update(`${new Date(r.updated_at).toISOString()}|${JSON.stringify(r.data)}`).digest("hex"));
  }
  return out;
}

let server: { base: string; close: () => Promise<void> };
let api: ReturnType<typeof client>;
let fx: Awaited<ReturnType<typeof seedFixtures>>;
let routes: Route[] = [];
let victimIds: string[] = [];
let sentinels: string[] = [];
let before = new Map<string, string>();

beforeAll(async () => {
  fx = await seedFixtures();
  server = await startServer();
  api = client(server.base);

  // Give workspace A records in the tables a typical tenant fills, so the sweep has
  // real ids to aim at: a leave request, a reimbursement, an announcement, a document.
  const admin = await api.login(ACCOUNTS.acmeAdmin);
  const emp = await api.login(ACCOUNTS.emp);
  const types = (await api.call("GET", "/api/leave/types", admin)).data;
  const day = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  await api.call("POST", "/api/leave/requests", emp, { leaveTypeId: (Array.isArray(types) ? types : types.types)[0].id, from: day, to: day, reason: "isolation" });
  await api.call("POST", "/api/reimbursements", emp, { category: "TRAVEL", amount: 100, description: "isolation" });
  await api.call("POST", "/api/announcements", admin, { title: "isolation", body: "isolation", category: "GENERAL" });

  routes = inventory();
  const ids = new Set<string>();
  for (const meta of Object.values(TABLES) as any[]) {
    if (!meta.tenant) continue;
    const rows = await dbAny.selectFrom(meta.table).select("id").where("org_id", "=", fx.acme.id).limit(2).execute();
    for (const r of rows) ids.add(r.id);
  }
  victimIds = [...ids];
  const people = await db.selectFrom("employees").select(["email", "code"]).where("org_id", "=", fx.acme.id).execute();
  sentinels = people.flatMap((p) => [p.email, p.code]).filter((v): v is string => !!v);
  before = await fingerprint(fx.acme.id);
}, 120_000);
afterAll(() => server.close());

describe("Tenant isolation sweep", () => {
  it("the inventory covers the tenant API", async () => {
    expect(routes.length).toBeGreaterThan(80);
    expect(victimIds.length).toBeGreaterThan(15);
    expect(sentinels.length).toBeGreaterThan(5);
  });

  it("the detector is live: workspace A's own admin does see that data", async () => {
    // Without this, a sweep that never matched anything would pass for the wrong reason.
    const owner = await api.login(ACCOUNTS.acmeAdmin);
    const r = await api.call("GET", `/api/employees/${fx.ids.emp}`, owner);
    expect(r.status).toBe(200);
    expect(sentinels.some((s) => r.body.includes(s))).toBe(true);
  });

  it("no parameterised route lets workspace B read or change workspace A", async () => {
    const attacker = await api.login(ACCOUNTS.globexAdmin);
    const leaks: string[] = [];
    let requests = 0;
    for (const route of routes) {
      for (const id of victimIds) {
        // The first parameter gets the victim id; any further one a harmless placeholder.
        let first = true;
        const p = route.path.replace(/:[a-zA-Z]+/g, () => (first ? ((first = false), id) : "x"));
        const r = await api.call(route.method, p, attacker, route.method === "GET" || route.method === "DELETE" ? undefined : {});
        requests++;
        if (r.status >= 500) leaks.push(`${route.method} ${route.path} -> ${r.status}`);
        if (route.method === "GET" && r.status < 300) {
          const hit = sentinels.find((s) => r.body.includes(s));
          if (hit) leaks.push(`${route.method} ${route.path} returned workspace A data (${hit})`);
        }
      }
    }
    expect(requests).toBeGreaterThan(1000);
    expect(leaks, leaks.slice(0, 20).join("\n")).toEqual([]);
  }, 600_000);

  it("not one of workspace A's rows changed", async () => {
    const after = await fingerprint(fx.acme.id);
    const changed = [...before.keys()].filter((k) => after.get(k) !== before.get(k));
    const created = [...after.keys()].filter((k) => !before.has(k));
    expect(changed, `changed: ${changed.slice(0, 10).join(", ")}`).toEqual([]);
    expect(created, `created in A: ${created.slice(0, 10).join(", ")}`).toEqual([]);
  });
});
