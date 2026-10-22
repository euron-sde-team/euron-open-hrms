/**
 * The filename a server chose, from a Content-Disposition header.
 *
 * Handles the RFC 5987 form (`filename*=UTF-8''payslip%20May.pdf`), quoted and
 * bare `filename=`, and prefers `filename*` when both are present because that
 * is the one that can carry non-ASCII names.
 */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(header);
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(header);
  const raw = extended?.[1] ?? plain?.[1] ?? plain?.[2]?.trim();
  if (!raw) return fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    // A literal % that is not an escape: use the name as sent.
    return raw;
  }
}

/** Hand a Blob to the browser as a file download. */
export function saveBlob(data: BlobPart, filename: string): void {
  const href = window.URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has definitely been handled.
  setTimeout(() => window.URL.revokeObjectURL(href), 0);
}
