"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiError, http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { employmentTypeLabel } from "@/lib/employment";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@open-hrms/ui/table";

// ── Local types (mirror GET /reports/reporting) ─────────────────────────────
interface ReportingNode {
  id: string;
  name: string;
  code: string;
  designation: string;
  department: string;
  employmentType: string;
  managerId: string | null;
  managerName: string | null;
  directReports: number;
}

interface ReportingResponse {
  nodes: ReportingNode[];
  roots: string[];
}

type BadgeColour = "green" | "amber" | "red" | "blue" | "grey" | "violet";

const TYPE_VARIANT: Record<string, BadgeColour> = {
  FULL_TIME: "green",
  PART_TIME: "amber",
  INTERN: "blue",
  CONTRACT: "violet",
  OUTSOURCED: "grey",
};

// CSV exports offered by the backend, filenames derived from the path.
const CSV_EXPORTS: { path: string; file: string; label: string }[] = [
  { path: "/reports/export/employees.csv", file: "employees.csv", label: "Employees" },
  { path: "/reports/export/payroll.csv", file: "payroll.csv", label: "Payroll" },
  { path: "/reports/export/attendance.csv", file: "attendance.csv", label: "Attendance" },
  { path: "/reports/export/reimbursements.csv", file: "reimbursements.csv", label: "Reimbursements" },
  { path: "/reports/export/vendor-bills.csv", file: "vendor-bills.csv", label: "Vendor bills" },
];

/** Download an authenticated CSV via the api (blob) instance. */
async function downloadCsv(path: string, file: string): Promise<void> {
  const res = await api.get(path, { responseType: "blob" });
  const url = window.URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function ExportButtons() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (path: string, file: string) => {
    setBusy(path);
    try {
      await downloadCsv(path, file);
      toast.success(`${file} downloaded`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {CSV_EXPORTS.map((x) => (
        <Button
          key={x.path}
          size="sm"
          variant="outline"
          disabled={busy === x.path}
          onClick={() => run(x.path, x.file)}
        >
          {busy === x.path ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Download className="mr-2 size-4" />
          )}
          {x.label}
        </Button>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-r border-b border-border bg-card p-5">
      <div className="font-mono text-[13px] font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold">{value}</div>
    </div>
  );
}

export default function ReportingPage() {
  const { isStaff } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["reports", "reporting"],
    queryFn: () => http.get<ReportingResponse>("/reports/reporting"),
    enabled: isStaff,
  });

  const nodes = useMemo(() => data?.nodes ?? [], [data]);

  // Real aggregates derived from the reporting structure the route returns.
  const stats = useMemo(() => {
    const managers = nodes.filter((n) => n.directReports > 0);
    const unassigned = nodes.filter((n) => !n.managerId);
    const byType: Record<string, number> = {};
    for (const n of nodes) byType[n.employmentType] = (byType[n.employmentType] || 0) + 1;
    const span = managers.length
      ? Math.round((managers.reduce((s, m) => s + m.directReports, 0) / managers.length) * 10) / 10
      : 0;
    return { headcount: nodes.length, managers, unassigned, byType, span };
  }, [nodes]);

  if (!isStaff) {
    return (
      <>
        <PageHeader title="Reporting" description="Your organisation&apos;s reporting structure." />
        <Card className="py-12 text-center text-sm text-muted-foreground">
          This area is staff only.
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reporting"
        description="Your organisation&apos;s reporting structure, with downloadable HR exports."
        actions={<ExportButtons />}
      />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Headline aggregates derived from the reporting nodes. */}
          <div className="grid grid-cols-2 border-t border-l border-border sm:grid-cols-4">
            <Stat label="Headcount" value={stats.headcount} />
            <Stat label="Managers" value={stats.managers.length} />
            <Stat label="Unassigned" value={stats.unassigned.length} />
            <Stat label="Avg span" value={stats.span} />
          </div>

          {/* By employment type, a small bordered table over the same nodes. */}
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">By employment type</h3>
            {Object.keys(stats.byType).length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No employees.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(stats.byType)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => {
                    const pct = stats.headcount ? (count / stats.headcount) * 100 : 0;
                    return (
                      <div key={type} className="flex items-center gap-3">
                        <div className="w-28 shrink-0 text-xs text-muted-foreground">
                          {employmentTypeLabel(type)}
                        </div>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(pct, 2)}%` }}
                          />
                        </div>
                        <div className="w-10 shrink-0 text-right text-xs font-medium tabular-nums">
                          {count}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </Card>

          {/* Managers and their direct reports. */}
          {stats.managers.length === 0 ? (
            <Card className="py-12 text-center text-sm text-muted-foreground">
              No reporting relationships set yet. Edit an employee and set &apos;Reports to&apos;.
            </Card>
          ) : (
            stats.managers.map((m) => (
              <Card key={m.id}>
                <div className="flex flex-wrap items-baseline gap-2 border-b px-4 py-3">
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.designation || "-"} {m.department ? `· ${m.department}` : ""}
                  </span>
                  <Badge variant="grey" className="ml-auto">
                    {m.directReports} report{m.directReports === 1 ? "" : "s"}
                  </Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden md:table-cell">Designation</TableHead>
                      <TableHead className="hidden lg:table-cell">Department</TableHead>
                      <TableHead className="hidden sm:table-cell">Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nodes
                      .filter((n) => n.managerId === m.id)
                      .map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <div className="max-w-[16rem] truncate font-medium" title={r.name}>{r.name}</div>
                            <div className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground" title={r.code}>{r.code}</div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{r.designation || "-"}</TableCell>
                          <TableCell className="hidden lg:table-cell">{r.department || "-"}</TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <Badge variant={TYPE_VARIANT[r.employmentType] || "grey"}>
                              {employmentTypeLabel(r.employmentType)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </Card>
            ))
          )}

          {/* Unassigned employees (no manager). */}
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Unassigned (no manager)</h3>
            {stats.unassigned.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stats.unassigned.map((n) => (
                  <Badge key={n.id} variant="grey">
                    {n.name}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
