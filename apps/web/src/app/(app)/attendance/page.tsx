"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, Loader2, MapPin, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { PushRemindersCard } from "@/components/push-reminders";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@open-hrms/ui/tabs";

// --- Local types (mirror the attendance backend route responses) ------------

type AttendanceStatus = "PRESENT" | "REMOTE" | "ABSENT" | "ON_DUTY" | "ON_LEAVE";

interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInOffice?: string | null;
  checkInDistance?: number | null;
  withinFence?: boolean | null;
  workedMinutes?: number;
  halfDay?: boolean;
  regularized?: boolean;
}

interface MeAttendanceResponse {
  today: AttendanceRecord | null;
  records: AttendanceRecord[];
}

interface CheckResponse extends AttendanceRecord {
  message: string;
}

interface OrgAttendanceRow {
  employeeId: string;
  name: string;
  code: string;
  department: string;
  employmentType: string;
  status: AttendanceStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  office: string | null;
  distance: number | null;
  withinFence: boolean | null;
  halfDay: boolean;
  regularized: boolean;
  workedMinutes: number;
}

interface OrgAttendanceResponse {
  date: string;
  rows: OrgAttendanceRow[];
}

interface Coords {
  lat: number;
  lng: number;
}

// --- Helpers -----------------------------------------------------------------

const STATUS_VARIANT: Record<AttendanceStatus, "green" | "blue" | "grey" | "amber"> = {
  PRESENT: "green",
  REMOTE: "blue",
  ON_DUTY: "grey",
  ABSENT: "grey",
  ON_LEAVE: "amber",
};

function StatusBadge({ status }: { status: AttendanceStatus }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "grey"}>{status.replace("_", " ")}</Badge>;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtWorked(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return "-";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function todayMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Read the browser's current position; rejects with a friendly message. */
function getCurrentCoords(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Enable location access to mark attendance."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Your location is unavailable right now. Try again."
              : err.code === err.TIMEOUT
                ? "Getting your location timed out. Try again."
                : "Could not read your location.";
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

// --- My attendance (employee) ------------------------------------------------

function MyAttendance() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(todayMonth());

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "me", month],
    queryFn: () => http.get<MeAttendanceResponse>("/attendance/me", { month }),
  });

  const today = data?.today ?? null;
  const records = data?.records ?? [];
  const checkedIn = !!today?.checkInAt;
  const checkedOut = !!today?.checkOutAt;

  const checkIn = useMutation({
    mutationFn: async () => {
      const coords = await getCurrentCoords();
      return http.post<CheckResponse>("/attendance/check-in", coords);
    },
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const checkOut = useMutation({
    mutationFn: async () => {
      const coords = await getCurrentCoords();
      return http.post<CheckResponse>("/attendance/check-out", coords);
    },
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Today &middot; {todayStr()}</div>
            {isLoading ? (
              <Skeleton className="h-7 w-40" />
            ) : checkedIn ? (
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={today!.status} />
                <span className="text-sm text-muted-foreground">
                  In {fmtTime(today!.checkInAt)}
                  {checkedOut ? ` · Out ${fmtTime(today!.checkOutAt)}` : ""}
                </span>
                {today?.checkInOffice && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-4" />
                    {today.checkInOffice}
                    {today.checkInDistance != null ? ` · ${today.checkInDistance}m` : ""}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-base font-medium">Not checked in yet</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => checkIn.mutate()}
              disabled={checkedIn || checkIn.isPending}
            >
              {checkIn.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="mr-2 h-4 w-4" />
              )}
              Check in
            </Button>
            <Button
              variant="outline"
              onClick={() => checkOut.mutate()}
              disabled={!checkedIn || checkedOut || checkOut.isPending}
            >
              {checkOut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="mr-2 h-4 w-4" />
              )}
              Check out
            </Button>
          </div>
        </div>
      </Card>

      {/* Clocking in happens here, so this is where an employee expects to find
          the switch for being reminded to do it. */}
      <PushRemindersCard />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Label htmlFor="month" className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4" /> Month
          </Label>
          <Input
            id="month"
            type="month"
            className="sm:w-48"
            value={month}
            max={todayMonth()}
            onChange={(e) => setMonth(e.target.value || todayMonth())}
          />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>In</TableHead>
              <TableHead>Out</TableHead>
              <TableHead className="hidden sm:table-cell">Worked</TableHead>
              <TableHead className="hidden md:table-cell">Office / Distance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  No attendance records for this month.
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.date}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                    {r.regularized && (
                      <Badge variant="blue" className="ml-1.5">
                        Regularized
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{fmtTime(r.checkInAt)}</TableCell>
                  <TableCell>{fmtTime(r.checkOutAt)}</TableCell>
                  <TableCell className="hidden sm:table-cell">{fmtWorked(r.workedMinutes)}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {r.checkInOffice
                      ? `${r.checkInOffice}${r.checkInDistance != null ? ` · ${r.checkInDistance}m` : ""}`
                      : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// --- Org attendance (staff) --------------------------------------------------

function OrgAttendance() {
  const [date, setDate] = useState(todayStr());

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "org", date],
    queryFn: () => http.get<OrgAttendanceResponse>("/attendance", { date }),
  });

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="org-date" className="flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4" /> Date
        </Label>
        <Input
          id="org-date"
          type="date"
          className="sm:w-48"
          value={date}
          max={todayStr()}
          onChange={(e) => setDate(e.target.value || todayStr())}
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="hidden md:table-cell">Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>In</TableHead>
              <TableHead>Out</TableHead>
              <TableHead className="hidden sm:table-cell">Worked</TableHead>
              <TableHead className="hidden lg:table-cell">Office / Distance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  No active employees for this date.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.code}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{r.department}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                    {r.halfDay && (
                      <Badge variant="blue" className="ml-1.5">
                        Half day
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{fmtTime(r.checkInAt)}</TableCell>
                  <TableCell>{fmtTime(r.checkOutAt)}</TableCell>
                  <TableCell className="hidden sm:table-cell">{fmtWorked(r.workedMinutes)}</TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {r.office ? `${r.office}${r.distance != null ? ` · ${r.distance}m` : ""}` : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// --- Page --------------------------------------------------------------------

export default function AttendancePage() {
  const { user, isStaff } = useAuth();
  const canMark = !!user?.employeeId;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Geo-fenced daily check-in and history."
      />

      {isStaff ? (
        // Staff with no employee record can't check in, so don't dump them on an
        // empty "My attendance" tab, default to Org attendance and hide the
        // personal tab entirely. Staff who DO have an employee record see both.
        <Tabs defaultValue={canMark ? "me" : "org"}>
          <TabsList>
            {canMark && <TabsTrigger value="me">My attendance</TabsTrigger>}
            <TabsTrigger value="org">Org attendance</TabsTrigger>
          </TabsList>
          {canMark && (
            <TabsContent value="me" className="mt-6">
              <MyAttendance />
            </TabsContent>
          )}
          <TabsContent value="org" className="mt-6">
            <OrgAttendance />
          </TabsContent>
        </Tabs>
      ) : canMark ? (
        <MyAttendance />
      ) : (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          You don&apos;t have an employee record, so there&apos;s nothing to check in.
        </Card>
      )}
    </>
  );
}
