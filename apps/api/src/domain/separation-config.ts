/**
 * Separation (offboarding) type configuration. Drives the type-aware flows:
 * who initiates, the approval chain, whether a notice period applies, and which
 * terminal documents are issued. No migration: separations ride the existing
 * jsonb `separations` table (type + status are the only structured fields).
 *
 * Status machine (shared across types):
 *   Resignation:  PENDING_MANAGER -> PENDING_HR -> NOTICE_PERIOD -> IN_CLEARANCE -> COMPLETED
 *   Involuntary:  NOTICE_PERIOD (or straight) -> IN_CLEARANCE -> COMPLETED      (termination/retirement/EOC)
 *   Absconding:   ABSCONDING -> ABSCONDED
 *   Off-ramps:    DECLINED (manager/HR), WITHDRAWN (employee), CANCELLED (HR)
 */

export const TYPES = {
  RESIGNATION: {
    label: "Resignation",
    initiator: "EMPLOYEE",
    managerApproval: true, // L1: reporting manager (skipped if none) -> L2: HR
    hrApproval: true,
    withdrawable: true, // before HR accepts
    notice: true,
    documents: ["RELIEVING_LETTER"], // relieving letter doubles as the experience certificate
  },
  TERMINATION: {
    label: "Termination",
    initiator: "HR",
    subReasons: ["PERFORMANCE", "MISCONDUCT", "LAYOFF"],
    forCauseReasons: ["MISCONDUCT"], // "for cause" -> no experience certificate
    managerApproval: false,
    hrApproval: false,
    withdrawable: false,
    notice: "optional", // HR chooses notice period vs immediate
    documents: ["TERMINATION_LETTER", "EXPERIENCE_LETTER"],
  },
  ABSCONDING: {
    label: "Absconding",
    initiator: "HR",
    managerApproval: false,
    hrApproval: false,
    withdrawable: false,
    notice: false,
    warnings: 2, // warning letters before confirming
    terminal: "ABSCONDED",
    documents: [], // no relieving / experience
  },
  RETIREMENT: {
    label: "Retirement",
    initiator: "HR",
    managerApproval: false,
    hrApproval: false,
    withdrawable: false,
    notice: false,
    documents: ["RETIREMENT_LETTER"],
  },
  END_OF_CONTRACT: {
    label: "End of contract",
    initiator: "HR",
    managerApproval: false,
    hrApproval: false,
    withdrawable: false,
    notice: false,
    documents: ["EXPERIENCE_LETTER"],
  },
};

export const TYPE_KEYS = Object.keys(TYPES);
export const isType = (t) => TYPE_KEYS.includes(t);
export const typeDef = (t) => TYPES[t] || TYPES.RESIGNATION;

/** Active (non-terminal) statuses, used to block a second open separation. */
export const TERMINAL = ["COMPLETED", "CANCELLED", "DECLINED", "WITHDRAWN", "ABSCONDED"];
export const isActive = (s) => s && !TERMINAL.includes(s.status);

// Attrition classification for analytics.
const CLASS = { RESIGNATION: "VOLUNTARY", RETIREMENT: "VOLUNTARY", TERMINATION: "INVOLUNTARY", ABSCONDING: "INVOLUNTARY", END_OF_CONTRACT: "OTHER" };
export const classOf = (type) => CLASS[type] || "OTHER";

// Standard exit-interview questionnaire (employee-facing).
export const EXIT_INTERVIEW_QUESTIONS = [
  { key: "primaryReason", label: "Primary reason for leaving", type: "select", options: ["Better opportunity", "Compensation", "Work-life balance", "Manager / management", "Role / growth", "Relocation", "Personal", "Other"] },
  { key: "wouldRecommend", label: "Would you recommend us as a place to work?", type: "select", options: ["Definitely", "Probably", "Not sure", "Probably not", "Definitely not"] },
  { key: "rating", label: "Overall experience (1-5)", type: "select", options: ["5", "4", "3", "2", "1"] },
  { key: "liked", label: "What did you value most?", type: "text" },
  { key: "improve", label: "What could we improve?", type: "text" },
  { key: "comments", label: "Anything else you'd like to share?", type: "text" },
];

/**
 * Terminal letters HR may choose from, whatever the separation type.
 *
 * The type's own `documents` list is the sensible default, not a rule: an organisation
 * may well want to hand someone an experience certificate alongside a relieving letter, or
 * issue nothing at all. These are the four the letter engine can generate on exit.
 */
export const SELECTABLE_DOCUMENTS = [
  { key: "RELIEVING_LETTER", label: "Relieving and experience letter" },
  { key: "EXPERIENCE_LETTER", label: "Experience certificate" },
  { key: "TERMINATION_LETTER", label: "Termination letter" },
  { key: "RETIREMENT_LETTER", label: "Superannuation letter" },
];
export const SELECTABLE_KEYS = SELECTABLE_DOCUMENTS.map((d) => d.key);

/* ── Notice period ─────────────────────────────────────────────────────────── */

/**
 * How HR states the notice period when starting or accepting an exit.
 *
 *   DEFAULT  serve the contractual notice on record (employee, else org, else 30)
 *   DAYS     serve a stated number of days from today
 *   UNTIL    serve until a stated last working day
 *   SKIP     no notice at all: released with effect from the last working day
 *
 * SKIP is the case the product got wrong. "Immediate exit" was a boolean that was
 * stored and then ignored: the separation and the employee were both moved to
 * NOTICE_PERIOD regardless, so somebody released on the spot showed as serving a
 * notice period they had explicitly been excused, and everything keyed off that
 * status (payroll, the directory, reminders, letters) followed the wrong answer.
 */
export const NOTICE_MODES = ["DEFAULT", "DAYS", "UNTIL", "SKIP"] as const;
export type NoticeMode = (typeof NOTICE_MODES)[number];
export const isNoticeMode = (m: unknown): m is NoticeMode => NOTICE_MODES.includes(m as NoticeMode);

/**
 * Used when neither the employee nor the organisation states one.
 *
 * A fallback, not a policy: 30 days is the common Indian default, and an
 * organisation that means something else sets it in Settings once rather than
 * having every exit typed in by hand.
 */
export const FALLBACK_NOTICE_DAYS = 30;

const MAX_NOTICE_DAYS = 365;

const dayMs = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (v: unknown): Date | null => {
  const str = String(v ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(`${str}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * dayMs);

/**
 * The contractual notice on record for this person.
 *
 * Per-employee first, because notice length is a term of an individual contract:
 * a senior hire on 90 days and a probationer on 7 work at the same organisation.
 * The org default exists so the common case needs no per-employee data entry.
 */
export function defaultNoticeDays(employee: any, org: any): number {
  const fromEmployee = Number(employee?.noticePeriodDays);
  if (Number.isFinite(fromEmployee) && fromEmployee >= 0) return Math.min(fromEmployee, MAX_NOTICE_DAYS);
  const fromOrg = Number(org?.noticePeriodDays);
  if (Number.isFinite(fromOrg) && fromOrg >= 0) return Math.min(fromOrg, MAX_NOTICE_DAYS);
  return FALLBACK_NOTICE_DAYS;
}

export interface ResolvedNotice {
  mode: NoticeMode;
  /** Days of notice actually being served. 0 when skipped. */
  noticeDays: number;
  lastWorkingDay: string;
  /** True when no notice is served: the employee is released with immediate effect. */
  waived: boolean;
  /** Where the day count came from, for the audit log and the UI's explanation. */
  source: "employee" | "org" | "fallback" | "stated" | "derived" | "waived";
  /** True when the last working day is today or earlier, so the person has already left. */
  alreadyPast: boolean;
}

/**
 * Turn HR's choice into the two facts the rest of the system needs: how many days
 * of notice are being served, and what the last working day is.
 *
 * Callers pass whichever fields the form supplied; anything missing falls back to
 * the contractual default, so an old client that sends only `lastWorkingDay`
 * still behaves exactly as it did.
 */
export function resolveNotice(input: {
  mode?: unknown;
  noticeDays?: unknown;
  lastWorkingDay?: unknown;
  employee?: any;
  org?: any;
  /** The day notice starts running. Defaults to today. */
  from?: string;
}): ResolvedNotice {
  const today = parseDay(input.from) || parseDay(new Date().toISOString()) || new Date();
  const stated = parseDay(input.lastWorkingDay);
  const requested = isNoticeMode(input.mode) ? input.mode : null;

  // No mode supplied: infer one, so callers written before notice modes existed
  // (and the bulk/API paths) keep working. A stated date means UNTIL; nothing at
  // all means the contractual default.
  const mode: NoticeMode = requested ?? (stated ? "UNTIL" : "DEFAULT");

  if (mode === "SKIP") {
    // Released with effect from the stated day, or today. A back-dated skip is
    // allowed on purpose: exits are frequently recorded days after the fact.
    const lwd = stated && stated <= today ? stated : today;
    return { mode, noticeDays: 0, lastWorkingDay: isoDay(lwd), waived: true, source: "waived", alreadyPast: true };
  }

  if (mode === "UNTIL") {
    const lwd = stated || today;
    const days = Math.max(0, Math.round((lwd.getTime() - today.getTime()) / dayMs));
    return {
      mode, noticeDays: days, lastWorkingDay: isoDay(lwd),
      // A last working day of today or earlier is an exit, not a notice period,
      // whichever way HR expressed it. Treating it as served notice is what put
      // people who had already left into NOTICE_PERIOD.
      waived: days === 0, source: "derived", alreadyPast: lwd <= today,
    };
  }

  const requestedDays = Number(input.noticeDays);
  const useStatedDays = mode === "DAYS" && Number.isFinite(requestedDays) && requestedDays >= 0;
  const days = useStatedDays
    ? Math.min(Math.round(requestedDays), MAX_NOTICE_DAYS)
    : defaultNoticeDays(input.employee, input.org);

  const source: ResolvedNotice["source"] = useStatedDays
    ? "stated"
    : Number.isFinite(Number(input.employee?.noticePeriodDays))
      ? "employee"
      : Number.isFinite(Number(input.org?.noticePeriodDays))
        ? "org"
        : "fallback";

  const lwd = addDays(today, days);
  return { mode, noticeDays: days, lastWorkingDay: isoDay(lwd), waived: days === 0, source, alreadyPast: days === 0 };
}

/** Is this separation a termination for cause? Drives the experience-certificate guard. */
export function isForCause(sep) {
  const def = typeDef(sep.type);
  return sep.type === "TERMINATION" && (def.forCauseReasons || []).includes(sep.subReason);
}

/** The default set for a type, with the for-cause exclusion applied. */
export function defaultDocumentsFor(sep) {
  const def = typeDef(sep.type);
  let docs = (def.documents || []).slice();
  if (isForCause(sep)) docs = docs.filter((d) => d !== "EXPERIENCE_LETTER");
  return docs;
}

/**
 * Documents to issue at completion.
 *
 * An explicit `documents` array on the separation wins, so HR decides the paperwork rather
 * than the type deciding for them. An empty array is a real choice (issue nothing) and is
 * honoured; only an absent field falls back to the default.
 */
export function documentsFor(sep) {
  return Array.isArray(sep.documents) ? sep.documents.filter((d) => SELECTABLE_KEYS.includes(d)) : defaultDocumentsFor(sep);
}
