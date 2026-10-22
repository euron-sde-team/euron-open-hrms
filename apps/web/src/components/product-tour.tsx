"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import { productName } from "@/lib/runtime-env";

/**
 * First-run guided tour. Spotlights key nav areas the first time a user signs in,
 * with role-specific steps (admin/staff vs employee). "Seen" is persisted per user
 * in the DB (user.tourSeenAt via POST /auth/tour-complete), so it shows once.
 *
 * Targets are stable `data-tour="…"` anchors placed in the app shell.
 */

// Tip rows render as a small bulleted list inside the popover description.
const tips = (intro: string, items: string[]) =>
  `${intro}<ul style="margin:8px 0 0;padding-left:1rem;list-style:disc;color:#5a6560;line-height:1.6">${items
    .map((i) => `<li>${i}</li>`)
    .join("")}</ul>`;

// Action-first onboarding for a new admin: lead with the 3 things that actually
// get an empty workspace running, framed as "do this", then briefly map the rest.
const adminSteps = (name: string): DriveStep[] => [
  { popover: { title: `Welcome to ${name} 👋`, description: "Here's the 1-minute tour: the <b>3 steps to get set up</b>, then where everything else lives." } },
  { element: '[data-tour="nav:Settings"]', popover: { title: "Step 1: Set up your company", side: "bottom", align: "end",
    description: tips("Open <b>Settings → Organization</b> first to set the basics:", ["Company name & <b>email sender name</b> for staff emails", "Your list of <b>designations</b> (job titles)", "<b>Employee ID</b> format"]) } },
  { element: '[data-tour="nav:People"]', popover: { title: "Step 2: Add departments & your team", side: "bottom", align: "start",
    description: tips("Under <b>People</b>:", ["Create your <b>Departments</b>", "<b>Employees → Add</b> one at a time, or <b>Bulk import</b> a CSV/Excel of all staff", "They get an email to set their password & sign in"]) } },
  { element: '[data-tour="nav:Finance"]', popover: { title: "Step 3: Set payroll country & run payroll", side: "bottom", align: "start",
    description: tips("Go to <b>Finance → Payslips</b>:", ["Click <b>Payroll settings</b> to set your <b>country</b>: statutory components, rates & currency follow it", "Generate payslips (HRA/allowances auto-calculated)", "Process a <b>pay run</b> for everyone, approve <b>reimbursements</b>"]) } },
  { popover: { title: "That's the core 🎯", description: "Set up → add people → pay them. Everything below is there when you need it. Here's a 10-second map." } },
  { element: '[data-tour="nav:Time"]', popover: { title: "Time", side: "bottom", align: "start",
    description: "Approve <b>leave</b>, see geo-fenced <b>attendance</b>, and manage the <b>holiday</b> calendar." } },
  { element: '[data-tour="nav:Performance"]', popover: { title: "Performance", side: "bottom", align: "start",
    description: "Run <b>appraisals</b>, set <b>improvement plans</b>, and track <b>work logs</b>." } },
  { element: '[data-tour="nav:Workplace"]', popover: { title: "Workplace", side: "bottom", align: "start",
    description: "<b>Assets</b>, <b>perks</b>, <b>family benefits</b>, well-being and <b>exits</b>: the employee experience." } },
  { element: '[data-tour="nav:Company"]', popover: { title: "Company", side: "bottom", align: "start",
    description: "Post <b>announcements</b>, publish <b>policies</b> & <b>benefits</b> everyone can read." } },
  { element: '[data-tour="search"]', popover: { title: "Tip: ⌘K to go anywhere", description: "Press <b>⌘K</b> anytime to jump to any person or page instantly.", side: "bottom", align: "end" } },
  { element: '[data-tour="nav:Settings"]', popover: { title: "Ready? Start with Step 1 →", description: "Head to <b>Settings → Organization</b> to set up your company. You've got this!", side: "bottom", align: "end" } },
];

// Action-first for employees: the few things you'll actually do, then the rest.
const employeeSteps = (name: string): DriveStep[] => [
  { popover: { title: `Welcome to ${name} 👋`, description: "This is your self-service portal. Here are the <b>things you'll use most</b>. Takes 30 seconds." } },
  { element: '[data-tour="nav:Time"]', popover: { title: "Mark attendance & apply for leave", side: "bottom", align: "start",
    description: tips("Your daily essentials live under <b>Time</b>:", ["<b>Mark attendance</b>: check in when you start work", "<b>My leave</b>: request time off & see your balance", "<b>Holidays</b>: the company calendar"]) } },
  { element: '[data-tour="nav:Finance"]', popover: { title: "Payslips & reimbursements", side: "bottom", align: "start",
    description: tips("Under <b>Finance</b> you can:", ["View & download <b>My payslips</b>", "Raise a <b>reimbursement</b> claim with a bill", "Access <b>My documents</b>"]) } },
  { element: '[data-tour="nav:Workplace"]', popover: { title: "Your assets, perks & well-being", side: "bottom", align: "start",
    description: tips("<b>Workplace</b> has your personal stuff:", ["<b>My assets</b>: your assigned equipment", "<b>Perks & family benefits</b>", "<b>Well-being</b>: confidential check-ins"]) } },
  { element: '[data-tour="nav:Company"]', popover: { title: "Stay in the loop", side: "bottom", align: "start",
    description: tips("<b>Company</b> is for everyone:", ["<b>Announcements</b>: latest company news", "<b>Policies & Benefits</b>: the handbook", "<b>Directory</b>: find colleagues"]) } },
  { element: '[data-tour="search"]', popover: { title: "Tip: ⌘K to go anywhere", description: "Press <b>⌘K</b> anytime to jump to any page instantly.", side: "bottom", align: "end" } },
  { element: '[data-tour="user-menu"]', popover: { title: "You're all set! 🎉", description: "Your profile, password and security live here. A good first step: head to <b>Time → Mark attendance</b>. Welcome aboard!", side: "bottom", align: "end" } },
];

export function ProductTour() {
  const { user, refresh } = useAuth();
  const pathname = usePathname();
  const started = useRef(false);

  useEffect(() => {
    if (!user || started.current) return;
    if (user.tourSeenAt) return;          // already seen → never again
    if (pathname !== "/dashboard") return; // only on the landing page after login
    // Wait a tick so the nav has rendered before driver.js measures elements.
    const t = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      const steps = user.isStaff ? adminSteps(productName()) : employeeSteps(productName());
      // Skip steps whose target isn't on the page (e.g. a hidden nav group).
      const present = steps.filter((s) => !s.element || document.querySelector(s.element as string));
      const markSeen = () => {
        http.post("/auth/tour-complete").then(() => refresh()).catch(() => {});
      };
      const d = driver({
        showProgress: true,
        allowClose: true,
        nextBtnText: "Next →",
        prevBtnText: "Back",
        doneBtnText: "Finish",
        progressText: "{{current}} of {{total}}",
        popoverClass: "app-tour",         // themed via globals.css
        stagePadding: 6,
        stageRadius: 10,
        overlayColor: "#0b3b34",          // deep teal scrim instead of plain black
        overlayOpacity: 0.6,
        steps: present,
        onDestroyed: markSeen, // fires on finish OR skip/close
      });
      d.drive();
    }, 600);
    return () => clearTimeout(t);
  }, [user, pathname, refresh]);

  return null;
}
