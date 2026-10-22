"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Loader2,
  Pencil,
  Trash2,
  Gift,
  Heart,
  Clock,
  Monitor,
  TrendingUp,
  Banknote,
  Activity,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Textarea } from "@open-hrms/ui/textarea";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Card } from "@open-hrms/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

interface Benefit {
  id: string;
  title: string;
  category?: string;
  description?: string;
  order?: number;
}

type BenefitForm = {
  title: string;
  category: string;
  description: string;
};

const BENEFIT_ICON: Record<string, LucideIcon> = {
  HEALTH: Heart,
  LEAVE: Clock,
  WORK: Monitor,
  GROWTH: TrendingUp,
  REIMBURSEMENT: Banknote,
  WELLNESS: Activity,
  REWARDS: Gift,
  WORKPLACE: LayoutGrid,
};

function iconFor(category?: string): LucideIcon {
  return BENEFIT_ICON[(category ?? "").toUpperCase()] ?? Gift;
}

function emptyForm(): BenefitForm {
  return { title: "", category: "GENERAL", description: "" };
}

function fromBenefit(b: Benefit): BenefitForm {
  return {
    title: b.title ?? "",
    category: b.category ?? "GENERAL",
    description: b.description ?? "",
  };
}

function BenefitDialog({
  benefit,
  open,
  onOpenChange,
}: {
  benefit: Benefit | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const isNew = !benefit;
  const [form, setForm] = useState<BenefitForm>(benefit ? fromBenefit(benefit) : emptyForm());
  const set = (k: keyof BenefitForm, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? http.post("/content/benefits", form)
        : http.put(`/content/benefits/${benefit!.id}`, form),
    onSuccess: () => {
      toast.success(isNew ? "Benefit added" : "Benefit updated");
      qc.invalidateQueries({ queryKey: ["benefits"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add benefit" : "Edit benefit"}</DialogTitle>
          <DialogDescription>
            Benefits are visible to everyone in the workspace.
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
            <Field label="Description" className="sm:col-span-2">
              <Textarea
                rows={5}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
              {isNew ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BenefitDetailDialog({
  benefit,
  open,
  onOpenChange,
  canEdit,
  onEdit,
}: {
  benefit: Benefit | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canEdit: boolean;
  onEdit: (b: Benefit) => void;
}) {
  if (!benefit) return null;
  const Icon = iconFor(benefit.category);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              {benefit.category && (
                <div className="text-[13px] font-medium text-muted-foreground">
                  {benefit.category}
                </div>
              )}
              <DialogTitle>{benefit.title}</DialogTitle>
            </div>
          </div>
          <DialogDescription className="sr-only">Benefit details</DialogDescription>
        </DialogHeader>
        {benefit.description ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
            {benefit.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No further details provided.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canEdit && (
            <Button
              onClick={() => {
                onOpenChange(false);
                onEdit(benefit);
              }}
            >
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BenefitsPage() {
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const [dialogBenefit, setDialogBenefit] = useState<Benefit | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailBenefit, setDetailBenefit] = useState<Benefit | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: benefits = [], isLoading } = useQuery({
    queryKey: ["benefits"],
    queryFn: () => http.get<Benefit[]>("/content/benefits"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => http.del(`/content/benefits/${id}`),
    onSuccess: () => {
      toast.success("Benefit deleted");
      qc.invalidateQueries({ queryKey: ["benefits"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const openNew = () => {
    setDialogBenefit(null);
    setDialogOpen(true);
  };
  const openEdit = (b: Benefit) => {
    setDialogBenefit(b);
    setDialogOpen(true);
  };
  const openDetail = (b: Benefit) => {
    setDetailBenefit(b);
    setDetailOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Benefits"
        description="The benefits and perks available to the team at this workspace."
        actions={
          isStaff ? (
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> New benefit
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : benefits.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No benefits listed.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {benefits.map((b) => {
            const Icon = iconFor(b.category);
            return (
              <Card
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(b)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDetail(b);
                  }
                }}
                className="cursor-pointer p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        {b.category && (
                          <div className="text-[13px] font-medium text-muted-foreground">
                            {b.category}
                          </div>
                        )}
                        <h4 className="text-sm font-semibold leading-tight">{b.title}</h4>
                      </div>
                      {isStaff && (
                        <div className="flex shrink-0 gap-0.5">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Edit ${b.title}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(b);
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Delete ${b.title}`}
                            disabled={remove.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Delete "${b.title}"?`)) remove.mutate(b.id);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </div>
                    {b.description && (
                      <p
                        className="mt-1.5 line-clamp-3 text-sm leading-snug text-muted-foreground"
                        title={b.description}
                      >
                        {b.description}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {dialogOpen && (
        <BenefitDialog
          key={dialogBenefit?.id ?? "new"}
          benefit={dialogBenefit}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}

      {detailOpen && (
        <BenefitDetailDialog
          key={detailBenefit?.id ?? "detail"}
          benefit={detailBenefit}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          canEdit={isStaff}
          onEdit={openEdit}
        />
      )}
    </>
  );
}
