/**
 * AI document extraction: validation rules, the off-by-default and exclusion guards,
 * and full round trips through both provider adapters against a local stub server
 * (AI_DOC_GEMINI_BASE_URL / AI_DOC_OPENAI_BASE_URL). No real provider is ever called.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  aadhaarChecksumValid,
  extractDocument,
  isExtractable,
  FIELD_SPECS,
  EXTRACTABLE,
} from "../../src/integrations/ai/document-extract";

/** Brute-force the check digit so we have a genuinely valid test number. */
function makeValidAadhaar(prefix11: string): string | null {
  for (let d = 0; d <= 9; d++) if (aadhaarChecksumValid(prefix11 + d)) return prefix11 + d;
  return null;
}

const ENV_KEYS = [
  "AI_DOC_EXTRACTION", "AI_DOC_PROVIDER", "AI_DOC_EXCLUDE", "GEMINI_API_KEY", "OPENAI_API_KEY",
  "AI_DOC_GEMINI_BASE_URL", "AI_DOC_OPENAI_BASE_URL",
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("Aadhaar checksum (Verhoeff)", () => {
  const valid = makeValidAadhaar("23456789012");
  it("a valid 12-digit number can be constructed", () => expect(valid).not.toBeNull());
  it("a valid number passes", () => expect(aadhaarChecksumValid(valid!)).toBe(true));
  it("a single misread digit is rejected", () => {
    const flipped = valid!.slice(0, 5) + ((Number(valid![5]) + 1) % 10) + valid!.slice(6);
    expect(aadhaarChecksumValid(flipped)).toBe(false);
  });
  it("11 digits are rejected", () => expect(aadhaarChecksumValid("12345678901")).toBe(false));
  it("13 digits are rejected", () => expect(aadhaarChecksumValid("1234567890123")).toBe(false));
  it("non-numeric input is rejected", () => expect(aadhaarChecksumValid("abcdefghijkl")).toBe(false));
});

describe("Field specs", () => {
  it("PAN, Aadhaar, voter ID, passport and bank proofs are covered", () => {
    expect(["PAN", "AADHAAR", "VOTER_ID", "PASSPORT", "BANK"].every((c) => isExtractable(c)), String(EXTRACTABLE)).toBe(true);
  });
  // Aadhaar is sensitive but returned in full: the extractor exists to CHECK a typed
  // number against the card, which last-four masking cannot do. `sensitive` governs logging.
  it("the Aadhaar number field is marked sensitive", () => {
    expect(FIELD_SPECS.AADHAAR.find((x) => x.key === "aadhaarNumber")!.sensitive).toBe(true);
  });
  it("Aadhaar is returned in full and normalised", () => {
    const f = FIELD_SPECS.AADHAAR.find((x) => x.key === "aadhaarNumber")!;
    expect(f.mask).toBeUndefined();
    expect(f.normalise!("2345 6789 0123")).toBe("234567890123");
  });
  it("the PAN normaliser accepts a well-formed PAN", () => expect(FIELD_SPECS.PAN[0].normalise!("abcde1234f")).toBe("ABCDE1234F"));
  it("the PAN normaliser rejects a malformed one", () => expect(FIELD_SPECS.PAN[0].normalise!("ABC123")).toBeNull());
  it("the IFSC normaliser enforces the format", () => {
    expect(FIELD_SPECS.BANK[1].normalise!("test0001234")).toBe("TEST0001234");
    expect(FIELD_SPECS.BANK[1].normalise!("NOPE")).toBeNull();
  });
});

describe("Guards", () => {
  it("does nothing unless explicitly enabled", async () => {
    delete process.env.AI_DOC_EXTRACTION;
    const off = await extractDocument({ buffer: Buffer.from("x"), mimeType: "image/png", category: "PAN" });
    expect(off.ok).toBe(false);
    expect(off.skipped).toMatch(/turned off/i);
  });
  // Every guard below returns BEFORE any provider call, so a placeholder key is safe.
  it("skips a category it has no rules for", async () => {
    process.env.AI_DOC_EXTRACTION = "true";
    process.env.GEMINI_API_KEY = "placeholder-not-used";
    const r = await extractDocument({ buffer: Buffer.from("x"), mimeType: "image/png", category: "GENERAL" });
    expect(r.skipped).toMatch(/No extraction rules/i);
  });
  it("refuses an unsupported file type", async () => {
    process.env.AI_DOC_EXTRACTION = "true";
    process.env.GEMINI_API_KEY = "placeholder-not-used";
    const r = await extractDocument({ buffer: Buffer.from("x"), mimeType: "text/plain", category: "PAN" });
    expect(r.skipped).toMatch(/Cannot read/i);
  });
});

/**
 * A stand-in for both providers. It answers with the JSON the extraction prompt asks
 * for, and records every request so the tests can assert what left the process.
 */
describe("Provider round trip (local stub)", () => {
  const seen: { path: string; auth: string; body: any }[] = [];
  const reply = {
    documentType: "PAN card",
    fields: { panNumber: "abcde1234f", name: "TEST SPECIMEN NAME", fatherName: "SPECIMEN FATHER", dob: "17/04/1996" },
    confidence: { panNumber: 0.97, name: 0.92, fatherName: 0.9, dob: 0.95 },
  };
  let server: http.Server;
  let base = "";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen.push({ path: req.url || "", auth: String(req.headers["x-goog-api-key"] || req.headers.authorization || ""), body: JSON.parse(raw || "{}") });
        const text = JSON.stringify(reply);
        const payload = req.url!.includes("generateContent")
          ? { candidates: [{ content: { parts: [{ text }] } }] }
          : { choices: [{ message: { content: text } }] };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const enable = (provider: "gemini" | "openai") => {
    process.env.AI_DOC_EXTRACTION = "true";
    process.env.AI_DOC_PROVIDER = provider;
    process.env.GEMINI_API_KEY = "test-only-gemini-key";
    process.env.OPENAI_API_KEY = "test-only-openai-key";
    process.env.AI_DOC_GEMINI_BASE_URL = base;
    process.env.AI_DOC_OPENAI_BASE_URL = `${base}/v1`;
  };

  for (const provider of ["gemini", "openai"] as const) {
    it(`${provider}: reads, normalises and validates every PAN field`, async () => {
      enable(provider);
      const before = seen.length;
      const out = await extractDocument({ buffer: Buffer.from("%PDF-specimen"), mimeType: "application/pdf", category: "PAN" });
      expect(out.ok).toBe(true);
      expect(out.provider).toBe(provider);
      expect(seen.length).toBe(before + 1);
      const pan = out.fields.find((f) => f.key === "panNumber");
      expect(pan?.value).toBe("ABCDE1234F");
      expect(pan?.valid).toBe(true);
      expect(out.fields.find((f) => f.key === "dob")?.value).toBe("1996-04-17");
    });
  }

  it("the gemini adapter authenticates with the key header and sends the document inline", async () => {
    enable("gemini");
    await extractDocument({ buffer: Buffer.from("%PDF-specimen"), mimeType: "application/pdf", category: "PAN" });
    const last = seen[seen.length - 1];
    expect(last.path).toMatch(/:generateContent$/);
    expect(last.auth).toBe("test-only-gemini-key");
    expect(last.body.contents[0].parts[1].inline_data.mime_type).toBe("application/pdf");
  });

  it("an excluded category never reaches a provider", async () => {
    enable("gemini");
    process.env.AI_DOC_EXCLUDE = "AADHAAR";
    const before = seen.length;
    const r = await extractDocument({ buffer: Buffer.from("x"), mimeType: "image/png", category: "AADHAAR" });
    expect(r.skipped).toMatch(/excluded/i);
    expect(seen.length).toBe(before);
  });

  it("an unrelated OpenAI key never reroutes documents away from the chosen provider", async () => {
    enable("gemini");
    delete process.env.AI_DOC_PROVIDER;
    await extractDocument({ buffer: Buffer.from("%PDF-specimen"), mimeType: "application/pdf", category: "PAN" });
    expect(seen[seen.length - 1].path).toMatch(/generateContent/);
  });
});
