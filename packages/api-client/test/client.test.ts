import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient, apiError, apiErrorCode, isWorkspaceSuspendedError } from "../src";
import { stubAdapter, type StubResponse } from "./stub-adapter";

const TOKEN_KEY = "test.token";

function setup(respond: () => StubResponse, opts: Partial<Parameters<typeof createApiClient>[0]> = {}) {
  const client = createApiClient({ tokenKey: TOKEN_KEY, baseURL: "http://api.test/api/", ...opts });
  const stub = stubAdapter(respond);
  client.api.defaults.adapter = stub.adapter;
  return { client, calls: stub.calls };
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/dashboard");
});
afterEach(() => vi.restoreAllMocks());

describe("request", () => {
  it("attaches the bearer token from storage", async () => {
    window.localStorage.setItem(TOKEN_KEY, "abc");
    const { client, calls } = setup(() => ({ status: 200, data: { ok: true } }));
    await expect(client.http.get("/auth/me")).resolves.toEqual({ ok: true });
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer abc");
  });

  it("sends no Authorization header when signed out", async () => {
    const { client, calls } = setup(() => ({ status: 200, data: {} }));
    await client.http.get("/signup/countries");
    expect(calls[0]?.headers.has("Authorization")).toBe(false);
  });

  it("reads a function baseURL on every request and trims the trailing slash", async () => {
    let base = "http://one.test/api/";
    const { client, calls } = setup(() => ({ status: 200, data: {} }), { baseURL: () => base });
    await client.http.get("/a");
    base = "http://two.test/api";
    await client.http.get("/b");
    expect(calls.map((c) => c.baseURL)).toEqual(["http://one.test/api", "http://two.test/api"]);
  });

  it("sends a DELETE body only when one is given", async () => {
    const { client, calls } = setup(() => ({ status: 200, data: {} }));
    await client.http.del("/x");
    await client.http.del("/y", { reason: "gone" });
    expect(calls[0]?.data).toBeUndefined();
    expect(JSON.parse(String(calls[1]?.data))).toEqual({ reason: "gone" });
  });
});

describe("401", () => {
  it("clears the token and calls onUnauthorized", async () => {
    window.localStorage.setItem(TOKEN_KEY, "stale");
    const onUnauthorized = vi.fn();
    const { client } = setup(() => ({ status: 401, data: { error: "Session expired" } }), { onUnauthorized });
    await expect(client.http.get("/auth/me")).rejects.toThrow();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("leaves the token alone on other errors", async () => {
    window.localStorage.setItem(TOKEN_KEY, "good");
    const onUnauthorized = vi.fn();
    const { client } = setup(() => ({ status: 500 }), { onUnauthorized });
    await expect(client.http.get("/x")).rejects.toThrow();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("good");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe("WORKSPACE_SUSPENDED", () => {
  const suspended = (): StubResponse => ({
    status: 403,
    data: { error: "This workspace is suspended. Contact your administrator.", code: "WORKSPACE_SUSPENDED" },
  });

  it("notifies the option and every subscriber, and keeps the session", async () => {
    window.localStorage.setItem(TOKEN_KEY, "valid");
    const onWorkspaceSuspended = vi.fn();
    const { client } = setup(suspended, { onWorkspaceSuspended });
    const listener = vi.fn();
    const unsubscribe = client.onWorkspaceSuspended(listener);

    const err = await client.http.get("/employees").catch((e: unknown) => e);
    expect(isWorkspaceSuspendedError(err)).toBe(true);
    expect(apiErrorCode(err)).toBe("WORKSPACE_SUSPENDED");
    expect(onWorkspaceSuspended).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("valid");

    unsubscribe();
    await client.http.get("/employees").catch(() => undefined);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not fire for an ordinary 403", async () => {
    const listener = vi.fn();
    const { client } = setup(() => ({ status: 403, data: { error: "Forbidden" } }));
    client.onWorkspaceSuspended(listener);
    const err = await client.http.get("/payroll").catch((e: unknown) => e);
    expect(isWorkspaceSuspendedError(err)).toBe(false);
    expect(apiError(err)).toBe("Forbidden");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("apiError", () => {
  it("falls back through error, message and a generic string", () => {
    expect(apiError({ response: { data: { message: "m" } } })).toBe("m");
    expect(apiError(new Error("boom"))).toBe("boom");
    expect(apiError(undefined)).toBe("Something went wrong");
  });
});

describe("downloadFile", () => {
  it("saves the blob under the server's filename", async () => {
    const created: string[] = [];
    window.URL.createObjectURL = vi.fn(() => "blob:test");
    window.URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this.download);
    });
    const { client, calls } = setup(() => ({
      status: 200,
      data: new Blob(["x"]),
      headers: { "content-disposition": 'attachment; filename="payslip-2026-05.pdf"' },
    }));
    await client.downloadFile("/payroll/1/pdf", "payslip.pdf");
    expect(calls[0]?.responseType).toBe("blob");
    expect(click).toHaveBeenCalledOnce();
    expect(created).toEqual(["payslip-2026-05.pdf"]);
  });
});
