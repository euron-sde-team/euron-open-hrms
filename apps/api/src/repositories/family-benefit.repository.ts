import { Repository } from "./repository";

/** Data access for `family_benefits`: one enrolment per employee. */
export class FamilyBenefitRepository extends Repository {
  /** employeeId is a hot col (indexed). */
  forEmployee(employeeId: string) {
    return this.where({ employeeId }).one();
  }
}
