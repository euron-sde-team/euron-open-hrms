/**
 * Demo activity seeded per workspace (used by the demo seed only): announcements,
 * policies and benefits when the starter packs left none, vendors with bills, and
 * people data (work logs, wellbeing, assets, perks, a PIP, an appraisal cycle).
 * Idempotent: each block only seeds a workspace that has none yet.
 *
 * Holidays are not seeded here. Provisioning applies the calendar for the
 * workspace's own country and state (starter-content.ts).
 */
import { systemRepos, repos } from "../repositories/base.repository";

const POLICIES = [
  ["Leave Policy", "LEAVE",
    "Eligible employees accrue Casual Leave (12/yr), Sick Leave (12/yr) and Earned Leave (15/yr). " +
    "Leave must be applied via the HRMS and approved by the reporting manager/HR. Earned leave may be " +
    "carried forward up to a cap; unavailed leave is encashed at separation per policy. Public " +
    "holidays for each office are published in the Leave Calendar. Interns accrue casual/sick leave on a pro-rata basis."],
  ["Code of Conduct", "CONDUCT",
    "All employees are expected to act with integrity, professionalism and respect. Discrimination, harassment, " +
    "bribery, conflicts of interest and misuse of company resources are strictly prohibited. Breaches may lead to " +
    "disciplinary action up to termination."],
  ["Prevention of Sexual Harassment (POSH)", "POSH",
    "The company is committed to a workplace free of sexual harassment, in compliance with the Sexual Harassment of " +
    "Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013. Complaints may be raised to the Internal " +
    "Committee (IC) and will be handled confidentially and time-bound. Retaliation against complainants is prohibited."],
  ["Work From Home / Hybrid Policy", "WFH",
    "The company follows a hybrid model. Employees may work remotely with manager approval; attendance is captured via " +
    "the geo-fenced HRMS. Remote employees are marked REMOTE when checking in outside an office geofence. Core collaboration " +
    "hours are 11:00-17:00 IST."],
  ["IT & Acceptable Use Policy", "IT",
    "Company devices, accounts and networks are for business use. Employees must use strong passwords and MFA, must not " +
    "install unauthorised software, and must protect customer and company data. All official communication uses the " +
    "company-issued official email ID."],
  ["Travel & Reimbursement Policy", "REIMBURSEMENT",
    "Reasonable, pre-approved business expenses (travel, internet, equipment, client meetings) are reimbursable. Submit a " +
    "claim in the HRMS with a valid receipt within 30 days. Approved claims are paid with the next payroll cycle. GST " +
    "invoices should be in the company's name where applicable."],
  ["Probation & Confirmation Policy", "PROBATION",
    "New full-time employees serve a probation of up to 6 months, during which performance is reviewed. On satisfactory " +
    "review, employment is confirmed. Probation may be extended once. Notice during probation is 15 days."],
  ["Notice Period & Separation Policy", "SEPARATION",
    "Confirmed full-time employees serve a 30-60 day notice period on resignation. Separation is processed via the HRMS " +
    "(initiation, approval, exit clearance, full & final settlement, relieving letter). Company property must be " +
    "returned before the last working day."],
  ["Data Security & Confidentiality", "SECURITY",
    "Employees must keep confidential all proprietary, customer and personal data accessed during employment, during and " +
    "after the engagement. Personal data is handled per applicable data-protection law. Report any data incident immediately to IT/Security."],
  ["Equal Opportunity & Anti-Discrimination", "EEO",
    "The company is an equal-opportunity employer. Hiring, pay and advancement are based on merit, irrespective of gender, " +
    "religion, caste, region, disability or background."],
];

const BENEFITS = [
  ["Group Health Insurance", "HEALTH",
    "Comprehensive group mediclaim cover for every employee, with the option to add dependents (spouse, children and parents) for full-time staff. Cover is cashless at a wide network of hospitals, no upfront payment for planned or emergency admissions.\n\n" +
    "What's included:\n" +
    "• Floater sum insured covering hospitalisation, day-care procedures and pre/post-hospitalisation expenses.\n" +
    "• Cashless claims at network hospitals; reimbursement claims supported elsewhere.\n" +
    "• Maternity cover and newborn care as per the policy schedule.\n\n" +
    "Enrol your dependents from the Family Benefits page. Keep your policy card and insurer helpline handy for admissions, HR can assist with pre-authorisation."],
  ["Paid Time Off", "LEAVE",
    "A balanced leave policy so you can rest, recover and handle personal commitments without stress. Your annual quota combines casual, sick and earned leave, on top of all gazetted public holidays.\n\n" +
    "How it works:\n" +
    "• Casual leave for short personal needs; sick leave for illness (a medical note may be required for longer absences).\n" +
    "• Earned leave accrues monthly and can be carried forward or encashed per company policy.\n" +
    "• Public holidays for your office are observed in addition to your quota.\n\n" +
    "Apply through the Leave page, requests route to your manager for approval and your live balance is always visible there."],
  ["Hybrid & Flexible Work", "WORK",
    "Work the way you do your best work. Choose office, remote or a hybrid mix, with flexible core hours that respect your focus time and your life outside it.\n\n" +
    "What to expect:\n" +
    "• Flexible start/end times around a small set of overlap hours for collaboration.\n" +
    "• Geo-fenced attendance so on-site check-ins are accurate and effortless.\n" +
    "• Manager-aligned schedules, agree your in-office days with your team.\n\n" +
    "Mark attendance from the Attendance page; remote days are fully supported by the Internet/WFH reimbursement."],
  ["Learning & Development", "GROWTH",
    "We invest in your growth. Every employee gets an annual L&D stipend for courses, certifications, books and conferences, plus full access to the company's learning platform.\n\n" +
    "Use it for:\n" +
    "• Online courses and professional certifications relevant to your role or career path.\n" +
    "• Conference tickets, workshops and industry events.\n" +
    "• Unlimited access to the internal learning library.\n\n" +
    "Talk to your manager about a development plan, then claim eligible spends via Reimbursements. Unused stipend rules follow company policy."],
  ["Internet / WFH Reimbursement", "REIMBURSEMENT",
    "A monthly allowance to cover the cost of working comfortably from home, available to remote and hybrid employees.\n\n" +
    "Covers:\n" +
    "• Broadband / internet charges.\n" +
    "• Reasonable home-office running costs as defined in the policy.\n\n" +
    "Submit your claim with a bill from the Reimbursements page each month. Approved amounts are paid out in the regular payroll cycle."],
  ["Wellness & Mental Health", "WELLNESS",
    "Your wellbeing matters as much as your work. Access wellness sessions and confidential, professional counselling whenever you need support, no questions asked.\n\n" +
    "Support available:\n" +
    "• Confidential 1:1 counselling with qualified professionals.\n" +
    "• Group wellness sessions, mindfulness and stress-management workshops.\n" +
    "• A private, anonymous well-being pulse so the team can improve how we work.\n\n" +
    "Everything is strictly confidential. Reach out through the Wellbeing page or contact HR to be connected."],
  ["Performance Bonus & ESOPs", "REWARDS",
    "Share in the success you help create. Eligible full-time employees earn performance-linked incentives and stock options (ESOPs), so your impact is recognised and rewarded.\n\n" +
    "How it works:\n" +
    "• Performance bonuses tied to individual and company outcomes, reviewed each cycle.\n" +
    "• ESOP grants for eligible roles, with a vesting schedule defined in your grant letter.\n" +
    "• Transparent criteria discussed during performance reviews.\n\n" +
    "Your manager and HR will walk you through eligibility and grant details during the appraisal cycle."],
  ["Parental Leave", "LEAVE",
    "Time to be present for the moments that matter. We provide maternity and paternity leave in line with statutory norms and our company policy.\n\n" +
    "What's offered:\n" +
    "• Maternity leave as mandated by law, with a smooth return-to-work transition.\n" +
    "• Paternity leave to support new fathers and partners.\n" +
    "• Flexibility on phased return where feasible, agreed with your manager.\n\n" +
    "Notify HR well in advance so we can plan coverage and ensure your leave and pay are set up correctly."],
  ["Device & Equipment", "WORK",
    "The right tools to do great work. Every employee receives a company laptop and the equipment their role requires, with reimbursement for additional approved items.\n\n" +
    "Includes:\n" +
    "• A company laptop and standard peripherals on joining.\n" +
    "• Role-specific tools and software licences as needed.\n" +
    "• Reimbursement for approved accessories (where applicable).\n\n" +
    "Raise equipment needs or report issues through the Assets page; IT handles provisioning, repairs and returns."],
];

const ANNOUNCEMENTS = [
  ["Welcome to the new HR portal", "GENERAL", true,
    "Our new HRMS is live! From here you can mark attendance, apply for leave, raise reimbursements, view the holiday calendar, read company policies, and download your payslips. Reach out to HR for any help."],
  ["Payroll cycle", "PAYROLL", false,
    "Payroll is processed on the last working day of each month. Approved reimbursements are paid in the same cycle. Please keep your bank details up to date in your profile."],
];

async function ensureContent(sys = systemRepos(), opts: { vendorPasswordHash?: string } = {}) {
  const orgs = await sys.organizations.all();
  for (const org of orgs) {
    const r = repos({ orgId: org.id });
    if ((await r.announcements.count()) === 0) {
      const hr = await r.users.findOne((u) => u.role === "ADMIN" || u.role === "HR");
      for (const [title, category, pinned, body] of ANNOUNCEMENTS)
        await r.announcements.insert({ title, category, pinned, body, authorId: hr ? hr.id : null });
    }
    if ((await r.policies.count()) === 0) {
      for (let i = 0; i < POLICIES.length; i++) {
        const [title, category, content] = POLICIES[i];
        await r.policies.insert({ title, category, content, version: "1.0", order: i, publishedAt: new Date().toISOString() });
      }
    }
    if ((await r.benefits.count()) === 0) {
      for (let i = 0; i < BENEFITS.length; i++) {
        const [title, category, description] = BENEFITS[i];
        await r.benefits.insert({ title, category, description, order: i });
      }
    } else {
      // Keep the canonical benefit copy fresh: refresh description/category for any
      // existing benefit whose title matches the seed (no duplicates, no deletions).
      const existing = await r.benefits.all();
      const byTitle = new Map(existing.map((b: any) => [b.title, b]));
      for (let i = 0; i < BENEFITS.length; i++) {
        const [title, category, description] = BENEFITS[i];
        const cur: any = byTitle.get(title);
        if (cur && (cur.description !== description || cur.category !== category)) {
          await r.benefits.update(cur.id, { description, category, order: cur.order ?? i });
        }
      }
    }
    if ((await r.vendors.count()) === 0) {
      const mk = async (name, type, email, services, withLogin) => {
        const v = await r.vendors.insert({
          code: `VEN-${1000 + (await r.vendors.count())}`,
          name, type, email, phone: "", company: name, gstin: "", pan: "", bank: { account: "", ifsc: "", bankName: "" },
          services, status: "ACTIVE",
        });
        if (withLogin && opts.vendorPasswordHash) {
          await r.users.insert({ email, name, role: "VENDOR", vendorId: v.id, employeeId: null, passwordHash: opts.vendorPasswordHash, status: "ACTIVE", emailVerifiedAt: new Date().toISOString() });
        }
        return v;
      };
      const v1 = await mk("Nimbus Cloud Hosting", "VENDOR", `billing@cloudhost.${org.slug}.example.com`, "Cloud hosting & infra", true);
      await mk("Acme Design Consultants", "CONSULTANT", `hello@design.${org.slug}.example.com`, "Brand & UX consulting", false);
      // sample bills for v1
      await r.vendorBills.insert({ vendorId: v1.id, invoiceNumber: "INV-2026-001", amount: 80000, taxAmount: 14400, totalAmount: 94400, currency: "INR", description: "Cloud hosting - April", periodFrom: "2026-04-01", periodTo: "2026-04-30", attachmentFilename: null, status: "APPROVED", decidedBy: null, decidedAt: new Date().toISOString(), note: "" });
      await r.vendorBills.insert({ vendorId: v1.id, invoiceNumber: "INV-2026-002", amount: 85000, taxAmount: 15300, totalAmount: 100300, currency: "INR", description: "Cloud hosting - May", periodFrom: "2026-05-01", periodTo: "2026-05-31", attachmentFilename: null, status: "SUBMITTED", decidedBy: null, decidedAt: null, note: "" });
    }
    // Register every designation already used by employees into the org's managed
    // list, so the onboarding/edit designation picker offers them as suggestions.
    const usedDesigs: string[] = [...new Set(
      (await r.employees.all()).map((e: any) => String(e.designation || "").trim()).filter(Boolean) as string[],
    )];
    if (usedDesigs.length) {
      const cur = Array.isArray(org.designations) ? org.designations : [];
      const lower = new Set(cur.map((d: string) => d.toLowerCase()));
      const merged = [...cur, ...usedDesigs.filter((d) => !lower.has(d.toLowerCase()))]
        .sort((a, b) => a.localeCompare(b)).slice(0, 300);
      if (merged.length !== cur.length) await sys.organizations.update(org.id, { designations: merged });
    }

    await seedPeopleData(r, org);
  }
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** Seed productivity logs, wellbeing, assets, AI tokens, perks, PIP, appraisal & family. */
async function seedPeopleData(r, org) {
  if ((await r.workLogs.count()) > 0) return;
  const emps = await r.employees.find((e) => e.status !== "EXITED");
  const WTYPES = ["ONSITE", "REMOTE", "CLIENT", "OFFSITE"];
  for (let idx = 0; idx < emps.length; idx++) {
    const e = emps[idx];
    for (let d = 1; d <= 6; d++) {
      const type = WTYPES[(idx + d) % WTYPES.length];
      await r.workLogs.insert({ employeeId: e.id, date: daysAgo(d), type, client: type === "CLIENT" ? "Acme Corp" : "", hours: 7 + ((idx + d) % 3), productivityScore: 6 + ((idx + d) % 4), summary: "Shipped tasks, reviews and planning.", tasks: "" });
      await r.wellbeing.insert({ employeeId: e.id, date: daysAgo(d), mood: 3 + ((idx + d) % 3), stress: 2 + ((idx + d) % 3), workload: 3 + ((idx + d) % 2), note: "", anonymous: true });
    }
    await r.aiTokens.insert({ employeeId: e.id, plan: idx === 0 ? "PRO" : "PLUS", dailyLimit: idx === 0 ? 500000 : 100000, usedToday: 12000 + idx * 4000, requests: [], grantedBy: null });
    await r.assets.insert({ employeeId: e.id, category: "LAPTOP", name: "Laptop 14-inch", serial: `LAP-${1000 + idx}`, condition: "Good", status: idx % 2 ? "IN_USE" : "PROVISIONED", assignedAt: new Date().toISOString(), acknowledgedAt: idx % 2 ? new Date().toISOString() : null, returnedAt: null, notes: "" });
    await r.assets.insert({ employeeId: e.id, category: "ACCESS_CARD", name: "Office access card", serial: `AC-${2000 + idx}`, condition: "New", status: "IN_USE", assignedAt: new Date().toISOString(), acknowledgedAt: new Date().toISOString(), returnedAt: null, notes: "" });
    await r.perks.insert({ employeeId: e.id, type: "GOODIE", item: "Welcome kit (hoodie + bottle + stickers)", code: "", status: "ALLOCATED", expiresAt: null, allocatedBy: null });
    await r.perks.insert({ employeeId: e.id, type: "COUPON", item: "Festival gift voucher", code: `CPN-${org.slug.slice(0, 3).toUpperCase()}${1000 + idx}`, status: "ALLOCATED", expiresAt: daysAgo(-30), allocatedBy: null });
  }
  const pipEmp = emps.find((e) => e.employmentType === "PART_TIME") || emps[emps.length - 1];
  if (pipEmp) await r.pips.insert({ employeeId: pipEmp.id, title: "Performance Improvement Plan", reason: "Output below the expected bar in the last cycle.", objectives: "1) Hit weekly delivery targets\n2) Improve code-review turnaround\n3) Weekly 1:1 with manager", startDate: daysAgo(7), endDate: daysAgo(-53), status: "ACTIVE", mentorId: null, checkins: [{ date: daysAgo(2), note: "Good progress on targets this week.", rating: 6 }], outcome: "", createdBy: null });
  const ft = emps.find((e) => e.employmentType === "FULL_TIME");
  if (ft) await r.familyBenefits.insert({ employeeId: ft.id, plan: "Group Health - Family Floater", coverAmount: 500000, dependents: [{ name: "Spouse", relation: "Spouse", dob: "1992-03-10", gender: "Female" }, { name: "Child", relation: "Son", dob: "2020-08-01", gender: "Male" }], status: "ENROLLED" });
  if ((await r.appraisalCycles.count()) === 0) {
    const cycle = await r.appraisalCycles.insert({ name: "H1 2026 Appraisal", periodLabel: "Jan-Jun 2026", status: "OPEN" });
    for (const e of emps) await r.appraisals.insert({ cycleId: cycle.id, employeeId: e.id, selfReview: "", achievements: "", managerRating: null, managerComments: "", recommendedHikePct: 0, finalHikePct: 0, status: "PENDING_SELF" });
  }
}

export { ensureContent, POLICIES, BENEFITS };
