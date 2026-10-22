"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, Users, MapPin, Mail } from "lucide-react";
import { http } from "@/lib/api";
import { employmentTypeLabel } from "@/lib/employment";
import { PageHeader } from "@open-hrms/ui/page-header";
import { OrgLogo } from "@/components/logo-upload";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Skeleton } from "@open-hrms/ui/skeleton";

// Local shapes, mirror GET /api/directory/company.
interface CompanyOrg {
  id: string;
  name: string;
  address?: string;
  [k: string]: unknown;
}

interface CompanyOffice {
  id: string;
  name: string;
  address?: string;
}

interface CompanyDepartmentStat {
  name: string;
  count: number;
}

interface CompanyHrContact {
  name: string;
  email: string;
  role: string;
}

interface EmergencyContactDetail {
  name?: string;
  relation?: string;
  phone?: string;
}

interface CompanyEmergencyContact {
  employee: string;
  code: string;
  contact: EmergencyContactDetail;
}

interface CompanyResponse {
  org: CompanyOrg;
  offices: CompanyOffice[];
  headcount: number;
  byType: Record<string, number>;
  departments: CompanyDepartmentStat[];
  hrContacts: CompanyHrContact[];
  emergencyContacts: CompanyEmergencyContact[];
}

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card className="gap-1 p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold leading-tight">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export default function CompanyPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["company"],
    queryFn: () => http.get<CompanyResponse>("/directory/company"),
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Company" description="Your organisation at a glance." />
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </>
    );
  }

  const typeHint = Object.entries(data.byType)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${count} ${employmentTypeLabel(type)}`)
    .join(" · ");

  return (
    <>
      {/* Renders nothing until an admin uploads a logo in Settings. */}
      <OrgLogo className="mb-5 h-12 max-w-[260px]" alt={`${data.org.name} logo`} />
      <PageHeader title={data.org.name} description="Your organisation at a glance." />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Headcount" value={data.headcount} hint={typeHint || undefined} />
        <StatCard label="Departments" value={data.departments.length} />
        <StatCard label="Offices" value={data.offices.length} />
      </div>

      <Card className="mb-5 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-base font-bold">
          <Building2 className="h-4 w-4 text-muted-foreground" /> Company details
        </h3>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              Organisation
            </dt>
            <dd className="mt-0.5 text-sm">{data.org.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              Registered address
            </dt>
            <dd className="mt-0.5 text-sm">{data.org.address || "-"}</dd>
          </div>
        </dl>

        {data.departments.length > 0 && (
          <div className="mt-5 border-t pt-4">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Departments
            </div>
            <div className="flex flex-wrap gap-2">
              {data.departments.map((d) => (
                <Badge key={d.name} variant="grey">
                  {d.name} · {d.count}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="mb-5 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-base font-bold">
          <MapPin className="h-4 w-4 text-muted-foreground" /> Offices
        </h3>
        {data.offices.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No offices listed.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {data.offices.map((o) => (
              <div key={o.id} className="rounded-[8px] border border-border p-3">
                <div className="text-sm font-semibold">{o.name}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">{o.address || "-"}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-base font-bold">
            <Mail className="h-4 w-4 text-muted-foreground" /> HR &amp; key contacts
          </h3>
          {data.hrContacts.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No HR contacts.</div>
          ) : (
            <div className="space-y-3">
              {data.hrContacts.map((h) => (
                <div
                  key={`${h.email}-${h.role}`}
                  className="flex items-center justify-between gap-3 rounded-[8px] border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{h.name}</div>
                    <a
                      href={`mailto:${h.email}`}
                      className="block truncate text-xs text-muted-foreground hover:underline"
                      title={h.email}
                    >
                      {h.email}
                    </a>
                  </div>
                  <Badge variant="violet" className="shrink-0">{h.role}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-base font-bold">
            <Users className="h-4 w-4 text-muted-foreground" /> Emergency contacts
          </h3>
          {data.emergencyContacts.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No emergency contacts on file yet.
            </div>
          ) : (
            <div className="space-y-3">
              {data.emergencyContacts.map((e) => (
                <div key={e.code} className="rounded-[8px] border border-border p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold" title={e.employee}>{e.employee}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{e.code}</span>
                  </div>
                  <div className="mt-1 text-sm">
                    {e.contact.name || "-"}
                    {e.contact.relation ? (
                      <span className="text-muted-foreground"> · {e.contact.relation}</span>
                    ) : null}
                  </div>
                  {e.contact.phone && (
                    <div className="text-xs text-muted-foreground">{e.contact.phone}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
