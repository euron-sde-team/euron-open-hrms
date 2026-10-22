/**
 * Monthly payslip (PDF), built on the shared document kit.
 *
 * The payslip is the one document every employee reads every month, so it moved onto the
 * kit alongside the letters. Three things changed materially:
 *
 *  - Amounts now use the same `money()` formatter as the rest of the product. The old
 *    private CURRENCY_SYMBOL map existed only because Helvetica has no rupee glyph, so
 *    every payslip said "Rs. 60,000.00" while the web UI said "₹60,000.00" for the same
 *    figure. With Inter embedded (see ./pdf/fonts) the real symbol renders, and one
 *    formatter means the PDF and the screen can no longer disagree.
 *  - Earnings, deductions and employer contributions are three stacked `amountTable`s
 *    rather than one hand-drawn four-column grid. The grid truncated long component
 *    labels (every label was `lineBreak: false` inside a half-width cell) and could not
 *    break across a page, so a payslip with many components simply lost rows.
 *  - The verification block rides in the last page footer via `finalize`, instead of a
 *    tall card that pushed a one-page payslip onto a second, near-empty page.
 */
import { round2, money, MONTHS } from "../core/util";
import { brandForAsync } from "../domain/brand";
import * as kit from "./kit";

const TYPE_LABELS = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  INTERN: "Intern",
  CONTRACT: "Contract",
  OUTSOURCED: "Outsourced",
};

// ---------------------------------------------------------------------------
// Amount in words (Indian numbering: crore / lakh / thousand)
// ---------------------------------------------------------------------------
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")).trim();
}
function threeDigits(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return ((h ? ONES[h] + " Hundred" : "") + (rest ? (h ? " " : "") + twoDigits(rest) : "")).trim();
}
/**
 * INR only, and named so.
 *
 * Both halves of this are India-specific: the unit names (Rupees, Paise) and the grouping
 * (crore / lakh, not million / billion). Generalising it properly means a per-currency
 * table of major and minor unit names AND a second grouping scheme, which is a payroll
 * feature rather than a formatting one. Until someone asks for it, the caller prints this
 * line for INR payslips and omits it elsewhere: a wrong amount in words on a document
 * banks accept as proof of income is worse than no amount in words.
 */
function amountInWordsINR(amount) {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(twoDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (rest) parts.push(threeDigits(rest));
  let words = "Rupees " + (parts.length ? parts.join(" ") : "Zero");
  if (paise) words += " and " + twoDigits(paise) + " Paise";
  return words + " Only";
}

/**
 * The name a payslip PDF is stored and downloaded under:
 * `payslip_<org>_<employee code>_<YYYY-MM>.pdf`.
 *
 * Exported because the download route needs the SAME name: a payslip that
 * arrives in someone's Downloads folder as a bare id is unusable once there are
 * twelve of them, and the meaningful name only reaches the browser if the
 * response says so.
 */
function payslipFileName(org: any, employee: any, month: number, year: number): string {
  const safe = (v: unknown, fallback: string) => {
    const s = String(v ?? "").trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
    return s || fallback;
  };
  const orgPart = safe(org?.slug, "org");
  const empPart = safe(employee?.code || employee?.id, "employee");
  return `payslip_${orgPart}_${empPart}_${year}-${String(Number(month) + 1).padStart(2, "0")}.pdf`;
}

/**
 * A titled money table that will not be separated from its own heading.
 *
 * `kit.heading` and `kit.amountTable` each fit-check only themselves, so a section starting
 * near the foot of a page put its heading (and, for employer contributions, the caveat that
 * makes the figures mean anything) on one page and the figures on the next. Reserving the
 * whole block up front moves the break to before the heading, where it belongs.
 */
function section(ctx: kit.DocContext, title: string, rows: kit.AmountRow[], note?: string) {
  const headingH = 34;
  const noteH = note ? 26 : 0;
  const tableH = 20 + (rows.length + 1) * 20; // column head + rows + trailing gap
  kit.ensureSpace(ctx, headingH + noteH + tableH);
  kit.heading(ctx, title);
  if (note) kit.flow(ctx, note, { size: kit.TYPE.small, color: kit.INK.muted });
  kit.amountTable(ctx, rows, { head: ["Component", "Amount"] });
}

/**
 * @param {object} p
 * @param {object} p.org        organization row
 * @param {object} p.employee   employee row
 * @param {object} p.slip       {
 *   month(0-11), year,
 *   earnings:[{label,amount}], deductions:[{label,amount}],
 *   employerContributions?:[{label,amount}],   // cost to company, not in net
 *   daysPaid?: number,                         // printed only when the run supplies it
 *   currency?: "INR"|"USD"|..., locale?: "en-IN"|...
 * }
 * @returns {Promise<{buffer,fileName,gross,totalDed,net}>}
 */
async function generatePayslipPdf({ org, employee, slip, verification = null }: any) {
  const fileName = payslipFileName(org, employee, slip.month, slip.year);

  const currency = slip.currency || "INR";
  const locale = slip.locale || "en-IN";
  const fmt = (n) => money(n, currency, locale);

  const earnings = slip.earnings || [];
  const deductions = slip.deductions || [];
  const employerContributions = slip.employerContributions || [];
  const gross = round2(earnings.reduce((s, e) => s + Number(e.amount || 0), 0));
  const totalDed = round2(deductions.reduce((s, e) => s + Number(e.amount || 0), 0));
  const net = round2(gross - totalDed);

  const period = `${MONTHS[slip.month]} ${slip.year}`;
  const name = `${employee.firstName} ${employee.lastName || ""}`.trim();
  const brand = await brandForAsync(org);
  const ctx = kit.createDocument(brand, `Payslip ${period} - ${name}`, `Payslip for ${period}`);

  const fmtDate = (d) => {
    if (!d) return "-";
    const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
    return Number.isNaN(dt.getTime())
      ? "-"
      : dt.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  };
  const bank = employee.bank || {};
  const kyc = employee.kyc || {};
  // The account number is masked to the last four: a payslip is routinely forwarded to
  // landlords and banks, and the full number is not theirs to have.
  const bankValue = bank.account
    ? `${bank.bankName ? bank.bankName + " " : ""}${String(bank.account).replace(/.(?=.{4})/g, "X")}`
    : bank.paypal
      ? `PayPal: ${bank.paypal}`
      : "-";

  kit.letterhead(ctx);
  kit.refLine(ctx, employee.code || null, period);
  kit.title(ctx, `Payslip for ${period}`);

  // Three columns, not two: the particulars are short and the extra rows a two-column grid
  // costs push the employer-contributions section onto a second page on an ordinary slip.
  // Grid values do not wrap, so the two long ones (bank account, office) are placed in the
  // last column, where any overflow runs into the right margin rather than into a neighbour.
  const details: [string, string][] = [
    ["Employee name", name || "-"],
    ["Employee code", employee.code || String(employee.id || "").slice(0, 8)],
    ["Designation", employee.designation || "-"],
    ["Department", employee._departmentName || "-"],
    ["Employment type", TYPE_LABELS[employee.employmentType] || String(employee.employmentType || "-").replace(/_/g, " ")],
    ["Date of joining", fmtDate(employee.joiningDate)],
    ["PAN", kyc.pan || employee.pan || "-"],
    ["UAN", kyc.uan || employee.uan || "-"],
    ["Bank account", bankValue],
    ["Payment mode", bank.account ? "Bank Transfer" : "-"],
    ["Reports to", employee._managerName || "-"],
    ["Location", employee._officeName || employee.location || "-"],
  ];
  // Only printed when the run states it. Defaulting to the length of the month would be a
  // claim about attendance the payslip has no basis for, on a document used as evidence.
  if (Number.isFinite(Number(slip.daysPaid))) {
    details.push(["Days paid", String(slip.daysPaid)]);
  }
  kit.detailGrid(ctx, details, 3);

  section(ctx, "Earnings", [
    ...earnings.map((e) => ({ label: e.label, amount: fmt(e.amount) })),
    { label: "Gross earnings", amount: fmt(gross), strong: true },
  ]);

  section(ctx, "Deductions", deductions.length
    ? [
        ...deductions.map((d) => ({ label: d.label, amount: fmt(d.amount), muted: true })),
        { label: "Total deductions", amount: fmt(totalDed), strong: true },
      ]
    : [{ label: "No deductions this month", amount: fmt(0), muted: true }]);

  // Net pay is the number the employee opened the document for, so it gets the one
  // emphasised row on the page rather than competing with the section subtotals.
  kit.amountTable(ctx, [{ label: "Net pay", amount: fmt(net), total: true }]);
  if (currency === "INR") {
    kit.flow(ctx, `Net pay in words: ${amountInWordsINR(net)}`, { size: kit.TYPE.small, color: kit.INK.muted });
  }

  if (employerContributions.length) {
    const ctcTotal = round2(employerContributions.reduce((s, c) => s + Number(c.amount || 0), 0));
    // Kept in its own section, below net pay, precisely so it cannot be read as money taken
    // out of the salary: these are amounts the company pays on top of it.
    section(ctx, "Employer contributions", [
      ...employerContributions.map((c) => ({ label: c.label, amount: fmt(c.amount) })),
      { label: "Total employer contributions", amount: fmt(ctcTotal), strong: true },
    ], "Cost to company. These amounts are paid by the employer and are NOT deducted from your net pay.");
  }

  kit.flow(ctx, "This is a system-generated payslip and does not require a signature.", {
    size: kit.TYPE.small, color: kit.INK.faint,
  });

  const { buffer } = await kit.finalize(ctx, fileName, verification);
  return { buffer, fileName, gross, totalDed, net };
}

export { generatePayslipPdf, payslipFileName };
