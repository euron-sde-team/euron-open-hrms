/**
 * Attendance: geofenced self check-in / check-out, the employee's own month, the
 * org-wide day view for staff, and HR regularization.
 */
import type { RequestContext } from "../core/context";
import { bad, forbidden, distanceMeters, todayStr } from "../core/util";
import { isStaff } from "../middleware/auth";
import { notifyEmployee } from "./notification.service";
import { fullName } from "../domain/person";

const truthy = (v) => v === true || v === "true";

/**
 * Resolve the office to check against and whether the point is inside its fence.
 * If the employee is assigned to a specific office (officeId), check that one;
 * otherwise fall back to the nearest office in the org.
 */
async function geofence(ctx: RequestContext, lat, lng, preferredOfficeId) {
  const offices = await ctx.data.offices.all();
  if (preferredOfficeId) {
    const assigned = offices.find((o) => o.id === preferredOfficeId);
    if (assigned) {
      const d = Math.round(distanceMeters({ lat, lng }, { lat: assigned.lat, lng: assigned.lng }));
      return { office: assigned, distance: d, within: d <= assigned.radiusMeters };
    }
  }
  let nearest: any = null, best = Infinity;
  for (const o of offices) {
    const d = distanceMeters({ lat, lng }, { lat: o.lat, lng: o.lng });
    if (d < best) { best = d; nearest = o; }
  }
  if (!nearest) return { office: null, distance: null, within: false };
  return { office: nearest, distance: Math.round(best), within: best <= nearest.radiusMeters };
}

async function myEmployee(ctx: RequestContext) {
  if (!ctx.user.employeeId) throw bad("Only employees can mark attendance");
  const e = await ctx.data.employees.byId(ctx.user.employeeId);
  if (!e) throw bad("Employee record missing");
  return e;
}

function requireStaff(ctx: RequestContext) {
  if (!isStaff(ctx.user)) throw forbidden("Staff access required");
}

export async function checkIn(ctx: RequestContext, input: { lat?: unknown; lng?: unknown; halfDay?: unknown }) {
  const e = await myEmployee(ctx);
  const lat = Number(input.lat), lng = Number(input.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) throw bad("Location (lat, lng) is required to check in");
  const date = todayStr();
  // Indexed lookup (employeeId+date are hot columns), avoids scanning the org's
  // entire attendance history in JS on this high-traffic daily endpoint.
  let rec = await ctx.data.attendance.forEmployeeOn(e.id, date);
  if (rec && rec.checkInAt) throw bad("Already checked in today");
  const g = await geofence(ctx, lat, lng, e.officeId);
  const payload = {
    checkInAt: new Date().toISOString(),
    checkInLat: lat, checkInLng: lng,
    checkInOffice: g.office ? g.office.name : null,
    checkInDistance: g.distance,
    withinFence: g.within,
    halfDay: truthy(input.halfDay),
    status: g.within ? "PRESENT" : "REMOTE",
  };
  if (rec) rec = await ctx.data.attendance.update(rec.id, payload);
  else rec = await ctx.data.attendance.create({ employeeId: e.id, date, ...payload, checkOutAt: null, workedMinutes: 0 });
  return {
    ...rec,
    message: g.within
      ? `Checked in at ${g.office.name} (${g.distance}m from centre).`
      : `Checked in OUTSIDE the office geofence (${g.distance != null ? g.distance + "m from " + (g.office ? g.office.name : "office") : "no office set"}). Marked as REMOTE.`,
  };
}

export async function checkOut(ctx: RequestContext, input: { lat?: unknown; lng?: unknown }) {
  const e = await myEmployee(ctx);
  const date = todayStr();
  const rec = await ctx.data.attendance.forEmployeeOn(e.id, date);
  if (!rec || !rec.checkInAt) throw bad("You have not checked in today");
  if (rec.checkOutAt) throw bad("Already checked out today");
  const lat = input.lat != null ? Number(input.lat) : null;
  const lng = input.lng != null ? Number(input.lng) : null;
  const out = new Date();
  const worked = Math.max(0, Math.round(((out as any) - (new Date(rec.checkInAt) as any)) / 60000));
  const updated = await ctx.data.attendance.update(rec.id, {
    checkOutAt: out.toISOString(),
    checkOutLat: lat, checkOutLng: lng,
    workedMinutes: worked,
  });
  return { ...updated, message: `Checked out. Worked ${Math.floor(worked / 60)}h ${worked % 60}m.` };
}

/** The caller's own records for a month (YYYY-MM, default this month) plus today's status. */
export async function myAttendance(ctx: RequestContext, month?: string) {
  const e = await myEmployee(ctx);
  const wanted = month || todayStr().slice(0, 7);
  // employeeId in SQL; month prefix filtered in JS over just this employee's rows.
  const list = (await ctx.data.attendance.forEmployee(e.id))
    .filter((a) => a.date.startsWith(wanted))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const today = await ctx.data.attendance.forEmployeeOn(e.id, todayStr());
  return { today: today || null, records: list };
}

/** Org-wide view of one day (staff), optionally narrowed to a department. */
export async function dayRoster(ctx: RequestContext, filter: { date?: string; departmentId?: string }) {
  requireStaff(ctx);
  const date = filter.date || todayStr();
  // Everyone on the roster except exited staff (includes ONBOARDING new hires, not
  // just ACTIVE). where() is equality-only, so filter !=EXITED in JS.
  let emps = (await ctx.data.employees.all()).filter((e) => e.status !== "EXITED");
  emps = emps.filter((e) => ctx.inScope(e)); // scoped staff: only their depts/offices
  if (filter.departmentId) emps = emps.filter((e) => e.departmentId === filter.departmentId);
  const recs = await ctx.data.attendance.onDate(date);
  const byEmp = Object.fromEntries(recs.map((r) => [r.employeeId, r]));
  const depts = await ctx.data.departments.all();
  const deptById = Object.fromEntries(depts.map((d) => [d.id, d]));
  // Employees with an approved leave covering this date show ON_LEAVE instead of ABSENT.
  const onLeave = new Set(
    (await ctx.data.leaveRequests.where({ status: "APPROVED" }).list())
      .filter((l) => l.from <= date && date <= l.to)
      .map((l) => l.employeeId)
  );
  return {
    date,
    rows: emps.map((e) => {
      const r = byEmp[e.id];
      const dept = e.departmentId ? deptById[e.departmentId] : null;
      return {
        employeeId: e.id,
        name: fullName(e),
        code: e.code,
        department: dept ? dept.name : "-",
        employmentType: e.employmentType,
        status: r ? r.status : (onLeave.has(e.id) ? "ON_LEAVE" : "ABSENT"),
        checkInAt: r ? r.checkInAt : null,
        checkOutAt: r ? r.checkOutAt : null,
        office: r ? r.checkInOffice : null,
        distance: r ? r.checkInDistance : null,
        withinFence: r ? r.withinFence : null,
        halfDay: r ? !!r.halfDay : false,
        regularized: r ? !!r.regularized : false,
        workedMinutes: r ? r.workedMinutes : 0,
      };
    }),
  };
}

/**
 * Correct or create an attendance record for an employee on a date (staff):
 * forgotten check-in, system error, on-duty, etc.
 */
export async function regularize(
  ctx: RequestContext,
  input: { employeeId?: string; date?: string; status?: string; checkInAt?: string; checkOutAt?: string; halfDay?: unknown; note?: string },
) {
  requireStaff(ctx);
  const { employeeId, date } = input;
  if (!employeeId || !date) throw bad("employeeId and date are required");
  const emp = await ctx.data.employees.byId(employeeId);
  if (!emp) throw bad("Employee not found");
  const status = ["PRESENT", "REMOTE", "ABSENT", "ON_DUTY"].includes(input.status as string) ? input.status : "PRESENT";
  const ci = input.checkInAt || null, co = input.checkOutAt || null;
  const workedMinutes = ci && co ? Math.max(0, Math.round(((new Date(co) as any) - (new Date(ci) as any)) / 60000)) : 0;
  const patch = {
    status, checkInAt: ci, checkOutAt: co, workedMinutes,
    halfDay: truthy(input.halfDay),
    regularized: true, regularizedBy: ctx.user.id, regularizedNote: input.note || "",
  };
  const existing = await ctx.data.attendance.forEmployeeOn(employeeId, date); // indexed
  const rec = existing
    ? await ctx.data.attendance.update(existing.id, patch)
    : await ctx.data.attendance.create({ employeeId, date, ...patch });
  await ctx.data.auditLog.create({ action: "ATTENDANCE_REGULARIZE", userId: ctx.user.id, meta: { employeeId, date, status } });
  await notifyEmployee(ctx.repos, employeeId, { type: "ATTENDANCE", title: "Attendance updated", body: `Your attendance for ${date} was set to ${status} by HR.`, link: "myattendance" });
  return rec;
}
