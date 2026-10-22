/**
 * CSV writing, in one place.
 *
 * Extracted from reports.routes.ts when onboarding needed exports too. Copying it would have
 * meant two implementations of the formula-injection defence below, and the copy that gets
 * forgotten during a refactor is the one that ships the exploit.
 */

/**
 * CSV formula injection (OWASP): a cell starting with = + - @ (or a leading tab/CR) is
 * executed as a formula by Excel/Sheets. Prefix with a single quote to defang
 * employee-controlled fields (names, addresses, notes). Exported for the few exports that
 * build their own lines instead of calling csv().
 */
export function defangCell(v: any): string {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/** Serialise rows of cells. */
export function csv(rows: any[][]): string {
  const esc = (v: any) => {
    v = defangCell(v);
    // A bare CR is a line break to Excel, so it is quoted too: unquoted, it would start a
    // new row whose first cell escaped the defang above.
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

export function sendCsv(res: any, name: string, rows: any[][]) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=${name}`);
  res.send(csv(rows));
}
