/**
 * Company leave rules, on top of the yearly quota each leave type already has.
 *
 *   - A monthly limit on paid leave, every paid type counted together, with a
 *     tighter limit for the first few months after joining (for example 1 a month
 *     for the first 3 months, then 2). Days beyond it are taken as Loss of Pay.
 *   - Advance notice for long leave (for example 3 or more days must be applied
 *     for at least 7 days ahead).
 *   - Optionally, sizing requests in working days, so a weekend inside a leave
 *     does not use up a 1 or 2 day monthly limit.
 *
 * All of it is off until a company turns it on in Settings, so one tenant's policy
 * never changes how leave works for another. The config lives in the org's `data`
 * JSONB as `leaveRules` (no migration), next to `leaveCoverage`.
 *
 * Everything here is pure. The leave routes load the employee, their other
 * requests and the holiday calendar, and get back the problems, if there are any.
 */

import { LEAVE_CATALOGUE, leaveType as catalogueByKey } from "./leave-policy";

export interface LeaveRules {
  monthlyLimit: {
    enabled: boolean;
    /** Paid days a month during the first `newJoinerMonths` after joining. */
    newJoinerLimit: number;
    /** 0 means no separate new-joiner period. */
    newJoinerMonths: number;
    /** Paid days a month after that. */
    limit: number;
    /**
     * Unused paid days roll into the following months instead of lapsing at month end.
     * The running total resets each calendar year; yearly carry-forward stays per leave type.
     */
    carryOver: boolean;
  };
  advanceNotice: {
    enabled: boolean;
    /** A request of this many days or more counts as long leave. */
    minDays: number;
    /** Long leave must be applied for at least this many days before it starts. */
    noticeDays: number;
  };
  /** Count only working days: weekly offs and public or company holidays are skipped. */
  workingDaysOnly: boolean;
}

export const DEFAULT_LEAVE_RULES: LeaveRules = {
  monthlyLimit: { enabled: false, newJoinerLimit: 1, newJoinerMonths: 3, limit: 2, carryOver: false },
  advanceNotice: { enabled: false, minDays: 3, noticeDays: 7 },
  workingDaysOnly: false,
};

export type LeaveRuleCode = "MONTHLY_LIMIT" | "ADVANCE_NOTICE";

export interface RuleProblem {
  rule: LeaveRuleCode;
  message: string;
}

/** A whole number in [min, max], or the fallback when the value is missing or not a number. */
function wholeNumber(v: unknown, fallback: number, min: number, max: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

/** The org's rules, with anything missing or out of range replaced by the default. */
export function readLeaveRules(org: any): LeaveRules {
  const raw = (org && org.leaveRules) || {};
  const m = raw.monthlyLimit || {};
  const n = raw.advanceNotice || {};
  const d = DEFAULT_LEAVE_RULES;
  return {
    monthlyLimit: {
      enabled: !!m.enabled,
      newJoinerLimit: wholeNumber(m.newJoinerLimit, d.monthlyLimit.newJoinerLimit, 0, 31),
      newJoinerMonths: wholeNumber(m.newJoinerMonths, d.monthlyLimit.newJoinerMonths, 0, 24),
      limit: wholeNumber(m.limit, d.monthlyLimit.limit, 0, 31),
      carryOver: !!m.carryOver,
    },
    advanceNotice: {
      enabled: !!n.enabled,
      minDays: wholeNumber(n.minDays, d.advanceNotice.minDays, 1, 366),
      noticeDays: wholeNumber(n.noticeDays, d.advanceNotice.noticeDays, 0, 366),
    },
    workingDaysOnly: !!raw.workingDaysOnly,
  };
}

/** Sanitise a rules payload coming from the API. */
export const normalizeLeaveRules = (input: any): LeaveRules => readLeaveRules({ leaveRules: input });

/* ── Which leave types the rules apply to ──────────────────────────────── */

/** The catalogue entry a stored leave type came from: by key, else by exact name. */
function catalogueEntry(type: any) {
  const byKey = type?.key ? catalogueByKey(String(type.key)) : undefined;
  if (byKey) return byKey;
  const name = String(type?.name || "").trim().toLowerCase();
  return LEAVE_CATALOGUE.find((t) => t.name.toLowerCase() === name);
}

/**
 * Does this leave type count toward the monthly limit? An explicit setting on the
 * type wins, then the catalogue default, then "yes". Unpaid leave never counts: the
 * limit is on paid days, and Loss of Pay is where the extra days go.
 */
export function countsTowardMonthlyLimit(type: any): boolean {
  if (!type || type.paid === false) return false;
  if (typeof type.countsTowardMonthlyLimit === "boolean") return type.countsTowardMonthlyLimit;
  const def = catalogueEntry(type);
  return def ? def.countsTowardMonthlyLimit : true;
}

/** Does a long request of this type need advance notice? Same precedence as above. */
export function needsAdvanceNotice(type: any): boolean {
  if (!type) return false;
  if (typeof type.needsAdvanceNotice === "boolean") return type.needsAdvanceNotice;
  const def = catalogueEntry(type);
  return def ? def.needsAdvanceNotice : true;
}

/* ── Dates ─────────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (iso: string, days: number) => toIso(new Date(toDate(iso).getTime() + days * DAY_MS));

/** A YYYY-MM-DD date, or null for anything that is not one. */
function isoDay(v: unknown): string | null {
  const s = v == null ? "" : String(v).slice(0, 10);
  return ISO_DAY.test(s) && !Number.isNaN(toDate(s).getTime()) ? s : null;
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export const daysFrom = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);

/** Every date from `from` to `to`, inclusive. Empty for a bad or backwards range. */
export function eachDate(from: string, to: string): string[] {
  const a = isoDay(from), b = isoDay(to);
  if (!a || !b || b < a) return [];
  const out: string[] = [];
  for (let d = a; d <= b; d = shift(d, 1)) out.push(d);
  return out;
}

/** `iso` moved by `n` calendar months, clamped to the end of a shorter month (31 Jan + 1 = 28 Feb). */
export function addMonths(iso: string, n: number): string {
  const d = toDate(iso);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toIso(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
}

/* ── Counting leave days ───────────────────────────────────────────────── */

export interface WorkCalendar {
  /** 0 = Sunday .. 6 = Saturday. */
  workingDays: number[];
  /** Company-wide days off: public and company holidays. Restricted holidays are optional, so not here. */
  holidays: Set<string>;
}

/** Does this date count as a day of leave? Every date does, unless the rules count working days only. */
export function isLeaveDay(iso: string, rules: LeaveRules, cal: WorkCalendar): boolean {
  if (!rules.workingDaysOnly) return true;
  return cal.workingDays.includes(toDate(iso).getUTCDay()) && !cal.holidays.has(iso);
}

/** The dates in a request that count as leave. Its length is the request's size in days. */
export function leaveDates(from: string, to: string, rules: LeaveRules, cal: WorkCalendar): string[] {
  return eachDate(from, to).filter((d) => isLeaveDay(d, rules, cal));
}

/* ── Monthly limit ─────────────────────────────────────────────────────── */

export interface Span {
  from: string;
  to: string;
}

/** The limit that applies on a date: the new-joiner one during the first months after joining. */
export function monthlyLimitOn(date: string, joiningDate: string | null | undefined, rules: LeaveRules) {
  const { newJoinerMonths, newJoinerLimit, limit } = rules.monthlyLimit;
  const joined = isoDay(joiningDate);
  if (joined && newJoinerMonths > 0) {
    const after = addMonths(joined, newJoinerMonths);
    if (date < after) return { limit: newJoinerLimit, newJoiner: true, newJoinerEnds: shift(after, -1) };
  }
  return { limit, newJoiner: false, newJoinerEnds: null as string | null };
}

/** Distinct leave dates per calendar month ("YYYY-MM"), across a set of requests. */
function datesByMonth(spans: Span[], rules: LeaveRules, cal: WorkCalendar): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of spans) {
    for (const d of leaveDates(s.from, s.to, rules, cal)) {
      const month = d.slice(0, 7);
      if (!out.has(month)) out.set(month, new Set());
      out.get(month)!.add(d);
    }
  }
  return out;
}

export interface MonthlyOverage {
  /** "YYYY-MM" */
  month: string;
  limit: number;
  /** Paid days already taken or applied for that month, before this request. */
  used: number;
  /** Paid days this request adds to that month. */
  requested: number;
  newJoiner: boolean;
  /** With carry-over: paid days this request can still take as paid. */
  available?: number;
}

/** The month after a "YYYY-MM" month. */
const nextMonth = (month: string) => addMonths(`${month}-01`, 1).slice(0, 7);

/**
 * Paid days a month adds when unused days carry over: the limit in force at the start of the
 * month, or on the joining date in the month someone joins. Nothing before they joined.
 */
function monthlyAccrual(month: string, joiningDate: string | null | undefined, rules: LeaveRules): number {
  const joined = isoDay(joiningDate);
  if (joined && month < joined.slice(0, 7)) return 0;
  const start = joined && joined.slice(0, 7) === month ? joined : `${month}-01`;
  return monthlyLimitOn(start, joiningDate, rules).limit;
}

type OverageInput = {
  rules: LeaveRules;
  cal: WorkCalendar;
  joiningDate?: string | null;
  request: Span;
  others: Span[];
};

/**
 * With carry-over, paid days build up month by month through the calendar year and unused
 * ones roll forward. A request fits if it never takes the running total past what has built
 * up, in its own month or in any later month where leave is already booked.
 */
function carryOverOverages(input: OverageInput): MonthlyOverage[] {
  const { rules, cal } = input;
  const mine = datesByMonth([input.request], rules, cal);
  const taken = datesByMonth(input.others, rules, cal);
  const out: MonthlyOverage[] = [];
  const years = [...new Set([...mine.keys()].map((m) => m.slice(0, 4)))].sort();
  for (const year of years) {
    const inYear = (m: string) => m.startsWith(`${year}-`);
    const firstMonth = [...mine.keys()].filter(inYear).sort()[0];
    const lastMonth = [...mine.keys(), ...taken.keys()].filter(inYear).sort().pop()!;
    let builtUp = 0, used = 0, added = 0, room = Infinity, over = false;
    for (let m = `${year}-01`; m <= lastMonth; m = nextMonth(m)) {
      builtUp += monthlyAccrual(m, input.joiningDate, rules);
      const before = taken.get(m) || new Set<string>();
      used += before.size;
      added += [...(mine.get(m) || [])].filter((d) => !before.has(d)).length;
      if (m >= firstMonth) {
        room = Math.min(room, builtUp - used);
        if (added > builtUp - used) over = true;
      }
    }
    if (over && added > 0) {
      const firstDay = [...mine.get(firstMonth)!].sort()[0];
      const { limit, newJoiner } = monthlyLimitOn(firstDay, input.joiningDate, rules);
      out.push({ month: firstMonth, limit, used, requested: added, newJoiner, available: Math.max(0, room) });
    }
  }
  return out;
}

/**
 * Months in which this request would go over the monthly limit. `others` are the
 * employee's other live requests of types that count. Dates are counted once, so two
 * requests covering the same day do not use the limit up twice.
 */
export function monthlyOverages(input: OverageInput): MonthlyOverage[] {
  const { rules, cal } = input;
  if (!rules.monthlyLimit.enabled) return [];
  if (rules.monthlyLimit.carryOver) return carryOverOverages(input);
  const mine = datesByMonth([input.request], rules, cal);
  const taken = datesByMonth(input.others, rules, cal);
  const out: MonthlyOverage[] = [];
  for (const [month, dates] of mine) {
    const before = taken.get(month) || new Set<string>();
    const added = [...dates].filter((d) => !before.has(d)).sort();
    if (!added.length) continue;
    const { limit, newJoiner } = monthlyLimitOn(added[0], input.joiningDate, rules);
    if (before.size + added.length > limit) {
      out.push({ month, limit, used: before.size, requested: added.length, newJoiner });
    }
  }
  return out;
}

/** How much of a month's limit is used, for showing an employee where they stand. */
export function monthlyAllowance(input: {
  rules: LeaveRules;
  cal: WorkCalendar;
  joiningDate?: string | null;
  /** "YYYY-MM" */
  month: string;
  /** The date the limit is judged on: today for the current month. */
  onDate: string;
  /** The employee's live requests of types that count. */
  taken: Span[];
}) {
  const { rules, month } = input;
  const { limit, newJoiner, newJoinerEnds } = monthlyLimitOn(input.onDate, input.joiningDate, rules);
  const byMonth = datesByMonth(input.taken, rules, input.cal);
  const usedIn = (m: string) => (byMonth.get(m) || new Set()).size;
  const used = usedIn(month);
  if (!rules.monthlyLimit.carryOver) {
    return { month, limit, used, remaining: Math.max(0, limit - used), newJoiner, newJoinerEnds, carriedOver: 0 };
  }
  // Unused days from earlier months this year, plus what this month adds.
  let builtUp = 0, usedBefore = 0;
  for (let m = `${month.slice(0, 4)}-01`; m < month; m = nextMonth(m)) {
    builtUp += monthlyAccrual(m, input.joiningDate, rules);
    usedBefore += usedIn(m);
  }
  const carriedOver = Math.max(0, builtUp - usedBefore);
  const total = carriedOver + monthlyAccrual(month, input.joiningDate, rules);
  return { month, limit: total, used, remaining: Math.max(0, total - used), newJoiner, newJoinerEnds, carriedOver };
}

/* ── Advance notice ────────────────────────────────────────────────────── */

export interface NoticeShortfall {
  /** Leave days in the run this request belongs to: itself plus any leave it touches. */
  runDays: number;
  runFrom: string;
  runTo: string;
  /** Days from today to the start of this request. Negative when it has already started. */
  daysAhead: number;
}

/**
 * Is this long leave, applied for too late? A request that touches other leave,
 * directly or across a weekend or holiday, is judged on the whole run, so long leave
 * cannot slip through as a string of short requests.
 */
export function noticeShortfall(input: {
  rules: LeaveRules;
  cal: WorkCalendar;
  /** The org's local date, YYYY-MM-DD. */
  today: string;
  request: Span;
  /** The employee's other live requests of types that need notice. */
  others: Span[];
}): NoticeShortfall | null {
  const { rules, cal, request } = input;
  if (!rules.advanceNotice.enabled) return null;

  const onLeave = new Set<string>();
  for (const s of [request, ...input.others]) for (const d of eachDate(s.from, s.to)) onLeave.add(d);

  // Walk outwards while the next day is leave, or a day off with more leave beyond it.
  const reach = (edge: string, dir: 1 | -1) => {
    let end = edge;
    let d = shift(edge, dir);
    for (let i = 0; i < 366; i++, d = shift(d, dir)) {
      if (onLeave.has(d)) end = d;
      else if (isLeaveDay(d, rules, cal)) break;
    }
    return end;
  };
  const runFrom = reach(request.from, -1);
  const runTo = reach(request.to, 1);
  const runDays = leaveDates(runFrom, runTo, rules, cal).filter((d) => onLeave.has(d)).length;
  if (runDays < rules.advanceNotice.minDays) return null;

  const daysAhead = daysFrom(input.today, request.from);
  if (daysAhead >= rules.advanceNotice.noticeDays) return null;
  return { runDays, runFrom, runTo, daysAhead };
}

/* ── Messages ──────────────────────────────────────────────────────────── */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtDay = (iso: string) =>
  toDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtMonth = (month: string) =>
  toDate(`${month}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function monthlyLimitMessage(o: MonthlyOverage, rules: LeaveRules, audience: "applicant" | "approver"): string {
  const firstMonths = `for the first ${plural(rules.monthlyLimit.newJoinerMonths, "month")} after joining`;

  if (o.available !== undefined) {
    const { newJoinerLimit, limit } = rules.monthlyLimit;
    const rate = o.newJoiner
      ? `${plural(newJoinerLimit, "paid day")} a month ${firstMonths}, then ${limit} a month`
      : `${plural(limit, "paid day")} a month`;
    if (audience === "approver") {
      return `Approving this goes over the paid leave built up so far (${rate}, unused days carry over): ` +
        `${plural(o.available, "day")} available, and this request needs ${o.requested}.`;
    }
    if (o.available === 0) {
      return `Paid leave builds up at ${rate}, and unused days carry over. ` +
        "No paid days are available for this request, so apply it as Loss of Pay instead.";
    }
    return `Paid leave builds up at ${rate}, and unused days carry over. ` +
      `${plural(o.available, "paid day")} ${o.available === 1 ? "is" : "are"} available for this request, ` +
      `but it needs ${o.requested}. Apply ${o.available} as paid leave and the rest as Loss of Pay.`;
  }

  const limitText = `${plural(o.limit, "day")} a month${o.newJoiner ? ` ${firstMonths}` : ""}`;
  const month = fmtMonth(o.month);

  if (audience === "approver") {
    return `Approving this goes over the monthly paid-leave limit of ${limitText}: ` +
      `${plural(o.used, "day")} already approved in ${month}, and this request adds ${o.requested}.`;
  }
  if (o.limit === 0) {
    return `No paid leave is allowed ${o.newJoiner ? firstMonths : "under the company's leave rules"}. ` +
      "Apply this as Loss of Pay instead.";
  }
  const left = Math.max(0, o.limit - o.used);
  if (left === 0) {
    return `Paid leave is limited to ${limitText}. You've already used or applied for ${o.used} in ${month}, ` +
      "so none are left. Apply this as Loss of Pay instead.";
  }
  return `Paid leave is limited to ${limitText}. This request has ${plural(o.requested, "paid day")} in ${month}, ` +
    `but only ${left} ${left === 1 ? "is" : "are"} left. Apply ${left} as paid leave and the rest as Loss of Pay.`;
}

function noticeMessage(s: NoticeShortfall, request: Span, rules: LeaveRules): string {
  const unit = rules.workingDaysOnly ? "working days" : "days";
  const when =
    s.daysAhead > 1 ? `in ${s.daysAhead} days`
    : s.daysAhead === 1 ? "tomorrow"
    : s.daysAhead === 0 ? "today"
    : `on ${fmtDay(request.from)}, which has already passed`;
  let msg = `Leave of ${rules.advanceNotice.minDays} or more ${unit} has to be applied for at least ` +
    `${plural(rules.advanceNotice.noticeDays, "day")} before it starts, and this one starts ${when}.`;
  if (s.runFrom !== request.from || s.runTo !== request.to) {
    msg += ` Together with the leave next to it, that's ${s.runDays} ${unit} in a row ` +
      `(${fmtDay(s.runFrom)} to ${fmtDay(s.runTo)}).`;
  }
  return s.daysAhead < 0
    ? `${msg} Ask HR to record it for you.`
    : `${msg} Pick dates further ahead, or ask HR to apply for you if it's urgent.`;
}

/* ── All rules together ────────────────────────────────────────────────── */

export interface LiveRequest extends Span {
  /** The request's leave type record, so the rules can tell whether it counts. */
  type: any;
}

/**
 * Everything wrong with a request under the company's rules. Empty when the rules
 * are off, or the request is fine.
 */
export function leaveRuleProblems(input: {
  rules: LeaveRules;
  cal: WorkCalendar;
  /** The org's local date, YYYY-MM-DD. */
  today: string;
  joiningDate?: string | null;
  /** The leave type being requested. */
  type: any;
  request: Span;
  /** The employee's other live requests, not including this one. */
  others: LiveRequest[];
  /** Applicants are told what to do instead; approvers are told what they would override. */
  audience: "applicant" | "approver";
  /** Notice is about when leave was asked for, so it is judged when applying, not when approving. */
  checkNotice: boolean;
}): RuleProblem[] {
  const { rules, cal, request } = input;
  const problems: RuleProblem[] = [];

  if (countsTowardMonthlyLimit(input.type)) {
    const others = input.others.filter((o) => countsTowardMonthlyLimit(o.type));
    for (const o of monthlyOverages({ rules, cal, joiningDate: input.joiningDate, request, others })) {
      problems.push({ rule: "MONTHLY_LIMIT", message: monthlyLimitMessage(o, rules, input.audience) });
    }
  }

  if (input.checkNotice && needsAdvanceNotice(input.type)) {
    const others = input.others.filter((o) => needsAdvanceNotice(o.type));
    const short = noticeShortfall({ rules, cal, today: input.today, request, others });
    if (short) problems.push({ rule: "ADVANCE_NOTICE", message: noticeMessage(short, request, rules) });
  }

  return problems;
}
