// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENV, apiBase, productName, runtimeEnv, serverEnv, splitProductName } from "@/lib/runtime-env";

afterEach(() => {
  window.__HRMS_ENV = undefined;
  vi.unstubAllEnvs();
});

describe("runtimeEnv", () => {
  it("prefers the injected window.__HRMS_ENV", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://build.example.com/api");
    window.__HRMS_ENV = { API_URL: "https://api.example.com/api/", PRODUCT_NAME: "Acme People" };
    expect(runtimeEnv()).toEqual({ API_URL: "https://api.example.com/api/", PRODUCT_NAME: "Acme People" });
    expect(apiBase()).toBe("https://api.example.com/api");
    expect(productName()).toBe("Acme People");
  });

  it("falls back to build-time NEXT_PUBLIC_* values, then defaults", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://build.example.com/api");
    expect(runtimeEnv().API_URL).toBe("http://build.example.com/api");
    expect(runtimeEnv().PRODUCT_NAME).toBe(DEFAULT_ENV.PRODUCT_NAME);
  });

  it("treats blank injected values as absent", () => {
    window.__HRMS_ENV = { API_URL: "  ", PRODUCT_NAME: "" };
    expect(runtimeEnv()).toEqual(DEFAULT_ENV);
  });
});

describe("serverEnv", () => {
  it("reads the unprefixed variables first", () => {
    expect(serverEnv({ API_URL: "https://a.example.com/api", NEXT_PUBLIC_API_URL: "https://b.example.com/api" }).API_URL).toBe(
      "https://a.example.com/api"
    );
    expect(serverEnv({}).PRODUCT_NAME).toBe(DEFAULT_ENV.PRODUCT_NAME);
  });
});

describe("splitProductName", () => {
  it("mutes the last word", () => {
    expect(splitProductName("Acme People HRMS")).toEqual({ lead: "Acme People", tail: "HRMS" });
    expect(splitProductName("Solo")).toEqual({ lead: "Solo", tail: "" });
  });
});
