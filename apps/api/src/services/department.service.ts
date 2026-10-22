/**
 * Departments: the organisational units employees belong to, each with an optional head.
 */
import type { RequestContext } from "../core/context";
import { bad, notFound } from "../core/util";

const fullName = (emp) => (emp ? `${emp.firstName} ${emp.lastName || ""}`.trim() : null);

/** Every department with its active headcount and the head's name resolved. */
export async function listDepartments(ctx: RequestContext) {
  const [departments, employees] = await Promise.all([ctx.data.departments.all(), ctx.data.employees.all()]);
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  return departments.map((d) => ({
    ...d,
    employeeCount: employees.filter((e) => e.departmentId === d.id && e.status !== "EXITED").length,
    headName: d.headId ? fullName(byId[d.headId]) : null,
  }));
}

export async function createDepartment(ctx: RequestContext, input: { name?: string; description?: string; headId?: string | null }) {
  if (!input.name) throw bad("Department name is required");
  if (await ctx.data.departments.findByName(input.name)) throw bad("A department with that name already exists");
  // headId lives in the `data` jsonb, not a hot column.
  return ctx.data.departments.create({ name: input.name, description: input.description || "", headId: input.headId || null });
}

export async function updateDepartment(ctx: RequestContext, id: string, input: { name?: string; description?: string; headId?: string | null }) {
  const department = await ctx.data.departments.byId(id);
  if (!department) throw notFound("Department not found");
  const patch: Record<string, unknown> = {};
  if (input.name != null) patch.name = input.name;
  if (input.description != null) patch.description = input.description;
  if (input.headId !== undefined) patch.headId = input.headId || null;
  return ctx.data.departments.update(department.id, patch);
}

export async function deleteDepartment(ctx: RequestContext, id: string) {
  const department = await ctx.data.departments.byId(id);
  if (!department) throw notFound("Department not found");
  if (await ctx.data.employees.countActiveInDepartment(department.id)) {
    throw bad("Cannot delete a department that still has active employees");
  }
  await ctx.data.departments.remove(department.id);
  return { ok: true };
}
