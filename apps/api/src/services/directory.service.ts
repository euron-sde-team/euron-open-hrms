/** Company directory, org-chart and common org info, visible to everyone. */
import type { RequestContext } from "../core/context";
import { managerOf } from "../domain/manager";

const nameOf = (e) => (e ? `${e.firstName} ${e.lastName || ""}`.trim() : null);

async function departmentsById(ctx: RequestContext) {
  const depts = await ctx.data.departments.all();
  return Object.fromEntries(depts.map((d) => [d.id, d]));
}

/** Everyone in the org with work contact details, sorted by name. */
export async function listDirectory(ctx: RequestContext) {
  const emps = await ctx.data.employees.active();
  const deptById = await departmentsById(ctx);
  const byId = Object.fromEntries(emps.map((e) => [e.id, e]));
  return emps.map((e) => {
    const dept = e.departmentId ? deptById[e.departmentId] : null;
    const mgrId = managerOf(e);
    const mgr = mgrId ? byId[mgrId] : null;
    return {
      id: e.id, name: nameOf(e), code: e.code, designation: e.designation || "",
      department: dept ? dept.name : "-", employmentType: e.employmentType,
      email: e.officialEmail || e.email, personalEmail: e.personalEmail || "", phone: e.phone || "",
      managerName: nameOf(mgr), location: e.currentAddress || "",
      socials: e.socials || {}, emergencyContact: e.emergencyContact || {},
      joiningDate: e.joiningDate, status: e.status,
    };
  }).sort((a, b) => (a.name as string).localeCompare(b.name as string));
}

/** Reporting hierarchy for everyone to see. */
export async function orgChart(ctx: RequestContext) {
  const emps = await ctx.data.employees.active();
  const deptById = await departmentsById(ctx);
  const nodes = emps.map((e) => {
    const dept = e.departmentId ? deptById[e.departmentId] : null;
    return {
      id: e.id, name: nameOf(e), code: e.code, designation: e.designation || "",
      department: dept ? dept.name : "-", employmentType: e.employmentType,
      managerId: managerOf(e), email: e.officialEmail || e.email,
    };
  });
  return { nodes, roots: nodes.filter((n) => !n.managerId).map((n) => n.id) };
}

/** Org details, HR contacts, offices, headcount, emergency contacts. */
export async function companyInfo(ctx: RequestContext) {
  const org = await ctx.data.organizations.byId(ctx.orgId);
  const offices = await ctx.data.offices.all();
  const departments = await ctx.data.departments.all();
  const emps = await ctx.data.employees.active();
  const hrUsers = await ctx.data.users.find((u) => u.role === "ADMIN" || u.role === "HR");
  return {
    org,
    offices,
    headcount: emps.length,
    byType: emps.reduce((a, e) => ((a[e.employmentType] = (a[e.employmentType] || 0) + 1), a), {}),
    departments: departments.map((d) => ({ name: d.name, count: emps.filter((e) => e.departmentId === d.id).length })),
    hrContacts: hrUsers.map((u) => ({ name: u.name, email: u.email, role: u.role })),
    emergencyContacts: emps
      .filter((e) => e.emergencyContact && e.emergencyContact.phone)
      .map((e) => ({ employee: nameOf(e), code: e.code, contact: e.emergencyContact })),
  };
}
