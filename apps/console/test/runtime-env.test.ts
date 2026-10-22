// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ENV, runtimeEnv, serverEnv, tenantUrl } from "@/lib/runtime-env";

afterEach(() => {
  window.__HRMS_ENV = undefined;
});

describe("console runtime env", () => {
  it("defaults the tenant URL to the web app's dev port", () => {
    expect(runtimeEnv().TENANT_URL).toBe(DEFAULT_ENV.TENANT_URL);
    expect(serverEnv({}).TENANT_URL).toBe("http://localhost:3410");
  });

  it("takes the injected TENANT_URL and trims trailing slashes", () => {
    window.__HRMS_ENV = { TENANT_URL: "https://people.example.com//" };
    expect(tenantUrl()).toBe("https://people.example.com");
  });
});
