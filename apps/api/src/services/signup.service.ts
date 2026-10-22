/**
 * PUBLIC company self-signup (no auth).
 * The person who signs up creates the workspace and becomes its first ADMIN
 * (Super-Admin model, as in Zoho People). The admin email must be verified
 * before they can sign in: org starts PENDING_VERIFICATION, user starts INVITED.
 */
import { systemContext } from "../core/context";
import { bad } from "../core/util";
import { validate } from "../core/validate";
import { logger } from "../core/logger";
import { hashPassword, signToken, assertStrongPassword } from "../middleware/auth";
import { createToken, consumeToken } from "../security/tokens";
import { sendMailSafe } from "../integrations/mail/mailer";
import { verifyEmail } from "../integrations/mail/templates";
import { provisionOrgDefaults, uniqueSlug } from "./provisioning.service";
import { ensureEmployeeForUser } from "../domain/person";
import { publicUser } from "../domain/user-view";
import { listCountries } from "../domain/payroll/countries";
import { systemRepos } from "../repositories/base.repository";
import { createRepositories } from "../repositories";

const SIGNUP_SCHEMA = {
  companyName: { required: true, trim: true, min: 1, max: 200, label: "Company name" },
  adminName: { required: true, trim: true, min: 1, max: 200, label: "Your name" },
  email: { required: true, email: true, label: "Email" },
  phone: { trim: true, max: 32, default: "" },
  country: { trim: true, max: 4, default: "IN" },
};

const nowIso = () => new Date().toISOString();

/** The country list for the signup form. */
export function signupCountries() {
  return listCountries().map((c) => ({ country: c.country, label: c.label }));
}

/** Create the workspace and its first (unverified) admin, then email the verification link. */
export async function signup(body: any) {
  const { companyName, adminName, email, phone, country } = validate(SIGNUP_SCHEMA, body);
  const password = String((body && body.password) || "");
  assertStrongPassword(password);

  const sysStore = systemRepos();
  const sys = createRepositories(sysStore);
  if (await sys.users.findByEmail(email)) throw bad("An account with that email already exists");

  const slug = await uniqueSlug(sysStore, companyName);
  const org = await sys.organizations.create({
    name: companyName,
    slug,
    address: "",
    status: "PENDING_VERIFICATION",
    signupSource: "SELF_SIGNUP",
    country,
  });

  const ws = systemContext(org.id);
  const admin = await ws.data.users.create({
    email,
    name: adminName,
    phone: phone || "",
    role: "ADMIN",
    employeeId: null,
    passwordHash: hashPassword(password),
    status: "INVITED",
    emailVerifiedAt: null,
    credentialsChangedAt: nowIso(),
  });

  await provisionOrgDefaults(org.id, { country, state: body?.state ? String(body.state) : null });

  /*
   * The founder is an employee too.
   *
   * Signup used to create only a login, so the person who set the workspace up appeared
   * nowhere on their own roster: no attendance, no leave, absent from the org chart, and
   * unavailable as anyone's reporting manager. Created after provisionOrgDefaults so the
   * employee-code rule and departments exist first, and best-effort because a failure here
   * must not cost someone their workspace: the same call is idempotent from the backfill
   * and from Settings, so a miss is recoverable.
   */
  try {
    await ensureEmployeeForUser(ws.repos, org, admin, { status: "ACTIVE", createdVia: "SIGNUP" });
  } catch (e) {
    logger.error({ err: e, orgId: org.id, userId: admin.id }, "signup: could not create the founder's employee record");
  }

  const token = await createToken({ type: "EMAIL_VERIFY", orgId: org.id, userId: admin.id, email });
  const mail = await sendMailSafe(verifyEmail({ to: email, name: adminName, companyName, token }));

  return { ok: true, verifyRequired: true, mail: { to: email, mode: mail.mode } };
}

/** Activate the workspace + admin from the emailed token, and sign them in. */
export async function verifySignup(rawToken: unknown) {
  const tok = await consumeToken("EMAIL_VERIFY", rawToken);
  if (!tok) throw bad("This verification link is invalid or has expired.");
  const sys = createRepositories(systemRepos());
  const user = await sys.users.byId(tok.userId);
  if (!user) throw bad("Account not found.");
  const ws = systemContext(user.orgId);
  await ws.data.users.update(user.id, { status: "ACTIVE", emailVerifiedAt: nowIso() });
  await sys.organizations.update(user.orgId, { status: "ACTIVE" });
  const org = await ws.data.organizations.byId(user.orgId);
  const fresh = await sys.users.byId(user.id);
  return { token: signToken(fresh), user: await publicUser(fresh, org, ws.repos) };
}

/** Resend the verification email. Non-enumerating: the response never says whether it was sent. */
export async function resendVerification(rawEmail: unknown) {
  const email = String(rawEmail || "").toLowerCase().trim();
  const user = email ? await createRepositories(systemRepos()).users.findByEmail(email) : null;
  if (user && user.status === "INVITED" && !user.emailVerifiedAt && user.role === "ADMIN") {
    const org = await systemContext(user.orgId).data.organizations.byId(user.orgId);
    const token = await createToken({ type: "EMAIL_VERIFY", orgId: user.orgId, userId: user.id, email });
    await sendMailSafe(verifyEmail({ to: email, name: user.name, companyName: org ? org.name : "your workspace", token }));
  }
  return { ok: true, message: "If that email is awaiting verification, a new link has been sent." };
}
