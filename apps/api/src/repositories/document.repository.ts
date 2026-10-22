import { Repository, type Row } from "./repository";

/** A `documents` row: the fields the domain rules read, over the open jsonb document. */
export type DocumentRow = Row & {
  employeeId?: string | null;
  category?: string | null;
  visibility?: string | null;
  departmentIds?: string[] | null;
  uploadedBy?: string | null;
  verified?: boolean;
};

/** Data access for `documents`. */
export class DocumentRepository extends Repository<DocumentRow> {
  /** Every document filed against one employee (employeeId is a hot column). */
  forEmployee(employeeId: string) {
    // NB: the structured builder exposes .list()/.one()/.count(), not .all().
    return this.where({ employeeId }).list();
  }

  /** Every document in one category, across the workspace. */
  ofCategory(category: string) {
    return this.find((d) => d.category === category);
  }

  /** Any one document of `category` on file for an employee, or null. */
  findForEmployee(employeeId: string, category: string) {
    return this.findOne((d) => d.employeeId === employeeId && d.category === category);
  }
}
