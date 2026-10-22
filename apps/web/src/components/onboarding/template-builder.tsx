"use client";

/**
 * The onboarding form builder.
 *
 * Modelled on the letter-template editor: a palette served by the API (GET
 * /onboarding-templates/meta) drives every choice offered, so the UI can never present an
 * option the server's validator will refuse. Saving posts the whole document and surfaces
 * the server's error verbatim, naming the section and field.
 *
 * The one idea worth understanding before editing here is `mapsTo`. A field either writes to
 * the employee record or it does not, and only a fixed allowlist of destinations exists.
 * Anything else is collected against the case alone. That is what makes it safe to let a
 * tenant build their own form: nobody can point a self-service question at compensation.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, Loader2, Plus, Save, Trash2, Star, Archive, ShieldAlert, Sparkles, Eye } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { Button } from "@open-hrms/ui/button";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Input } from "@open-hrms/ui/input";
import { Textarea } from "@open-hrms/ui/textarea";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { SectionForm } from "@/components/onboarding/section-form";
import type { OnboardingCase } from "@/lib/onboarding-forms";
import { CURRENT_EMPLOYMENT_TYPES } from "@/lib/employment";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@open-hrms/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@open-hrms/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@open-hrms/ui/select";
import { cn } from "@open-hrms/ui/cn";
import type {
  BuilderMeta, OnboardingTemplate, TemplateField, TemplateSection, SectionKind, FieldType,
} from "@/lib/onboarding-forms";

const STATUS_VARIANT = { DRAFT: "grey", ACTIVE: "green", ARCHIVED: "amber" } as const;

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";

/* ── Field editor ───────────────────────────────────────────────────────────────────── */

function FieldEditor({
  field, meta, onChange, onRemove,
}: {
  field: TemplateField;
  meta: BuilderMeta;
  onChange: (f: TemplateField) => void;
  onRemove: () => void;
}) {
  const mapped = meta.mappablePaths.find((p) => p.path === field.mapsTo);
  const needsOptions = field.type === "select" || field.type === "multiselect";

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold text-muted-foreground">{field.key}</p>
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove field">
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <FormGrid columns={2}>
        <Field label="Question" htmlFor={`${field.key}-label`} required>
          <Input
            id={`${field.key}-label`}
            value={field.label}
            onChange={(e) => onChange({ ...field, label: e.target.value })}
          />
        </Field>
        <Field label="Answer type" htmlFor={`${field.key}-type`}>
          <Select
            items={meta.fieldTypes.map((t) => ({ value: t.value, label: t.label }))}
            value={field.type}
            onValueChange={(v) => onChange({ ...field, type: v as FieldType })}
          >
            <SelectTrigger id={`${field.key}-type`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {meta.fieldTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </FormGrid>

      {needsOptions && (
        <Field label="Choices" hint="One per line.">
          <Textarea
            rows={3}
            value={(field.options ?? []).join("\n")}
            onChange={(e) => onChange({ ...field, options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          />
        </Field>
      )}

      <FormGrid columns={2}>
        <Field label="Format check" htmlFor={`${field.key}-pattern`} hint="Validates the answer's shape.">
          <Select
            items={[{ value: "", label: "None" }, ...meta.patterns.map((p) => ({ value: p.key, label: p.label }))]}
            value={field.pattern ?? ""}
            onValueChange={(v) => onChange({ ...field, pattern: String(v) || undefined })}
          >
            <SelectTrigger id={`${field.key}-pattern`}><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {meta.patterns.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Save onto the employee record as"
          htmlFor={`${field.key}-maps`}
          hint="Leave blank to collect the answer without changing their record."
        >
          <Select
            items={[{ value: "", label: "Do not save to the record" }, ...meta.mappablePaths.map((p) => ({ value: p.path, label: p.label }))]}
            value={field.mapsTo ?? ""}
            onValueChange={(v) => onChange({ ...field, mapsTo: String(v) || undefined })}
          >
            <SelectTrigger id={`${field.key}-maps`}><SelectValue placeholder="Do not save to the record" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Do not save to the record</SelectItem>
              {meta.mappablePaths.map((p) => (
                <SelectItem key={p.path} value={p.path}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FormGrid>

      {mapped?.tier === "FINANCIAL" && (
        <p className="flex items-start gap-2 rounded-md border border-[color:var(--warn)]/30 p-2.5 text-[12px] text-[color:var(--warn)]">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          This is where their salary is paid. HR reviews every change before it takes effect.
        </p>
      )}

      <Field label="Helper text" hint="Shown under the question.">
        <Input value={field.help ?? ""} onChange={(e) => onChange({ ...field, help: e.target.value || undefined })} />
      </Field>

      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <Checkbox
          checked={!!field.required}
          onCheckedChange={(c: boolean) => onChange({ ...field, required: c })}
        />
        Required
      </label>
    </Card>
  );
}

/* ── Template editor ────────────────────────────────────────────────────────────────── */


/**
 * What the person filling this in will actually see.
 *
 * Renders the DRAFT through the same SectionForm the employee and candidate use, rather than a
 * separate mock-up of it: a preview that is its own implementation drifts from the real form,
 * and then it is worse than no preview because it is confidently wrong. Read-only, and driven
 * off an empty synthetic case so nothing here can touch real data.
 */
function PreviewDialog({ doc }: { doc: OnboardingTemplate }) {
  const [open, setOpen] = useState(false);

  // A blank case in the shape SectionForm expects. Never saved, never sent anywhere.
  const blankCase = {
    id: "preview",
    sections: {},
    documents: [],
    acknowledgments: [],
    declaration: null,
    assets: { acknowledged: [], declared: [] },
  } as unknown as OnboardingCase;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Eye className="size-4" /> Preview
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{doc.name || "Untitled form"}</DialogTitle>
            <DialogDescription>
              Exactly what the employee or candidate sees, in order. Read-only, and unsaved
              changes are included so you can check wording before you save.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-8">
            {doc.sections.map((section, i) => (
              <section key={section.key}>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Step {i + 1} of {doc.sections.length}
                  {section.optional ? " · optional" : ""}
                </p>
                <h3 className="mb-4 text-[18px] font-semibold tracking-[-0.01em]">{section.title}</h3>
                <SectionForm
                  section={section}
                  caseData={blankCase}
                  base=""
                  errors={[]}
                  disabled
                  values={{}}
                  rows={[]}
                  onValues={() => {}}
                  onRows={() => {}}
                  onRefresh={() => {}}
                  policies={[]}
                />
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TemplateEditor({
  template, meta, onClose,
}: {
  template: OnboardingTemplate;
  meta: BuilderMeta;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [doc, setDoc] = useState<OnboardingTemplate>(template);
  const [selected, setSelected] = useState(0);

  useEffect(() => { setDoc(template); setSelected(0); }, [template.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const section = doc.sections[selected];

  const setSection = (patch: Partial<TemplateSection>) =>
    setDoc({ ...doc, sections: doc.sections.map((s, i) => (i === selected ? { ...s, ...patch } : s)) });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= doc.sections.length) return;
    const next = [...doc.sections];
    const [row] = next.splice(from, 1);
    if (!row) return;
    next.splice(to, 0, row);
    setDoc({ ...doc, sections: next });
    setSelected(to);
  };

  const addSection = (kind: SectionKind) => {
    const label = meta.sectionKinds.find((k) => k.value === kind)?.label ?? "Section";
    const base: TemplateSection = {
      key: `${slug(label)}_${doc.sections.length + 1}`,
      kind,
      title: label,
      ...(kind === "ASSETS" ? { assets: { mode: "BOTH" as const } } : {}),
      ...(kind === "DECLARATION" ? { declarationText: "I confirm the information I have given is true and complete." } : {}),
      ...(["FIELDS", "BANK", "EMPLOYMENT_HISTORY", "EDUCATION", "DEPENDENTS"].includes(kind)
        ? { fields: [{ key: "field_1", label: "New question", type: "text" as FieldType }] }
        : {}),
      ...(kind === "DOCUMENTS" ? { documents: [{ category: "PAN", required: true }] } : {}),
    };
    setDoc({ ...doc, sections: [...doc.sections, base] });
    setSelected(doc.sections.length);
  };

  const save = useMutation({
    mutationFn: () => http.put<OnboardingTemplate>(`/onboarding-templates/${doc.id}`, doc),
    onSuccess: (t) => {
      toast.success(`Saved. Version ${t.version}.`);
      qc.invalidateQueries({ queryKey: ["onboarding-templates"] });
      setDoc(t);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Input
            value={doc.name}
            className="h-auto border-0 px-0 text-[22px] font-semibold shadow-none focus-visible:ring-0"
            onChange={(e) => setDoc({ ...doc, name: e.target.value })}
          />
          <p className="text-[12px] text-muted-foreground">
            {doc.sections.length} sections · version {doc.version}
            {doc.presetKey && ` · from the ${doc.presetKey.replace(/_/g, " ").toLowerCase()} preset`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Back to list</Button>
          <PreviewDialog doc={doc} />
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
          </Button>
        </div>
      </div>

      <FormGrid columns={3}>
        <Field label="Days to complete" hint="Used when a campaign sets no deadline.">
          <Input
            type="number"
            min={1}
            value={doc.dueDays}
            onChange={(e) => setDoc({ ...doc, dueDays: Number(e.target.value) })}
          />
        </Field>
        <Field label="Reminder days" hint="Relative to the deadline. Negative is before, e.g. -3, -1, 1.">
          <Input
            value={(doc.reminderOffsets ?? []).join(", ")}
            onChange={(e) =>
              setDoc({
                ...doc,
                reminderOffsets: e.target.value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)),
              })
            }
          />
        </Field>
        <Field label="Tell the manager after" hint="Days past the deadline. 0 switches it off.">
          <Input
            type="number"
            min={0}
            value={doc.escalateAfterDays}
            onChange={(e) => setDoc({ ...doc, escalateAfterDays: Number(e.target.value) })}
          />
        </Field>
      </FormGrid>

      {/*
        Assignment rules. The resolver has always honoured these (it is how the shorter form
        reaches interns and freelancers), but there was no way to see or change them, so a
        tenant could only ever have one form in practice: the default.
      */}
      <Field
        label="Use this form for"
        hint="Leave all unselected to use it for everyone. The default form covers anyone no rule matches."
      >
        <div className="flex flex-wrap gap-1.5">
          {CURRENT_EMPLOYMENT_TYPES.map((t) => {
            const on = (doc.appliesTo?.employmentTypes ?? []).includes(t.value);
            return (
              <Button
                key={t.value}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                onClick={() => {
                  const cur = doc.appliesTo?.employmentTypes ?? [];
                  setDoc({
                    ...doc,
                    appliesTo: {
                      departmentIds: doc.appliesTo?.departmentIds ?? [],
                      employmentTypes: on ? cur.filter((x) => x !== t.value) : [...cur, t.value],
                    },
                  });
                }}
              >
                {t.label}
              </Button>
            );
          })}
        </div>
      </Field>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        {/* Section list */}
        <div className="space-y-2">
          {doc.sections.map((s, i) => (
            <div
              key={s.key}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2 py-1.5",
                i === selected ? "border-primary bg-primary/5" : "hover:bg-muted"
              )}
            >
              <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(i)}>
                <p className="truncate text-[13px] font-medium">{s.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {meta.sectionKinds.find((k) => k.value === s.kind)?.label}
                  {s.optional && " · optional"}
                </p>
              </button>
              <div className="flex shrink-0 flex-col">
                <button onClick={() => move(i, i - 1)} aria-label="Move up" className="p-0.5 disabled:opacity-30" disabled={i === 0}>
                  <ArrowUp className="size-3" />
                </button>
                <button onClick={() => move(i, i + 1)} aria-label="Move down" className="p-0.5 disabled:opacity-30" disabled={i === doc.sections.length - 1}>
                  <ArrowDown className="size-3" />
                </button>
              </div>
            </div>
          ))}

          <Select
            items={meta.sectionKinds.map((k) => ({ value: k.value, label: k.label }))}
            value=""
            onValueChange={(v) => v && addSection(v as SectionKind)}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="+ Add a section" /></SelectTrigger>
            <SelectContent>
              {meta.sectionKinds.map((k) => (
                <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Selected section */}
        {section && (
          <div className="min-w-0 space-y-4">
            <Card className="space-y-4 p-5">
              <FormGrid columns={2}>
                <Field label="Section title" required>
                  <Input value={section.title} onChange={(e) => setSection({ title: e.target.value })} />
                </Field>
                <Field label="Type">
                  <Input value={meta.sectionKinds.find((k) => k.value === section.kind)?.label ?? section.kind} disabled />
                </Field>
              </FormGrid>
              <Field label="Description" hint="Shown at the top of the step.">
                <Textarea rows={2} value={section.description ?? ""} onChange={(e) => setSection({ description: e.target.value })} />
              </Field>
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <Checkbox checked={!!section.optional} onCheckedChange={(c: boolean) => setSection({ optional: c })} />
                  People may skip this section
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDoc({ ...doc, sections: doc.sections.filter((_, i) => i !== selected) });
                    setSelected(0);
                  }}
                >
                  <Trash2 className="size-3.5" /> Remove section
                </Button>
              </div>

              {section.kind === "ASSETS" && (
                <Field label="How assets are handled" hint="Acknowledge what HR issued, let people declare extras, or both.">
                  <Select
                    items={[
                      { value: "BOTH", label: "Both" },
                      { value: "ACKNOWLEDGE", label: "Acknowledge issued items only" },
                      { value: "DECLARE", label: "Declare received items only" },
                    ]}
                    value={section.assets?.mode ?? "BOTH"}
                    onValueChange={(v) => setSection({ assets: { ...(section.assets ?? { mode: "BOTH" }), mode: v as "BOTH" } })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BOTH">Both</SelectItem>
                      <SelectItem value="ACKNOWLEDGE">Acknowledge issued items only</SelectItem>
                      <SelectItem value="DECLARE">Declare received items only</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {section.kind === "DECLARATION" && (
                <Field label="Declaration text" required>
                  <Textarea rows={4} value={section.declarationText ?? ""} onChange={(e) => setSection({ declarationText: e.target.value })} />
                </Field>
              )}
            </Card>

            {section.fields && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[15px] font-semibold">Questions</h4>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSection({
                        fields: [
                          ...(section.fields ?? []),
                          { key: `field_${(section.fields?.length ?? 0) + 1}`, label: "New question", type: "text" },
                        ],
                      })
                    }
                  >
                    <Plus className="size-3.5" /> Add question
                  </Button>
                </div>
                {section.fields.map((f, i) => (
                  <FieldEditor
                    key={f.key}
                    field={f}
                    meta={meta}
                    onChange={(next) => setSection({ fields: section.fields!.map((x, j) => (j === i ? next : x)) })}
                    onRemove={() => setSection({ fields: section.fields!.filter((_, j) => j !== i) })}
                  />
                ))}
              </div>
            )}

            {section.kind === "DOCUMENTS" && (
              <Card className="space-y-3 p-5">
                <h4 className="text-[15px] font-semibold">Documents to collect</h4>
                {(section.documents ?? []).map((d, i) => (
                  <div key={d.category + i} className="flex flex-wrap items-end gap-3">
                    <Field label="Document" className="min-w-[220px] flex-1">
                      <Select
                        items={meta.documentCategories.map((c) => ({ value: c.value, label: c.label }))}
                        value={d.category}
                        onValueChange={(v) =>
                          setSection({ documents: section.documents!.map((x, j) => (j === i ? { ...x, category: String(v) } : x)) })
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {meta.documentCategories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <label className="flex h-10 cursor-pointer items-center gap-2 text-[13px]">
                      <Checkbox
                        checked={d.required !== false}
                        onCheckedChange={(c: boolean) =>
                          setSection({ documents: section.documents!.map((x, j) => (j === i ? { ...x, required: c } : x)) })
                        }
                      />
                      Required
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSection({ documents: section.documents!.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSection({ documents: [...(section.documents ?? []), { category: "OTHER", required: true }] })}
                >
                  <Plus className="size-3.5" /> Add a document
                </Button>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── List + actions ─────────────────────────────────────────────────────────────────── */

export function TemplateBuilder() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["onboarding-templates"],
    queryFn: () => http.get<OnboardingTemplate[]>("/onboarding-templates"),
  });
  const { data: meta } = useQuery({
    queryKey: ["onboarding-template-meta"],
    queryFn: () => http.get<BuilderMeta>("/onboarding-templates/meta"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["onboarding-templates"] });

  const create = useMutation({
    mutationFn: (presetKey: string) => http.post<OnboardingTemplate>("/onboarding-templates", { presetKey }),
    onSuccess: (t) => { toast.success(`"${t.name}" created as a draft.`); invalidate(); setCreating(false); setEditingId(t.id); },
    onError: (e) => toast.error(apiError(e)),
  });

  const act = useMutation({
    mutationFn: (v: { id: string; path: string; body?: unknown }) =>
      v.path === "delete"
        ? http.del(`/onboarding-templates/${v.id}`)
        : http.post(`/onboarding-templates/${v.id}/${v.path}`, v.body),
    onSuccess: () => { invalidate(); toast.success("Updated."); },
    onError: (e) => toast.error(apiError(e)),
  });

  const editing = useMemo(() => templates.find((t) => t.id === editingId), [templates, editingId]);

  if (editing && meta) {
    return <TemplateEditor template={editing} meta={meta} onClose={() => setEditingId(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          The form people fill in. Start from a preset and change whatever you need.
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New form
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-44 w-full" />
      ) : templates.length === 0 ? (
        <Card className="p-10 text-center">
          <Sparkles className="mx-auto size-7 text-muted-foreground" />
          <p className="mt-3 text-[15px] font-medium">No onboarding forms yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Start from the India standard pack, or the shorter one for interns and contractors.
          </p>
          <Button className="mt-4" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Create one
          </Button>
        </Card>
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Form</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Contents</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <p className="flex items-center gap-2 font-medium">
                      {t.name}
                      {t.isDefault && <Star className="size-3.5 fill-current text-[color:var(--warn)]" />}
                    </p>
                    {t.description && (
                      <p className="max-w-md truncate text-[12px] text-muted-foreground">{t.description}</p>
                    )}
                  </TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[t.status]}>{t.status.charAt(0) + t.status.slice(1).toLowerCase()}</Badge></TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {t.summary.sections} sections · {t.summary.fields} questions · {t.summary.mapped} saved to records
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditingId(t.id)}>Edit</Button>
                      {t.status === "DRAFT" && (
                        <Button size="sm" onClick={() => act.mutate({ id: t.id, path: "status", body: { status: "ACTIVE" } })}>
                          Activate
                        </Button>
                      )}
                      {t.status === "ACTIVE" && !t.isDefault && (
                        <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: t.id, path: "default" })}>
                          <Star className="size-3.5" /> Default
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: t.id, path: "duplicate", body: {} })}>
                        <Copy className="size-3.5" />
                      </Button>
                      {t.status === "ACTIVE" && (
                        <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: t.id, path: "status", body: { status: "ARCHIVED" } })}>
                          <Archive className="size-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: t.id, path: "delete" })}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start from a preset</DialogTitle>
            <DialogDescription>
              Both are complete, working forms. You can edit every question afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(meta?.presets ?? []).map((p) => (
              <Card key={p.presetKey} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">{p.name}</p>
                  <p className="text-[12px] text-muted-foreground">{p.sections} sections · {p.fields} questions</p>
                </div>
                <Button size="sm" disabled={create.isPending} onClick={() => create.mutate(p.presetKey)}>
                  Use this
                </Button>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
