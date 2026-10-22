"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, Building2, Mail } from "lucide-react";
import { http } from "@/lib/api";
import { employmentTypeLabel } from "@/lib/employment";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Input } from "@open-hrms/ui/input";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Avatar, AvatarFallback } from "@open-hrms/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@open-hrms/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-hrms/ui/select";

// Local shapes, mirror the backend GET /api/directory and GET /api/departments
// contracts. Defined here to avoid touching shared types.
interface DirectoryDepartment {
  id: string;
  name: string;
}

interface DirectoryPerson {
  id: string;
  name: string;
  code?: string;
  designation: string;
  department: string;
  employmentType?: string | null;
  email?: string;
  managerName?: string | null;
}

const TYPE_VARIANT: Record<string, "green" | "amber" | "red" | "blue" | "grey" | "violet"> = {
  FULL_TIME: "green",
  PART_TIME: "amber",
  INTERN: "blue",
  CONTRACT: "violet",
  OUTSOURCED: "grey",
};

/** Build initials from a person's display name (e.g. "Ada Lovelace" → "AL"). */
function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export default function DirectoryPage() {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => http.get<DirectoryDepartment[]>("/departments"),
  });

  const { data: people = [], isLoading } = useQuery({
    queryKey: ["directory"],
    queryFn: () => http.get<DirectoryPerson[]>("/directory"),
  });

  const deptName = useMemo(() => {
    if (dept === "all") return null;
    return departments.find((d) => d.id === dept)?.name ?? null;
  }, [dept, departments]);

  const filtered = useMemo(() => {
    return people.filter((p) => {
      if (deptName && p.department !== deptName) return false;
      if (q) {
        const s = q.toLowerCase();
        return `${p.name} ${p.email ?? ""} ${p.code ?? ""} ${p.designation ?? ""} ${p.department}`
          .toLowerCase()
          .includes(s);
      }
      return true;
    });
  }, [people, q, deptName]);

  const deptCount = useMemo(
    () => new Set(people.map((p) => p.department).filter((d) => d && d !== "-")).size,
    [people]
  );

  const stats = [
    { label: "People", value: people.length, icon: Users },
    { label: "Departments", value: deptCount, icon: Building2 },
    { label: "Showing", value: filtered.length, icon: Search },
  ];

  const deptItems = [
    { value: "all", label: "All departments" },
    ...departments.map((d) => ({ value: d.id, label: d.name })),
  ];

  return (
    <>
      <PageHeader title="Directory" description="Find anyone in the company." />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="flex-row items-center gap-3 px-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <s.icon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xl font-semibold leading-none">
                {isLoading ? "-" : s.value}
              </div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, email, designation..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select items={deptItems} value={dept} onValueChange={(v) => setDept(v ?? "all")}>
          <SelectTrigger className="sm:w-56">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            {deptItems.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Designation</TableHead>
              <TableHead className="hidden lg:table-cell">Department</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="hidden xl:table-cell">Reports to</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No people found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarFallback>{initials(p.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.name}</div>
                        {p.email && (
                          <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <Mail className="size-4 shrink-0" />
                            <span className="truncate">{p.email}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {p.designation || "-"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {p.department && p.department !== "-" ? (
                      <Badge variant="grey">{p.department}</Badge>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {p.employmentType ? (
                      <Badge variant={TYPE_VARIANT[p.employmentType] || "grey"}>
                        {employmentTypeLabel(p.employmentType)}
                      </Badge>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-muted-foreground">
                    {p.managerName || "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
