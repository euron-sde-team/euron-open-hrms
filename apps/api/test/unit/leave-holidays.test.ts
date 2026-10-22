import { it, expect } from "vitest";
/**
 * Hermetic checks for the holiday calendar and leave-entitlement engine.
 * No database, no server: pure logic.
 */
import { generateHolidays, INDIAN_STATES, yearsWithVariableData } from "../../src/domain/holidays";
import { entitlements, LEAVE_CATALOGUE } from "../../src/domain/leave-policy";

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
const names = (hs: { name: string }[]) => hs.map((h) => h.name);

section("Holidays: national set");
const ka2026 = generateHolidays(2026, "KA");
check("returns a populated calendar", ka2026.holidays.length > 15, ka2026.holidays.length);
for (const n of ["Republic Day", "Independence Day", "Gandhi Jayanti"]) {
  check(`includes gazetted ${n}`, names(ka2026.holidays).includes(n));
}
check("dates are all in the requested year",
  ka2026.holidays.every((h) => h.date.startsWith("2026-")),
  ka2026.holidays.filter((h) => !h.date.startsWith("2026-")).map((h) => h.date));
check("sorted by date",
  ka2026.holidays.every((h, i, a) => i === 0 || a[i - 1].date <= h.date));
check("weekday computed", ka2026.holidays[0]?.weekday?.length > 0, ka2026.holidays[0]);

section("Holidays: state scoping");
check("Karnataka gets Kannada Rajyotsava", names(ka2026.holidays).includes("Kannada Rajyotsava"));
const mh2026 = generateHolidays(2026, "MH");
check("Maharashtra does NOT get Kannada Rajyotsava", !names(mh2026.holidays).includes("Kannada Rajyotsava"));
check("Maharashtra gets Maharashtra Day", names(mh2026.holidays).includes("Maharashtra Day"));
check("Maharashtra gets Ganesh Chaturthi", names(mh2026.holidays).includes("Ganesh Chaturthi"));
const wb2026 = generateHolidays(2026, "WB");
check("West Bengal does NOT get Ganesh Chaturthi (not in its state list)",
  !names(wb2026.holidays).includes("Ganesh Chaturthi"));
check("West Bengal gets Pohela Boishakh", names(wb2026.holidays).includes("Pohela Boishakh (Bengali New Year)"));
const kl2026 = generateHolidays(2026, "KL");
check("Kerala gets Kerala Piravi", names(kl2026.holidays).includes("Kerala Piravi"));
check("Kerala does NOT get Haryana Day", !names(kl2026.holidays).includes("Haryana Day"));

section("Holidays: no state = national only");
const national = generateHolidays(2026, null);
check("national set excludes state-only days",
  !names(national.holidays).includes("Kannada Rajyotsava") &&
  !names(national.holidays).includes("Maharashtra Day"),
  names(national.holidays).filter((n) => /Rajyotsava|Maharashtra Day/.test(n)));
check("national set still has Republic Day", names(national.holidays).includes("Republic Day"));

section("Holidays: honesty about lunar festivals");
check("2026 has festival dates", ka2026.hasVariableData);
check("2026 marks Diwali as variable",
  ka2026.holidays.filter((h) => /Deepavali/.test(h.name)).every((h) => h.variable),
  ka2026.holidays.filter((h) => /Deepavali/.test(h.name)));
const far = generateHolidays(2031, "KA");
check("a year with no festival data still returns fixed holidays", far.holidays.length > 5, far.holidays.length);
check("...and reports it has no festival data", far.hasVariableData === false);
check("...and names what is missing rather than inventing dates",
  far.missingVariable.length > 5 && far.missingVariable.some((m) => /Deepavali|Holi/.test(m)),
  far.missingVariable.slice(0, 5));
check("...and invents no Diwali", !names(far.holidays).some((n) => /Deepavali|Diwali/.test(n)),
  names(far.holidays).filter((n) => /Deepavali|Diwali/.test(n)));

section("Holidays: options");
const noRestricted = generateHolidays(2026, "KA", { includeRestricted: false });
check("restricted holidays can be excluded",
  noRestricted.holidays.every((h) => h.type !== "RESTRICTED"),
  noRestricted.holidays.filter((h) => h.type === "RESTRICTED").map((h) => h.name));
check("excluding restricted yields fewer days", noRestricted.holidays.length < ka2026.holidays.length);
check("no duplicate date+name pairs", (() => {
  const keys = ka2026.holidays.map((h) => `${h.date}|${h.name}`);
  return new Set(keys).size === keys.length;
})());
check("state list is complete-ish", INDIAN_STATES.length >= 30, INDIAN_STATES.length);
check("years with data reported", yearsWithVariableData().includes(2026), yearsWithVariableData());

section("Leave: permanent employee, full year");
const perm = entitlements({ employmentType: "PERMANENT", gender: "Female", joiningDate: "2020-01-01", year: 2026 });
const get = (list: typeof perm, key: string) => list.find((e) => e.key === key)!;
check("earned leave is the full 15", get(perm, "EARNED").days === 15, get(perm, "EARNED"));
check("casual leave is the full 12", get(perm, "CASUAL").days === 12);
check("earned leave carries forward and is encashable",
  get(perm, "EARNED").carryForwardCap === 30 && get(perm, "EARNED").encashable);
check("maternity available to a female employee",
  get(perm, "MATERNITY").eligible && get(perm, "MATERNITY").days === 182, get(perm, "MATERNITY"));
check("paternity NOT offered to a female employee", !get(perm, "PATERNITY").eligible);
check("LOP always available", get(perm, "LOP").eligible);

section("Leave: mid-year joiner is pro-rated");
const midYear = entitlements({ employmentType: "PERMANENT", joiningDate: "2026-07-01", year: 2026 });
check("earned leave halved for a July joiner", get(midYear, "EARNED").days === 7, get(midYear, "EARNED"));
check("...with the reason stated", /pro-rated/i.test(get(midYear, "EARNED").reason), get(midYear, "EARNED").reason);
const decJoiner = entitlements({ employmentType: "PERMANENT", joiningDate: "2026-12-20", year: 2026 });
check("a 20-Dec joiner accrues nothing this year", get(decJoiner, "EARNED").days === 0, get(decJoiner, "EARNED"));

section("Leave: engagement type drives eligibility");
const intern = entitlements({ employmentType: "INTERN", joiningDate: "2020-01-01", year: 2026 });
check("intern accrues leave at half rate", get(intern, "EARNED").days === 8, get(intern, "EARNED"));
const freelancer = entitlements({ employmentType: "FREELANCER", joiningDate: "2020-01-01", year: 2026 });
check("freelancer accrues NO paid leave",
  !get(freelancer, "EARNED").eligible && get(freelancer, "EARNED").days === 0, get(freelancer, "EARNED"));
check("...with an explanatory reason", /do not accrue/i.test(get(freelancer, "EARNED").reason), get(freelancer, "EARNED").reason);
check("freelancer still has LOP", get(freelancer, "LOP").eligible);
const vendor = entitlements({ employmentType: "VENDOR", joiningDate: "2020-01-01", year: 2026 });
check("vendor accrues no paid leave", !get(vendor, "EARNED").eligible);
const temp = entitlements({ employmentType: "TEMPORARY", joiningDate: "2020-01-01", year: 2026 });
check("temporary staff DO accrue leave", get(temp, "EARNED").eligible && get(temp, "EARNED").days === 15);

section("Leave: catalogue integrity");
check("every type has a unique key",
  new Set(LEAVE_CATALOGUE.map((t) => t.key)).size === LEAVE_CATALOGUE.length);
check("statutory maternity is 26 weeks (182 days)",
  LEAVE_CATALOGUE.find((t) => t.key === "MATERNITY")!.maxPerYear === 182);
check("LOP is unpaid", LEAVE_CATALOGUE.find((t) => t.key === "LOP")!.paid === false);
check("every entitlement row carries a reason", perm.every((e) => e.reason.length > 0));
