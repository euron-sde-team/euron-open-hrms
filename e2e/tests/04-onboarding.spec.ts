import { test, expect } from "@playwright/test";
import { API, DEMO, apiToken, latestMail, linkIn } from "../helpers";

// HR invites a candidate; the candidate opens the emailed link with no account and
// reaches their onboarding form.
test("a candidate opens the emailed onboarding link and sees their form", async ({ page, request }) => {
  const token = await apiToken(request, DEMO.acmeHr);
  const personalEmail = `candidate.${Date.now().toString(36)}@example.com`;
  const r = await request.post(`${API}/onboarding/invites`, {
    headers: { authorization: `Bearer ${token}` },
    data: { firstName: "Jamie", lastName: "Rivera", personalEmail, employmentType: "FULL_TIME", designation: "Designer" },
  });
  expect(r.status(), await r.text()).toBe(201);

  const mail = await latestMail(request, personalEmail, /.+/);
  const link = linkIn(mail, /https?:\/\/[^\s"'<>]+\/onboard\?token=[\w-]+/);
  await page.goto(link);
  await expect(page.getByText(/Jamie/).first()).toBeVisible();
  await expect(page.getByText(/acme robotics/i).first()).toBeVisible();
});
