/**
 * AI extraction of Indian identity documents.
 *
 * An employee uploads a photo or scan of a PAN card, Aadhaar, voter ID,
 * passport, driving licence, bank proof or an educational certificate, and the
 * fields are read out of it so nobody retypes them, and so HR verification
 * becomes "confirm what was read" rather than "read it yourself".
 *
 * ── Privacy is the load-bearing design decision, not an afterthought ────────
 *
 * The Aadhaar Act restricts storage and disclosure of Aadhaar numbers, and
 * sending an Aadhaar image to a third-party model is a real exposure. So:
 *
 *   1. Aadhaar is returned and stored in FULL. It used to be masked to its last
 *      four digits here, which defeated the only reason to extract it: the job
 *      is to CHECK the number the employee typed against the card, and
 *      last-four cannot tell a transposed digit from a correct one. It also
 *      disagreed with the self-onboarding route, which always stored the whole
 *      number, so the same field meant different things per intake path.
 *      PF and ESIC filing need all twelve digits. That makes this an access
 *      control obligation rather than a storage one: `documents.manage` and the
 *      department/office scoping gate who can read it, and it is marked
 *      `sensitive` so it stays out of logs.
 *   2. Nothing is sent anywhere unless AI_DOC_EXTRACTION is explicitly enabled.
 *      The default is off, so an unconfigured deployment cannot leak anything.
 *   3. Individual document types can be excluded from AI processing entirely
 *      via AI_DOC_EXCLUDE, so an organisation can keep Aadhaar local while
 *      still parsing PAN and certificates.
 *   4. Raw model responses are never logged, they contain the PII we are
 *      trying to contain.
 *
 * Extraction is advisory. Nothing it returns is trusted: every field is
 * validated, given a confidence, and still requires human verification before
 * it counts. A model misreading a digit must not silently become someone's
 * payroll PAN.
 */

import { docCategory } from "../../domain/documents";

/* ── Configuration ──────────────────────────────────────────────────────── */

export type AiProvider = "gemini" | "openai" | "none";

export function aiConfig() {
  const enabled = String(process.env.AI_DOC_EXTRACTION || "").toLowerCase() === "true";
  const geminiKey = process.env.GEMINI_API_KEY || "";
  const openaiKey = process.env.OPENAI_API_KEY || "";
  // Gemini is the only provider unless someone opts out in so many words.
  // This used to fall through to OpenAI whenever OPENAI_API_KEY happened to be
  // present, which meant an unrelated key left in the environment could
  // silently reroute identity documents, Aadhaar, PAN, bank proofs, to a
  // different vendor with no deploy, no code change and nothing in the logs to
  // say so. Choosing who sees that data is a decision, not a fallback.
  const requested = String(process.env.AI_DOC_PROVIDER || "gemini").trim().toLowerCase();
  const provider: AiProvider = !enabled
    ? "none"
    : requested === "openai"
      ? (openaiKey ? "openai" : "none")
      : geminiKey
        ? "gemini"
        : "none";
  return {
    enabled: enabled && provider !== "none",
    provider,
    geminiKey,
    openaiKey,
    model: process.env.AI_DOC_MODEL || "gemini-2.5-flash",
    /** Document categories never sent to a model, e.g. "AADHAAR". */
    excluded: new Set(
      String(process.env.AI_DOC_EXCLUDE || "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    ),
    maxBytes: Number(process.env.AI_DOC_MAX_BYTES || 8 * 1024 * 1024),
    /**
     * Provider endpoints. Overridable for an API gateway or regional endpoint you
     * operate, and so the test suite can run the full pipeline against a local stub.
     */
    geminiBaseUrl: (process.env.AI_DOC_GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, ""),
    openaiBaseUrl: (process.env.AI_DOC_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  };
}

/* ── Field specs per document type ──────────────────────────────────────── */

export interface FieldSpec {
  key: string;
  label: string;
  /** What to ask the model for. */
  hint: string;
  /** Validation; returns a normalised value or null when invalid. */
  normalise?: (raw: string) => string | null;
  /** Mask before returning, used for Aadhaar. */
  mask?: (value: string) => string;
  sensitive?: boolean;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const digits = (s: string) => String(s ?? "").replace(/\D/g, "");

/** ISO-ify the date formats Indian documents actually use. */
function toIso(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime()) ? null : iso;
  }
  // "17 April 1996" / "17-Apr-1996"
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Aadhaar Verhoeff checksum, the last digit validates the other eleven.
 * Catches a misread digit that a length check would pass.
 */
const D_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function aadhaarChecksumValid(num: string): boolean {
  const d = digits(num);
  if (d.length !== 12) return false;
  let c = 0;
  const reversed = d.split("").reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) c = D_TABLE[c][P_TABLE[i % 8][reversed[i]]];
  return c === 0;
}

export const FIELD_SPECS: Record<string, FieldSpec[]> = {
  PAN: [
    { key: "panNumber", label: "PAN", hint: "the 10-character Permanent Account Number",
      normalise: (r) => { const v = String(r).toUpperCase().replace(/\s/g, ""); return PAN_RE.test(v) ? v : null; } },
    { key: "name", label: "Name", hint: "the cardholder's full name as printed" },
    { key: "fatherName", label: "Father's name", hint: "the father's name, if printed" },
    { key: "dob", label: "Date of birth", hint: "date of birth", normalise: toIso },
  ],
  AADHAAR: [
    // Returned in full, not masked. Masking here defeated the only reason to extract it:
    // the point is to CHECK the typed number against the card, and last-four cannot tell a
    // transposed digit from a correct one. Still `sensitive`, so it stays out of logs, and
    // AI_DOC_EXCLUDE independently governs whether an Aadhaar image is sent to a model.
    { key: "aadhaarNumber", label: "Aadhaar", hint: "the 12-digit Aadhaar number",
      normalise: (r) => { const d = digits(r); return d.length === 12 ? d : null; },
      sensitive: true },
    { key: "name", label: "Name", hint: "the holder's full name as printed" },
    { key: "dob", label: "Date of birth", hint: "date of birth or year of birth", normalise: toIso },
    { key: "gender", label: "Gender", hint: "gender" },
    { key: "address", label: "Address", hint: "the full printed address" },
  ],
  VOTER_ID: [
    { key: "voterId", label: "Voter ID (EPIC)", hint: "the EPIC number",
      normalise: (r) => { const v = String(r).toUpperCase().replace(/\s/g, ""); return v.length >= 8 ? v : null; } },
    { key: "name", label: "Name", hint: "the elector's full name" },
    { key: "fatherName", label: "Father's / husband's name", hint: "the relation's name printed" },
    { key: "dob", label: "Date of birth", hint: "date of birth or age", normalise: toIso },
    { key: "address", label: "Address", hint: "the printed address" },
  ],
  PASSPORT: [
    { key: "passportNumber", label: "Passport number", hint: "the passport number",
      normalise: (r) => { const v = String(r).toUpperCase().replace(/\s/g, ""); return /^[A-Z][0-9]{7}$/.test(v) ? v : v.length >= 6 ? v : null; } },
    { key: "name", label: "Name", hint: "given and surname as printed" },
    { key: "dob", label: "Date of birth", hint: "date of birth", normalise: toIso },
    { key: "expiryDate", label: "Date of expiry", hint: "date of expiry", normalise: toIso },
    { key: "placeOfBirth", label: "Place of birth", hint: "place of birth" },
  ],
  DRIVING_LICENCE: [
    { key: "licenceNumber", label: "Licence number", hint: "the driving licence number" },
    { key: "name", label: "Name", hint: "the holder's name" },
    { key: "dob", label: "Date of birth", hint: "date of birth", normalise: toIso },
    { key: "validUntil", label: "Valid until", hint: "validity end date", normalise: toIso },
  ],
  BANK: [
    { key: "accountNumber", label: "Account number", hint: "the bank account number",
      normalise: (r) => { const d = digits(r); return d.length >= 6 ? d : null; } },
    { key: "ifsc", label: "IFSC", hint: "the IFSC code",
      normalise: (r) => { const v = String(r).toUpperCase().replace(/\s/g, ""); return IFSC_RE.test(v) ? v : null; } },
    { key: "bankName", label: "Bank name", hint: "the bank's name" },
    { key: "accountHolder", label: "Account holder", hint: "the account holder's name" },
  ],
  EDUCATION: [
    { key: "qualification", label: "Qualification", hint: "the degree or qualification awarded" },
    { key: "institution", label: "Institution", hint: "the university, board or college" },
    { key: "name", label: "Name", hint: "the student's name" },
    { key: "yearOfPassing", label: "Year of passing", hint: "year of passing or award" },
    { key: "grade", label: "Grade / percentage", hint: "the grade, CGPA or percentage" },
  ],
  EXPERIENCE: [
    { key: "employer", label: "Employer", hint: "the issuing company's name" },
    { key: "name", label: "Name", hint: "the employee's name" },
    { key: "designation", label: "Designation", hint: "the role held" },
    { key: "fromDate", label: "From", hint: "employment start date", normalise: toIso },
    { key: "toDate", label: "To", hint: "employment end date", normalise: toIso },
  ],
};

/** Which uploaded document categories we know how to read. */
export const EXTRACTABLE = Object.keys(FIELD_SPECS);
export const isExtractable = (category?: string | null) =>
  !!category && EXTRACTABLE.includes(String(category).toUpperCase());

/* ── Result shape ───────────────────────────────────────────────────────── */

export interface ExtractedField {
  key: string;
  label: string;
  /** Normalised value, masked where the spec demands it. */
  value: string;
  /** What the model returned, before normalisation, omitted for sensitive fields. */
  raw?: string;
  /** 0-1, as reported by the model and reduced when validation fails. */
  confidence: number;
  valid: boolean;
  note?: string;
}

export interface ExtractionResult {
  ok: boolean;
  /** Why extraction did not run, when it didn't. */
  skipped?: string;
  provider: AiProvider;
  model?: string;
  category: string;
  fields: ExtractedField[];
  warnings: string[];
  /** True when the image looked like a different document type than claimed. */
  categoryMismatch?: string | null;
  /** Milliseconds the provider call took, for cost/latency visibility. */
  ms?: number;
}

/* ── Prompt ─────────────────────────────────────────────────────────────── */

function buildPrompt(category: string, specs: FieldSpec[]): string {
  const fields = specs.map((s) => `  "${s.key}": string   // ${s.hint}`).join("\n");
  return [
    `You are reading an official Indian identity or employment document.`,
    `The uploader says it is: ${docCategory(category)?.label ?? category}.`,
    ``,
    `Return ONLY a JSON object, no prose and no code fences, of exactly this shape:`,
    `{`,
    `  "documentType": string,  // what you actually see, e.g. "PAN card", "Aadhaar card"`,
    `  "fields": {`,
    fields,
    `  },`,
    `  "confidence": {  // 0.0-1.0 per field above, how sure you are of the characters`,
    specs.map((s) => `    "${s.key}": number`).join(",\n"),
    `  }`,
    `}`,
    ``,
    `Rules:`,
    `- Transcribe EXACTLY what is printed. Do not guess, correct or complete values.`,
    `- If a field is absent or illegible, use an empty string and confidence 0.`,
    `- Never invent a plausible-looking number. An empty value is far better than a wrong one.`,
    `- Dates: prefer DD/MM/YYYY exactly as printed.`,
  ].join("\n");
}

/* ── Providers ──────────────────────────────────────────────────────────── */

interface ProviderResponse {
  documentType?: string;
  fields?: Record<string, string>;
  confidence?: Record<string, number>;
}

/** Pull the JSON object out of a model reply that may be fenced or chatty. */
function parseJsonReply(text: string): ProviderResponse | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callGemini(
  cfg: ReturnType<typeof aiConfig>,
  prompt: string,
  buffer: Buffer,
  mimeType: string
): Promise<ProviderResponse | null> {
  const url = `${cfg.geminiBaseUrl}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": cfg.geminiKey, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) {
    // Deliberately does NOT include the body: an error echo can carry the
    // document contents we are trying to contain.
    throw new Error(`Gemini returned HTTP ${res.status}`);
  }
  const data: any = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  return parseJsonReply(text);
}

async function callOpenai(
  cfg: ReturnType<typeof aiConfig>,
  prompt: string,
  buffer: Buffer,
  mimeType: string
): Promise<ProviderResponse | null> {
  const res = await fetch(`${cfg.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.openaiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_DOC_MODEL_OPENAI || "gpt-4o-mini",
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI returned HTTP ${res.status}`);
  const data: any = await res.json();
  return parseJsonReply(data?.choices?.[0]?.message?.content ?? "");
}

/* ── Public entry point ─────────────────────────────────────────────────── */

const SUPPORTED_MIME = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "application/pdf",
]);

/**
 * Read fields out of an uploaded identity document.
 *
 * Never throws: extraction is a convenience, and a provider outage must not
 * stop an employee uploading their documents. Failures come back as
 * `{ ok: false, skipped }`.
 */
export async function extractDocument(opts: {
  buffer: Buffer;
  mimeType: string;
  category: string;
}): Promise<ExtractionResult> {
  const cfg = aiConfig();
  const category = String(opts.category || "").toUpperCase();
  const base: ExtractionResult = {
    ok: false, provider: cfg.provider, category, fields: [], warnings: [], categoryMismatch: null,
  };

  if (!cfg.enabled) {
    return { ...base, skipped: "AI extraction is turned off (set AI_DOC_EXTRACTION=true and a provider key)." };
  }
  if (!isExtractable(category)) {
    return { ...base, skipped: `No extraction rules for "${category}".` };
  }
  if (cfg.excluded.has(category)) {
    return { ...base, skipped: `${category} is excluded from AI processing by configuration.` };
  }
  if (!SUPPORTED_MIME.has(String(opts.mimeType).toLowerCase())) {
    return { ...base, skipped: `Cannot read ${opts.mimeType}. Upload a PNG, JPEG, WEBP or PDF.` };
  }
  if (opts.buffer.length > cfg.maxBytes) {
    return { ...base, skipped: `File is larger than the ${Math.round(cfg.maxBytes / 1024 / 1024)}MB extraction limit.` };
  }

  const specs = FIELD_SPECS[category];
  const started = Date.now();
  let reply: ProviderResponse | null = null;
  try {
    const prompt = buildPrompt(category, specs);
    reply = cfg.provider === "gemini"
      ? await callGemini(cfg, prompt, opts.buffer, opts.mimeType)
      : await callOpenai(cfg, prompt, opts.buffer, opts.mimeType);
  } catch (err) {
    return { ...base, ms: Date.now() - started, skipped: `Extraction failed: ${(err as Error).message}` };
  }
  const ms = Date.now() - started;

  if (!reply || !reply.fields) {
    return { ...base, ms, skipped: "The document could not be read. Try a clearer photo." };
  }

  const warnings: string[] = [];
  const fields: ExtractedField[] = [];

  for (const spec of specs) {
    const rawValue = String(reply.fields[spec.key] ?? "").trim();
    let confidence = Number(reply.confidence?.[spec.key] ?? 0);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, confidence));

    if (!rawValue) {
      fields.push({ key: spec.key, label: spec.label, value: "", confidence: 0, valid: false, note: "Not found on the document." });
      continue;
    }

    let value = rawValue;
    let valid = true;
    let note: string | undefined;

    if (spec.normalise) {
      const norm = spec.normalise(rawValue);
      if (norm === null) {
        valid = false;
        // Drop confidence hard on a validation failure: the model may be
        // confident and still wrong, and a wrong PAN is worse than a blank one.
        confidence = Math.min(confidence, 0.2);
        note = `"${spec.sensitive ? "(withheld)" : rawValue}" is not a valid ${spec.label}.`;
        value = spec.sensitive ? "" : rawValue;
      } else {
        value = norm;
      }
    }

    // Aadhaar-specific: checksum, then mask. The full number stops here.
    if (spec.key === "aadhaarNumber" && valid) {
      if (!aadhaarChecksumValid(value)) {
        valid = false;
        confidence = Math.min(confidence, 0.2);
        note = "The Aadhaar number failed its checksum, so a digit was probably misread.";
      }
    }
    if (spec.mask) value = value ? spec.mask(value) : "";

    fields.push({
      key: spec.key,
      label: spec.label,
      value,
      raw: spec.sensitive ? undefined : rawValue,
      confidence,
      valid,
      note,
    });
  }

  // Did the model see a different document than the uploader claimed? Worth
  // saying out loud, mis-filed documents are a common onboarding problem.
  let categoryMismatch: string | null = null;
  const seen = String(reply.documentType ?? "").toLowerCase();
  if (seen) {
    const expected = (docCategory(category)?.label ?? category).toLowerCase();
    const key = expected.split(" ")[0];
    if (key && !seen.includes(key) && !expected.includes(seen.split(" ")[0])) {
      categoryMismatch = reply.documentType ?? null;
      warnings.push(`This looks like a ${reply.documentType}, but it was uploaded as ${docCategory(category)?.label ?? category}.`);
    }
  }

  const lowConfidence = fields.filter((f) => f.value && f.confidence < 0.6);
  if (lowConfidence.length) {
    warnings.push(`Low confidence on ${lowConfidence.map((f) => f.label).join(", ")}, please check these against the document.`);
  }
  if (category === "AADHAAR") {
    warnings.push("Only the last four digits of the Aadhaar number are retained.");
  }

  return {
    ok: fields.some((f) => f.value && f.valid),
    provider: cfg.provider,
    model: cfg.model,
    category,
    fields,
    warnings,
    categoryMismatch,
    ms,
  };
}
