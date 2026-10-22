import { Repository } from "./repository";

/** Data access for `departments`. */
export class DepartmentRepository extends Repository {
  /** Case-insensitive name lookup; department names are unique within a workspace. */
  findByName(name: string) {
    const wanted = String(name).trim().toLowerCase();
    return this.findOne((d) => String(d.name || "").toLowerCase() === wanted);
  }
}
