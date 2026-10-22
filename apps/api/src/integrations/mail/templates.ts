/** Branded transactional email templates for the account lifecycle. */
import { PRODUCT_NAME } from "../../core/product";

// Account-lifecycle links (verify / reset / invite) open in the CLIENT web app,
// not this API. APP_WEB_URL points at the frontend; fall back to APP_BASE_URL,
// then localhost:3410 (the web app's default dev port).
const baseUrl = () => process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 5005}`;
const webUrl = () => process.env.APP_WEB_URL || process.env.APP_BASE_URL || "http://localhost:3410";

// Brand palette (single source so every template stays consistent).
const BRAND = "#0f766e"; // teal-700, readable behind white text
const BRAND_DARK = "#115e54"; // teal-800, gradient/footer accent
const PAGE_BG = "#ecfdf5"; // teal-50, page backdrop
const escAttr = (s) => String(s == null ? "" : s).replace(/"/g, "&quot;");
/**
 * Escape text destined for the HTML body.
 *
 * Separation reasons, letter notes and similar are typed by a person and go straight into
 * these templates, so an unescaped angle bracket would break the markup and a crafted one
 * would inject into every recipient's mail client.
 */
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Industry-grade transactional shell. Table-based with inline styles and fluid widths
 * (width:100% + max-width:600) so it reflows on phones; <style>/media-queries are
 * unreliable across clients, so nothing depends on them. Includes:
 *   - a hidden preheader (inbox preview text),
 *   - MSO (Outlook) conditional wrappers for the fixed-width container,
 *   - a wordmark header, a white body card, and a footer with sender + disclaimer.
 * Signature stays backward-compatible: shell(title, bodyHtml, opts?).
 */
const shell = (title, bodyHtml, opts: { preheader?: string; footerNote?: string } = {}) => {
  // Both escaped HERE, not at each call site. They are plain text by definition, but they are
  // interpolated straight into markup below, and callers feed them org names, employee first
  // names, section titles and HR notes. The title is the worse of the two: it renders in an
  // <h1> in the visible body, and every caller passing a variable passed it raw, including
  // ones that carefully escaped the SAME value lower down in their own body. Sixteen call
  // sites each remembering to escape is a rule the seventeenth breaks; one choke point cannot.
  const safeTitle = esc(title);
  const preheader = opts.preheader ? esc(opts.preheader) : safeTitle;
  const footerNote =
    opts.footerNote ||
    `This is an automated message from ${PRODUCT_NAME}. Please do not reply to this email.`;
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>${safeTitle}</title>
  <!--[if mso]><style>table,td,div,h1,p{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;width:100%;background:${PAGE_BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE_BG}">${preheader}&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG}">
    <tr>
      <td align="center" style="padding:28px 12px">
        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
          <tr>
            <td style="background:${BRAND};background-image:linear-gradient(135deg,${BRAND} 0%,${BRAND_DARK} 100%);padding:22px 28px;border-radius:14px 14px 0 0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="vertical-align:middle">
                    <span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;background:#ffffff;color:${BRAND};border-radius:7px;font-size:18px;font-weight:700;vertical-align:middle">e</span>
                    <span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:.2px;vertical-align:middle;padding-left:10px">${esc(PRODUCT_NAME)}</span>
                  </td>
                  <td align="right" style="vertical-align:middle;color:#d1fae5;font-size:11px;letter-spacing:.4px;text-transform:uppercase">People · Payroll · Leave</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;padding:30px 28px 8px">
              <h1 style="margin:0;font-size:21px;line-height:1.3;font-weight:700;color:#111827">${safeTitle}</h1>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;border-radius:0 0 14px 14px;padding:8px 28px 30px;font-size:15px;line-height:1.65;color:#374151">${bodyHtml}</td>
          </tr>
          <tr>
            <td style="padding:20px 28px;text-align:center;color:#9ca3af;font-size:12px;line-height:1.6">
              <p style="margin:0 0 4px">${footerNote}</p>
              <p style="margin:0">&copy; ${new Date().getFullYear()} ${esc(PRODUCT_NAME)}. All rights reserved.</p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
};

// Bulletproof, full-width-on-mobile CTA button + a copy/paste link fallback.
const button = (href, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0">
     <tr><td align="center">
       <a href="${escAttr(href)}" target="_blank" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:9px;font-weight:600;font-size:15px;mso-padding-alt:0;text-align:center">${label}</a>
     </td></tr>
   </table>
   <p style="font-size:12px;color:#9ca3af;margin:0">Or paste this link into your browser:</p>
   <p style="font-size:12px;margin:4px 0 0;word-break:break-all;overflow-wrap:anywhere"><a href="${escAttr(href)}" style="color:${BRAND}">${href}</a></p>`;

/**
 * Responsive key/value details table (employee ID, login, temp password, etc.).
 * `rows` is an array of [label, valueHtml]. Stacks cleanly on narrow screens because
 * each cell wraps and the table is fluid (width:100%).
 */
const detailsTable = (rows) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:10px;margin:16px 0;font-size:14px;line-height:1.5">
     ${rows
       .map(
         ([label, value], i) =>
           `<tr><td style="padding:10px 14px;color:#6b7280;white-space:nowrap;vertical-align:top;${i ? "border-top:1px solid #d1fae5" : ""}">${label}</td><td style="padding:10px 14px;color:#111827;word-break:break-word;overflow-wrap:anywhere;${i ? "border-top:1px solid #d1fae5" : ""}">${value}</td></tr>`
       )
       .join("")}
   </table>`;

/** Company-admin signup: verify your email to activate the workspace. */
function verifyEmail({ to, name, companyName, token }) {
  const link = `${webUrl()}/verify?token=${token}`;
  return {
    to,
    subject: `Verify your email to activate ${companyName}`,
    html: shell(`Welcome to ${PRODUCT_NAME}`, `
      <p>Hi ${name || "there"},</p>
      <p>Thanks for creating the <b>${companyName}</b> workspace. Confirm your email to activate it and sign in.</p>
      ${button(link, "Verify email & activate")}
      <p style="font-size:12px;color:#888">This link expires in 48 hours.</p>`),
  };
}

/** Forgot password: set a new password. */
function resetEmail({ to, name, token }) {
  const link = `${webUrl()}/reset-password?token=${token}`;
  return {
    to,
    subject: `Reset your ${PRODUCT_NAME} password`,
    html: shell(`Password reset`, `
      <p>Hi ${name || "there"},</p>
      <p>We received a request to reset your password. Click below to choose a new one. If you did not request this, you can safely ignore this email.</p>
      ${button(link, "Set a new password")}
      <p style="font-size:12px;color:#888">This link expires in 45 minutes and can be used once.</p>`),
  };
}

/** Invite a teammate (HR / manager) to a workspace. */
function staffInviteEmail({ to, orgName, inviterName, role, token }) {
  const link = `${webUrl()}/accept-invite?token=${token}`;
  return {
    to,
    subject: `${inviterName || "Your team"} invited you to ${orgName} on ${PRODUCT_NAME}`,
    html: shell(`You're invited to ${orgName}`, `
      <p>Hi,</p>
      <p>${inviterName || "An administrator"} has invited you to join <b>${orgName}</b> as <b>${(role || "STAFF").toString().replace("_", " ")}</b>.</p>
      <p>Accept the invite and set your password to get started:</p>
      ${button(link, "Accept invite & set password")}
      <p style="font-size:12px;color:#888">This invite expires in 7 days.</p>`),
  };
}

/**
 * Invite a teammate with a temporary password (no link flow). Carries their login
 * email, a temporary password to sign in with, and the portal link. They change it
 * after first sign-in. `portalUrl` is the tenant portal (Next.js client).
 */
function staffTempPasswordEmail({ to, orgName, inviterName, role, password, portalUrl }) {
  const portal = portalUrl || webUrl();
  return {
    to,
    subject: `${inviterName || "Your team"} added you to ${orgName} on ${PRODUCT_NAME}`,
    html: shell(`You've been added to ${orgName}`, `
      <p>Hi,</p>
      <p>${inviterName || "An administrator"} has added you to <b>${orgName}</b> as <b>${(role || "STAFF").toString().replace("_", " ")}</b>. Sign in with the temporary password below:</p>
      ${detailsTable([
        ["HRMS portal", `<a href="${portal}" style="color:${BRAND}">${portal}</a>`],
        ["Login", `<b>${to}</b>`],
        ["Temporary password", `<b>${password}</b>`],
      ])}
      ${button(portal, `Sign in to ${PRODUCT_NAME}`)}
      <p>Please sign in and change your password right away.</p>`,
      {
        preheader: `Your ${orgName} login: ${to}`,
        footerNote:
          "For your security, change your temporary password at first sign-in and never share it. This is an automated message - please do not reply.",
      }),
  };
}

/**
 * Self-onboarding invite, sent to a candidate's personal email with a link to fill
 * in their details. `link` is the prebuilt onboarding URL.
 */
function inviteEmail({ org, personalEmail, link, firstName }) {
  return {
    to: personalEmail,
    subject: `${org.name} - Complete your onboarding`,
    html: shell(`Welcome aboard, ${firstName || "there"}!`, `
      <p>We're excited to begin your onboarding at <b>${org.name}</b>.</p>
      <p>To get started, use the secure link below to fill in your details. Once you submit, we'll
         generate your official email ID and employee ID, and send you a welcome email with your login.</p>
      ${button(link, "Start onboarding")}
      <p style="margin-top:20px">Looking forward to having you with us,<br/>${org.name} HR Team</p>`,
      { preheader: `Complete your onboarding at ${org.name}.` }),
  };
}

/**
 * Self-onboarding welcome, sent once the candidate completes the form. Carries their
 * official email, employee ID and temporary password. `portalUrl` is the tenant portal
 * (the Next.js client); falls back to the API base if not supplied.
 */
function welcomeEmail({ org, employee, password, personalEmail, portalUrl }) {
  const portal = portalUrl || baseUrl();
  return {
    to: personalEmail,
    subject: `${org.name} - Welcome! Your official email & employee ID`,
    html: shell(`Welcome to ${org.name}, ${employee.firstName}!`, `
      <p>Your onboarding is complete - we're thrilled to have you on the team. Here are your official details:</p>
      ${detailsTable([
        ["Employee ID", `<b>${employee.code}</b>`],
        ["Official email", `<b>${employee.officialEmail}</b>`],
        ["HRMS portal", `<a href="${portal}" style="color:${BRAND}">${portal}</a>`],
        ["Login", `<b>${employee.officialEmail}</b>`],
        ["Temporary password", `<b>${password}</b>`],
      ])}
      <p>Please sign in and change your password right away. From the portal you can upload your documents
         (Aadhaar, PAN, bank statement, etc.), mark attendance, apply for leave, raise reimbursements and view your payslips.</p>
      <p style="margin-top:20px">Warm regards,<br/>${org.name} HR Team</p>`,
      {
        preheader: `Your ${org.name} login: ${employee.officialEmail}`,
        footerNote:
          "For your security, change your temporary password at first sign-in and never share it. This is an automated message - please do not reply.",
      }),
  };
}

/**
 * HR direct-onboarding, sent when HR adds an employee (and on resend-invite). Carries
 * the portal link, login email and temporary password. `portalUrl` is the tenant portal.
 */
/**
 * Joining email with the portal link and a temporary password.
 *
 * `to` and `loginEmail` are separate because they usually differ: the message has to reach
 * the joiner's PERSONAL inbox, since they cannot read a company mailbox they have not been
 * given yet, while the address they sign in with is their OFFICIAL one. Both default to the
 * record's primary address so existing callers are unaffected.
 */
function onboardingEmail({ org, emp, dept, password, portalUrl, to, loginEmail }: any) {
  const portal = portalUrl || baseUrl();
  const role = emp.designation || (emp.employmentType || "").replace("_", " ");
  const signInAs = loginEmail || emp.officialEmail || emp.email;
  return {
    to: to || emp.personalEmail || emp.email,
    subject: `Welcome to ${org.name} - your onboarding details`,
    html: shell(`Welcome to ${org.name}!`, `
      <p>Hi ${emp.firstName},</p>
      <p>We're delighted to have you join <b>${org.name}</b>${dept ? ` in the <b>${dept.name}</b> department` : ""}${role ? ` as <b>${role}</b>` : ""}.</p>
      <p>Your employee code is <b>${emp.code}</b>. Sign in to the HR portal to manage your
         attendance, leave, documents and payslips:</p>
      ${detailsTable([
        ["Portal", `<a href="${portal}" style="color:${BRAND}">${portal}</a>`],
        ["Sign in with", `<b>${signInAs}</b>`],
        ["Temporary password", `<b>${password}</b>`],
      ])}
      <p>Please sign in and change your password from the profile menu.</p>
      <p style="margin-top:20px">Warm regards,<br/>${org.name} HR Team</p>`,
      {
        preheader: `Your onboarding details for ${org.name}.`,
        footerNote:
          "For your security, change your temporary password at first sign-in and never share it. This is an automated message - please do not reply.",
      }),
  };
}

/**
 * Sign-in address changed.
 *
 * Sent to BOTH the old and the new address. The old one because that is where the person is
 * still expecting mail and is the only place a warning reaches them if the change was not
 * theirs; the new one because it tells them what to use from now on. Changing the address
 * also ends their open sessions, so saying so up front prevents a support ticket.
 */
function loginEmailChangedEmail({ org, name, to, oldEmail, newEmail, portalUrl }: any) {
  const portal = portalUrl || baseUrl();
  return {
    to,
    subject: `${org.name}: your sign-in address has changed`,
    html: shell("Your sign-in address has changed", `
      <p>Hi ${name || "there"},</p>
      <p>The email address you use to sign in to the <b>${org.name}</b> HR portal has been updated
         by your HR team.</p>
      ${detailsTable([
        ["Previous address", `${oldEmail}`],
        ["New sign-in address", `<b>${newEmail}</b>`],
        ["Portal", `<a href="${portal}" style="color:${BRAND}">${portal}</a>`],
      ])}
      <p>Your password has not changed. You have been signed out on all devices, so please sign in
         again using the new address.</p>
      <p>If you were not expecting this, contact your HR team straight away.</p>
      <p style="margin-top:20px">Warm regards,<br/>${org.name} HR Team</p>`,
      {
        preheader: `Sign in with ${newEmail} from now on.`,
        footerNote: "This is an automated message, please do not reply.",
      }),
  };
}

/**
 * A letter has been issued, with the PDF attached.
 *
 * Letters were filed to the portal and nothing was sent, so someone who was not signed in
 * had no idea their relieving letter or confirmation existed. Attached rather than linked,
 * because the most common reason to want one of these is to forward it to a bank, a landlord
 * or a future employer, and a link behind a login cannot be forwarded.
 */
function letterIssuedEmail({ org, name, to, letterLabel, note, filename, buffer, portalUrl }: any) {
  const portal = portalUrl || baseUrl();
  return {
    to,
    subject: `${org.name}: your ${letterLabel.toLowerCase()}`,
    html: shell(letterLabel, `
      <p>Hi ${name || "there"},</p>
      <p>Your <b>${esc(letterLabel.toLowerCase())}</b> from <b>${org.name}</b> is attached to this email.</p>
      ${note ? `<p>${esc(note)}</p>` : ""}
      <p>A copy is also filed under My documents in the HR portal:</p>
      ${detailsTable([["Portal", `<a href="${portal}" style="color:${BRAND}">${portal}</a>`]])}
      <p>If the letter carries a QR code, anyone can use it to confirm the letter is genuine
         without needing to contact us.</p>
      <p style="margin-top:20px">Warm regards,<br/>${org.name} HR Team</p>`,
      {
        preheader: `Your ${letterLabel.toLowerCase()} is attached.`,
        footerNote: "This is an automated message, please do not reply.",
      }),
    attachments: buffer ? [{ filename: filename || "letter.pdf", content: buffer, contentType: "application/pdf" }] : undefined,
  };
}

/**
 * A step in someone's separation. One template for every transition.
 *
 * The wording varies far less than the number of transitions suggests (initiated, accepted,
 * declined, withdrawn, completed), and a separate template per step would be five near
 * copies drifting apart. The caller supplies the heading and the sentence that differs.
 */
function separationEmail({ org, name, to, heading, message, rows, portalUrl }: any) {
  const portal = portalUrl || baseUrl();
  return {
    to,
    subject: `${org.name}: ${heading.toLowerCase()}`,
    html: shell(heading, `
      <p>Hi ${name || "there"},</p>
      <p>${esc(message)}</p>
      ${rows && rows.length ? detailsTable(rows) : ""}
      <p>You can follow the remaining steps in the HR portal:</p>
      ${detailsTable([["Portal", `<a href="${portal}" style="color:${BRAND}">${portal}</a>`]])}
      <p style="margin-top:20px">Warm regards,<br/>${org.name} HR Team</p>`,
      {
        preheader: message,
        footerNote: "This is an automated message, please do not reply.",
      }),
  };
}

/**
 * Daily nudge for someone who has not clocked in yet.
 *
 * Kept short on purpose: this is the one email an employee may receive every working
 * day, so it earns its place only by being scannable and immediately actionable.
 */
function clockInReminderEmail({ org, emp, date, portalUrl }: any) {
  const portal = portalUrl || baseUrl();
  return {
    to: emp.officialEmail || emp.email,
    subject: `${org.name} - You have not clocked in today`,
    html: shell(`Good morning, ${emp.firstName || "there"}`, `
      <p>Our records show no attendance entry for <b>${date}</b> yet.</p>
      <p>If you are working today, please clock in. If you are on leave, ask your manager
         or HR to record it so you are not marked absent.</p>
      ${button(`${portal}/attendance`, "Clock in")}
      <p style="margin-top:20px">${org.name} HR Team</p>`,
      {
        preheader: `No attendance recorded for ${date}.`,
        footerNote: "You are receiving this because daily attendance reminders are enabled for your organisation.",
      }),
  };
}

/* ── Onboarding data collection ──────────────────────────────────────────────
 *
 * These go to the EXISTING roster, not to candidates. The link is a portal deep link, so
 * they sign in normally rather than following a credential embedded in an email that will
 * sit in an inbox long after it is needed. That is deliberate: the form behind it collects
 * PAN, Aadhaar and a bank account.
 */

/** How long is left, in words. Empty string when there is no deadline. */
const dueIn = (dueAt) => {
  if (!dueAt) return "";
  const days = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86400000);
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
};

const longDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";

/** Asked to complete (or top up) their own record. Sent when a campaign launches. */
function onboardingRequestEmail({ org, employee, dueAt, portalUrl, message = "" }: { org: any; employee: any; dueAt: any; portalUrl: string; message?: string }) {
  const portal = (portalUrl || webUrl()).replace(/\/$/, "");
  return {
    to: employee.officialEmail || employee.email || employee.personalEmail,
    subject: `${org.name} - Please complete your employee details`,
    html: shell(`Hi ${employee.firstName || "there"}, we need a few details`, `
      <p>${org.name} is bringing everyone's records up to date, and we need you to check and
         complete your own. It covers your personal details, identity documents, salary
         account and emergency contact.</p>
      ${message ? `<p>${esc(message)}</p>` : ""}
      ${dueAt ? detailsTable([["Please complete by", `<b>${longDate(dueAt)}</b> (${dueIn(dueAt)})`]]) : ""}
      <p>You can save as you go and come back to it, so there is no need to finish in one sitting.</p>
      ${button(`${portal}/onboarding/me`, "Complete my details")}
      <p style="margin-top:20px">Thank you,<br/>${org.name} HR Team</p>`,
      { preheader: dueAt ? `Due ${longDate(dueAt)}.` : `A few details are needed for your employee record.` }),
  };
}

/** Nudge before the deadline. `remaining` is what is still outstanding, in plain words. */
function onboardingReminderEmail({ org, employee, dueAt, portalUrl, remaining = [] as string[] }) {
  const portal = (portalUrl || webUrl()).replace(/\/$/, "");
  return {
    to: employee.officialEmail || employee.email || employee.personalEmail,
    subject: `${org.name} - Your employee details are due ${dueIn(dueAt)}`,
    html: shell(`A reminder, ${employee.firstName || "there"}`, `
      <p>Your employee details are still incomplete${dueAt ? `, and they are due <b>${dueIn(dueAt)}</b> (${longDate(dueAt)})` : ""}.</p>
      ${remaining.length ? `<p>Still outstanding:</p><ul>${remaining.slice(0, 8).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      <p>Whatever you have already filled in has been saved.</p>
      ${button(`${portal}/onboarding/me`, "Finish my details")}
      <p style="margin-top:20px">${org.name} HR Team</p>`,
      { preheader: `Due ${longDate(dueAt)}.`, footerNote: "You are receiving this because your employee details are not yet complete." }),
  };
}

/** Past the deadline. Firmer, but still a link and a list rather than a telling-off. */
function onboardingOverdueEmail({ org, employee, dueAt, portalUrl, remaining = [] as string[] }) {
  const portal = (portalUrl || webUrl()).replace(/\/$/, "");
  return {
    to: employee.officialEmail || employee.email || employee.personalEmail,
    subject: `${org.name} - Your employee details are overdue`,
    html: shell(`Your details are overdue`, `
      <p>Hi ${esc(employee.firstName || "there")},</p>
      <p>Your employee details were due <b>${dueIn(dueAt)}</b> (${longDate(dueAt)}) and are still incomplete.
         Some of them are needed for payroll and statutory filing, so please complete them as soon as you can.</p>
      ${remaining.length ? `<p>Still outstanding:</p><ul>${remaining.slice(0, 8).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${button(`${portal}/onboarding/me`, "Complete my details now")}
      <p style="margin-top:20px">${org.name} HR Team</p>`,
      { preheader: `Overdue since ${longDate(dueAt)}.` }),
  };
}

/** Escalation to the reporting manager (and HR) once someone is well past due. */
function onboardingEscalationEmail({ org, manager, employee, dueAt, portalUrl }) {
  const portal = (portalUrl || webUrl()).replace(/\/$/, "");
  const name = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
  return {
    to: manager.officialEmail || manager.email || manager.personalEmail,
    subject: `${org.name} - ${name}'s employee details are overdue`,
    html: shell(`A team member's details are outstanding`, `
      <p>Hi ${esc(manager.firstName || "there")},</p>
      <p><b>${esc(name)}</b>${employee.code ? ` (${esc(employee.code)})` : ""} has not completed their employee
         details. They were due <b>${longDate(dueAt)}</b>, ${dueIn(dueAt)}.</p>
      <p>Some of what is missing is needed for payroll and statutory filing. A word from you usually
         does more than another automated reminder.</p>
      ${button(`${portal}/onboarding`, "View in HRMS")}
      <p style="margin-top:20px">${org.name} HR Team</p>`,
      { preheader: `${name}'s details are overdue.`, footerNote: "You are receiving this because you are their reporting manager." }),
  };
}

/** HR has sent a section back for correction. */
function onboardingChangesRequestedEmail({ org, employee, sectionTitle, note, portalUrl }) {
  const portal = (portalUrl || webUrl()).replace(/\/$/, "");
  return {
    to: employee.officialEmail || employee.email || employee.personalEmail,
    subject: `${org.name} - A change is needed on your employee details`,
    html: shell(`One section needs another look`, `
      <p>Hi ${esc(employee.firstName || "there")},</p>
      <p>HR has reviewed your details and asked for a change to <b>${esc(sectionTitle)}</b>:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">
        <tr><td style="border-left:3px solid ${BRAND};padding:10px 14px;background:#f0fdfa;font-size:14px;color:#374151">${esc(note)}</td></tr>
      </table>
      <p>Everything else you submitted has been kept, so you only need to update that one section
         and submit again.</p>
      ${button(`${portal}/onboarding/me`, "Update my details")}
      <p style="margin-top:20px">${org.name} HR Team</p>`,
      { preheader: `${sectionTitle} needs a change.` }),
  };
}

/** Everything approved. */
function onboardingApprovedEmail({ org, employee, portalUrl }) {
  const portal = (portalUrl || webUrl()).replace(/\/$/, "");
  return {
    to: employee.officialEmail || employee.email || employee.personalEmail,
    subject: `${org.name} - Your details have been approved`,
    html: shell(`All done, thank you`, `
      <p>Hi ${esc(employee.firstName || "there")},</p>
      <p>HR has reviewed and approved your employee details. Your record is now up to date, and
         your documents are filed against your profile.</p>
      ${button(`${portal}/profile`, "View my profile")}
      <p style="margin-top:20px">${org.name} HR Team</p>`,
      { preheader: `Your employee details have been approved.` }),
  };
}

export {
  verifyEmail,
  resetEmail,
  staffInviteEmail,
  staffTempPasswordEmail,
  inviteEmail,
  welcomeEmail,
  onboardingEmail,
  onboardingRequestEmail,
  onboardingReminderEmail,
  onboardingOverdueEmail,
  onboardingEscalationEmail,
  onboardingChangesRequestedEmail,
  onboardingApprovedEmail,
  loginEmailChangedEmail,
  letterIssuedEmail,
  separationEmail,
  clockInReminderEmail,
  baseUrl,
};
