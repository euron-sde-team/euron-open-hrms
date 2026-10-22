/**
 * Indian holiday calendar, national, state and restricted holidays.
 *
 * Replaces a single hardcoded Karnataka-2026 array with something a tenant in
 * any state can actually use.
 *
 * An important honesty constraint shapes the design: most Indian festivals
 * follow lunar calendars, so Diwali, Holi, Eid, Ganesh Chaturthi and the rest
 * move every year and cannot be computed from a rule. Only some holidays have
 * fixed Gregorian dates.
 *
 * So the calendar is split:
 *
 *   FIXED, same date every year (Republic Day, Independence Day, state
 *               formation days). Generated for any year on demand.
 *   VARIABLE, lunar/observational. Shipped only for years we hold real
 *               dates for. For any other year the generator returns the fixed
 *               set and tells the caller which festivals still need dates,
 *               rather than inventing them.
 *
 * That last point matters: a payroll and leave system that silently invents a
 * Diwali date is worse than one that admits it doesn't know.
 */

export type HolidayType = "PUBLIC" | "RESTRICTED" | "COMPANY";

export interface HolidayDef {
  /** MM-DD for fixed holidays. */
  monthDay?: string;
  name: string;
  type: HolidayType;
  /** Null/absent = observed nationwide. Otherwise the state codes that observe it. */
  states?: string[];
  note?: string;
}

/* ── States ─────────────────────────────────────────────────────────────── */

export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: "AN", name: "Andaman & Nicobar Islands" },
  { code: "AP", name: "Andhra Pradesh" },
  { code: "AR", name: "Arunachal Pradesh" },
  { code: "AS", name: "Assam" },
  { code: "BR", name: "Bihar" },
  { code: "CH", name: "Chandigarh" },
  { code: "CT", name: "Chhattisgarh" },
  { code: "DL", name: "Delhi" },
  { code: "GA", name: "Goa" },
  { code: "GJ", name: "Gujarat" },
  { code: "HR", name: "Haryana" },
  { code: "HP", name: "Himachal Pradesh" },
  { code: "JK", name: "Jammu & Kashmir" },
  { code: "JH", name: "Jharkhand" },
  { code: "KA", name: "Karnataka" },
  { code: "KL", name: "Kerala" },
  { code: "LA", name: "Ladakh" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "MH", name: "Maharashtra" },
  { code: "MN", name: "Manipur" },
  { code: "ML", name: "Meghalaya" },
  { code: "MZ", name: "Mizoram" },
  { code: "NL", name: "Nagaland" },
  { code: "OR", name: "Odisha" },
  { code: "PY", name: "Puducherry" },
  { code: "PB", name: "Punjab" },
  { code: "RJ", name: "Rajasthan" },
  { code: "SK", name: "Sikkim" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "TG", name: "Telangana" },
  { code: "TR", name: "Tripura" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "UK", name: "Uttarakhand" },
  { code: "WB", name: "West Bengal" },
];

const STATE_NAMES = new Map(INDIAN_STATES.map((s) => [s.code, s.name]));
export const stateName = (code?: string | null) => (code ? STATE_NAMES.get(code) ?? code : "");

/* ── Fixed-date holidays ────────────────────────────────────────────────── */

/**
 * Holidays that fall on the same Gregorian date every year.
 * The three gazetted national holidays (Republic Day, Independence Day,
 * Gandhi Jayanti) are observed everywhere; the rest are state-declared, so
 * they carry an explicit state list.
 */
/**
 * Formation/statehood days are fixed dates, but not every state gazettes its own
 * as a closed holiday, and some observe it only for government offices. Say so
 * rather than let HR assume the list is authoritative.
 */
const STATE_DAY_NOTE = "State formation day, confirm against your state's gazette before publishing.";

export const FIXED_HOLIDAYS: HolidayDef[] = [
  { monthDay: "01-01", name: "New Year's Day", type: "PUBLIC" },
  {
    monthDay: "01-14",
    name: "Makar Sankranti / Pongal",
    type: "PUBLIC",
    states: ["AP", "TG", "KA", "TN", "GJ", "MH", "OR", "BR", "JH", "WB", "PY"],
    note: "Observed on 14 or 15 January depending on the year and state, confirm locally.",
  },
  // Statehood / formation days. All are fixed calendar dates, so they resolve for
  // any year, unlike the lunar festivals below. Whether a given state gazettes
  // its formation day as a closed holiday varies, hence the confirm note.
  { monthDay: "01-21", name: "Meghalaya Statehood Day", type: "PUBLIC", states: ["ML"], note: STATE_DAY_NOTE },
  { monthDay: "01-24", name: "Uttar Pradesh Diwas", type: "RESTRICTED", states: ["UP"], note: STATE_DAY_NOTE },
  { monthDay: "01-25", name: "Himachal Pradesh Statehood Day", type: "PUBLIC", states: ["HP"], note: STATE_DAY_NOTE },
  { monthDay: "01-26", name: "Republic Day", type: "PUBLIC", note: "Gazetted national holiday." },
  { monthDay: "02-19", name: "Chhatrapati Shivaji Maharaj Jayanti", type: "PUBLIC", states: ["MH"] },
  { monthDay: "02-20", name: "Arunachal Pradesh Statehood Day", type: "PUBLIC", states: ["AR"], note: STATE_DAY_NOTE },
  { monthDay: "02-20", name: "Mizoram Statehood Day", type: "PUBLIC", states: ["MZ"], note: STATE_DAY_NOTE },
  { monthDay: "03-22", name: "Bihar Diwas", type: "PUBLIC", states: ["BR"] },
  { monthDay: "03-30", name: "Rajasthan Diwas", type: "PUBLIC", states: ["RJ"] },
  { monthDay: "04-01", name: "Odisha Day (Utkala Dibasa)", type: "PUBLIC", states: ["OR"] },
  { monthDay: "04-13", name: "Baisakhi", type: "PUBLIC", states: ["PB", "HR", "CH", "HP", "DL"] },
  { monthDay: "04-14", name: "Dr. B. R. Ambedkar Jayanti", type: "PUBLIC" },
  { monthDay: "04-14", name: "Tamil New Year (Puthandu)", type: "PUBLIC", states: ["TN", "PY"] },
  { monthDay: "04-14", name: "Vishu", type: "PUBLIC", states: ["KL"] },
  { monthDay: "04-14", name: "Bohag Bihu", type: "PUBLIC", states: ["AS"] },
  { monthDay: "04-15", name: "Pohela Boishakh (Bengali New Year)", type: "PUBLIC", states: ["WB", "TR"] },
  {
    monthDay: "05-01",
    name: "May Day (Labour Day)",
    type: "PUBLIC",
    states: ["KA", "TN", "KL", "AP", "TG", "WB", "MH", "GA", "BR", "MN", "TR", "PY"],
  },
  { monthDay: "05-01", name: "Maharashtra Day", type: "PUBLIC", states: ["MH"] },
  { monthDay: "05-01", name: "Gujarat Day", type: "PUBLIC", states: ["GJ"] },
  { monthDay: "05-16", name: "Sikkim Statehood Day", type: "PUBLIC", states: ["SK"], note: STATE_DAY_NOTE },
  { monthDay: "06-02", name: "Telangana Formation Day", type: "PUBLIC", states: ["TG"], note: STATE_DAY_NOTE },
  { monthDay: "06-15", name: "Raja Sankranti", type: "RESTRICTED", states: ["OR"] },
  { monthDay: "08-15", name: "Independence Day", type: "PUBLIC", note: "Gazetted national holiday." },
  { monthDay: "10-02", name: "Gandhi Jayanti", type: "PUBLIC", note: "Gazetted national holiday." },
  { monthDay: "10-31", name: "Sardar Vallabhbhai Patel Jayanti", type: "RESTRICTED", states: ["GJ"] },
  { monthDay: "11-01", name: "Kannada Rajyotsava", type: "PUBLIC", states: ["KA"] },
  { monthDay: "11-01", name: "Kerala Piravi", type: "PUBLIC", states: ["KL"] },
  { monthDay: "11-01", name: "Haryana Day", type: "PUBLIC", states: ["HR"] },
  { monthDay: "11-01", name: "Andhra Pradesh Formation Day", type: "PUBLIC", states: ["AP"] },
  { monthDay: "11-01", name: "Madhya Pradesh Foundation Day", type: "PUBLIC", states: ["MP"] },
  { monthDay: "11-01", name: "Chhattisgarh Foundation Day", type: "PUBLIC", states: ["CT"] },
  { monthDay: "11-01", name: "Punjab Day", type: "RESTRICTED", states: ["PB"] },
  { monthDay: "11-09", name: "Uttarakhand Foundation Day", type: "PUBLIC", states: ["UK"] },
  { monthDay: "11-15", name: "Jharkhand Foundation Day", type: "PUBLIC", states: ["JH"] },
  { monthDay: "12-01", name: "Nagaland Statehood Day", type: "PUBLIC", states: ["NL"], note: STATE_DAY_NOTE },
  { monthDay: "12-19", name: "Goa Liberation Day", type: "PUBLIC", states: ["GA"], note: STATE_DAY_NOTE },
  { monthDay: "12-25", name: "Christmas", type: "PUBLIC" },
];

/* ── Variable (lunar / observational) holidays ──────────────────────────── */

/**
 * Festivals whose Gregorian date changes each year, keyed by year.
 *
 * These CANNOT be derived, they follow lunar calendars and, for the Islamic
 * ones, local moon sighting. Only years we hold real dates for appear here.
 *
 * 2026 is the set previously hardcoded in seed-content.ts, retained as-is.
 * To add a year, add its entry; nothing else needs to change.
 */
export const VARIABLE_HOLIDAYS: Record<number, HolidayDef[]> = {
  /**
   * Cross-checked against the DoPT central gazetted list for 2026 (17 holidays,
   * as published by NIEPVD, niepvd.nic.in). The seven entries marked [DoPT 2026]
   * were missing from the original set, which is why a generated 2026 calendar
   * was noticeably thinner than a 2027 one.
   */
  2026: [
    { monthDay: "02-15", name: "Maha Shivaratri", type: "PUBLIC" },
    { monthDay: "03-04", name: "Holi", type: "PUBLIC", states: ["DL", "UP", "MP", "RJ", "BR", "HR", "PB", "CH", "UK", "JH", "CT", "GJ", "MH", "WB"] },
    { monthDay: "03-19", name: "Ugadi / Gudi Padwa", type: "PUBLIC", states: ["KA", "AP", "TG", "MH", "GA"] },
    { monthDay: "03-21", name: "Eid al-Fitr (Ramzan)", type: "PUBLIC", note: "Subject to moon sighting." },
    { monthDay: "03-26", name: "Ram Navami", type: "PUBLIC" }, // [DoPT 2026]
    { monthDay: "03-31", name: "Mahavir Jayanti", type: "PUBLIC" }, // [DoPT 2026]
    { monthDay: "04-03", name: "Good Friday", type: "PUBLIC" },
    { monthDay: "05-01", name: "Buddha Purnima", type: "PUBLIC" }, // [DoPT 2026]
    { monthDay: "05-27", name: "Bakrid (Eid al-Adha)", type: "RESTRICTED", note: "Subject to moon sighting." },
    { monthDay: "06-26", name: "Muharram", type: "PUBLIC", note: "Subject to moon sighting." }, // [DoPT 2026]
    { monthDay: "08-26", name: "Ganesh Chaturthi", type: "PUBLIC", states: ["MH", "KA", "GA", "AP", "TG", "GJ"] },
    { monthDay: "08-26", name: "Milad-un-Nabi", type: "PUBLIC", note: "Subject to moon sighting." }, // [DoPT 2026]
    { monthDay: "09-04", name: "Janmashtami", type: "PUBLIC" }, // [DoPT 2026]
    { monthDay: "10-20", name: "Mahalaya Amavasya", type: "RESTRICTED", states: ["WB", "KA", "OR"] },
    {
      monthDay: "10-20",
      name: "Vijayadashami (Dussehra)",
      type: "PUBLIC",
      note: "Central list gazettes 20 Oct 2026; Karnataka's DPAR gazette observes 21 Oct, the curated Karnataka set carries the state date.",
    },
    { monthDay: "11-08", name: "Deepavali (Naraka Chaturdashi)", type: "PUBLIC" },
    { monthDay: "11-09", name: "Balipadyami (Deepavali)", type: "PUBLIC" },
    { monthDay: "11-24", name: "Guru Nanak Jayanti", type: "PUBLIC" }, // [DoPT 2026]
  ],

  /**
   * Source: DoPT O.M. No. 12/2/2023-JCA dated 16 July 2026, the central
   * government gazetted holiday list for 2027. Transcribed, not derived.
   *
   * Only the 17 gazetted festivals are listed. Maha Shivaratri, Ugadi, Onam and
   * Ganesh Chaturthi are state/restricted holidays that the central list does
   * not fix, so they are deliberately absent and will surface in
   * `missingVariable` rather than be guessed at.
   */
  2027: [
    { monthDay: "03-10", name: "Eid al-Fitr (Ramzan)", type: "PUBLIC", note: "Subject to moon sighting." },
    { monthDay: "03-23", name: "Holi", type: "PUBLIC", states: ["DL", "UP", "MP", "RJ", "BR", "HR", "PB", "CH", "UK", "JH", "CT", "GJ", "MH", "WB"] },
    { monthDay: "03-26", name: "Good Friday", type: "PUBLIC" },
    { monthDay: "04-15", name: "Ram Navami", type: "PUBLIC" },
    { monthDay: "04-19", name: "Mahavir Jayanti", type: "PUBLIC" },
    { monthDay: "05-17", name: "Bakrid (Eid al-Adha)", type: "PUBLIC", note: "Subject to moon sighting." },
    { monthDay: "05-20", name: "Buddha Purnima", type: "PUBLIC" },
    { monthDay: "06-16", name: "Muharram", type: "PUBLIC", note: "Subject to moon sighting." },
    {
      monthDay: "08-15",
      name: "Milad-un-Nabi",
      type: "PUBLIC",
      note: "Coincides with Independence Day in 2027, DoPT allows no substitute holiday.",
    },
    { monthDay: "08-25", name: "Janmashtami", type: "PUBLIC" },
    { monthDay: "10-09", name: "Vijayadashami (Dussehra)", type: "PUBLIC" },
    { monthDay: "10-29", name: "Deepavali (Diwali)", type: "PUBLIC" },
    { monthDay: "11-14", name: "Guru Nanak Jayanti", type: "PUBLIC" },
  ],
};

/** Festivals we expect in a full year but hold no date for, per year. */
export const EXPECTED_VARIABLE_FESTIVALS = [
  "Maha Shivaratri",
  "Holi",
  "Ugadi / Gudi Padwa",
  "Ram Navami",
  "Mahavir Jayanti",
  "Good Friday",
  "Eid al-Fitr (Ramzan)",
  "Buddha Purnima",
  "Bakrid (Eid al-Adha)",
  "Muharram",
  "Onam",
  "Janmashtami",
  "Ganesh Chaturthi",
  "Milad-un-Nabi",
  "Vijayadashami (Dussehra)",
  "Deepavali",
  "Guru Nanak Jayanti",
];

/* ── Generation ─────────────────────────────────────────────────────────── */

export interface GeneratedHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  type: HolidayType;
  /** True when the date came from the per-year table rather than a fixed rule. */
  variable: boolean;
  region: string;
  note?: string;
  /** Day of week, so HR can see which fall on a weekend. */
  weekday: string;
  weekend: boolean;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function applies(def: HolidayDef, state?: string | null): boolean {
  if (!def.states || !def.states.length) return true; // nationwide
  return !!state && def.states.includes(state);
}

/**
 * Build the holiday list for a year and state.
 *
 * Returns `missingVariable` naming the festivals we hold no date for, so the
 * UI can tell HR exactly what to add rather than presenting a quietly
 * incomplete calendar as if it were finished.
 */
export function generateHolidays(
  year: number,
  state?: string | null,
  opts: { includeRestricted?: boolean } = {}
): { holidays: GeneratedHoliday[]; missingVariable: string[]; hasVariableData: boolean } {
  const includeRestricted = opts.includeRestricted !== false;
  const region = state ? stateName(state) : "India";
  const out: GeneratedHoliday[] = [];

  const push = (def: HolidayDef, variable: boolean) => {
    if (!def.monthDay) return;
    if (!applies(def, state)) return;
    if (!includeRestricted && def.type === "RESTRICTED") return;
    const date = `${year}-${def.monthDay}`;
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return;
    const dow = d.getUTCDay();
    out.push({
      date,
      name: def.name,
      type: def.type,
      variable,
      region: def.states?.length ? region : "India",
      note: def.note,
      weekday: WEEKDAYS[dow],
      weekend: dow === 0 || dow === 6,
    });
  };

  for (const def of FIXED_HOLIDAYS) push(def, false);

  const variable = VARIABLE_HOLIDAYS[year] ?? [];
  for (const def of variable) push(def, true);

  // De-duplicate same date + same name (e.g. a festival listed for several
  // states), keeping the first.
  const seen = new Set<string>();
  const deduped = out.filter((h) => {
    const key = `${h.date}|${h.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

  const haveNames = new Set(variable.map((v) => v.name.toLowerCase()));
  const missingVariable = EXPECTED_VARIABLE_FESTIVALS.filter(
    (n) => ![...haveNames].some((h) => h.includes(n.toLowerCase().split(" ")[0]))
  );

  return {
    holidays: deduped,
    missingVariable: variable.length ? missingVariable : EXPECTED_VARIABLE_FESTIVALS,
    hasVariableData: variable.length > 0,
  };
}

/** Years we hold lunar-festival dates for. */
export function yearsWithVariableData(): number[] {
  return Object.keys(VARIABLE_HOLIDAYS).map(Number).sort();
}
