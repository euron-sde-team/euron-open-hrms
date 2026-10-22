/**
 * Render a letter template to a PDF.
 *
 * One generic walker replaces the eight hand-written generators that used to live in
 * letters.ts. Each block type maps onto exactly one pdf/kit.ts primitive, which is what
 * keeps an organisation's edits from breaking the layout: HR controls every word, while
 * measure, page breaks, the signature block and the verification strip stay under the
 * kit's control.
 */
import * as kit from "./kit";
import { FONT } from "./fonts";
import { money, round2, compEarnings } from "../core/util";
import { buildTokens, renderText, type TokenSubject } from "../domain/letter-tokens";
import { templateFor, type LetterBlock, type LetterTemplate } from "../domain/letter-templates";

/**
 * Per-issue suffix for letter filenames.
 *
 * Deterministic names (offer_<org>_<code>.pdf) meant re-issuing a letter overwrote the
 * previous PDF while the earlier Document row still pointed at that name, so the old record
 * silently served the new letter's content. Timestamped to the millisecond AND given a
 * random tail, because a seconds-only stamp still collided when two letters were issued
 * inside the same second, which a bulk run does routinely.
 */
const stamp = () =>
  `${new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 17)}${Math.random().toString(36).slice(2, 6)}`;

/** Compensation rows for the salary table. Returns the monthly gross. */
function salaryRows(ctx: kit.DocContext, salary: any, annual: boolean): number {
  const s = salary || {};
  const currency = s.currency || "INR";
  const fmt = (n: number) => money(n, currency);
  const rows: kit.AmountRow[] =
    Array.isArray(s.components) && s.components.length
      ? s.components.map((c: any) => ({ label: c.label || c.key, amount: fmt(Number(c.amount || 0)) }))
      : [
          { label: "Basic", amount: fmt(Number(s.basic || 0)) },
          { label: "House Rent Allowance (HRA)", amount: fmt(Number(s.hra || 0)) },
          { label: "Special / Other Allowances", amount: fmt(Number(s.allowances || 0)) },
        ];
  const monthlyGross = compEarnings(s);
  // Without the annual row, monthly gross is the bottom line and takes the emphasis.
  rows.push({ label: "Gross (monthly)", amount: fmt(monthlyGross), strong: annual, total: !annual });
  if (annual) rows.push({ label: "Annual CTC", amount: fmt(monthlyGross * 12), total: true });
  kit.amountTable(ctx, rows, { head: ["Component", "Amount"] });
  return monthlyGross;
}

/** Before/after comparison for an appraisal. */
function revisionRows(ctx: kit.DocContext, salary: any, previousSalary: any) {
  const currency = (salary && salary.currency) || "INR";
  const prevAnnual = round2(compEarnings(previousSalary) * 12);
  const newAnnual = round2(compEarnings(salary) * 12);
  const pct = prevAnnual > 0 ? round2(((newAnnual - prevAnnual) / prevAnnual) * 100) : 0;
  kit.amountTable(ctx, [
    { label: "Previous annual CTC", amount: money(prevAnnual, currency), muted: true },
    { label: "Increase", amount: `${pct >= 0 ? "+" : ""}${pct}%`, strong: true },
    { label: "Revised annual CTC", amount: money(newAnnual, currency), total: true },
  ]);
}

/** Dues on exit. `settlement` is a computeSettlement() result. */
function settlementRows(ctx: kit.DocContext, settlement: any, salary: any) {
  const s = settlement || {};
  const currency = (salary && salary.currency) || "INR";
  const fmt = (n: number) => money(n, currency);
  const rows: kit.AmountRow[] = [
    { label: `Pending salary (${s.daysWorked || 0} day(s))`, amount: fmt(s.pendingSalary || 0) },
    { label: `Leave encashment (${s.encashableLeaveDays || 0} day(s))`, amount: fmt(s.leaveEncashment || 0) },
  ];
  // Shown as a negative amount so the arithmetic down to the net is visible on its face.
  if (s.recoveries) rows.push({ label: "Less: recoveries", amount: fmt(-Math.abs(s.recoveries)), muted: true });
  rows.push({ label: "Net settlement (estimate)", amount: fmt(s.net || 0), total: true });
  kit.amountTable(ctx, rows, { head: ["Particulars", "Amount"] });
  if (s.unreturnedAssets) {
    kit.flow(ctx, `Note: ${s.unreturnedAssets} company asset(s) pending return.`, {
      font: FONT.semibold,
      size: kit.TYPE.small,
    });
  }
}

export interface RenderInput extends TokenSubject {
  kind: string;
  /** Resolved template. Pass to avoid a second org read; otherwise resolved from `org`. */
  template?: LetterTemplate;
  /** Verification record printed as the QR strip, when the letter carries one. */
  verification?: any;
  /** computeSettlement() output, for the settlement statement. */
  settlement?: any;
  /** Overrides the generated filename prefix. Defaults to the lowercased kind. */
  filePrefix?: string;
}

/**
 * Render `kind` for one employee, returning the PDF bytes and a unique filename.
 *
 * Empty blocks are skipped rather than rendered blank: an optional paragraph whose only
 * content was a token that did not apply (a termination with no stated reason, an absence
 * notice with no day count) would otherwise leave a stray fragment or an empty line in the
 * middle of a formal letter.
 */
export async function renderLetter(input: RenderInput): Promise<{ buffer: Buffer; fileName: string }> {
  const { kind, org, brand, employee } = input;
  const tpl = input.template || templateFor(org, kind);
  const tokens = buildTokens(input);
  const sub = (s: string) => renderText(s, tokens);

  const name = tokens["employee.fullName"];
  const title = sub(tpl.title);
  const prefix = input.filePrefix || kind.toLowerCase();
  const fileName = `${prefix}_${org.slug}_${employee.code || employee.id}_${stamp()}.pdf`;

  const ctx = kit.createDocument(brand, `${title} - ${name}`, title);

  /*
   * The date at the top. Readers take it as the date of the letter's subject, not the day
   * somebody clicked a button, so a reprint of an old appointment letter must not be stamped
   * with today. Falls back to the issue date whenever the chosen source is empty.
   */
  const DATE_BY_SOURCE: Record<string, string> = {
    issue: tokens["letter.date"],
    joining: tokens["employee.joiningDate"],
    effective: tokens["letter.effectiveDate"],
    lastWorkingDay: tokens["letter.lastWorkingDay"],
  };
  const headerDate = DATE_BY_SOURCE[tpl.dateSource || "issue"] || tokens["letter.date"];

  kit.letterhead(ctx);
  kit.refLine(ctx, tokens["letter.reference"] || null, headerDate);
  if (tpl.marker) kit.marker(ctx, sub(tpl.marker));
  kit.title(ctx, title);
  if (tpl.showRecipient) {
    const lines = (tpl.recipientLines || []).map(sub).filter(Boolean);
    if (lines.length) kit.recipient(ctx, lines);
  }

  for (const block of tpl.blocks as LetterBlock[]) {
    switch (block.type) {
      case "paragraph": {
        const text = sub(block.text);
        // A paragraph reduced to punctuation by absent tokens (e.g. "Details:") is noise.
        if (text && /[A-Za-z0-9]/.test(text)) kit.flow(ctx, text);
        break;
      }
      case "heading": {
        const text = sub(block.text);
        if (text) kit.heading(ctx, text);
        break;
      }
      case "bullets": {
        const items = (block.items || []).map(sub).filter((i) => i && /[A-Za-z0-9]/.test(i));
        if (items.length) kit.bullets(ctx, items);
        break;
      }
      case "note": {
        const text = sub(block.text);
        if (text) kit.flow(ctx, text, { size: kit.TYPE.small, color: kit.INK.muted });
        break;
      }
      case "salaryTable":
        salaryRows(ctx, input.salary || employee.salary, block.annual !== false);
        break;
      case "revisionTable":
        revisionRows(ctx, input.salary || employee.salary, input.previousSalary);
        break;
      case "settlementTable":
        settlementRows(ctx, input.settlement, input.salary || employee.salary);
        break;
      case "detailGrid": {
        const pairs = (block.pairs || [])
          .map(([l, v]) => [sub(l), sub(v)] as [string, string])
          .filter(([l]) => l);
        if (pairs.length) kit.detailGrid(ctx, pairs);
        break;
      }
      case "signature":
        kit.signature(ctx);
        break;
      case "acceptance":
        kit.acceptance(ctx);
        break;
      default:
        // Unknown block types are ignored rather than thrown on, so a template saved by a
        // newer build cannot make an older one fail to issue a letter at all.
        break;
    }
  }

  return kit.finalize(ctx, fileName, input.verification || null);
}
