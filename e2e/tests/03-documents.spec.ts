import { test, expect } from "@playwright/test";
import { API, DEMO, WEB, apiToken } from "../helpers";

// A payslip is generated (PDF stored in S3 on the emulator), then anyone holding the
// document can check it is genuine on the public verification page, without signing in.
test("a generated payslip can be verified publicly from its code", async ({ page, request }) => {
  const token = await apiToken(request, DEMO.acmeAdmin);
  const auth = { authorization: `Bearer ${token}` };
  const emps = await (await request.get(`${API}/employees`, { headers: auth })).json();
  const list = Array.isArray(emps) ? emps : emps.items || emps.employees;
  const employee = list.find((e: any) => e.email === DEMO.acmeEmployee);
  const now = new Date();
  const gen = await request.post(`${API}/salary/payslip`, { headers: auth, data: { employeeId: employee.id, month: now.getUTCMonth() + 1, year: now.getUTCFullYear() } });
  expect(gen.status(), await gen.text()).toBe(201);
  const body = await gen.json();
  const code = body.verification?.code || body.payslip?.verifyCode;
  expect(code, JSON.stringify(Object.keys(body))).toBeTruthy();

  const download = await request.get(`${API}/salary/payslips/${body.payslip.id}/download`, { headers: auth });
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("pdf");

  await page.goto(`${WEB}/verify/${encodeURIComponent(code)}`);
  await expect(page.getByText(/genuine|valid|verified/i).first()).toBeVisible();
  await expect(page.getByText(/payslip/i).first()).toBeVisible();

  await page.goto(`${WEB}/verify/NOT-A-REAL-CODE`);
  await expect(page.getByText(/not found|no document|could not|invalid/i).first()).toBeVisible();
});
