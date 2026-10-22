"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Loader2,
  Download,
  Trash2,
  FileText,
  BadgeCheck,
  Search,
  X,
  Building2,
  Globe,
  Lock,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { http, apiError, downloadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@open-hrms/ui/cn";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Textarea } from "@open-hrms/ui/textarea";
import { Label, FieldHint } from "@open-hrms/ui/label";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Skeleton } from "@open-hrms/ui/skeleton";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@open-hrms/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

/* ── Shapes (mirror apps/api/src/documents.ts) ────────────────────────────── */

type Visibility = "PRIVATE" | "DEPARTMENT" | "ORG";

interface DocCategory {
  value: string;
  label: string;
  group: "IDENTITY" | "EMPLOYMENT" | "FINANCE" | "COMPANY" | "OTHER";
  kyc?: boolean;
  verifiable?: boolean;
  help?: string;
}

interface DocumentRecord {
  id: string;
  employeeId: string | null;
  employeeName: string | null;
  title: string;
  description?: string;
  category: string;
  categoryLabel: string;
  tags: string[];
  visibility: Visibility;
  departmentIds: string[];
  departmentNames: string[];
  originalName?: string;
  sizeBytes?: number;
  verified?: boolean;
  createdAt?: string;
}

interface Meta {
  categories: DocCategory[];
  kyc: DocCategory[];
  visibilities: { value: Visibility; label: string; help: string }[];
}

interface Department { id: string; name: string }
interface EmployeeLite { id: string; firstName: string; lastName?: string; code?: string; status?: string }

const GROUP_LABEL: Record<string, string> = {
  IDENTITY: "Identity & KYC",
  EMPLOYMENT: "Employment",
  FINANCE: "Finance",
  COMPANY: "Company-wide",
  OTHER: "Other",
};

const VIS_ICON = { PRIVATE: Lock, DEPARTMENT: Building2, ORG: Globe } as const;

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(v?: string): string {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/* ── Upload ──────────────────────────────────────────────────────────────── */

function UploadDialog({
  meta,
  departments,
  employees,
  isStaff,
}: {
  meta?: Meta;
  departments: Department[];
  employees: EmployeeLite[];
  isStaff: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState<Visibility>(isStaff ? "ORG" : "PRIVATE");
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState("");

  const reset = () => {
    setFile(null); setTitle(""); setDescription(""); setCategory("GENERAL");
    setTags(""); setVisibility(isStaff ? "ORG" : "PRIVATE"); setDepartmentIds([]); setEmployeeId("");
  };

  const create = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Choose a file first");
      return http.upload<DocumentRecord>("/documents", file, {
        title: title || file.name,
        description,
        category,
        tags,
        visibility,
        departmentIds: departmentIds.join(","),
        ...(employeeId ? { employeeId } : {}),
      });
    },
    onSuccess: () => {
      toast.success("Document uploaded");
      qc.invalidateQueries({ queryKey: ["documents"] });
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const grouped = useMemo(() => {
    const out: Record<string, DocCategory[]> = {};
    for (const c of meta?.categories ?? []) (out[c.group] ??= []).push(c);
    return out;
  }, [meta]);

  const needsDepartments = visibility === "DEPARTMENT" && departmentIds.length === 0;
  const visibilityHelp = meta?.visibilities.find((v) => v.value === visibility)?.help;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload /> Upload document
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload a document</DialogTitle>
            <DialogDescription>
              {isStaff
                ? "Publish a policy to the whole company or specific departments, or file a document against one employee."
                : "Upload a document to your own record. Only you and HR can see it."}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
            className="space-y-6"
          >
            <Field label="File" htmlFor="file" hint="Up to 25 MB.">
              <Input
                id="file"
                type="file"
                required
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
                }}
              />
            </Field>

            <Field label="Title" htmlFor="title">
              <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Leave Policy 2026" />
            </Field>

            <FormGrid columns={2}>
              <Field label="Type">
                <Select value={category} onValueChange={(v) => setCategory(String(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(grouped).map(([group, items], i) => (
                      <SelectGroup key={group}>
                        {i > 0 && <SelectSeparator />}
                        <SelectLabel>{GROUP_LABEL[group] ?? group}</SelectLabel>
                        {items.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {isStaff && (
                <Field label="Who can see it">
                  <Select value={visibility} onValueChange={(v) => setVisibility(String(v) as Visibility)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(meta?.visibilities ?? []).map((v) => (
                        <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {/* The visibility help sits on the grid's next row rather than in the Field's
                  `hint`: inside the cell it would push that select up by its own height and
                  knock the row out of line with Type, which is the thing Field prevents. */}
              {isStaff && visibilityHelp && (
                <FieldHint className="-mt-2.5 sm:col-start-2">{visibilityHelp}</FieldHint>
              )}
            </FormGrid>

            {isStaff && visibility === "DEPARTMENT" && (
              <div className="space-y-3 rounded-[14px] border border-border bg-muted/40 p-4">
                <Label>Departments</Label>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {departments.map((d) => (
                    <Label key={d.id} className="gap-3">
                      <Checkbox
                        checked={departmentIds.includes(d.id)}
                        onCheckedChange={(c) =>
                          setDepartmentIds((prev) =>
                            c ? [...prev, d.id] : prev.filter((x) => x !== d.id)
                          )
                        }
                      />
                      {d.name}
                    </Label>
                  ))}
                </div>
                {needsDepartments && (
                  <p className="flex items-center gap-2 text-[14px] font-medium text-destructive">
                    <ShieldAlert className="size-4" /> Choose at least one department.
                  </p>
                )}
              </div>
            )}

            {isStaff && visibility === "PRIVATE" && (
              <Field
                label="Attach to an employee"
                hint="Leave blank to keep it as a private company document."
              >
                <Select value={employeeId} onValueChange={(v) => setEmployeeId(String(v))}>
                  <SelectTrigger><SelectValue placeholder="Choose an employee" /></SelectTrigger>
                  <SelectContent>
                    {employees.filter((e) => e.status !== "EXITED").map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {`${e.firstName} ${e.lastName ?? ""}`.trim()}{e.code ? ` (${e.code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field label="Tags" htmlFor="tags" hint="Comma-separated. Tags are searchable.">
              <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="leave, 2026, policy" />
            </Field>

            <Field label="Description" htmlFor="description">
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this document covers, and who it applies to." />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending || !file || needsDepartments}>
                {create.isPending && <Loader2 className="animate-spin" />} Upload
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function DocumentsPage() {
  const qc = useQueryClient();
  const { isStaff } = useAuth();

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("ALL");
  const [visibility, setVisibility] = useState("ALL");
  const [departmentId, setDepartmentId] = useState("ALL");

  const { data: meta } = useQuery({
    queryKey: ["documents-meta"],
    queryFn: () => http.get<Meta>("/documents/meta"),
  });
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => http.get<Department[]>("/departments"),
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => http.get<EmployeeLite[]>("/employees"),
    enabled: isStaff,
  });

  const params = {
    ...(q ? { q } : {}),
    ...(category !== "ALL" ? { category } : {}),
    ...(visibility !== "ALL" ? { visibility } : {}),
    ...(departmentId !== "ALL" ? { departmentId } : {}),
  };

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["documents", params],
    queryFn: () => http.get<DocumentRecord[]>("/documents", params),
  });

  const remove = useMutation({
    mutationFn: (id: string) => http.del(`/documents/${id}`),
    onSuccess: () => {
      toast.success("Document deleted");
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const verify = useMutation({
    mutationFn: ({ id, verified }: { id: string; verified: boolean }) =>
      http.post(`/documents/${id}/verify`, { verified }),
    onSuccess: () => {
      toast.success("Verification updated");
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const download = async (d: DocumentRecord) => {
    try {
      await downloadFile(`/documents/${d.id}/download`, d.originalName || d.title);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const filtersActive = q || category !== "ALL" || visibility !== "ALL" || departmentId !== "ALL";
  const clearFilters = () => { setQ(""); setCategory("ALL"); setVisibility("ALL"); setDepartmentId("ALL"); };

  return (
    <>
      <PageHeader
        title="Documents"
        description={
          isStaff
            ? "The company document library and every employee's filed paperwork, searchable in one place."
            : "Company policies published to you, plus your own filed documents."
        }
        actions={
          <UploadDialog meta={meta} departments={departments} employees={employees} isStaff={isStaff} />
        }
      />

      {/* Search + filters */}
      <Card className="mb-6">
        <div className="flex flex-col gap-4 px-6 lg:flex-row lg:items-end">
          <div className="flex-1 space-y-2.5">
            <Label htmlFor="doc-search">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
              <Input
                id="doc-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Title, tag, description, file name or person"
                className="pl-11"
              />
            </div>
          </div>

          <div className="grid flex-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2.5">
              <Label>Type</Label>
              <Select value={category} onValueChange={(v) => setCategory(String(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  {(meta?.categories ?? []).map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2.5">
              <Label>Visibility</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(String(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Any</SelectItem>
                  {(meta?.visibilities ?? []).map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2.5">
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={(v) => setDepartmentId(String(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Any</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {filtersActive && (
            <Button variant="ghost" onClick={clearFilters}>
              <X /> Clear
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead className="hidden lg:table-cell">Visible to</TableHead>
              <TableHead className="hidden xl:table-cell">Uploaded</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-7 w-full" /></TableCell></TableRow>
              ))
            ) : docs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-16 text-center">
                  <FileText className="mx-auto size-9 text-muted-foreground/50" />
                  <p className="mt-4 text-[17px] font-medium">
                    {filtersActive ? "Nothing matches those filters" : "No documents yet"}
                  </p>
                  <p className="mt-1.5 text-[15px] text-muted-foreground">
                    {filtersActive
                      ? "Try a different search, or clear the filters."
                      : "Upload a policy, handbook or employee document to get started."}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              docs.map((d) => {
                const VisIcon = VIS_ICON[d.visibility] ?? Lock;
                return (
                  <TableRow key={d.id}>
                    <TableCell className="max-w-[420px] whitespace-normal">
                      <div className="flex items-start gap-3">
                        <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{d.title}</span>
                            {d.verified && (
                              <Badge variant="green"><BadgeCheck /> Verified</Badge>
                            )}
                          </div>
                          {d.description && (
                            <p className="mt-1 text-[14px] leading-[20px] text-muted-foreground">{d.description}</p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                            {d.employeeName && <span>{d.employeeName}</span>}
                            <span>{formatSize(d.sizeBytes)}</span>
                            {d.tags.map((t) => (
                              <button
                                key={t}
                                onClick={() => setQ(t)}
                                className="rounded-full bg-muted px-2 py-0.5 text-[13px] hover:bg-accent hover:text-accent-foreground"
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="grey">{d.categoryLabel}</Badge>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal lg:table-cell">
                      <span className="inline-flex items-center gap-2 text-[14px] text-muted-foreground">
                        <VisIcon className="size-4" />
                        {d.visibility === "ORG"
                          ? "Everyone"
                          : d.visibility === "DEPARTMENT"
                            ? d.departmentNames.join(", ") || "All departments"
                            : d.employeeName || "Private"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-[14px] text-muted-foreground">
                      {formatDate(d.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => download(d)}>
                          <Download /> <span className="hidden sm:inline">Download</span>
                        </Button>
                        {isStaff && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={verify.isPending}
                            onClick={() => verify.mutate({ id: d.id, verified: !d.verified })}
                          >
                            <BadgeCheck className={cn(d.verified && "text-[color:var(--ok)]")} />
                            <span className="hidden sm:inline">{d.verified ? "Unverify" : "Verify"}</span>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(d.id)}
                        >
                          <Trash2 /> <span className="hidden sm:inline">Delete</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
