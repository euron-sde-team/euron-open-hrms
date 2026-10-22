/**
 * Letter templates: the catalogue of letter kinds, and the default content for each.
 *
 * Every letter HRMS issues was previously hardcoded in letters.ts, so an organisation could
 * not change a single word. Wording that suits one company reads wrong at another, and the
 * clauses a letter of appointment needs are a matter of that organisation's policy and its
 * counsel's advice, not ours.
 *
 * A template is a title, an optional confidentiality marker, and an ordered list of typed
 * blocks. Each block type maps one-to-one onto a primitive in pdf/kit.ts, so an organisation
 * controls all of the copy while the layout, page breaks, signature block and verification
 * strip stay correct. Free-form rich text would hand those over too, and the first long
 * paragraph would push the signature onto a page of its own.
 *
 * Storage: org.data.letterTemplates[KIND]. Absent means "use the default below", so there is
 * nothing to migrate and "reset to default" is a delete.
 */

export type LetterBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "salaryTable"; annual?: boolean }
  | { type: "revisionTable" }
  | { type: "settlementTable" }
  | { type: "detailGrid"; pairs: [string, string][] }
  | { type: "note"; text: string }
  | { type: "signature" }
  | { type: "acceptance" };

export interface LetterTemplate {
  title: string;
  /** Small uppercase stamp, e.g. "Private & confidential". Null for letters meant to be shown. */
  marker: string | null;
  /** Recipient block (name, designation, address). Off for "To Whomsoever It May Concern" letters. */
  showRecipient: boolean;
  /** Lines of the recipient block, token-substituted. Only used when showRecipient. */
  recipientLines?: string[];
  /**
   * Which date is printed at the top of the letter.
   *
   * "issue" is the day it is generated, which is the convention for correspondence and the
   * only option that used to exist. It is wrong for an appointment letter that is produced
   * weeks after the fact, or reprinted years later: the reader takes the date at the top as
   * the date of the appointment. Organisations differ on this, so it is a per-letter choice.
   */
  dateSource?: "issue" | "joining" | "effective" | "lastWorkingDay";
  blocks: LetterBlock[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface LetterKindSpec {
  key: string;
  label: string;
  /** What this letter is for, shown above the editor. */
  description: string;
  /** Document category the issued PDF is filed under. */
  category: string;
  /** Blocks that make no sense for this kind, hidden from the editor's block picker. */
  allowedDynamicBlocks: string[];
  group: "Joining" | "During employment" | "Exit";
}

export const LETTER_KINDS: LetterKindSpec[] = [
  {
    key: "OFFER_LETTER",
    label: "Offer / letter of appointment",
    description: "Issued when someone is hired, stating the role, start date and compensation.",
    category: "OFFER_LETTER",
    allowedDynamicBlocks: ["salaryTable", "acceptance"],
    group: "Joining",
  },
  {
    key: "CONFIRMATION_LETTER",
    label: "Confirmation of employment",
    description: "Issued when probation is completed successfully and employment is made permanent.",
    category: "CONFIRMATION_LETTER",
    allowedDynamicBlocks: ["salaryTable"],
    group: "During employment",
  },
  {
    key: "PROBATION_EXTENSION_LETTER",
    label: "Probation extension",
    description: "Issued when probation is extended rather than confirmed.",
    category: "PROBATION_EXTENSION_LETTER",
    allowedDynamicBlocks: [],
    group: "During employment",
  },
  {
    key: "APPRAISAL_LETTER",
    label: "Appraisal / compensation revision",
    description: "Issued after a review, stating the revised compensation and its effective date.",
    category: "APPRAISAL_LETTER",
    allowedDynamicBlocks: ["revisionTable", "salaryTable"],
    group: "During employment",
  },
  {
    key: "RELIEVING_LETTER",
    label: "Relieving and experience letter",
    description: "Issued on exit, confirming service and that the person is relieved of duties.",
    category: "RELIEVING_LETTER",
    allowedDynamicBlocks: [],
    group: "Exit",
  },
  {
    key: "EXPERIENCE_LETTER",
    label: "Experience certificate",
    description:
      "Certifies service only. Used where a relieving letter would overstate matters, such as an end of contract or a termination.",
    category: "EXPERIENCE_LETTER",
    allowedDynamicBlocks: [],
    group: "Exit",
  },
  {
    key: "TERMINATION_LETTER",
    label: "Termination of employment",
    description: "Issued when the organisation ends the employment.",
    category: "TERMINATION_LETTER",
    allowedDynamicBlocks: [],
    group: "Exit",
  },
  {
    key: "RETIREMENT_LETTER",
    label: "Superannuation / retirement",
    description: "Issued on retirement, recording the organisation's appreciation.",
    category: "RETIREMENT_LETTER",
    allowedDynamicBlocks: [],
    group: "Exit",
  },
  {
    key: "ABSCONDING_LETTER_1",
    label: "Absence notice (first warning)",
    description: "First formal notice to someone absent without approval or intimation.",
    category: "ABSCONDING_LETTER",
    allowedDynamicBlocks: [],
    group: "Exit",
  },
  {
    key: "ABSCONDING_LETTER_2",
    label: "Absence notice (final warning)",
    description: "Final notice before treating the absence as abandonment of service.",
    category: "ABSCONDING_LETTER",
    allowedDynamicBlocks: [],
    group: "Exit",
  },
  {
    key: "SETTLEMENT_STATEMENT",
    label: "Full and final settlement",
    description: "Statement of dues on exit. The figures are computed, only the wording is editable.",
    category: "SETTLEMENT_STATEMENT",
    allowedDynamicBlocks: ["settlementTable"],
    group: "Exit",
  },
];

export const LETTER_KIND_KEYS = LETTER_KINDS.map((k) => k.key);
export const letterKind = (key: string) => LETTER_KINDS.find((k) => k.key === key);

/**
 * Default content for each kind.
 *
 * Written to be professionally usable as-is for an Indian employer, and deliberately
 * conservative: statements an organisation cannot necessarily stand behind (conduct
 * appraisals in a relieving letter, dues settled in an experience certificate) are kept out
 * of the letters where they would not always be true. Any organisation can edit all of it.
 */
export const DEFAULT_TEMPLATES: Record<string, LetterTemplate> = {
  OFFER_LETTER: {
    title: "Letter of Appointment",
    marker: "Private & confidential",
    showRecipient: true,
    dateSource: "joining",
    recipientLines: ["{{employee.fullName}}", "{{employee.designation}}", "{{employee.currentAddress}}", "{{employee.personalEmail}}"],
    blocks: [
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text:
          "We are pleased to offer you the position of {{employee.designation}} at {{org.legalName}}, on a {{employee.employmentType}} basis, with effect from {{employee.joiningDate}}. Your employee code is {{employee.code}}.",
      },
      { type: "heading", text: "Compensation" },
      { type: "salaryTable", annual: true },
      { type: "heading", text: "Terms" },
      {
        type: "bullets",
        items: [
          "This offer is subject to satisfactory verification of your documents and references.",
          "Your employment is governed by the company's policies as amended from time to time.",
          "Your appointment is effective from {{employee.joiningDate}}, subject to your joining on that date.",
          "Either party may end the employment in accordance with the notice period set out in the policies.",
          "Statutory deductions apply as required by law and are shown on each month's payslip.",
        ],
      },
      {
        type: "paragraph",
        text:
          "We look forward to a long and rewarding association. Please sign below and return a copy as a token of your acceptance.",
      },
      { type: "signature" },
      { type: "acceptance" },
    ],
  },

  CONFIRMATION_LETTER: {
    title: "Letter of Confirmation of Employment",
    marker: "Private & confidential",
    showRecipient: true,
    recipientLines: ["{{employee.fullName}}", "{{employee.designation}}", "{{employee.department}}"],
    blocks: [
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text:
          "We are pleased to inform you that, following a review of your performance during your probationary period, your employment with {{org.legalName}} as {{employee.designation}} is confirmed with effect from {{letter.effectiveDate}}.",
      },
      {
        type: "paragraph",
        text:
          "Your appointment is now permanent and you are eligible for all benefits applicable to confirmed employees, in accordance with the company's policies as amended from time to time.",
      },
      { type: "heading", text: "Terms" },
      {
        type: "bullets",
        items: [
          "All other terms and conditions of your appointment remain unchanged.",
          "The notice period applicable to confirmed employees now applies to either party.",
          "Your continued employment remains subject to the company's policies and codes of conduct.",
        ],
      },
      {
        type: "paragraph",
        text:
          "We thank you for your contribution during your probationary period and look forward to your continued success with us.",
      },
      { type: "signature" },
    ],
  },

  PROBATION_EXTENSION_LETTER: {
    title: "Extension of Probationary Period",
    marker: "Private & confidential",
    showRecipient: true,
    recipientLines: ["{{employee.fullName}}", "{{employee.designation}}", "{{employee.department}}"],
    blocks: [
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text:
          "Following a review of your performance during your probationary period with {{org.legalName}}, we are writing to inform you that your probation is extended with effect from {{letter.effectiveDate}}.",
      },
      {
        type: "paragraph",
        text:
          "This extension is intended to give you a further opportunity to meet the expectations of your role as {{employee.designation}}. Your reporting manager will agree specific objectives with you and will review your progress at the end of the extended period.",
      },
      { type: "heading", text: "Terms" },
      {
        type: "bullets",
        items: [
          "All other terms and conditions of your appointment remain unchanged.",
          "Your employment remains subject to the notice period applicable during probation.",
          "A further review will be carried out before the end of the extended period.",
        ],
      },
      {
        type: "paragraph",
        text: "We encourage you to make full use of the support available to you, and we wish you every success.",
      },
      { type: "signature" },
    ],
  },

  APPRAISAL_LETTER: {
    title: "Appraisal & Compensation Revision Letter",
    marker: "Private & confidential",
    showRecipient: true,
    recipientLines: ["{{employee.fullName}}", "{{employee.designation}}", "{{employee.department}}"],
    blocks: [
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text:
          "Congratulations. Following your performance review, we are pleased to inform you that your compensation as {{employee.designation}} has been revised, effective {{letter.effectiveDate}}.",
      },
      { type: "heading", text: "Revision summary" },
      { type: "revisionTable" },
      { type: "heading", text: "Revised compensation (monthly)" },
      { type: "salaryTable", annual: false },
      {
        type: "paragraph",
        text:
          "All other terms of your employment remain unchanged. We deeply value your contribution and look forward to your continued success.",
      },
      { type: "signature" },
    ],
  },

  RELIEVING_LETTER: {
    title: "Relieving & Experience Letter",
    marker: null,
    showRecipient: false,
    blocks: [
      { type: "paragraph", text: "To Whomsoever It May Concern," },
      {
        type: "paragraph",
        text:
          "This is to certify that {{employee.fullName}} (Employee Code: {{employee.code}}) was employed with {{org.legalName}} as {{employee.designation}}, from {{employee.joiningDate}} to {{letter.lastWorkingDay}}.",
      },
      {
        type: "paragraph",
        text:
          "During the tenure, {{employee.firstName}} was found to be sincere, hardworking and professional in conduct. All company dues have been settled and {{employee.firstName}} is relieved of all duties effective {{letter.lastWorkingDay}}.",
      },
      {
        type: "paragraph",
        text:
          "We thank {{employee.firstName}} for the contribution to {{org.legalName}} and wish {{employee.pronounThem}} success in all future endeavours.",
      },
      { type: "signature" },
    ],
  },

  EXPERIENCE_LETTER: {
    title: "Experience Certificate",
    marker: null,
    showRecipient: false,
    blocks: [
      { type: "paragraph", text: "To Whomsoever It May Concern," },
      {
        type: "paragraph",
        text:
          "This is to certify that {{employee.fullName}} (Employee Code: {{employee.code}}) was employed with {{org.legalName}} as {{employee.designation}}, from {{employee.joiningDate}} to {{letter.lastWorkingDay}}.",
      },
      {
        type: "paragraph",
        text:
          "During this period, {{employee.firstName}} carried out the assigned responsibilities diligently and professionally. We wish {{employee.firstName}} the very best for the future.",
      },
      { type: "signature" },
    ],
  },

  TERMINATION_LETTER: {
    title: "Letter of Termination of Employment",
    marker: "Private & confidential",
    showRecipient: true,
    recipientLines: ["{{employee.fullName}}", "{{employee.designation}}", "{{employee.department}}"],
    blocks: [
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text:
          "This letter is to formally notify you that your employment with {{org.legalName}} as {{employee.designation}} is terminated with effect from {{letter.lastWorkingDay}}.",
      },
      { type: "paragraph", text: "Details: {{letter.reason}}" },
      {
        type: "paragraph",
        text:
          "You are requested to complete the exit clearance formalities and return all company property on or before your last working day. Your full and final settlement will be processed as per company policy.",
      },
      { type: "paragraph", text: "We thank you for your services and wish you well in your future endeavours." },
      { type: "signature" },
    ],
  },

  RETIREMENT_LETTER: {
    title: "Letter of Superannuation (Retirement)",
    marker: null,
    showRecipient: true,
    recipientLines: ["{{employee.fullName}}", "{{employee.designation}}", "{{employee.department}}"],
    blocks: [
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text:
          "On the occasion of your retirement from {{org.legalName}} effective {{letter.lastWorkingDay}}, we place on record our sincere appreciation for your dedicated service as {{employee.designation}}, from {{employee.joiningDate}}.",
      },
      {
        type: "paragraph",
        text:
          "Your contribution over the years has been invaluable. We wish you a healthy, happy and fulfilling retirement.",
      },
      { type: "signature" },
    ],
  },

  ABSCONDING_LETTER_1: {
    title: "Absence Notice (First Warning)",
    marker: "Private & confidential",
    showRecipient: true,
    recipientLines: ["{{employee.fullName}}", "{{employee.designation}}", "{{employee.department}}", "{{employee.currentAddress}}"],
    blocks: [
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text:
          "Our records indicate that you have been absent from work without prior approval or intimation for {{letter.daysAbsent}} consecutive days. This is treated as a serious breach of your terms of employment with {{org.legalName}}.",
      },
      {
        type: "paragraph",
        text:
          "You are directed to report to duty immediately and explain your absence in writing. Failure to do so will lead to further disciplinary action, including termination on grounds of abandonment of service.",
      },
      { type: "signature" },
    ],
  },

  ABSCONDING_LETTER_2: {
    title: "Absence Notice (Final Warning)",
    marker: "Private & confidential",
    showRecipient: true,
    recipientLines: ["{{employee.fullName}}", "{{employee.designation}}", "{{employee.department}}", "{{employee.currentAddress}}"],
    blocks: [
      { type: "paragraph", text: "Dear {{employee.firstName}}," },
      {
        type: "paragraph",
        text:
          "Our records indicate that you have been absent from work without prior approval or intimation for {{letter.daysAbsent}} consecutive days. This is treated as a serious breach of your terms of employment with {{org.legalName}}.",
      },
      {
        type: "paragraph",
        text:
          "This is the final notice. If you fail to report to duty or provide a satisfactory explanation within 3 days of this letter, the company will treat you as having abandoned your employment and your services will be terminated without further notice.",
      },
      { type: "signature" },
    ],
  },

  SETTLEMENT_STATEMENT: {
    title: "Full & Final Settlement Statement",
    marker: "Private & confidential",
    showRecipient: true,
    recipientLines: [
      "{{employee.fullName}}",
      "Employee code: {{employee.code}}",
      "Last working day: {{letter.lastWorkingDay}}",
    ],
    blocks: [
      { type: "settlementTable" },
      { type: "note", text: "Estimate only, excludes statutory components (gratuity, PF, TDS)." },
      { type: "signature" },
    ],
  },
};

/**
 * The template an org actually uses for a kind: its own override, else the default.
 * Stored overrides are shallow-merged over the default so a template saved before a new
 * field existed still renders.
 */
export function templateFor(org: any, kind: string): LetterTemplate {
  const base = DEFAULT_TEMPLATES[kind];
  if (!base) throw new Error(`Unknown letter kind: ${kind}`);
  const stored = org && org.letterTemplates && org.letterTemplates[kind];
  return stored ? { ...base, ...stored } : base;
}

/** Has this org customised the given kind? Drives the "Default / Customised" badge. */
export const isCustomised = (org: any, kind: string) =>
  !!(org && org.letterTemplates && org.letterTemplates[kind]);
