import { Repository } from "./repository";

/**
 * Data access for `users` (login accounts).
 *
 * Bound to a workspace store, every query is scoped to that workspace. Bound to the system
 * store (`createRepositories(systemRepos())`), the same methods answer platform-wide, which
 * is what sign-in and the email-uniqueness checks need: sign-in is by email with no
 * workspace picker, so a login address is unique across the whole system.
 */
export class UserRepository extends Repository {
  /** The login with this address. `email` is a hot column with a unique index. */
  findByEmail(email: string) {
    return this.where({ email }).one();
  }

  /** Logins holding any of these addresses, in one IN query. */
  findByEmails(emails: string[]) {
    return this.where({ email: emails }).list();
  }

  /** The login linked to an employee record. `employeeId` is a hot column (indexed). */
  findByEmployeeId(employeeId: string) {
    return this.where({ employeeId }).one();
  }

  /** Workspace logins, excluding vendor logins (those belong to the vendor module). */
  staffAndEmployeeLogins() {
    return this.find((u) => u.role !== "VENDOR");
  }

  /** Every login keyed by the employee it is linked to; unlinked logins are left out. */
  async byEmployee(): Promise<Record<string, any>> {
    const m: Record<string, any> = {};
    for (const u of await this.all()) if (u.employeeId) m[u.employeeId] = u;
    return m;
  }
}
