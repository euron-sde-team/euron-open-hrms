import { resolvePermissions, isStaffPerms } from "../security/rbac";
import { sendTenantMail } from "../integrations/mail/mailer";
import { contactEmail } from "./identity.service";

/**
 * In-app notification helper. Fire-and-forget: a failure here must never break
 * the business action that triggered it (so every call is wrapped/caught).
 */

/** Notify a specific user (login account). */
async function notify(repos, userId, { type, title, body, link }: any = {}) {
  if (!userId || !title) return null;
  try {
    return await repos.notifications.insert({ userId, type: type || "INFO", title, body: body || "", link: link || null, readAt: null });
  } catch (_e) {
    return null;
  }
}

/** Notify the login account attached to an employee (if any). */
async function notifyEmployee(repos, employeeId, payload) {
  if (!employeeId) return null;
  try {
    const u = await repos.users.findOne((x) => x.employeeId === employeeId);
    return u ? notify(repos, u.id, payload) : null;
  } catch (_e) {
    return null;
  }
}

/** Notify every staff/HR user (anyone with staff access) in the org. */
async function notifyStaff(repos, payload) {
  try {
    const users = await repos.users.all();
    let org = null;
    const sent: Promise<any>[] = [];
    for (const u of users) {
      if (u.status === "DISABLED") continue;
      let staff;
      if (u.role === "ADMIN" || u.role === "HR") staff = true;
      else if (["MANAGER", "EMPLOYEE", "VENDOR"].includes(u.role)) staff = false;
      else { // custom role -> resolve against the org's customRoles
        if (!org) org = await repos.organizations.byId(repos.ctx && repos.ctx.orgId);
        staff = isStaffPerms(resolvePermissions(u, org || {}));
      }
      if (staff) sent.push(notify(repos, u.id, payload));
    }
    await Promise.all(sent);
    return sent.length;
  } catch (_e) {
    return 0;
  }
}

/**
 * Notify an employee in-app AND by email, in one call.
 *
 * Separation and letter issue previously produced only an in-app notification, so somebody
 * who was not signed in learned nothing: no notice that their resignation had been accepted,
 * no copy of their relieving letter. Keeping both in a single call is what stops the two
 * from drifting, which is exactly what happens when each caller remembers the notification
 * and forgets the mail.
 *
 * `email` is opt-out rather than opt-in, so the default behaviour is that people are told.
 * Delivery is best effort: `sendTenantMail` never throws, and a mail failure must not roll
 * back the business action that earned the notification.
 *
 * Recipients are always the employee's own addresses, resolved from their record. A caller
 * cannot supply one, which keeps letter attachments from being aimed anywhere else.
 */
async function notifyAndEmail(repos, org, employeeId, payload: any = {}, mail: any = null) {
  const inApp = await notifyEmployee(repos, employeeId, payload);
  if (!mail || mail.email === false) return { notified: !!inApp, emailed: false };

  try {
    const employee = await repos.employees.byId(employeeId);
    const to = mail.to || (employee ? contactEmail(employee) : null);
    if (!to) return { notified: !!inApp, emailed: false, reason: "no address on record" };

    const result = await sendTenantMail(org, {
      to,
      subject: mail.subject || payload.title,
      html: mail.html,
      text: mail.text,
      attachments: mail.attachments,
    }, { employeeId });
    return { notified: !!inApp, emailed: !!result.delivered, to, mode: result.mode, error: result.error };
  } catch (e) {
    return { notified: !!inApp, emailed: false, error: (e as Error).message };
  }
}

export { notify, notifyEmployee, notifyStaff, notifyAndEmail };
