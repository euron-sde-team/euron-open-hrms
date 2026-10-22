"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Send, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { splitEmailList } from "@/lib/email-list";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label } from "@open-hrms/ui/label";
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

// ── Local types (mirror GET /reports/weekly) ────────────────────────────────
interface WeeklyRow {
  employeeId: string;
  name: string;
  department: string;
  daysLogged: number;
  hours: number;
  avgProductivity: number;
  daysPresent: number;
  manager: string;
}

interface WeeklyDigest {
  from: string;
  to: string;
  headcount: number;
  totalHours: number;
  avgProductivity: number;
  topPerformers: WeeklyRow[];
  needsAttention: WeeklyRow[];
  activePips: number;
  rows: WeeklyRow[];
}

interface SendResult {
  ok: boolean;
  recipients: string[];
  mailMode: string;
  digest: { headcount: number; avgProductivity: number; totalHours: number };
}

const fmtDate = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "-";

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

/**
 * Send the digest. The API always mails the workspace's admins and HR plus the
 * recipients configured in Settings, Organization; the optional field here adds
 * one-off addresses for this send only.
 */
function SendWeeklyButton() {
  const [result, setResult] = useState<SendResult | null>(null);
  const [extra, setExtra] = useState("");
  const send = useMutation({
    mutationFn: () => {
      const extraRecipients = splitEmailList(extra);
      return http.post<SendResult>(
        "/reports/weekly/send",
        extraRecipients.length ? { extraRecipients } : {}
      );
    },
    onSuccess: (r) => {
      setResult(r);
      const verb = r.mailMode === "outbox" ? "saved to outbox for" : "sent to";
      toast.success(`Weekly report ${verb} ${r.recipients.join(", ")}`);
    },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
      {result && (
        <span
          className="hidden items-center gap-1.5 text-xs font-medium text-[var(--ok)] sm:inline-flex"
          title={`Recipients: ${result.recipients.join(", ")}`}
        >
          <CheckCircle2 className="size-4" />
          {result.mailMode === "outbox" ? "Saved to outbox" : "Sent"} · {result.recipients.length} recipient{result.recipients.length === 1 ? "" : "s"}
        </span>
      )}
      <Label htmlFor="weekly-extra" className="sr-only">
        Also send to
      </Label>
      <Input
        id="weekly-extra"
        className="w-full sm:w-72"
        inputMode="email"
        placeholder="Also send to (optional, comma separated)"
        value={extra}
        onChange={(e) => setExtra(e.target.value)}
      />
      <Button onClick={() => send.mutate()} disabled={send.isPending}>
        {send.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-2 h-4 w-4" />
        )}
        {result ? "Resend" : "Send to admins & HR"}
      </Button>
    </div>
  );
}

export default function WeeklyReportPage() {
  const { isStaff } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["reports", "weekly"],
    queryFn: () => http.get<WeeklyDigest>("/reports/weekly"),
    enabled: isStaff,
  });

  if (!isStaff) {
    return (
      <>
        <PageHeader title="Weekly report" description="Automated weekly productivity digest." />
        <Card className="py-12 text-center text-sm text-muted-foreground">
          This area is staff only.
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Weekly report"
        description={
          data
            ? `Productivity digest · ${fmtDate(data.from)} to ${fmtDate(data.to)} · for managers, HR and the CXO suite.`
            : "Automated weekly productivity digest for managers, HR and the CXO suite."
        }
        actions={<SendWeeklyButton />}
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 border-t border-l border-border sm:grid-cols-4">
            <Stat label="Headcount" value={data.headcount} />
            <Stat label="Hours logged" value={data.totalHours} />
            <Stat label="Avg productivity" value={`${data.avgProductivity}/10`} />
            <Stat label="Active PIPs" value={data.activePips} />
          </div>

          {/* Top performers. */}
          <Card>
            <div className="border-b px-4 py-3 text-sm font-semibold">Top performers</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="hidden sm:table-cell">Department</TableHead>
                  <TableHead className="text-right">Productivity</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Hours</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Present</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topPerformers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                      No data this week.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.topPerformers.map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell className="max-w-xs truncate font-medium" title={r.name}>{r.name}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {r.department || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="green">{r.avgProductivity}/10</Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right tabular-nums">
                        {r.hours}h
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right tabular-nums">
                        {r.daysPresent} days
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Needs attention. */}
          <Card>
            <div className="border-b px-4 py-3 text-sm font-semibold">
              Needs attention ({data.needsAttention.length})
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="hidden sm:table-cell">Department</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="hidden md:table-cell">Manager</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.needsAttention.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                      Everyone on track.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.needsAttention.map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell className="max-w-xs truncate font-medium" title={r.name}>{r.name}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {r.department || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.daysLogged ? (
                          <Badge variant="amber">{r.avgProductivity}/10</Badge>
                        ) : (
                          <Badge variant="red">No logs</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {r.manager || "·"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
