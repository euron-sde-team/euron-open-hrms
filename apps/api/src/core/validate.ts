/**
 * Tiny declarative request-body validator (zero dependencies, in the spirit of
 * the hand-rolled TOTP module). Define a schema of field rules; `validate`
 * returns a cleaned object or throws BadRequestError(400) with a clear message.
 *
 * Rule fields:
 *   type:     "string" | "number" | "boolean" | "array"   (default "string")
 *   required: boolean                                       (default false)
 *   trim:     boolean   - trim a string
 *   lower:    boolean   - l-case a string
 *   min/max:  number    - string length / number value / array length bounds
 *   email:    boolean   - must look like an email (implies lower+trim)
 *   enum:     array     - value must be one of these
 *   of:       rule      - element rule for arrays
 *   default:  any       - used when the field is absent/empty
 */
import { bad } from "./util";

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function coerce(rule, value, label) {
  const type = rule.type || "string";
  if (type === "string") {
    let s = value == null ? "" : String(value);
    if (rule.email || rule.lower) s = s.toLowerCase();
    if (rule.email || rule.trim) s = s.trim();
    if (rule.email && s && !EMAIL_RE.test(s)) throw bad(`${label} must be a valid email`);
    if (rule.min != null && s.length < rule.min) throw bad(`${label} must be at least ${rule.min} characters`);
    if (rule.max != null && s.length > rule.max) throw bad(`${label} must be at most ${rule.max} characters`);
    if (rule.enum && !rule.enum.includes(s)) throw bad(`${label} is invalid`);
    return s;
  }
  if (type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw bad(`${label} must be a number`);
    if (rule.min != null && n < rule.min) throw bad(`${label} must be >= ${rule.min}`);
    if (rule.max != null && n > rule.max) throw bad(`${label} must be <= ${rule.max}`);
    return n;
  }
  if (type === "boolean") return !!value;
  if (type === "array") {
    if (!Array.isArray(value)) throw bad(`${label} must be a list`);
    if (rule.min != null && value.length < rule.min) throw bad(`${label} must have at least ${rule.min} item(s)`);
    if (rule.max != null && value.length > rule.max) throw bad(`${label} must have at most ${rule.max} item(s)`);
    return rule.of ? value.map((v, i) => coerce(rule.of, v, `${label}[${i}]`)) : value;
  }
  return value;
}

/** Validate `body` against `schema`; returns a cleaned object (only known fields). */
export function validate(schema, body): any {
  const src = body && typeof body === "object" ? body : {};
  const out: any = {};
  for (const [field, rule] of Object.entries(schema) as [string, any][]) {
    const label = rule.label || field;
    const value = src[field];
    const empty = value == null || (typeof value === "string" && value.trim() === "");
    if (empty) {
      if (rule.default !== undefined) { out[field] = rule.default; continue; }
      if (rule.required) throw bad(`${label} is required`);
      if (value == null) continue; // optional + absent -> skip
    }
    out[field] = coerce(rule, value, label);
  }
  return out;
}
