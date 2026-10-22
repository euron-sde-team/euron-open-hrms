import { describe, expect, it } from "vitest";
import { buildImpersonationUrl, consumeImpersonationHash, readImpersonationToken } from "../src";

describe("impersonation hand-off", () => {
  it("round-trips a token through the URL the console opens", () => {
    const token = "eyJhbGciOi.payload+with/odd=chars";
    const url = new URL(buildImpersonationUrl("https://people.example.com/", token));
    expect(url.pathname).toBe("/login");
    expect(url.search).toBe("");
    expect(readImpersonationToken(url.hash)).toBe(token);
  });

  it("finds the token among other fragment params", () => {
    expect(readImpersonationToken("#tab=x&imp=abc&y=1")).toBe("abc");
    expect(readImpersonationToken("imp=abc")).toBe("abc");
  });

  it("returns null when absent, empty or malformed", () => {
    expect(readImpersonationToken("")).toBeNull();
    expect(readImpersonationToken("#impx=abc")).toBeNull();
    expect(readImpersonationToken("#imp=")).toBeNull();
    expect(readImpersonationToken("#imp=%E0%A4%A")).toBeNull();
  });

  it("consumes the token and strips it from the address bar", () => {
    window.history.replaceState(null, "", "/login?next=%2Fpayroll#imp=tok123");
    expect(consumeImpersonationHash(window)).toBe("tok123");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/login?next=%2Fpayroll");
  });

  it("leaves the URL alone when there is nothing to consume", () => {
    window.history.replaceState(null, "", "/login#section");
    expect(consumeImpersonationHash(window)).toBeNull();
    expect(window.location.hash).toBe("#section");
  });
});
