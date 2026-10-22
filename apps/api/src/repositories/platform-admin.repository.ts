import { Repository } from "./repository";

/** Data access for `platform_admins`. Domain-specific queries belong here. */
export class PlatformAdminRepository extends Repository {
  /** Exact match on the (already lower-cased) sign-in email, a hot column. */
  findByEmail(email: string) {
    return this.where({ email }).one();
  }
}
