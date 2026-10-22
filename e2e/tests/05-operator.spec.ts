import { test, expect } from "@playwright/test";
import { CONSOLE, DEMO, WEB, signIn, signInToWeb } from "../helpers";

test.describe("Operator console", () => {
  test("an operator sees the fleet and both demo workspaces", async ({ page }) => {
    await signIn(page, DEMO.operator, CONSOLE);
    await page.waitForURL(/\/overview/);
    await page.goto(`${CONSOLE}/workspaces`);
    await expect(page.getByText("Acme Robotics").first()).toBeVisible();
    await expect(page.getByText("Globex Labs").first()).toBeVisible();
  });

  test("suspending a workspace locks its signed-in users out immediately, reactivating restores them", async ({ browser }) => {
    const tenant = await browser.newPage();
    await signInToWeb(tenant, DEMO.globexAdmin);

    const ops = await browser.newPage();
    await signIn(ops, DEMO.operator, CONSOLE);
    await ops.waitForURL(/\/overview/);
    await ops.goto(`${CONSOLE}/workspaces`);
    const row = ops.getByRole("row", { name: /Globex Labs/ });
    await row.getByRole("button").last().click();
    await ops.getByRole("menuitem", { name: /suspend/i }).click();
    const dialog = ops.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole("textbox").first().fill("e2e check").catch(() => undefined);
      await dialog.getByRole("button", { name: /suspend/i }).click();
    }
    await expect(row.getByText(/suspended/i)).toBeVisible();

    // The tenant's existing session is refused on its very next request.
    await tenant.reload();
    await expect(tenant.getByRole("heading", { name: /workspace suspended/i })).toBeVisible();

    await row.getByRole("button").last().click();
    await ops.getByRole("menuitem", { name: /reactivate/i }).click();
    const again = ops.getByRole("dialog");
    if (await again.isVisible().catch(() => false)) await again.getByRole("button", { name: /reactivate/i }).click();
    await expect(row.getByText(/active/i)).toBeVisible();

    await tenant.goto(`${WEB}/dashboard`);
    await expect(tenant.getByRole("heading", { name: /workspace suspended/i })).toBeHidden();
  });
});
