import fs from "node:fs";
import path from "node:path";
import { expect, type Page, type APIRequestContext } from "@playwright/test";

export const WEB = process.env.WEB_URL || "http://localhost:3410";
export const CONSOLE = process.env.CONSOLE_URL || "http://localhost:3420";
export const API = process.env.API_URL || "http://localhost:5005/api";
export const MAILPIT = process.env.MAILPIT_URL || "http://localhost:8025";

/** The demo password `make env` generated (DEMO_PASSWORD overrides). */
export const PASSWORD = (() => {
  if (process.env.DEMO_PASSWORD) return process.env.DEMO_PASSWORD;
  const env = path.join(__dirname, "..", "deploy", "compose", ".env");
  const line = fs.existsSync(env) ? fs.readFileSync(env, "utf8").split("\n").find((l) => l.startsWith("HRMS_DEMO_PASSWORD=")) : null;
  if (!line) throw new Error("No demo password: run `make env && make demo`, or set DEMO_PASSWORD");
  return line.slice("HRMS_DEMO_PASSWORD=".length).trim();
})();

export const DEMO = {
  acmeAdmin: "maya.kapoor@acme-robotics.example.com",
  acmeHr: "leela.krishnan@acme-robotics.example.com",
  acmeLead: "arjun.mehta@acme-robotics.example.com",
  acmeEmployee: "rohan.das@acme-robotics.example.com",
  globexAdmin: "elena.fischer@globex-labs.example.com",
  operator: "operator@example.com",
};

/** Close the first-run product tour if it opens. */
export async function dismissTour(page: Page) {
  const pop = page.locator(".driver-popover");
  if (await pop.isVisible({ timeout: 2500 }).catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(pop).toBeHidden();
  }
}

export async function signIn(page: Page, email: string, base = WEB, password = PASSWORD) {
  await page.goto(`${base}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

export async function signInToWeb(page: Page, email: string) {
  await signIn(page, email);
  await page.waitForURL(/\/dashboard/);
  await dismissTour(page);
}

/** Token for API-side setup. */
export async function apiToken(request: APIRequestContext, email: string, password = PASSWORD): Promise<string> {
  const r = await request.post(`${API}/auth/login`, { data: { email, password } });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()).token;
}

export async function operatorToken(request: APIRequestContext): Promise<string> {
  const r = await request.post(`${API}/platform/auth/login`, { data: { email: DEMO.operator, password: PASSWORD } });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()).token;
}

type MailpitSummary = { ID: string; Subject: string; To: { Address: string }[] };

/** The newest message to `to` whose subject matches, waiting for it to arrive. */
export async function latestMail(request: APIRequestContext, to: string, subject: RegExp): Promise<{ id: string; html: string; text: string }> {
  for (let i = 0; i < 40; i++) {
    const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const hit = ((await r.json()).messages as MailpitSummary[]).find((m) => subject.test(m.Subject));
    if (hit) {
      const full = await (await request.get(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
      return { id: hit.ID, html: full.HTML || "", text: full.Text || "" };
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`No mail to ${to} matching ${subject}`);
}

export const linkIn = (mail: { html: string; text: string }, pattern: RegExp): string => {
  const m = (mail.html + "\n" + mail.text).replace(/&amp;/g, "&").match(pattern);
  if (!m) throw new Error(`No link matching ${pattern} in the mail`);
  return m[0];
};
