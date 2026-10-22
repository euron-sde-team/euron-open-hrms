import { it, expect } from "vitest";
/**
 * Round-trip check for the bulk-onboarding pipeline:
 * template -> parse -> validate, plus the messy cases a real sheet contains.
 */
import * as XLSX from "xlsx";
import {
  buildTemplate,
  parseWorkbook,
  validateRows,
  toIsoDate,
  toNumber,
} from "../../src/domain/onboarding-import";
import { normalizeEmploymentType, defaultSalaryBreakdown } from "../../src/domain/employment";

/** Legacy section headers become a prefix on the test names that follow them. */
let current = "";
const section = (title: string) => {
  current = title;
};
const named = (name: string) => (current ? `${current} > ${name}` : name);

/** One test case per legacy check, so each assertion reports on its own. */
function check(name: string, cond: boolean, detail?: unknown) {
  it(named(name), () => {
    expect(cond, detail === undefined ? name : `${name} -> ${JSON.stringify(detail)?.slice(0, 400)}`).toBe(true);
  });
}

const ctx = {
  departments: [{ id: "d1", name: "Engineering" }, { id: "d2", name: "People" }],
  offices: [{ id: "o1", name: "Bengaluru HQ" }],
  employees: [{ id: "m1", email: "manager@acme.com", code: "ACM-1000" }],
  takenEmails: new Set(["taken@acme.com", "manager@acme.com"]),
};

section("1. Template generates and round-trips");
const tpl = buildTemplate({
  orgName: "Acme Technologies",
  departments: ["Engineering", "People"],
  offices: ["Bengaluru HQ"],
  designations: ["Product Designer"],
});
check("template is a non-trivial xlsx", tpl.length > 5000, tpl.length);

const wb = XLSX.read(tpl, { type: "buffer" });
check("has Employees/Instructions/Reference sheets",
  ["Employees", "Instructions", "Reference"].every((s) => wb.SheetNames.includes(s)),
  wb.SheetNames);

const parsedTpl = parseWorkbook(tpl);
check("parses its own two sample rows", parsedTpl.rows.length === 2, parsedTpl.rows.length);
check("no unknown headers in own template", parsedTpl.unknownHeaders.length === 0, parsedTpl.unknownHeaders);
check("no missing required columns", parsedTpl.missingRequired.length === 0, parsedTpl.missingRequired);

const tplResults = validateRows(parsedTpl.rows, ctx);
check("sample rows validate clean", tplResults.every((r) => r.errors.length === 0),
  tplResults.flatMap((r) => r.errors));

section("2. Date coercion");
check("ISO passes through", toIsoDate("2026-09-01") === "2026-09-01", toIsoDate("2026-09-01"));
check("dd/mm/yyyy is day-first", toIsoDate("01/09/2026") === "2026-09-01", toIsoDate("01/09/2026"));
check("dd-mm-yyyy is day-first", toIsoDate("15-03-1994") === "1994-03-15", toIsoDate("15-03-1994"));
// 45877 is 20308 days past the 1970 epoch, i.e. 2025-08-08.
check("Excel serial 45877 -> 2025-08-08", toIsoDate(45877) === "2025-08-08", toIsoDate(45877));
check("Date object works", toIsoDate(new Date("2026-01-31T00:00:00Z")) === "2026-01-31", toIsoDate(new Date("2026-01-31T00:00:00Z")));
check("garbage rejected", toIsoDate("not a date") === null, toIsoDate("not a date"));
check("empty -> null", toIsoDate("") === null);

section("3. Number coercion");
check("plain number", toNumber(85000) === 85000);
check("rupee + commas", toNumber("₹1,25,000") === 125000, toNumber("₹1,25,000"));
check("spaces", toNumber(" 45000 ") === 45000);
check("garbage -> null", toNumber("abc") === null);

section("4. Employment type normalisation");
for (const [input, expect] of [
  ["Permanent", "PERMANENT"],
  ["full time", "FULL_TIME"],
  ["Full-Time", "FULL_TIME"],
  ["FREELANCER", "FREELANCER"],
  ["consultant", "FREELANCER"],
  ["Intern", "INTERN"],
  ["trainee", "INTERN"],
  ["temp", "TEMPORARY"],
  ["Vendor / contractor", "VENDOR"],
  ["part time", "PART_TIME"],
  ["nonsense", null],
] as [string, string | null][]) {
  check(`"${input}" -> ${expect}`, normalizeEmploymentType(input) === expect, normalizeEmploymentType(input));
}

section("5. Salary derivation");
const perm = defaultSalaryBreakdown("PERMANENT", 100000);
check("permanent basic is 50% of gross", perm.basic === 50000, perm);
check("permanent HRA is 40% of basic", perm.hra === 20000, perm);
check("permanent components sum to gross", perm.basic + perm.hra + perm.allowances === 100000, perm);
check("PF capped at the 15000 ceiling (1800)", perm.deductions === 1800, perm);
const free = defaultSalaryBreakdown("FREELANCER", 100000);
check("freelancer is a single fee line", free.basic === 100000 && free.hra === 0 && free.deductions === 0, free);
const intern = defaultSalaryBreakdown("INTERN", 25000);
check("intern stipend has no PF", intern.deductions === 0 && intern.basic === 25000, intern);

section("6. Validation of a messy sheet");
const messy = [
  ["First name", "Last name", "Personal email", "Employment type", "Joining date", "Department", "Monthly gross", "PAN", "IFSC", "Aadhaar", "Reporting manager email", "Work location"],
  // 0: clean
  ["Asha", "Rao", "asha@acme.com", "Permanent", "2026-04-01", "Engineering", 90000, "ABCDE1234F", "HDFC0001234", "123456789012", "manager@acme.com", "Bengaluru HQ"],
  // 1: email already taken
  ["Dup", "User", "taken@acme.com", "Permanent", "2026-04-01", "Engineering", 50000, "", "", "", "", ""],
  // 2: duplicate within the file
  ["Asha", "Twin", "asha@acme.com", "Permanent", "2026-04-01", "Engineering", 50000, "", "", "", "", ""],
  // 3: bad type, bad PAN, bad IFSC, short Aadhaar
  ["Bad", "Values", "bad@acme.com", "Astronaut", "2026-04-01", "Engineering", 50000, "XX123", "BADIFSC", "12345", "", ""],
  // 4: unknown department + unknown manager + unknown office (warnings only)
  ["Warn", "Only", "warn@acme.com", "Intern", "2026-04-01", "Marketing", 25000, "", "", "", "ghost@acme.com", "Mars Office"],
  // 5: missing required fields
  ["", "", "", "", "", "", "", "", "", "", "", ""],
  // 6: joining date before DOB is caught only when DOB present; here bad date format
  ["Bad", "Date", "baddate@acme.com", "Permanent", "31/31/2026", "Engineering", 50000, "", "", "", "", ""],
];
const messyWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(messyWb, XLSX.utils.aoa_to_sheet(messy), "Employees");
const messyBuf = XLSX.write(messyWb, { type: "buffer", bookType: "xlsx" }) as Buffer;

const parsedMessy = parseWorkbook(messyBuf);
// The all-blank row is dropped at parse time, so 6 data rows survive.
check("blank row dropped at parse", parsedMessy.rows.length === 6, parsedMessy.rows.length);

const res = validateRows(parsedMessy.rows, ctx);
const byEmail = (e: string) => res.find((r) => String((parsedMessy.rows.find((x) => x.__row === r.row) as any)?.email ?? "").toLowerCase() === e);

const clean = byEmail("asha@acme.com");
check("clean row has no errors", clean?.errors.length === 0, clean?.errors);
check("clean row resolved department", clean?.value?.departmentId === "d1", clean?.value?.departmentId);
check("clean row resolved manager", clean?.value?.managerId === "m1", clean?.value?.managerId);
check("clean row resolved office", clean?.value?.officeId === "o1", clean?.value?.officeId);
check("clean row derived salary from gross", clean?.value?.salary.basic === 45000, clean?.value?.salary);

check("taken email rejected", (byEmail("taken@acme.com")?.errors ?? []).some((e) => /already used/i.test(e.message)),
  byEmail("taken@acme.com")?.errors);

const dupes = res.filter((r) => r.errors.some((e) => /more than once/i.test(e.message)));
check("in-file duplicate rejected exactly once", dupes.length === 1, dupes.length);

const bad = byEmail("bad@acme.com");
check("unknown employment type rejected", (bad?.errors ?? []).some((e) => e.field === "Employment type"), bad?.errors);
check("bad PAN rejected", (bad?.errors ?? []).some((e) => e.field === "PAN"), bad?.errors);
check("bad IFSC rejected", (bad?.errors ?? []).some((e) => e.field === "IFSC"), bad?.errors);
check("short Aadhaar rejected", (bad?.errors ?? []).some((e) => e.field === "Aadhaar"), bad?.errors);
check("bad row yields no value", bad?.value === null);

const warn = byEmail("warn@acme.com");
check("unknown dept/manager/office are warnings, not errors", warn?.errors.length === 0, warn?.errors);
check("warnings recorded for all three", (warn?.warnings ?? []).length >= 3, warn?.warnings);
check("warning row still produces a value", warn?.value !== null);

const badDate = byEmail("baddate@acme.com");
check("impossible date rejected", (badDate?.errors ?? []).some((e) => e.field === "Joining date"), badDate?.errors);

section("7. Header aliasing");
const aliased = [
  ["first name", "EMAIL", "Type", "DOJ", "Gross Salary", "Mobile", "  Designation  "],
  ["Neha", "neha@acme.com", "full time", "2026-05-01", "₹75,000", "+91 90000 00000", "Analyst"],
];
const aliasWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(aliasWb, XLSX.utils.aoa_to_sheet(aliased), "Sheet1");
const aliasParsed = parseWorkbook(XLSX.write(aliasWb, { type: "buffer", bookType: "xlsx" }) as Buffer);
check("aliases matched, nothing unknown", aliasParsed.unknownHeaders.length === 0, aliasParsed.unknownHeaders);
const aliasRes = validateRows(aliasParsed.rows, ctx);
check("aliased row validates", aliasRes[0]?.errors.length === 0, aliasRes[0]?.errors);
check("currency gross parsed", aliasRes[0]?.value?.monthlyGross === 75000, aliasRes[0]?.value?.monthlyGross);

section("8. Missing required column is reported");
const noEmail = [["First name", "Employment type", "Joining date"], ["X", "Permanent", "2026-01-01"]];
const neWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(neWb, XLSX.utils.aoa_to_sheet(noEmail), "Employees");
const neParsed = parseWorkbook(XLSX.write(neWb, { type: "buffer", bookType: "xlsx" }) as Buffer);
check("missingRequired names the column", neParsed.missingRequired.includes("Personal email"), neParsed.missingRequired);
