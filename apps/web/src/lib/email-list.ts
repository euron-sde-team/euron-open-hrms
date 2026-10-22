/**
 * "a@example.com, b@example.com;c@example.com" to a clean, de-duplicated list.
 * Commas, semicolons and whitespace all separate, because people paste lists
 * from mail clients and spreadsheets. Validation stays the API's job; this only
 * shapes the input.
 */
export function splitEmailList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase();
    if (e) seen.add(e);
  }
  return [...seen];
}
