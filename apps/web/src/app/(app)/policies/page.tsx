"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Badge } from "@open-hrms/ui/badge";
import { Textarea } from "@open-hrms/ui/textarea";
import { Skeleton } from "@open-hrms/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@open-hrms/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

interface Policy {
  id: string;
  title: string;
  category?: string;
  content?: string;
  version?: string;
  order?: number;
  publishedAt?: string;
}

type PolicyForm = {
  title: string;
  category: string;
  content: string;
  version: string;
};

function emptyForm(): PolicyForm {
  return { title: "", category: "GENERAL", content: "", version: "1.0" };
}

function fromPolicy(p: Policy): PolicyForm {
  return {
    title: p.title ?? "",
    category: p.category ?? "GENERAL",
    content: p.content ?? "",
    version: p.version ?? "1.0",
  };
}

function PolicyDialog({
  policy,
  open,
  onOpenChange,
}: {
  policy: Policy | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const isNew = !policy;
  const [form, setForm] = useState<PolicyForm>(policy ? fromPolicy(policy) : emptyForm());
  const set = (k: keyof PolicyForm, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? http.post("/content/policies", form)
        : http.put(`/content/policies/${policy!.id}`, form),
    onSuccess: () => {
      toast.success(isNew ? "Policy published" : "Policy updated");
      qc.invalidateQueries({ queryKey: ["policies"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Publish policy" : "Edit policy"}</DialogTitle>
          <DialogDescription>
            Policies are visible to everyone in the organisation.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <FormGrid columns={2}>
            <Field label="Title">
              <Input required value={form.title} onChange={(e) => set("title", e.target.value)} />
            </Field>
            <Field label="Category">
              <Input value={form.category} onChange={(e) => set("category", e.target.value)} />
            </Field>
            <Field label="Body" className="sm:col-span-2">
              <Textarea
                required
                rows={10}
                value={form.content}
                onChange={(e) => set("content", e.target.value)}
              />
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
              {isNew ? "Publish" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PolicyReader({
  policyId,
  open,
  onOpenChange,
}: {
  policyId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: policy, isLoading } = useQuery({
    queryKey: ["policy", policyId],
    queryFn: () => http.get<Policy>(`/content/policies/${policyId}`),
    enabled: !!policyId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{policy?.title ?? "Policy"}</span>
            {policy?.category && <Badge variant="grey">{policy.category}</Badge>}
            {policy?.version && (
              <span className="text-xs font-normal text-muted-foreground">
                v{policy.version}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {policy?.content}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PoliciesPage() {
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const [editPolicy, setEditPolicy] = useState<Policy | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [readId, setReadId] = useState<string | null>(null);
  const [readOpen, setReadOpen] = useState(false);

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["policies"],
    queryFn: () => http.get<Policy[]>("/content/policies"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => http.del(`/content/policies/${id}`),
    onSuccess: () => {
      toast.success("Policy deleted");
      qc.invalidateQueries({ queryKey: ["policies"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const openNew = () => {
    setEditPolicy(null);
    setEditOpen(true);
  };
  const openEdit = (p: Policy) => {
    setEditPolicy(p);
    setEditOpen(true);
  };
  const openReader = (p: Policy) => {
    setReadId(p.id);
    setReadOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Policies"
        description="Company policies and guidelines for the team."
        actions={
          isStaff ? (
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> New policy
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="mt-2 h-3 w-1/4" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : policies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <FileText className="h-8 w-8" />
            <p className="font-medium text-foreground">No policies published</p>
            <p>
              {isStaff
                ? "Publish the first policy for your team."
                : "Check back later for company policies."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {policies.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => openReader(p)}
                    className="min-w-0 flex-1 basis-full text-left sm:basis-auto"
                  >
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {/* min-w-0: a flex item defaults to min-width:auto, which stops
                          `truncate` from ever kicking in. */}
                      <span className="min-w-0 truncate hover:underline">{p.title}</span>
                    </CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                      {p.category && <Badge variant="grey">{p.category}</Badge>}
                      {p.version && <span>v{p.version}</span>}
                    </CardDescription>
                  </button>
                  {isStaff && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                        <Pencil className="mr-1 size-4" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete "${p.title}"?`)) remove.mutate(p.id);
                        }}
                      >
                        <Trash2 className="mr-1 size-4" /> Delete
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {readOpen && (
        <PolicyReader
          key={readId ?? "reader"}
          policyId={readId}
          open={readOpen}
          onOpenChange={setReadOpen}
        />
      )}

      {editOpen && (
        <PolicyDialog
          key={editPolicy?.id ?? "new"}
          policy={editPolicy}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </>
  );
}
