/**
 * Pure-logic regressions from the API hardening pass: CSV formula-injection defence and
 * the workspace-local "today" used by reminders. No database, no network.
 */
import { describe, expect, it } from "vitest";
import { csv, defangCell } from "../../src/core/csv";
import { reminderToday } from "../../src/services/reminder.service";
import { fullName } from "../../src/domain/person";

describe("CSV formula injection", () => {
  it("prefixes a single quote on cells starting with = + - @, tab or CR", () => {
    for (const v of ["=SUM(A1)", "+1", "-2", "@cmd", "\tx", "\rx"]) expect(defangCell(v)).toBe("'" + v);
  });

  it("leaves ordinary cells alone", () => {
    expect(defangCell("Rohan Das")).toBe("Rohan Das");
    expect(defangCell("a=b")).toBe("a=b");
    expect(defangCell(42)).toBe("42");
    expect(defangCell(null)).toBe("");
  });

  it("csv() defangs and quotes", () => {
    expect(csv([["=1+2", "plain", 'say "hi"']])).toBe(`'=1+2,plain,"say ""hi"""`);
  });

  it("csv() quotes a bare carriage return so it cannot start a fresh, undefended row", () => {
    expect(csv([["note\r=HYPERLINK(1)", "x"]])).toBe(`"note\r=HYPERLINK(1)",x`);
  });
});

describe("reminderToday", () => {
  // 15:00 UTC on 10 March is already 11 March at UTC+14 and still 10 March in UTC.
  const now = new Date("2026-03-10T15:00:00Z");

  it("uses the workspace timezone when one is set", () => {
    expect(reminderToday({ reminders: { clockIn: { timezone: "Pacific/Kiritimati" } } }, now)).toBe("2026-03-11");
    expect(reminderToday({ reminders: { clockIn: { timezone: "America/Los_Angeles" } } }, new Date("2026-03-10T03:00:00Z"))).toBe("2026-03-09");
  });

  it("falls back to UTC without one", () => {
    expect(reminderToday({}, now)).toBe("2026-03-10");
    expect(reminderToday(null, now)).toBe("2026-03-10");
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(reminderToday({ reminders: { clockIn: { timezone: "Mars/Olympus" } } }, now)).toBe("2026-03-10");
  });
});

describe("fullName", () => {
  it("never renders a missing last name as undefined or null", () => {
    expect(fullName({ firstName: "Madhu" })).toBe("Madhu");
    expect(fullName({ firstName: "Madhu", lastName: null })).toBe("Madhu");
    expect(fullName({ firstName: "Rohan", lastName: "Das" })).toBe("Rohan Das");
    expect(fullName(null)).toBe("");
  });
});
