import type { Operator } from "@open-hrms/types";

/**
 * Whether this operator may change things. SUPPORT is read-only: the API
 * answers 403 to every write it attempts, so the console must not offer
 * those actions in the first place (a button that always fails is a bug).
 */
export function canOperate(admin: Pick<Operator, "role"> | null | undefined): boolean {
  return admin?.role === "OPERATOR";
}

/** Operators cannot disable themselves (the API refuses it too). */
export function canChangeOperatorStatus(
  admin: Pick<Operator, "id" | "role"> | null | undefined,
  target: Pick<Operator, "id">
): boolean {
  return canOperate(admin) && admin?.id !== target.id;
}
