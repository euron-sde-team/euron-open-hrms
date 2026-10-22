/**
 * Starter content: the baseline configuration packs (leave types, holidays,
 * policies, benefits, departments, onboarding forms). Both the tenant settings
 * page and the operator console read the same dry-run response.
 */

export type PackId =
  | "LEAVE_TYPES"
  | "HOLIDAYS"
  | "POLICIES"
  | "BENEFITS"
  | "DEPARTMENTS"
  | "ONBOARDING_TEMPLATE";

export interface PackMeta {
  id: PackId;
  label: string;
  description: string;
  /** Packs the caller must supply options for (holidays needs year + state). */
  needsOptions?: boolean;
}

export interface PackResult {
  pack: PackId;
  added: number;
  skipped: number;
  /** Rows that already existed and were refreshed from the source (holidays only). */
  updated?: number;
  /** HOLIDAYS only: which gazette the rows were transcribed from. */
  sourceLabel?: string;
  sourceCitation?: string;
  /** HOLIDAYS only: true when the national gazette stood in for a missing state one. */
  national?: boolean;
  /** Set when a pack cannot be offered at all, with the reason to show the user. */
  unavailable?: string;
  note?: string;
}

/** Dry-run response. `packs` is always the full catalogue, not the selection. */
export interface StarterContentPlan {
  packs: PackMeta[];
  states: { code: string; name: string }[];
  verifiedYears: number[];
  year: number;
  state: string | null;
  plan: PackResult[];
}

export interface StarterContentApplyResult {
  added: number;
  results: PackResult[];
}
