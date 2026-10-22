/**
 * Access revocation: disable the login account of employees who have exited or
 * whose last working day has passed. Runs on an interval (index.js) and is also
 * invoked immediately when a separation is completed.
 */
import { systemRepos, repos } from "../repositories/base.repository";
import { db } from "../db/kysely";
import { logger } from "../core/logger";
import { activeAdmins } from "../services/org-guard.service";
import { resolvePermissions, hasPerm } from "../security/rbac";

const nowIso = () => new Date().toISOString();

// Arbitrary fixed key identifying the "access sweep" advisory lock. pg_try_advisory_lock
// is per-session and non-blocking: only one replica acquires it, the rest skip.
const SWEEP_LOCK_KEY = 778001;

/**
 * Disable the login for one employee in an org (no-op if none / already disabled).
 *
 * Refuses to revoke the last administrator. Administrators are ordinary employees now, so
 * this function can reach one: an exit recorded before that change, or a separation left
 * open past its last working day, would otherwise have this background sweep quietly
 * disable the only account able to administer the workspace, with nobody left to undo it.
 * Skipping is the safe failure here, and it is logged loudly rather than silently.
 */
async function revokeForEmployee(r, employeeId) {
  const user = await r.users.findOne((u) => u.employeeId === employeeId && u.status !== "DISABLED");
  if (!user) return false;
  const others = await activeAdmins(r, user.id);
  if (!others.length && hasPerm(resolvePermissions(user, await r.organizations.byId(r.ctx && r.ctx.orgId) || {}), "*")) {
    logger.warn(
      { orgId: r.ctx && r.ctx.orgId, userId: user.id, employeeId },
      "access revocation skipped: this is the workspace's only administrator"
    );
    return false;
  }
  await r.users.update(user.id, { status: "DISABLED", credentialsChangedAt: nowIso() }); // bumps creds -> kills sessions
  return true;
}

/** Sweep every org: revoke access for completed/absconded exits and notice-period staff past their LWD. */
async function revokeExitedAccess() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const orgs = await systemRepos().organizations.all();
    let disabled = 0;
    for (const org of orgs) {
      const r = repos({ orgId: org.id });
      const seps = await r.separations.all();
      // Finalized exits, OR notice-period staff whose last working day has PASSED
      // (strictly before today) -- people keep access through their final day.
      const due = seps.filter((s) =>
        ["COMPLETED", "ABSCONDED"].includes(s.status) ||
        (["NOTICE_PERIOD", "IN_CLEARANCE"].includes(s.status) && s.lastWorkingDay && s.lastWorkingDay < today));
      for (const s of due) {
        // For a past-LWD notice that HR never completed, exit the employee too so
        // their status stays consistent with the now-disabled login.
        if (["NOTICE_PERIOD", "IN_CLEARANCE"].includes(s.status)) {
          const e = await r.employees.byId(s.employeeId);
          if (e && e.status !== "EXITED") await r.employees.update(e.id, { status: "EXITED" });
        }
        if (await revokeForEmployee(r, s.employeeId)) disabled++;
      }
    }
    if (disabled) logger.info({ disabled }, "access revocation: disabled exited logins");
    return disabled;
  } catch (e) {
    logger.error({ err: e }, "access revocation sweep failed");
    return 0;
  }
}

/**
 * Interval-safe wrapper: run the sweep ONLY if this replica can grab the advisory
 * lock, so N replicas don't all sweep every org simultaneously (duplicate writes).
 * Uses a session-level advisory lock on one pinned connection, released in `finally`.
 */
async function revokeExitedAccessIfLeader() {
  try {
    return await db.connection().execute(async (conn) => {
      const got = await conn
        .selectNoFrom((eb) => eb.fn<boolean>("pg_try_advisory_lock", [eb.lit(SWEEP_LOCK_KEY)]).as("locked"))
        .executeTakeFirst();
      if (!got || !(got as any).locked) {
        logger.debug("access sweep: another replica holds the lock, skipping");
        return 0;
      }
      try {
        return await revokeExitedAccess();
      } finally {
        await conn.selectNoFrom((eb) => eb.fn("pg_advisory_unlock", [eb.lit(SWEEP_LOCK_KEY)]).as("u")).executeTakeFirst();
      }
    });
  } catch (e) {
    logger.error({ err: e }, "access sweep leader-check failed");
    return 0;
  }
}

export { revokeExitedAccess, revokeExitedAccessIfLeader, revokeForEmployee };
