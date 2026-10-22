"use client";

/**
 * Removing somebody from the roster.
 *
 * The roster's delete button used to call the PURGE endpoint behind a one-line browser
 * confirm, destroying payslips, attendance, issued letters and separation records outright.
 * Employers are generally required to retain those, and no other feature can reconstruct
 * them. Established HR systems treat archiving as the normal way to remove somebody and
 * permanent deletion as a rare correction for a record created in error, so that is the
 * shape here: archiving is the default action, and destroying is deliberately harder.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { Badge } from "@open-hrms/ui/badge";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Skeleton } from "@open-hrms/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@open-hrms/ui/dialog";
import type { EnrichedEmployee } from "./types";

interface RecordCount {
  repo: string;
  label: string;
  count: number;
  statutory?: boolean;
}

interface DeleteImpact {
  employeeId: string;
  code: string;
  name: string;
  status: string;
  alreadyArchived: boolean;
  records: RecordCount[];
  totalRecords: number;
  hasStatutoryRecords: boolean;
  directReports: Array<{ id: string; name: string; code: string }>;
  portalRoles: string[];
  loginEmail: string | null;
}

export function RemoveEmployeeDialog({
  employee, open, onOpenChange,
}: {
  employee: EnrichedEmployee;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [confirmCode, setConfirmCode] = useState("");
  const [showPermanent, setShowPermanent] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["employees", "delete-impact", employee.id],
    queryFn: () => http.get<DeleteImpact>(`/employees/${employee.id}/delete-impact`),
    enabled: open,
  });

  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["employees"] });
    qc.invalidateQueries({ queryKey: ["letters"] });
    onOpenChange(false);
  };

  const archive = useMutation({
    // confirmStaff is safe to send: the dialog has already shown their portal roles and who
    // reports to them above the button, so the server's one-shot warning has been delivered.
    mutationFn: () =>
      http.del<{ reportsReassigned: number; accessRevoked: boolean }>(`/employees/${employee.id}?confirmStaff=1`),
    onSuccess: (r) => done(
      r.reportsReassigned
        ? `Archived. ${r.reportsReassigned} report(s) moved up the reporting line.`
        : "Archived. Their records are retained and their access is revoked."
    ),
    onError: (e) => toast.error(apiError(e)),
  });

  const purge = useMutation({
    mutationFn: () =>
      http.del(`/employees/${employee.id}?hard=1&confirmStaff=1&confirm=${encodeURIComponent(confirmCode.trim())}`),
    onSuccess: () => done("Permanently deleted"),
    onError: (e) => {
      const raw = apiError(e);
      try {
        const parsed = JSON.parse(raw);
        toast.error(parsed?.message || raw);
        return;
      } catch { /* not structured */ }
      toast.error(raw);
    },
  });

  const codeMatches = !!data && confirmCode.trim().toUpperCase() === data.code.toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Remove {employee.firstName} {employee.lastName}</DialogTitle>
          <DialogDescription>
            {data?.alreadyArchived
              ? "This person is already archived."
              : "Archiving keeps their history and is reversible. Deleting is not."}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="space-y-4">
            {/* What exists today, so the choice is made with the numbers in view. */}
            {data.totalRecords > 0 ? (
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-medium">
                  {data.totalRecords} record{data.totalRecords === 1 ? "" : "s"} on file
                </div>
                <ul className="space-y-0.5 text-sm text-muted-foreground">
                  {data.records.map((r) => (
                    <li key={r.repo} className="flex items-center justify-between gap-2">
                      <span>{r.count} {r.label}</span>
                      {r.statutory && <Badge variant="amber" className="text-[11px]">Retain</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing is attached to this person yet, so there is no history to lose.
              </p>
            )}

            {data.directReports.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                {data.directReports.length} {data.directReports.length === 1 ? "person reports" : "people report"} to
                them ({data.directReports.map((r) => r.name).join(", ")}). They will be moved up to this
                person&apos;s own manager.
              </div>
            )}

            {data.portalRoles.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                They hold portal access ({data.portalRoles.join(", ")}) on {data.loginEmail}. Archiving
                revokes it; deleting removes the login entirely.
              </div>
            )}

            {showPermanent && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm">
                  This permanently destroys everything listed above. It cannot be undone, and records
                  marked <b>Retain</b> are ones an employer is normally required to keep.
                </p>
                <label className="block text-sm">
                  Type <b>{data.code}</b> to confirm
                  <Input
                    className="mt-1"
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    placeholder={data.code}
                    autoComplete="off"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setShowPermanent((v) => !v)}
          >
            {showPermanent ? "Cancel permanent delete" : "Delete permanently"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            {showPermanent ? (
              <Button
                variant="destructive"
                disabled={!codeMatches || purge.isPending}
                onClick={() => purge.mutate()}
              >
                {purge.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete permanently
              </Button>
            ) : (
              <Button
                disabled={archive.isPending || data?.alreadyArchived}
                onClick={() => archive.mutate()}
              >
                {archive.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {data?.alreadyArchived ? "Already archived" : "Archive"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Roster action that opens the dialog. */
export function RemoveEmployeeAction({ employee }: { employee: EnrichedEmployee }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        className="h-auto flex-col gap-1 px-2 py-1.5 text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
        <span className="text-[13px] font-medium leading-none">Remove</span>
      </Button>
      {open && <RemoveEmployeeDialog employee={employee} open onOpenChange={setOpen} />}
    </>
  );
}
