/**
 * Sign-in identity: which address a person actually logs in with.
 *
 * An employee has two addresses. The PERSONAL one is where correspondence goes before they
 * have a company inbox, and it is the address a joining invite has to reach. The OFFICIAL
 * one is their work address, and once it exists it is what they sign in with, which is how
 * every serious HR system behaves.
 *
 * `users.email` stays the single canonical login address: it carries a database unique
 * constraint and an index, so authentication remains one indexed lookup and two addresses
 * can never drift into both being valid. Changing it is therefore a deliberate, audited
 * operation rather than a side effect of editing an employee record.
 */
import { systemRepos } from "../repositories/base.repository";
import { bad } from "../core/util";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Normalise an address for storage and comparison. Empty string when absent. */
export const normaliseEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Validate an address, or throw with the field named so the error is actionable. */
export function assertEmail(value: string, label: string) {
  if (!EMAIL_RE.test(value)) throw bad(`Enter a valid ${label}`);
  return value;
}

/**
 * The address this employee signs in with: their official address when they have one,
 * otherwise their personal one. Used wherever a login is created for an employee.
 */
export const resolveLoginEmail = (employee: any) =>
  normaliseEmail(employee?.officialEmail) || normaliseEmail(employee?.personalEmail) || normaliseEmail(employee?.email);

/**
 * The address to WRITE to: official first, falling back to personal.
 *
 * Deliberately separate from resolveLoginEmail even though they currently agree, because
 * they answer different questions and diverge for a joiner: their login is the official
 * address from day one, but the joining invite has to reach the personal inbox, since they
 * cannot read a company mailbox they have not been given access to yet.
 */
export const contactEmail = (employee: any) =>
  normaliseEmail(employee?.officialEmail) || normaliseEmail(employee?.personalEmail) || normaliseEmail(employee?.email);

/** Where a joining invite goes: personal inbox first, because the work one is not reachable yet. */
export const joiningEmail = (employee: any) =>
  normaliseEmail(employee?.personalEmail) || normaliseEmail(employee?.email) || normaliseEmail(employee?.officialEmail);

/**
 * Refuse an address already spoken for.
 *
 * A login is unique platform-wide, so an address held by another workspace would pass an
 * org-scoped check and then fail at insert with a constraint error. Employee addresses are
 * checked within the org, which is where a duplicate would actually cause confusion.
 *
 * `ignore` lets a record exclude itself when being edited.
 */
export async function assertEmailAvailable(
  repos: any,
  email: string,
  ignore: { userId?: string; employeeId?: string } = {}
) {
  if (!email) return;

  /*
   * A person's own login is not a clash with themselves.
   *
   * Callers naturally pass the employee they are editing, and forget that the login attached
   * to that employee holds the very same address. Resolving it here rather than expecting
   * every caller to remember is what stops "hr@example.com is already the sign-in address for
   * someone in this workspace" being thrown at somebody editing their own joining date.
   */
  let selfUserId = ignore.userId;
  if (!selfUserId && ignore.employeeId) {
    const linked = await repos.users.where({ employeeId: ignore.employeeId }).one();
    selfUserId = linked ? linked.id : undefined;
  }

  const user = await systemRepos().users.where({ email }).one();
  if (user && user.id !== selfUserId) {
    throw bad(
      user.orgId === (repos.ctx && repos.ctx.orgId)
        ? `${email} is already the sign-in address for someone in this workspace.`
        : `${email} already has a login in another workspace. Sign-in is by email address, so it can only belong to one person.`
    );
  }
  const employees = await repos.employees.all();
  const clash = employees.find(
    (e: any) =>
      e.id !== ignore.employeeId &&
      (normaliseEmail(e.officialEmail) === email || normaliseEmail(e.personalEmail) === email || normaliseEmail(e.email) === email)
  );
  if (clash) {
    throw bad(`${email} is already on ${clash.firstName} ${clash.lastName || ""}`.trim() + "'s record.");
  }
}

/**
 * Change a login's sign-in address.
 *
 * Stamps `credentialsChangedAt`, which `auth.ts` treats as a session cut-off, so every
 * outstanding session for that account stops validating. That is deliberate: the address
 * someone authenticates with has changed, and leaving old sessions alive means the change is
 * only half applied until they next sign out. The previous address is kept in
 * `user.data.previousEmails` so support can answer "I used to log in as..." later.
 */
export async function setLoginEmail(repos: any, user: any, nextEmail: string) {
  const email = normaliseEmail(nextEmail);
  assertEmail(email, "sign-in address");
  if (email === normaliseEmail(user.email)) return { changed: false, from: user.email, to: email, user };
  await assertEmailAvailable(repos, email, { userId: user.id, employeeId: user.employeeId });

  const previous = Array.isArray(user.previousEmails) ? user.previousEmails : [];
  const updated = await repos.users.update(user.id, {
    email,
    previousEmails: [...previous, user.email].filter(Boolean).slice(-10),
    credentialsChangedAt: new Date().toISOString(),
  });
  return { changed: true, from: user.email, to: email, user: updated };
}
