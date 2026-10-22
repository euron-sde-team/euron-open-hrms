import { describe, expect, it } from "vitest";
import { envScript, envScriptResponse, nonEmpty } from "../src";

const run = (script: string) => {
  const g: { __HRMS_ENV?: Record<string, string> } = {};
  new Function("globalThis", script)(g);
  return g.__HRMS_ENV;
};

describe("envScript", () => {
  it("assigns a frozen globalThis.__HRMS_ENV", () => {
    const env = run(envScript({ API_URL: "https://api.example.com/api", PRODUCT_NAME: "Acme" }));
    expect(env).toEqual({ API_URL: "https://api.example.com/api", PRODUCT_NAME: "Acme" });
    expect(Object.isFrozen(env)).toBe(true);
  });

  it("cannot be broken out of with a closing script tag", () => {
    const hostile = "</script><script>alert(1)</script><!--";
    const out = envScript({ PRODUCT_NAME: hostile });
    expect(out).not.toContain("<");
    expect(run(out)?.PRODUCT_NAME).toBe(hostile);
  });

  it("escapes the JS line terminators", () => {
    const out = envScript({ PRODUCT_NAME: "a\u2028b\u2029c" });
    expect(out).not.toMatch(/[\u2028\u2029]/);
    expect(run(out)?.PRODUCT_NAME).toBe("a\u2028b\u2029c");
  });
});

describe("envScriptResponse", () => {
  it("serves uncached JavaScript", async () => {
    const res = envScriptResponse({ A: "1" });
    expect(res.headers.get("content-type")).toMatch(/^application\/javascript/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain('"A":"1"');
  });
});

describe("nonEmpty", () => {
  it("trims and rejects blanks and non-strings", () => {
    expect(nonEmpty("  x ")).toBe("x");
    expect(nonEmpty("   ")).toBeUndefined();
    expect(nonEmpty(3)).toBeUndefined();
  });
});
