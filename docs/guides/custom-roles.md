# Roles, permissions and scope

Access in a workspace is decided by roles. A role is a set of permission codes. Every user
holds one primary role and may hold additional roles; their permissions are the union of
all of them, resolved on every request, so a change takes effect on the user's next click.
The implementation is `apps/api/src/security/rbac.ts`.

## Built-in roles

Built-in roles are read-only.

| Role | Holds | Typical use |
| --- | --- | --- |
| `ADMIN` | `*` (every permission, now and in future) | Workspace owners |
| `HR` | Every permission except `settings.manage`, `users.manage` and `roles.manage` | People operations |
| `MANAGER` | No permissions | Line managers: they act on their direct reports through the reporting line (`reportsTo`), for example approving their team's leave and reimbursements |
| `EMPLOYEE` | No permissions | Self-service: own profile, leave, attendance, payslips, documents |
| `VENDOR` | No permissions | Vendor self-service |

A role counts as **staff** when it holds `staff.access` (or `*`). Staff see the HR side of the
app; most HR endpoints are gated on it.

## Permission codes

| Group | Code | Grants |
| --- | --- | --- |
| Core | `staff.access` | Staff access: the HR side of the app |
| People | `employees.manage` | Manage employees |
| People | `onboarding.manage` | Manage onboarding and invites |
| People | `onboarding.review` | Review and approve submitted onboarding (kept separate on purpose: approving writes statutory identifiers and a bank account onto the employee record) |
| Time and leave | `leave.approve` | Approve or reject leave |
| Time and leave | `leave.manage` | Leave types, the company's leave rules and minimum coverage |
| Time and leave | `attendance.manage` | View and regularise attendance |
| Payroll | `payroll.manage` | Run payroll and payslips |
| Payroll | `reimbursements.manage` | Approve reimbursements |
| Payroll | `vendors.manage` | Manage vendors and bills |
| Performance | `performance.manage` | Manage PIPs and appraisals |
| Performance | `wellbeing.pulse` | View the well-being pulse |
| Workplace | `documents.manage` | Manage all documents |
| Workplace | `assets.manage` | Manage assets |
| Workplace | `perks.manage` | Manage perks |
| Workplace | `aitokens.manage` | Manage AI token allowances |
| Company | `announcements.manage` | Post announcements |
| Company | `content.manage` | Manage policies, benefits, holidays |
| Company | `reports.view` | View reports and exports |
| Company | `audit.view` | View the audit log |
| Administration | `settings.manage` | Organisation settings: profile, branding, sending domain, data export |
| Administration | `users.manage` | Users, invites, role and scope assignment |
| Administration | `roles.manage` | Create, edit and delete custom roles |

`GET /api/roles/catalog` returns this catalogue grouped as above, for the role editor.

## Where each permission is enforced

This is the state of enforcement in the API today. Several codes exist in the catalogue so
roles can be designed now, while their areas are still gated by `staff.access` as a whole.
**A custom role that holds `staff.access` can use every area listed in the last row, whatever
other codes it lacks.**

| Code | Enforced at |
| --- | --- |
| `payroll.manage` | The payroll endpoints under `/api/salary` (generating, previewing, emailing and deleting payslips, salary-sheet import, pay runs, structures, payroll rules, professional tax, gratuity) |
| `onboarding.manage` | Onboarding campaigns; opening onboarding cases; onboarding templates (or `settings.manage`) |
| `onboarding.review` | Reviewing and approving submitted onboarding cases |
| `leave.manage` | Leave configuration: types, rules, coverage (or `settings.manage`) |
| `leave.approve` | Deciding leave requests, within the holder's scope. Staff (within scope) and the applicant's reporting manager can also decide; nobody can decide their own leave |
| `reimbursements.manage` | Deciding reimbursements (staff and the employee's manager can also decide) |
| `documents.manage` | Letter templates (or `settings.manage`) |
| `audit.view` | Reading the audit log |
| `settings.manage` | Organisation settings, the sending domain, letter templates, leave configuration, onboarding templates |
| `users.manage` | All of `/api/users`: listing, inviting, status, roles, scope |
| `roles.manage` | Creating, updating and deleting custom roles |
| `staff.access` (no separate code yet) | Employees and employee import, departments, assets, perks, AI tokens, announcements, content (policies, benefits, holidays), reports, performance, vendors, letters, separations, and the staff side of onboarding. The codes `employees.manage`, `attendance.manage`, `vendors.manage`, `performance.manage`, `wellbeing.pulse`, `assets.manage`, `perks.manage`, `aitokens.manage`, `announcements.manage`, `content.manage` and `reports.view` are not yet checked separately by the API |

## Custom roles

Create roles that fit your organisation under Settings, Roles (needs `roles.manage`):

| Action | Endpoint | Rules |
| --- | --- | --- |
| List | `GET /api/roles` | Built-in and custom roles with the number of users holding each |
| Create | `POST /api/roles {"name", "permissions": [...]}` | The key is derived from the name (lowercase, underscores, at most 40 characters). A name that clashes with a built-in role or an existing custom role is refused. Unknown codes are dropped; `*` can never be granted |
| Update | `PUT /api/roles/:key` | Name and permission list |
| Delete | `DELETE /api/roles/:key` | Refused while any user holds the role |

Custom roles are stored per workspace (`organizations.data.customRoles`) and audited
(`ROLE_CREATE`, `ROLE_UPDATE`, `ROLE_DELETE`).

### Designing a role that works

Most services also look at staff status (`staff.access`) when they list or read other
employees' records: the leave request list, the payslip list and payslip downloads, the
reimbursement list. A role that holds a specific code but not `staff.access` can perform the
action that code guards (deciding a leave request, calling the payroll endpoints, deciding a
claim), but its lists show only the user's own records, or their team's for a manager. In
practice, give `staff.access` together with the specific codes, and narrow the user with a
scope (below):

```json
{ "name": "Payroll officer", "permissions": ["staff.access", "payroll.manage", "reimbursements.manage"] }
```

Read the enforcement table before relying on a role like this: through `staff.access` it
also reaches every area in the table's last row. It does not get settings, users, roles,
leave configuration or onboarding review, which are checked separately.

## Assigning roles

Under Settings, Users (needs `users.manage`):

| Action | Endpoint |
| --- | --- |
| Set the primary role (built-in or custom) | `POST /api/users/:id/role {"role"}` |
| Set additional roles | `PUT /api/users/:id/roles {"roleKeys": [...]}` |
| Set the scope | `PUT /api/users/:id/scope {"scopeType", "scopeIds"}` |

Every change is audited (`USER_ROLE`, `USER_ROLES`, `USER_SCOPE`).

**Last administrator.** A change that would leave the workspace without any user holding `*`
(disabling, demoting or removing roles from the last admin) is refused. The
access-revocation sweep (every 6 hours) also skips the last admin, logging a warning instead.

## Scope

A user's administrative powers can be limited to part of the organisation:

| `scopeType` | `scopeIds` | Effect |
| --- | --- | --- |
| `ALL` (default) | ignored | Workspace-wide |
| `DEPARTMENT` | department ids | Only employees in those departments |
| `OFFICE` | office ids | Only employees in those offices |

How scope applies:

- Lists of employees and of employee-owned records (payslips, claims, exports) are filtered
  to in-scope employees.
- Actions on a single record check the employee: out-of-scope requests get
  `403 Outside your assigned scope`.
- `ADMIN` (`*`) is always workspace-wide, whatever scope is stored.
- A `DEPARTMENT` or `OFFICE` scope with an empty id list is treated as `ALL`, so a
  misconfiguration cannot lock a user out of everything.
- Users cannot change their own scope.

Scope narrows permissions; it never grants any. A scoped HR user still needs the codes for
the areas they work in.
