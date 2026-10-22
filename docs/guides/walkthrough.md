# Walkthrough: one employee, from invitation to first payslip

This tour follows a new hire through the code, so you can see how the pieces fit before you
change one. Every step names the files to open. Paths are relative to `apps/api/src/` unless
they start with `apps/`, `packages/`, `db/` or `infra/`.

Run the stack first (`make up && make demo`) and keep http://localhost:8025 (Mailpit) open: every
email in this story lands there.

## 0. The company exists

Acme Robotics was created by the demo seed (`demo/seed.ts`). A real company signs up at `/signup`
instead:

- **`services/signup.service.ts` `signup`** creates the workspace as `PENDING_VERIFICATION`,
  runs the starter packs and sends a verification email.
- **`services/provisioning.service.ts`** decides which starter packs a new workspace gets:
  leave catalogue, departments, policies, benefits, and, for Indian workspaces, the gazetted
  holidays of their state.

**Things to notice:**

- Nothing in the code is keyed to a particular company. Letterhead facts, the signatory, the
  sending domain and the report recipients are all workspace settings (`domain/brand.ts`).
- Every row the workspace owns carries its `org_id`, and `repositories/base.repository.ts`
  adds it to every query. You will not see a single `where org_id` in a service.

## 1. HR sends an invitation

The HR partner opens **People → Onboarding → Individual invites** in the web app
(`apps/web/src/app/(app)/onboarding/`) and invites a candidate.

| Layer | Code |
| --- | --- |
| Route | `routes/onboarding.routes.ts`: `router.post("/invites", staffOnly, wrap(ctrl.create))` |
| Controller | `controllers/onboarding-invite.controller.ts` |
| Service | `services/onboarding-invite.service.ts` `createInvites` |
| Mail | `integrations/mail/mailer.ts` `sendTenantMail` → `integrations/mail/templates.ts` |

`createInvites` validates the candidate and checks that a form will apply to them (so no dead
link is ever emailed), stores the invite and sends the email. `sendTenantMail` resolves the
sender: the workspace's own verified domain if it has one, otherwise the platform address under
the workspace's name. Locally, the mail goes through the emulated SES and is relayed to Mailpit.

## 2. The candidate fills in the form

The link opens `/onboard?token=…` in the web app, without an account.

| Layer | Code |
| --- | --- |
| Route | `routes/onboarding.public.routes.ts`: authenticated by the token, rate limited |
| Service | `services/onboarding-portal.service.ts` (`getPortal`, `saveSection`, `attachDocument`, `submit`) |
| Rules | `domain/onboarding-case.ts` (section and case states), `domain/onboarding-template.ts` (validation, named patterns such as PAN and Aadhaar) |

The answers live on the onboarding case, not on an employee record yet. The `sections` field is
one of the sealed fields (`security/pii.ts` `ENCRYPTED_FIELDS`), so a national ID number typed
here is ciphertext in Postgres from the first save:

```sql
select data->'sections' from onboarding_cases;   -- {"$enc":"v1","iv":"…","ct":"…","tag":"…"}
```

## 3. HR reviews and approves

**People → Onboarding → Review** lists submitted cases.

| Layer | Code |
| --- | --- |
| Route | `routes/onboarding-cases.routes.ts`: `/:id/sections/:key/review`, `/:id/approve` (permission `onboarding.review`) |
| Service | `services/onboarding-case.service.ts` `reviewCaseSection`, `approveCase` |
| Mapping | `services/onboarding.service.ts` `commitCase` |

Sections can be sent back (`CHANGES_REQUESTED`) or approved one by one. On approval,
`commitCase` maps the answers onto the employee record, merging nested objects such as `kyc`
field by field so values the form did not ask about survive. The employee repository seals
`kyc` and `bank` on the way into the database.

## 4. The employee signs in

The new employee gets a welcome email with their official sign-in address and sets a password.

| Concern | Code |
| --- | --- |
| Sign-in and sessions | `services/auth.service.ts`: bcrypt, lockout, optional TOTP, trusted devices |
| Every later request | `middleware/auth.ts` `authRequired`: tenant JWT, then the user and the workspace reloaded |
| What they may do | `security/rbac.ts`: built-in and custom roles, department/office scope |

## 5. Attendance and leave

| Action | Code |
| --- | --- |
| Check in at the office | `services/attendance.service.ts` `checkIn`: geofence distance against the workspace's offices |
| Apply for leave | `services/leave.service.ts` `applyForLeave` → `domain/leave-rules.ts` (monthly allowances, carry-over, minimum coverage) |
| Manager approves | `services/leave.service.ts` `decideLeave`: power comes from the reporting line (`domain/manager.ts`), not a role |

## 6. Payroll and the first payslip

**Finance → Payroll → Generate payslip**, or a salary-sheet upload for everyone at once.

| Step | Code |
| --- | --- |
| Salary and structure | `services/salary-structure.service.ts`, `domain/payroll/structure.ts` |
| The country's rules | `domain/payroll/countries/` (`in.ts`, `us.ts`, `uk.ts`, `more-countries.ts`, `index.ts`) |
| The computation | `domain/payroll/engine.ts` `computePayroll` |
| Orchestration | `services/payroll.service.ts` `createPayslip`, `generatePayslip` |
| Verification | `security/verification.ts`: code and signature issued before rendering, so the QR exists |
| The PDF | `pdf/payslip.ts`, `pdf/kit.ts` |
| Bulk import | `services/payslip-import.service.ts`: preview and commit share one parser |

The PDF is stored through `integrations/storage.ts`: in the private S3 bucket under SSE-KMS
(or on local disk), and only ever streamed back through the API after a permission check. The
QR code on it opens `/verify/<code>` in the web app (`services/verification.service.ts`), where
anyone holding the document can check it is genuine.

## 7. The same story, from the operator console

In the operator console (`apps/console`, API under `routes/platform.routes.ts` →
`services/platform.service.ts`), Acme Robotics is one workspace in the fleet. An operator can:

- see its headcount and activity
- open a support session as its admin; the session is audited, and the web app shows a banner
  for its whole length
- suspend it: the employee's next request gets `403 WORKSPACE_SUSPENDED`
- purge it: everything is deleted, and finally its data key, which crypto-shreds the sealed
  fields in old backups

## 8. Where the tests are

| Story step | Proven by |
| --- | --- |
| Invitation, portal, review, commit | `apps/api/test/integration/onboarding-case.int.test.ts`, `onboarding-prehire.int.test.ts`, `onboarding-campaign.int.test.ts` |
| Sign-in, two-factor, lockout, suspension | `apps/api/test/integration/security.int.test.ts` |
| Isolation between workspaces | `apps/api/test/integration/isolation.int.test.ts` |
| Payroll maths | `apps/api/test/unit/engine.test.ts`, `payroll-india.test.ts`, `salary-structure.test.ts`, `exit-pay.test.ts` |
| Sending domains through SES | `apps/api/test/integration/sending-domains.int.test.ts` |
| The whole thing in a browser | `e2e/tests/` |

Next: the [LLD](../architecture/LLD.md) for the design of each module, or
[CONTRIBUTING.md](../../CONTRIBUTING.md) to make your first change.
