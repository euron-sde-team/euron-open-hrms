import { describe, expect, it } from "vitest";
import { filenameFromDisposition } from "../src";

describe("filenameFromDisposition", () => {
  it("reads a quoted filename", () => {
    expect(filenameFromDisposition('attachment; filename="report.csv"', "x")).toBe("report.csv");
  });

  it("reads a bare filename", () => {
    expect(filenameFromDisposition("attachment; filename=report.csv", "x")).toBe("report.csv");
  });

  it("prefers and decodes the RFC 5987 form", () => {
    const header = "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''Offer%20letter%20%E2%9C%93.pdf";
    expect(filenameFromDisposition(header, "x")).toBe("Offer letter ✓.pdf");
  });

  it("falls back when there is no header or no filename", () => {
    expect(filenameFromDisposition(null, "fallback.bin")).toBe("fallback.bin");
    expect(filenameFromDisposition("inline", "fallback.bin")).toBe("fallback.bin");
  });

  it("keeps a name with a stray percent sign instead of throwing", () => {
    expect(filenameFromDisposition('attachment; filename="100%.txt"', "x")).toBe("100%.txt");
  });
});
