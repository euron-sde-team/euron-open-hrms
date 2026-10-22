import { Repository } from "./repository";

/** Data access for `leave_types`. */
export class LeaveTypeRepository extends Repository {
  /** Case-insensitive name lookup; leave type names are unique within a workspace. */
  findByName(name: string) {
    const wanted = String(name).toLowerCase();
    return this.findOne((t) => t.name.toLowerCase() === wanted);
  }
}
