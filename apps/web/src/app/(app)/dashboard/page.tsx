"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, Wallet, Clock, CalendarDays, Receipt, type LucideIcon } from "lucide-react";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/currency";
import { employmentBreakdown } from "@/lib/employment";
import { PageHeader } from "@open-hrms/ui/page-header";
import { OnboardingPendingBanner } from "@/components/onboarding/pending-banner";
import { Card, CardContent } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";

interface QuickAction {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
  { href: "/onboarding", label: "Onboard employee", icon: UserPlus, primary: true },
  { href: "/payroll", label: "Run payroll", icon: Wallet },
  { href: "/attendance", label: "Today's attendance", icon: Clock },
  { href: "/leave", label: "Review leave", icon: CalendarDays },
];

// Employee-portal counterpart: the four everyday actions, with marking
// today's attendance as the headline action.
const EMPLOYEE_QUICK_ACTIONS: QuickAction[] = [
  { href: "/attendance", label: "Mark attendance", icon: Clock, primary: true },
  { href: "/leave", label: "Apply for leave", icon: CalendarDays },
  { href: "/payroll", label: "My payslips", icon: Wallet },
  { href: "/reimbursements", label: "Submit reimbursement", icon: Receipt },
];

function QuickActionsCard({ actions }: { actions: QuickAction[] }) {
  return (
    <Card className="mt-6">
      <CardContent>
        <h3 className="mb-3 text-lg font-bold tracking-tight">Quick actions</h3>
        <div className="flex flex-wrap gap-2.5">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.href}
                href={a.href}
                className={
                  "inline-flex items-center gap-2 rounded-[6px] border px-4 py-2 text-[13px] font-semibold transition-colors " +
                  (a.primary
                    ? "border-primary bg-primary text-primary-foreground hover:bg-[var(--accent-700)]"
                    : "border-border bg-card text-foreground hover:bg-muted")
                }
              >
                <Icon className="h-4 w-4" /> {a.label}
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface Dashboard {
  employees: number;
  byType: Record<string, number>;
  departments: number;
  pendingLeaves: number;
  attendanceToday: { present: number; remote: number; absent: number; total: number };
  monthlyPayrollNet: number;
  payrollCurrency?: string;
  isStaff: boolean;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="border-r border-b border-border bg-card p-5">
      <div className="font-mono text-[13px] font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold tracking-tight leading-none">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { user, isStaff } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => http.get<Dashboard>("/reports/dashboard"),
    enabled: isStaff,
  });

  if (!isStaff) {
    return (
      <>
        <PageHeader title={`Welcome, ${user?.name?.split(" ")[0] || "there"}`} description="Your workspace at a glance." />
        <OnboardingPendingBanner className="mb-6" />
        {user?.employeeId ? (
          <QuickActionsCard actions={EMPLOYEE_QUICK_ACTIONS} />
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Your account isn&apos;t linked to an employee profile, so personal features
              (attendance, leave, payslips) don&apos;t apply. You can still see company
              information and your team.
            </CardContent>
          </Card>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Dashboard" description="Headline numbers for your organisation." />
      {/* HR have their own details to complete too, so this sits above the org numbers. */}
      <OnboardingPendingBanner className="mb-6" />
      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 border-t border-l border-border sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Employees" value={data.employees} hint={employmentBreakdown(data.byType)} />
          <Stat label="Departments" value={data.departments} />
          <Stat label="Pending leave" value={data.pendingLeaves} hint="Awaiting approval" />
          <Stat
            label="Present today"
            value={`${data.attendanceToday.present + data.attendanceToday.remote}/${data.attendanceToday.total}`}
            hint={`${data.attendanceToday.remote} remote, ${data.attendanceToday.absent} absent`}
          />
          <Stat
            label="Payroll (net, this month)"
            value={formatMoney(data.monthlyPayrollNet, data.payrollCurrency || "INR")}
          />
        </div>
      )}

      <QuickActionsCard actions={QUICK_ACTIONS} />
    </>
  );
}
