import { test, expect } from "@playwright/test";
import { CONSOLE, DEMO, signIn } from "../helpers";

// The operator console hands a short-lived, audited session to the tenant web app in a
// new tab; the web app makes it unmistakable that an operator is acting.
test("an operator impersonates into a workspace and the web app shows the support banner", async ({ page, context }) => {
  await signIn(page, DEMO.operator, CONSOLE);
  await page.waitForURL(/\/overview/);
  await page.goto(`${CONSOLE}/workspaces`);
  await page.getByText("Acme Robotics").first().click();
  await page.getByRole("button", { name: /^impersonate$/i }).first().click();

  const dialog = page.getByRole("dialog").filter({ hasText: /Impersonate Acme Robotics/ });
  const reason = dialog.getByRole("textbox");
  if (await reason.count()) await reason.first().fill("e2e support check");
  const [tenantTab] = await Promise.all([
    context.waitForEvent("page"),
    dialog.getByRole("button", { name: /^impersonate$/i }).click(),
  ]);

  await tenantTab.waitForURL(/\/dashboard/, { timeout: 20_000 });
  await expect(tenantTab.getByText(/operator support session/i)).toBeVisible();
  await expect(tenantTab.getByText(/Acme Robotics/).first()).toBeVisible();
  // The hand-off token travels in the fragment and is consumed, never left in the URL.
  expect(tenantTab.url()).not.toContain("#imp=");
});
