/** Asset provisioning & submission: laptops, devices, access cards, etc. */
import type { RequestContext } from "../core/context";
import { bad, notFound, forbidden } from "../core/util";
import { isStaff } from "../middleware/auth";
import { notifyEmployee } from "./notification.service";
import { OPEN_STATUSES } from "../domain/onboarding-case";

const CATS = ["LAPTOP", "MONITOR", "PHONE", "ACCESS_CARD", "HEADSET", "SIM", "OTHER"];

async function nameMap(ctx: RequestContext) {
  const emps = await ctx.data.employees.all();
  return Object.fromEntries(emps.map((e) => [e.id, `${e.firstName} ${e.lastName || ""}`.trim()]));
}

/** A joiner's display name from their invite. */
const joinerName = (inv) => (inv ? `${inv.firstName || ""} ${inv.lastName || ""}`.trim() || inv.personalEmail : "New joiner");

/**
 * Names for assets staged against an onboarding case rather than an employee.
 *
 * Without this a day-one laptop shows as "Unassigned" in the register, which is indisputably
 * worse than the problem it solves: HR cannot tell whose it is until the person is hired.
 */
async function caseNameMap(ctx: RequestContext) {
  const cases = await ctx.data.onboardingCases.all();
  const invites = await ctx.data.onboardingInvites.all();
  const inviteById = Object.fromEntries(invites.map((i) => [i.id, i]));
  const out = {};
  for (const c of cases) {
    const inv = c.inviteId ? inviteById[c.inviteId] : null;
    out[c.id] = joinerName(inv);
  }
  return out;
}

const loadAsset = async (ctx: RequestContext, id: string) => {
  const a = await ctx.data.assets.byId(id);
  if (!a) throw notFound("Asset not found");
  return a;
};

/** Staff: all (filtered by employeeId / caseId / status); employee: own. */
export async function listAssets(ctx: RequestContext, q: { employeeId?: unknown; caseId?: unknown; status?: unknown }) {
  const names = await nameMap(ctx);
  const caseNames = await caseNameMap(ctx);
  let list = await ctx.data.assets.all();
  if (!isStaff(ctx.user)) list = list.filter((a) => a.employeeId === ctx.user.employeeId);
  else if (q.employeeId) list = list.filter((a) => a.employeeId === q.employeeId);
  if (q.caseId) list = list.filter((a) => a.caseId === q.caseId);
  if (q.status) list = list.filter((a) => a.status === q.status);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return list.map((a) => ({
    ...a,
    employeeName: names[a.employeeId] || (a.caseId ? caseNames[a.caseId] : null) || "Unassigned",
    // Says plainly that this is staged for somebody who has not started yet.
    pendingJoiner: !a.employeeId && !!a.caseId,
  }));
}

/**
 * Staff: provision an asset.
 *
 * Two targets: `employeeId` for somebody on the roster, or `caseId` for a JOINER who has not
 * been hired yet. The second exists because the commonest asset handover in any company is
 * the day-one laptop, and until now it could not be staged: a candidate has no `employees`
 * row until HR approves their onboarding form, so there was nothing to provision against and
 * the acknowledge half of the assets section was dead for exactly the population it was
 * designed for. A case-provisioned asset holds `employeeId: null` + `caseId`; commitCase()
 * attaches it to the employee record it creates.
 */
export async function provisionAsset(ctx: RequestContext, input: Record<string, any>) {
  const base = {
    category: CATS.includes(input.category) ? input.category : "OTHER",
    name: input.name || "Asset", serial: input.serial || "", condition: input.condition || "New",
    status: "PROVISIONED", assignedAt: new Date().toISOString(), acknowledgedAt: null, returnedAt: null, notes: input.notes || "",
  };

  if (input.caseId) {
    const c = await ctx.data.onboardingCases.byId(input.caseId);
    if (!c) throw notFound("Onboarding case not found");
    if (c.employeeId) throw bad("That person is already on the roster. Provision it to them directly.");
    if (!OPEN_STATUSES.includes(c.status) && c.status !== "SUBMITTED") {
      throw bad("That onboarding form is closed, so nothing more can be issued against it.");
    }
    const a = await ctx.data.assets.create({ ...base, employeeId: null, caseId: c.id });
    // No notification: a joiner has no login yet. They see it on their onboarding form.
    const inv = c.inviteId ? await ctx.data.onboardingInvites.byId(c.inviteId) : null;
    return { ...a, employeeName: joinerName(inv) };
  }

  const e = await ctx.data.employees.byId(input.employeeId);
  if (!e) throw notFound("Employee not found");
  const a = await ctx.data.assets.create({ ...base, employeeId: e.id });
  await notifyEmployee(ctx.repos, e.id, { type: "ASSET", title: "Asset assigned to you", body: `${a.name} (${a.category}) was provisioned. Please acknowledge receipt.`, link: "assets" });
  return { ...a, employeeName: `${e.firstName} ${e.lastName || ""}`.trim() };
}

/** The holder (or staff) confirms receipt. */
export async function acknowledgeAsset(ctx: RequestContext, id: string) {
  const a = await loadAsset(ctx, id);
  if (a.employeeId !== ctx.user.employeeId && !isStaff(ctx.user)) throw forbidden();
  if (a.status !== "PROVISIONED") throw bad("Already acknowledged");
  return ctx.data.assets.update(a.id, { status: "IN_USE", acknowledgedAt: new Date().toISOString() });
}

/** The holder (or staff) submits/returns the asset. */
export async function submitAsset(ctx: RequestContext, id: string, input: { condition?: string; notes?: string }) {
  const a = await loadAsset(ctx, id);
  if (a.employeeId !== ctx.user.employeeId && !isStaff(ctx.user)) throw forbidden();
  if (!["PROVISIONED", "IN_USE"].includes(a.status)) throw bad("Asset is not in use");
  return ctx.data.assets.update(a.id, { status: "SUBMITTED", condition: input.condition || a.condition, notes: input.notes || a.notes });
}

/** Staff: accept a return, or mark the asset lost. */
export async function returnAsset(ctx: RequestContext, id: string, input: { lost?: unknown; condition?: string }) {
  const a = await loadAsset(ctx, id);
  const status = input.lost ? "LOST" : "RETURNED";
  return ctx.data.assets.update(a.id, { status, returnedAt: new Date().toISOString(), condition: input.condition || a.condition });
}

export async function updateAsset(ctx: RequestContext, id: string, input: Record<string, any>) {
  const a = await loadAsset(ctx, id);
  const patch = {};
  for (const k of ["name", "serial", "condition", "notes"]) if (input[k] !== undefined) patch[k] = input[k];
  return ctx.data.assets.update(a.id, patch);
}
