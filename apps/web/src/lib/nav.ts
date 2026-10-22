import {
  LayoutDashboard,
  Users,
  Building2,
  CalendarDays,
  Clock,
  Wallet,
  FileText,
  LogOut as LogOutIcon,
  Receipt,
  Handshake,
  Boxes,
  Sparkles,
  BellRing,
  Gift,
  HeartPulse,
  Megaphone,
  Contact,
  CheckSquare,
  UserPlus,
  Network,
  BarChart3,
  CalendarCheck,
  CalendarClock,
  CalendarRange,
  ScrollText,
  BadgeCheck,
  Heart,
  MapPin,
  ClipboardCheck,
  Target,
  Activity,
  Coins,
  ShieldCheck,
  KeyRound,
  Mail,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Show only to staff (isStaff). */
  staff?: boolean;
  /** Show only when the user has a linked employee profile. */
  employeeOnly?: boolean;
  /** Hide from staff, for employee-portal entries whose staff
   *  counterpart already exists under a different label. */
  nonStaff?: boolean;
  /** Label shown to non-staff users instead of `label`, so the employee
   *  portal reads as their own space ("Mark attendance", "My leave")
   *  rather than mirroring the HR console. */
  employeeLabel?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/reminders", label: "Reminders", icon: CheckSquare },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/employees", label: "Employees", icon: Users, staff: true },
      { href: "/onboarding", label: "Onboarding", icon: UserPlus, staff: true },
      // Everyone with an employee record, staff included: HR fill in their own details too.
      { href: "/onboarding/me", label: "My details", icon: BadgeCheck, employeeOnly: true },
      { href: "/directory", label: "Directory", icon: Contact },
      { href: "/org-chart", label: "Org chart", icon: Network },
      { href: "/departments", label: "Departments", icon: Building2, staff: true },
      { href: "/reporting", label: "Reporting", icon: BarChart3, staff: true },
    ],
  },
  {
    label: "Time",
    items: [
      { href: "/leave", label: "Leave", icon: CalendarDays, employeeLabel: "My leave" },
      { href: "/attendance", label: "Attendance", icon: Clock, employeeLabel: "Mark attendance" },
      { href: "/holidays", label: "Holidays", icon: CalendarCheck },
    ],
  },
  {
    label: "Performance",
    items: [
      { href: "/performance?tab=appraisals", label: "Appraisals", icon: ClipboardCheck },
      { href: "/performance?tab=pip", label: "PIP", icon: Target },
      { href: "/performance?tab=worklogs", label: "Work logs", icon: Activity },
      { href: "/weekly-report", label: "Weekly report", icon: CalendarRange, staff: true },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/payroll", label: "Payslips", icon: Wallet, staff: true },
      {
        href: "/payroll",
        label: "My payslips",
        icon: Wallet,
        employeeOnly: true,
        nonStaff: true,
      },
      { href: "/payroll?tab=runs", label: "Pay runs", icon: Coins, staff: true },
      { href: "/reimbursements", label: "Reimbursements", icon: Receipt, employeeLabel: "My reimbursements" },
      { href: "/vendors", label: "Vendors", icon: Handshake, staff: true },
      { href: "/documents", label: "Documents", icon: FileText, employeeLabel: "My documents" },
    ],
  },
  {
    label: "Workplace",
    items: [
      { href: "/separation", label: "Separation", icon: LogOutIcon, staff: true },
      {
        href: "/separation",
        label: "Resignation",
        icon: LogOutIcon,
        employeeOnly: true,
        nonStaff: true,
      },
      { href: "/assets", label: "Assets", icon: Boxes, employeeLabel: "My assets" },
      { href: "/ai-tokens", label: "AI tokens", icon: Sparkles },
      { href: "/perks", label: "Perks", icon: Gift },
      { href: "/family", label: "Family benefits", icon: Heart },
      { href: "/wellbeing", label: "Well-being", icon: HeartPulse },
    ],
  },
  {
    label: "Company",
    items: [
      { href: "/announcements", label: "Announcements", icon: Megaphone },
      { href: "/company", label: "Company", icon: Building2 },
      { href: "/policies", label: "Policies", icon: ScrollText },
      { href: "/benefits", label: "Benefits", icon: BadgeCheck },
      { href: "/offices", label: "Offices", icon: MapPin, staff: true },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings?tab=security", label: "Security", icon: ShieldCheck },
      { href: "/settings?tab=organization", label: "Organization", icon: Building2, staff: true },
      { href: "/settings?tab=users", label: "Users", icon: Users, staff: true },
      { href: "/settings?tab=roles", label: "Roles & permissions", icon: KeyRound, staff: true },
      { href: "/settings?tab=email", label: "Sending email", icon: Mail, staff: true },
      { href: "/settings?tab=letters", label: "Letter templates", icon: FileText, staff: true },
      { href: "/settings?tab=leave", label: "Leave types", icon: CalendarDays, staff: true },
      { href: "/settings?tab=coverage", label: "Leave coverage", icon: CalendarCheck, staff: true },
      { href: "/settings?tab=leave-rules", label: "Leave rules", icon: CalendarClock, staff: true },
      { href: "/settings?tab=reminders", label: "Reminders", icon: BellRing, staff: true },
      { href: "/settings?tab=starter", label: "Starter content", icon: Sparkles, staff: true },
      { href: "/settings?tab=audit", label: "Audit log", icon: ScrollText, staff: true },
    ],
  },
];

/** Who is looking at the nav. Derived from the session in the app shell. */
export interface NavViewer {
  isStaff: boolean;
  /** The user has a linked employee profile (not every staff account does). */
  hasEmployee: boolean;
}

export function isNavItemVisible(item: NavItem, viewer: NavViewer): boolean {
  if (item.staff && !viewer.isStaff) return false;
  if (item.nonStaff && viewer.isStaff) return false;
  if (item.employeeOnly && !viewer.hasEmployee) return false;
  return true;
}

export function navLabel(item: NavItem, viewer: Pick<NavViewer, "isStaff">): string {
  return !viewer.isStaff && item.employeeLabel ? item.employeeLabel : item.label;
}

/** The groups this viewer sees, each holding only its visible items. Empty groups are dropped. */
export function visibleNavGroups(viewer: NavViewer, groups: NavGroup[] = NAV_GROUPS): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => isNavItemVisible(i, viewer)) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Resolve the single nav entry that matches the current location.
 *
 * Several nav entries deliberately share a pathname and differ only by
 * `?tab=` (Performance: appraisals/pip/worklogs, Payroll: payslips/runs, and
 * every Settings entry). Comparing on pathname alone lit every one of them at
 * once. Matching on the tab too, and returning exactly one winner, keeps the
 * highlight honest. Nested entries (/onboarding/me under /onboarding) resolve
 * to the most specific path.
 */
export function resolveActiveHref(
  pathname: string,
  currentTab: string | null,
  groups: NavGroup[] = NAV_GROUPS
): string | null {
  const baseOf = (href: string) => href.split("?")[0] ?? href;
  const matching = groups
    .flatMap((g) => g.items)
    .filter((item) => {
      const base = baseOf(item.href);
      return pathname === base || pathname.startsWith(base + "/");
    });
  if (!matching.length) return null;
  // The most specific path wins, so /onboarding/me lights "My details", not "Onboarding".
  const longest = Math.max(...matching.map((i) => baseOf(i.href).length));
  const onThisPage = matching.filter((i) => baseOf(i.href).length === longest);

  const tabOf = (href: string) => {
    const q = href.split("?")[1];
    return q ? new URLSearchParams(q).get("tab") : null;
  };

  // Exact tab match wins; otherwise the entry with no tab (the page's
  // default view); otherwise the first entry for this path.
  return (
    onThisPage.find((i) => tabOf(i.href) === currentTab)?.href ??
    onThisPage.find((i) => tabOf(i.href) === null)?.href ??
    onThisPage[0]?.href ??
    null
  );
}
