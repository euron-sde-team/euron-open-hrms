import { it, expect } from "vitest";
/**
 * Hermetic checks for per-state professional tax and statutory gratuity.
 */
import { professionalTaxFor, PT_SCHEDULES, ptComponentFor } from "../../src/domain/payroll/professional-tax";
import { computeGratuity, GRATUITY_CEILING } from "../../src/domain/payroll/gratuity";

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

section("Professional tax: states that levy NONE");
// This is the correctness fix that matters most: the old single slab charged
// PT to employees in states that do not levy it.
for (const s of ["DL", "HR", "UP", "RJ", "UK", "HP"]) {
  const r = professionalTaxFor(100000, s);
  check(`${s} deducts nothing even at 1,00,000 gross`, r.amount === 0, r);
  check(`${s} explains why`, /does not levy|development tax/i.test(r.reason), r.reason);
}

section("Professional tax: Karnataka");
check("below threshold -> 0", professionalTaxFor(24000, "KA").amount === 0);
check("at 25,000 -> 0 (boundary)", professionalTaxFor(24999, "KA").amount === 0);
check("above threshold -> 200", professionalTaxFor(30000, "KA").amount === 200, professionalTaxFor(30000, "KA"));
check("annual total respects the 2,500 cap", 200 * 12 <= 2500);

section("Professional tax: Maharashtra");
check("under 7,500 -> 0", professionalTaxFor(7000, "MH").amount === 0);
check("7,501-10,000 -> 175", professionalTaxFor(9000, "MH").amount === 175, professionalTaxFor(9000, "MH"));
check("above 10,000 -> 200", professionalTaxFor(50000, "MH", { gender: "Male" }).amount === 200);
check("February levies the extra 100 (=300)",
  professionalTaxFor(50000, "MH", { gender: "Male", month: 1 }).amount === 300,
  professionalTaxFor(50000, "MH", { gender: "Male", month: 1 }));
check("women under 25,000 are exempt",
  professionalTaxFor(20000, "MH", { gender: "Female" }).amount === 0,
  professionalTaxFor(20000, "MH", { gender: "Female" }));
check("women at/above 25,000 are NOT exempt",
  professionalTaxFor(30000, "MH", { gender: "Female" }).amount === 200);
check("annual Maharashtra total is exactly the 2,500 cap", 200 * 11 + 300 === 2500);

section("Professional tax: West Bengal bands");
for (const [gross, expect] of [[9000, 0], [12000, 110], [20000, 130], [30000, 150], [50000, 200]] as [number, number][]) {
  check(`WB ${gross} -> ${expect}`, professionalTaxFor(gross, "WB").amount === expect, professionalTaxFor(gross, "WB"));
}

section("Professional tax: schedule integrity");
check("no duplicate state codes",
  new Set(PT_SCHEDULES.map((s) => s.state)).size === PT_SCHEDULES.length);
check("every levying schedule has slabs",
  PT_SCHEDULES.filter((s) => !s.none).every((s) => (s.slabs?.length ?? 0) > 0));
check("every levying schedule's top band is unbounded",
  PT_SCHEDULES.filter((s) => !s.none).every((s) => s.slabs!.at(-1)!.upTo === null),
  PT_SCHEDULES.filter((s) => !s.none && s.slabs!.at(-1)!.upTo !== null).map((s) => s.state));
check("slabs ascend within each schedule",
  PT_SCHEDULES.filter((s) => !s.none).every((s) =>
    s.slabs!.every((b, i, a) => i === 0 || a[i - 1].upTo === null || b.upTo === null || a[i - 1].upTo! < b.upTo!)),
);
check("every schedule carries a verification note",
  PT_SCHEDULES.every((s) => s.verifyNote.length > 10));
check("monthly amounts never exceed the annual cap /12 for simple schedules",
  professionalTaxFor(999999, "KA").amount * 12 <= 2500);
check("unknown state returns 0 with a reason",
  professionalTaxFor(50000, "ZZ").amount === 0 && /No professional tax schedule/i.test(professionalTaxFor(50000, "ZZ").reason));
check("no state at all returns 0 with a reason",
  professionalTaxFor(50000, null).amount === 0 && /No state set/i.test(professionalTaxFor(50000, null).reason));

section("Professional tax: engine component");
const kaComp = ptComponentFor("KA");
check("KA component is enabled", kaComp.enabled === true);
check("KA component is a SLAB on GROSS", kaComp.calc === "SLAB" && kaComp.base === "GROSS");
const dlComp = ptComponentFor("DL");
check("Delhi component is DISABLED", dlComp.enabled === false, dlComp);
const noneComp = ptComponentFor(null);
check("no state -> disabled with a configure hint",
  noneComp.enabled === false && /Set the organisation's state/i.test(noneComp.note!), noneComp.note);

section("Gratuity: eligibility");
const short = computeGratuity({ basic: 50000, joiningDate: "2023-01-01", lastWorkingDay: "2026-01-01", employmentType: "PERMANENT" });
check("3 years -> not eligible", !short.eligible && short.amount === 0, short);
check("...with a stated reason", /five years/i.test(short.reason), short.reason);

const sixYears = computeGratuity({ basic: 50000, joiningDate: "2020-01-01", lastWorkingDay: "2026-01-01", employmentType: "PERMANENT" });
check("6 years -> eligible", sixYears.eligible, sixYears);
// (15 * 50000 * 6) / 26 = 173,076.92 -> 173,077
check("amount matches the statutory formula", sixYears.amount === 173077, sixYears);
check("formula is shown", /15 x/.test(sixYears.formula), sixYears.formula);

section("Gratuity: the 4y240d rule and 6-month rounding");
const fourPlus = computeGratuity({ basic: 30000, joiningDate: "2021-01-01", lastWorkingDay: "2025-09-30", employmentType: "PERMANENT" });
check("4 years + 240+ days qualifies", fourPlus.eligible, fourPlus);
const roundUp = computeGratuity({ basic: 26000, joiningDate: "2019-01-01", lastWorkingDay: "2026-08-01", employmentType: "PERMANENT" });
check("7y7m counts as 8 years", roundUp.yearsCounted === 8, roundUp);
const roundDown = computeGratuity({ basic: 26000, joiningDate: "2019-01-01", lastWorkingDay: "2026-03-01", employmentType: "PERMANENT" });
check("7y2m counts as 7 years", roundDown.yearsCounted === 7, roundDown);

section("Gratuity: engagement type");
for (const t of ["FREELANCER", "INTERN", "TEMPORARY", "VENDOR"]) {
  const r = computeGratuity({ basic: 50000, joiningDate: "2015-01-01", lastWorkingDay: "2026-01-01", employmentType: t });
  check(`${t} never accrues gratuity`, !r.eligible && r.amount === 0, r.reason);
}
const perm = computeGratuity({ basic: 50000, joiningDate: "2015-01-01", lastWorkingDay: "2026-01-01", employmentType: "PERMANENT" });
check("PERMANENT does accrue", perm.eligible);

section("Gratuity: statutory ceiling and edge cases");
const huge = computeGratuity({ basic: 900000, joiningDate: "1995-01-01", lastWorkingDay: "2026-01-01", employmentType: "PERMANENT" });
check("capped at the 20 lakh ceiling", huge.amount === GRATUITY_CEILING, huge.amount);
check("...and says it was capped", huge.cappedByCeiling && /ceiling/i.test(huge.reason));

const death = computeGratuity({ basic: 40000, joiningDate: "2024-01-01", lastWorkingDay: "2026-01-01", employmentType: "PERMANENT", reason: "DEATH" });
check("death waives the five-year qualifying period", death.eligible && death.amount > 0, death);
check("...and says so", /waived/i.test(death.reason), death.reason);

const withDa = computeGratuity({ basic: 40000, da: 10000, joiningDate: "2018-01-01", lastWorkingDay: "2026-01-01", employmentType: "PERMANENT" });
check("DA is included in wages", withDa.wages === 50000, withDa.wages);

const bad = computeGratuity({ basic: 40000, joiningDate: "", lastWorkingDay: "2026-01-01", employmentType: "PERMANENT" });
check("missing joining date is handled, not thrown", !bad.eligible && /missing or invalid/i.test(bad.reason), bad.reason);

const uncovered = computeGratuity({ basic: 26000, joiningDate: "2016-01-01", lastWorkingDay: "2026-01-01", employmentType: "PERMANENT", covered: false });
const covered = computeGratuity({ basic: 26000, joiningDate: "2016-01-01", lastWorkingDay: "2026-01-01", employmentType: "PERMANENT" });
check("uncovered establishments divide by 30, not 26", uncovered.amount < covered.amount, { uncovered: uncovered.amount, covered: covered.amount });
