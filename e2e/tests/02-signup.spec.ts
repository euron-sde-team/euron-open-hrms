import { test, expect } from "@playwright/test";
import { API, WEB, dismissTour, latestMail, linkIn } from "../helpers";

// A brand-new company signs up, verifies its address from the email SES sent (read back
// from Mailpit), and lands in its own provisioned workspace.
test("a company signs up, verifies its email and gets a provisioned workspace", async ({ page, request }) => {
  const stamp = Date.now().toString(36);
  const email = `founder.${stamp}@initech-${stamp}.example.com`;

  await page.goto(`${WEB}/signup`);
  await page.locator("#companyName").fill(`Initech ${stamp}`);
  await page.locator("#adminName").fill("Peter Gibbons");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("Signup-Passw0rd!");
  await page.getByRole("button", { name: /create workspace/i }).click();
  await expect(page.getByText(/check your (email|inbox)|verify/i).first()).toBeVisible();

  const mail = await latestMail(request, email, /verify|confirm/i);
  const link = linkIn(mail, /https?:\/\/[^\s"'<>]+\/verify\?token=[\w-]+/);
  await page.goto(link);
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  await dismissTour(page);

  // Provisioning gave the new workspace its starter content: a leave catalogue and
  // departments, visible to its own admin and to nobody else.
  const token = await page.evaluate(() => localStorage.getItem("hrms.token"));
  const types = await (await request.get(`${API}/leave/types`, { headers: { authorization: `Bearer ${token}` } })).json();
  const names = (Array.isArray(types) ? types : types.types || []).map((t: any) => t.name);
  expect(names).toEqual(expect.arrayContaining(["Casual Leave", "Sick Leave"]));
  await page.goto(`${WEB}/departments`);
  await expect(page.getByRole("heading", { name: /departments/i }).first()).toBeVisible();
});
