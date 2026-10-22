import { test, expect } from "@playwright/test";
import { DEMO, PASSWORD, WEB, signIn, signInToWeb } from "../helpers";

test.describe("Signing in", () => {
  test("the root sends a signed-out visitor to sign-in", async ({ page }) => {
    await page.goto(WEB);
    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveTitle(/Euron Open HRMS/);
  });

  test("a wrong password is refused with a message, not a crash", async ({ page }) => {
    await signIn(page, DEMO.acmeAdmin, WEB, "not-the-password");
    await expect(page.getByText(/invalid|incorrect|wrong/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("an admin lands on the dashboard with the full HR navigation", async ({ page }) => {
    await signInToWeb(page, DEMO.acmeAdmin);
    await expect(page.locator('[data-tour="nav:People"]')).toBeVisible();
    await expect(page.locator('[data-tour="nav:Settings"]')).toBeVisible();
    // The same locator the employee test expects to find nothing with.
    await expect(page.getByRole("banner").getByText("Settings", { exact: true })).toBeVisible();
  });

  test("an employee sees their own balances and no staff settings", async ({ page }) => {
    await signInToWeb(page, DEMO.acmeEmployee);
    // Employees get their own security settings, not the workspace Settings menu.
    await expect(page.getByRole("banner").getByText("Settings", { exact: true })).toHaveCount(0);
    await page.goto(`${WEB}/leave`);
    await expect(page.getByText(/your balances/i)).toBeVisible();
    await expect(page.getByText("Casual Leave").first()).toBeVisible();
  });

  test("an employee cannot open staff-only pages", async ({ page, request }) => {
    await signInToWeb(page, DEMO.acmeEmployee);
    const token = await page.evaluate(() => localStorage.getItem("hrms.token"));
    const r = await request.get("http://localhost:5005/api/vendors", { headers: { authorization: `Bearer ${token}` } });
    expect(r.status()).toBe(403);
    expect(PASSWORD.length).toBeGreaterThan(5);
  });
});
