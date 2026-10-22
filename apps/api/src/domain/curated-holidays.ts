/**
 * Curated holiday calendars, transcribed from official gazette notifications.
 *
 * Every date here comes from a named primary source and was checked against it.
 * Nothing is derived, inferred, or reconstructed from a lunar rule: festival
 * dates follow lunar calendars and, for the Islamic ones, local moon sighting,
 * so a computed date is a guess wearing a calendar's clothes. A wrong public
 * holiday means staff paid for the wrong day, so the rule is absolute, if we
 * cannot cite it, it does not go in.
 *
 * When no set exists for a requested year, the starter loader offers NO holiday
 * pack at all. It does not fall back to a constructed calendar.
 *
 * Sources:
 *   - NATIONAL 2026, DoPT central gazetted list for 2026, as published at
 *     niepvd.nic.in/gazetted-holiday-2026 (17 gazetted holidays).
 *   - NATIONAL 2027, DoPT O.M. No. 12/2/2023-JCA dated 16 July 2026
 *     (17 gazetted holidays).
 *   - KARNATAKA 2026, Karnataka DPAR notification (CIAUI 16 HHHL 2025); this
 *     is the calendar already in production use. Note it gazettes Vijayadashami
 *     on 21 Oct where the central list says 20 Oct, a real state variation.
 *
 * To add a year or state: transcribe the gazette, cite it above, add the entry.
 */

export interface CuratedHoliday {
  date: string;
  name: string;
  type: string;
  region: string;
  note?: string;
}

export interface CuratedSet {
  year: number;
  /** ISO state code from INDIAN_STATES, or null for the national set. */
  state: string | null;
  region: string;
  label: string;
  /** Primary source this was transcribed from, shown in the UI. */
  source: string;
  holidays: CuratedHoliday[];
}

const MOON = "Subject to moon sighting.";

/** Build rows from [date, name, type, note?] tuples. */
const rows = (region: string, list: (string | undefined)[][]): CuratedHoliday[] =>
  list.map(([date, name, type, note]) => ({
    date: date as string,
    name: name as string,
    type: type as string,
    region,
    ...(note ? { note } : {}),
  }));

/** DoPT central gazetted holidays, 2026. */
const national2026: CuratedSet = {
  year: 2026,
  state: null,
  region: "India",
  label: "India (central gazetted) 2026",
  source: "DoPT central gazetted list 2026 (niepvd.nic.in)",
  holidays: rows("India", [
    ["2026-01-26", "Republic Day", "PUBLIC"],
    ["2026-03-04", "Holi", "PUBLIC"],
    ["2026-03-21", "Id-ul-Fitr", "PUBLIC", MOON],
    ["2026-03-26", "Ram Navami", "PUBLIC"],
    ["2026-03-31", "Mahavir Jayanti", "PUBLIC"],
    ["2026-04-03", "Good Friday", "PUBLIC"],
    ["2026-05-01", "Buddha Purnima", "PUBLIC"],
    ["2026-05-27", "Id-ul-Zuha (Bakrid)", "PUBLIC", MOON],
    ["2026-06-26", "Muharram", "PUBLIC", MOON],
    ["2026-08-15", "Independence Day", "PUBLIC"],
    ["2026-08-26", "Milad-un-Nabi", "PUBLIC", MOON],
    ["2026-09-04", "Janmashtami", "PUBLIC"],
    ["2026-10-02", "Mahatma Gandhi's Birthday", "PUBLIC"],
    ["2026-10-20", "Dussehra (Vijaya Dashami)", "PUBLIC"],
    ["2026-11-08", "Diwali (Deepavali)", "PUBLIC"],
    ["2026-11-24", "Guru Nanak's Birthday", "PUBLIC"],
    ["2026-12-25", "Christmas Day", "PUBLIC"],
  ]),
};

/** DoPT central gazetted holidays, 2027 (O.M. dated 16 July 2026). */
const national2027: CuratedSet = {
  year: 2027,
  state: null,
  region: "India",
  label: "India (central gazetted) 2027",
  source: "DoPT O.M. No. 12/2/2023-JCA dated 16 July 2026",
  holidays: rows("India", [
    ["2027-01-26", "Republic Day", "PUBLIC"],
    ["2027-03-10", "Id-ul-Fitr", "PUBLIC", MOON],
    ["2027-03-23", "Holi", "PUBLIC"],
    ["2027-03-26", "Good Friday", "PUBLIC"],
    ["2027-04-15", "Ram Navami", "PUBLIC"],
    ["2027-04-19", "Mahavir Jayanti", "PUBLIC"],
    ["2027-05-17", "Id-ul-Zuha (Bakrid)", "PUBLIC", MOON],
    ["2027-05-20", "Buddha Purnima", "PUBLIC"],
    ["2027-06-16", "Muharram", "PUBLIC", MOON],
    ["2027-08-15", "Independence Day", "PUBLIC"],
    [
      "2027-08-15",
      "Milad-un-Nabi",
      "PUBLIC",
      "Coincides with Independence Day in 2027, DoPT allows no substitute holiday.",
    ],
    ["2027-08-25", "Janmashtami", "PUBLIC"],
    ["2027-10-02", "Mahatma Gandhi's Birthday", "PUBLIC"],
    ["2027-10-09", "Dussehra (Vijaya Dashami)", "PUBLIC"],
    ["2027-10-29", "Diwali (Deepavali)", "PUBLIC"],
    ["2027-11-14", "Guru Nanak's Birthday", "PUBLIC"],
    ["2027-12-25", "Christmas Day", "PUBLIC"],
  ]),
};

/** Karnataka DPAR general holidays, 2026, the calendar already in production. */
const karnataka2026: CuratedSet = {
  year: 2026,
  state: "KA",
  region: "Karnataka",
  label: "Karnataka 2026",
  source: "Karnataka DPAR notification CIAUI 16 HHHL 2025",
  holidays: rows("Karnataka", [
    ["2026-01-01", "New Year's Day", "PUBLIC"],
    ["2026-01-14", "Makara Sankranti", "PUBLIC"],
    ["2026-01-26", "Republic Day", "PUBLIC"],
    ["2026-02-15", "Maha Shivaratri", "PUBLIC"],
    ["2026-03-04", "Holi", "RESTRICTED"],
    ["2026-03-19", "Ugadi", "PUBLIC"],
    ["2026-03-21", "Eid al-Fitr (Ramzan)", "PUBLIC", MOON],
    ["2026-04-03", "Good Friday", "PUBLIC"],
    ["2026-04-14", "Dr. B. R. Ambedkar Jayanti", "PUBLIC"],
    ["2026-05-01", "May Day (Labour Day)", "PUBLIC"],
    ["2026-05-27", "Bakrid (Eid al-Adha)", "RESTRICTED", MOON],
    ["2026-08-15", "Independence Day", "PUBLIC"],
    ["2026-08-26", "Ganesh Chaturthi", "PUBLIC"],
    ["2026-10-02", "Gandhi Jayanti", "PUBLIC"],
    ["2026-10-20", "Mahalaya Amavasya", "RESTRICTED"],
    [
      "2026-10-21",
      "Vijayadashami (Dussehra)",
      "PUBLIC",
      "Karnataka gazettes 21 Oct; the central list gazettes 20 Oct.",
    ],
    ["2026-11-01", "Kannada Rajyotsava (Karnataka Formation Day)", "PUBLIC"],
    ["2026-11-08", "Deepavali (Naraka Chaturdashi)", "PUBLIC"],
    ["2026-11-09", "Balipadyami (Deepavali)", "PUBLIC"],
    ["2026-12-25", "Christmas", "PUBLIC"],
  ]),
};

const SETS: CuratedSet[] = [national2026, national2027, karnataka2026];

const key = (year: number, state: string | null) => `${year}:${state ?? "IN"}`;
const BY_KEY = new Map(SETS.map((s) => [key(s.year, s.state), s]));

/**
 * The best verified calendar for a year + state:
 *   1. that state's own gazette, when we hold it;
 *   2. otherwise the central gazetted list for that year.
 *
 * Both are transcribed from primary sources, this is not a quality fallback,
 * it is "we have no state gazette, so use the national one, which is correct
 * but shorter". Returns null when we hold nothing for the year at all, and the
 * caller must then offer no holiday pack rather than construct one.
 */
export function curatedHolidays(year: number, state: string | null): CuratedSet | null {
  return BY_KEY.get(key(year, state)) ?? BY_KEY.get(key(year, null)) ?? null;
}

/** Years we hold any verified calendar for, the only years the UI may offer. */
export function curatedYears(): number[] {
  return [...new Set(SETS.map((s) => s.year))].sort();
}

/** Every verified set, for the UI to advertise what is state-specific. */
export function curatedCoverage(): {
  year: number;
  state: string | null;
  label: string;
  source: string;
  count: number;
}[] {
  return SETS.map((s) => ({
    year: s.year,
    state: s.state,
    label: s.label,
    source: s.source,
    count: s.holidays.length,
  }));
}
