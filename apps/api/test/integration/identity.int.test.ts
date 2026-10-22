/**
 * Sign-in address uniqueness against the real database.
 *
 * A login is unique platform-wide, so `assertEmailAvailable` looks addresses up through
 * systemRepos(), across every workspace; employee addresses are checked within the
 * workspace. The case that shipped broken: editing an employee whose address matched their
 * own login (every employee created with one identity) failed with "already the sign-in
 * address for someone in this workspace", even when only the joining date had changed.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { repos, systemRepos } from "../../src/repositories/base.repository";
import * as ident from "../../src/services/identity.service";
import { ACCOUNTS, seedFixtures } from "./fixtures";

let r: ReturnType<typeof repos>;
let fx: Awaited<ReturnType<typeof seedFixtures>>;
const NO_LOGIN_EMAIL = "ravi.kumar@acme.example.com";

beforeAll(async () => {
  fx = await seedFixtures();
  r = repos({ orgId: fx.acme.id });
  // An employee with an address but no login, so only the employee-record check can catch it.
  await r.employees.insert({ code: "ACM-NOLOGIN", firstName: "Ravi", lastName: "Kumar", officialEmail: NO_LOGIN_EMAIL, email: NO_LOGIN_EMAIL, personalEmail: "", employmentType: "FULL_TIME", designation: "Analyst", joiningDate: "2026-01-01", status: "ACTIVE" });
});

describe("assertEmailAvailable", () => {
  it("treats the employee's own login as self", async () => {
    // Premise: the address really is held by a login, linked to this employee.
    const login = await systemRepos().users.where({ email: ACCOUNTS.emp }).one();
    expect(login?.employeeId).toBe(fx.ids.emp);
    // Without naming the record being edited, the same address is a clash.
    await expect(ident.assertEmailAvailable(r, ACCOUNTS.emp)).rejects.toThrow();
    await expect(ident.assertEmailAvailable(r, ACCOUNTS.emp, { employeeId: fx.ids.emp })).resolves.toBeUndefined();
  });

  it("still refuses somebody else's login", async () => {
    await expect(ident.assertEmailAvailable(r, ACCOUNTS.lead, { employeeId: fx.ids.emp })).rejects.toThrow(/already the sign-in address for someone in this workspace/);
  });

  it("still refuses another employee's address", async () => {
    expect(await systemRepos().users.where({ email: NO_LOGIN_EMAIL }).one()).toBeFalsy();
    await expect(ident.assertEmailAvailable(r, NO_LOGIN_EMAIL, { employeeId: fx.ids.emp })).rejects.toThrow(/Ravi Kumar's record/);
  });

  it("ignores an empty address", async () => {
    await expect(ident.assertEmailAvailable(r, "", { employeeId: fx.ids.emp })).resolves.toBeUndefined();
  });
});
