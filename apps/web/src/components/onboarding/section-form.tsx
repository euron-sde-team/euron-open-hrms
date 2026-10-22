"use client";

/**
 * One step of the onboarding form.
 *
 * Handles all nine section kinds so the wizard shell does not have to know about any of
 * them. This component is the reason the pre-hire form and the existing-employee form
 * cannot drift: both render THIS, and differ only in how they fetch and save.
 *
 * Autosave: edits are held locally and pushed on blur / step change by the parent, which
 * means a half-typed PAN is never sent mid-keystroke and never lost either. The server
 * saves what is valid and returns errors for the rest, so the errors shown here are always
 * the server's, never a second browser-side copy of the rules.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload, FileCheck2, AlertTriangle, Check, X } from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { FieldInput } from "@/components/onboarding/field-input";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Badge } from "@open-hrms/ui/badge";
import { Card } from "@open-hrms/ui/card";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Field, FormGrid } from "@open-hrms/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-hrms/ui/select";
import {
  isRepeatingKind,
  type OnboardingCase,
  type TemplateSection,
  type TemplateField,
} from "@/lib/onboarding-forms";

interface Policy {
  id: string;
  title: string;
  category?: string;
}

export interface SectionFormProps {
  section: TemplateSection;
  caseData: OnboardingCase;
  /** Server-reported errors for this section, keyed loosely by message. */
  errors: string[];
  disabled?: boolean;
  values: Record<string, unknown>;
  rows: Record<string, unknown>[];
  onValues: (next: Record<string, unknown>) => void;
  onRows: (next: Record<string, unknown>[]) => void;
  /** Refetch the case after an action that writes server-side (upload, asset, policy). */
  onRefresh: () => void;
  policies?: Policy[];
  /**
   * API prefix for this case's own actions, WITHOUT a trailing slash.
   *
   * The signed-in employee and the pre-hire candidate fill in the identical form; all that
   * differs is how they proved who they are. Passing the prefix in is what lets one renderer
   * serve both, instead of the two flows drifting the way they did before.
   *   employee  -> "/onboarding-cases/me"
   *   candidate -> "/onboarding/public/<token>"
   */
  base: string;
}

/* ── Documents ──────────────────────────────────────────────────────────────────────── */

function DocumentSlot({
  category,
  label,
  help,
  required,
  sectionKey,
  caseData,
  disabled,
  onRefresh,
  base,
}: {
  category: string;
  label: string;
  help?: string;
  required?: boolean;
  base: string;
  sectionKey: string;
  caseData: OnboardingCase;
  disabled?: boolean;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const existing = caseData.documents.find((d) => d.category === category && d.sectionKey === sectionKey);

  async function upload(file: File) {
    setBusy(true);
    try {
      await http.upload(`${base}/documents`, file, { sectionKey, category });
      toast.success(`${label} uploaded`);
      onRefresh();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium">
            {label}
            {required && <span className="ml-0.5 text-[color:var(--bad)]">*</span>}
          </p>
          {help && <p className="mt-0.5 text-[12px] text-muted-foreground">{help}</p>}
        </div>
        {existing ? (
          <Badge variant="green" className="shrink-0 gap-1">
            <FileCheck2 className="size-3" /> Uploaded
          </Badge>
        ) : required ? (
          <Badge variant="amber" className="shrink-0">Required</Badge>
        ) : (
          <Badge variant="grey" className="shrink-0">Optional</Badge>
        )}
      </div>

      {existing?.document?.originalName && (
        <p className="truncate text-[12px] text-muted-foreground">{existing.document.originalName}</p>
      )}

      {/* A hidden input driven by a ref, matching logo-upload.tsx. The Button primitive here
          has no `asChild`, so wrapping it in a <label> would nest a button inside a label
          and swallow the click in Safari. */}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp"
        className="hidden"
        // Disabled with the rest of the section, so a read-only render (the template
        // builder's preview) cannot open a picker and fire an upload at a case that
        // does not exist.
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        className="mt-auto w-full"
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="size-3.5" />
        {busy ? "Uploading…" : existing ? "Replace" : "Upload"}
      </Button>
    </Card>
  );
}

/* ── Repeating rows ─────────────────────────────────────────────────────────────────── */

function RepeatingRows({
  section,
  rows,
  disabled,
  onRows,
}: {
  section: TemplateSection;
  rows: Record<string, unknown>[];
  disabled?: boolean;
  onRows: (next: Record<string, unknown>[]) => void;
}) {
  const fields = (section.fields ?? []).filter((f) => f.type !== "file");
  const max = section.maxRows ?? 10;

  const setCell = (i: number, key: string, value: unknown) =>
    onRows(rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  return (
    <div className="space-y-4">
      {rows.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          {section.optional
            ? "Nothing here yet. Leave it blank if it does not apply to you."
            : "Add your first entry to continue."}
        </p>
      )}

      {rows.map((row, i) => (
        <Card key={String(row.id ?? i)} className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-muted-foreground">Entry {i + 1}</p>
            {!disabled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRows(rows.filter((_, idx) => idx !== i))}
                aria-label={`Remove entry ${i + 1}`}
              >
                <Trash2 className="size-3.5" /> Remove
              </Button>
            )}
          </div>
          <FormGrid columns={2}>
            {fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={row[f.key]}
                disabled={disabled}
                idPrefix={`r${i}-`}
                onChange={(v) => setCell(i, f.key, v)}
              />
            ))}
          </FormGrid>
        </Card>
      ))}

      {!disabled && rows.length < max && (
        <Button variant="outline" size="sm" onClick={() => onRows([...rows, {}])}>
          <Plus className="size-3.5" /> Add {rows.length ? "another" : "an entry"}
        </Button>
      )}
    </div>
  );
}

/* ── Assets ─────────────────────────────────────────────────────────────────────────── */

function AssetsSection({
  section,
  caseData,
  disabled,
  onRefresh,
  base,
}: {
  section: TemplateSection;
  caseData: OnboardingCase;
  disabled?: boolean;
  onRefresh: () => void;
  base: string;
}) {
  const mode = section.assets?.mode ?? "BOTH";
  type Issued = { id: string; name: string; category: string; serial?: string };
  const [issued, setIssued] = useState<Issued[] | null>(null);
  const [draft, setDraft] = useState({ category: "LAPTOP", name: "", serial: "", condition: "Good" });
  const [busy, setBusy] = useState(false);
  // Bumped after an acknowledgement to re-pull the register.
  const [reload, setReload] = useState(0);

  // The issued list lives on the assets register, not on the case, so it is fetched
  // separately. In an effect rather than during render: a fetch in the render phase fires
  // again on every re-render and, under StrictMode, twice per mount.
  useEffect(() => {
    if (mode === "DECLARE") return;
    // No base means this is a preview of a template being edited: there is no case to ask
    // about, so show the empty state rather than firing a request at "/assets".
    if (!base) { setIssued([]); return; }
    let cancelled = false;
    http
      .get<{ issued: Issued[] }>(`${base}/assets`)
      .then((d) => !cancelled && setIssued(d.issued ?? []))
      .catch(() => !cancelled && setIssued([]));
    return () => { cancelled = true; };
  }, [mode, reload, base]);

  const acked = new Map(caseData.assets.acknowledged.map((a) => [a.assetId, a]));

  async function acknowledge(assetId: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      await http.post(`${base}/assets/${assetId}/acknowledge`, body);
      onRefresh();
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function declare() {
    if (!draft.name.trim()) return toast.error("What is it? Give the item a name.");
    setBusy(true);
    try {
      await http.post(`${base}/assets/declared`, draft);
      setDraft({ category: "LAPTOP", name: "", serial: "", condition: "Good" });
      onRefresh();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  const CATS = section.assets?.allowedCategories ?? ["LAPTOP", "MONITOR", "PHONE", "ACCESS_CARD", "HEADSET", "SIM", "OTHER"];
  const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

  return (
    <div className="space-y-7">
      {mode !== "DECLARE" && (
        <section className="space-y-3">
          <div>
            <h4 className="text-[15px] font-semibold">Issued to you</h4>
            <p className="text-[13px] text-muted-foreground">
              Confirm you have each item. If a serial number does not match, enter what is printed on
              the item, we will sort it out.
            </p>
          </div>
          {issued && issued.length === 0 && (
            <p className="rounded-lg border border-dashed px-4 py-5 text-center text-[13px] text-muted-foreground">
              Nothing has been issued to you yet.
            </p>
          )}
          {(issued ?? []).map((a) => {
            const ack = acked.get(a.id);
            return (
              <Card key={a.id} className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">{a.name}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {pretty(a.category)}
                      {a.serial ? ` · on record as ${a.serial}` : ""}
                    </p>
                  </div>
                  {ack?.received === true && !ack.discrepancy && (
                    <Badge variant="green" className="gap-1"><Check className="size-3" /> Confirmed</Badge>
                  )}
                  {ack?.discrepancy && (
                    <Badge variant="amber" className="gap-1"><AlertTriangle className="size-3" /> Serial differs</Badge>
                  )}
                  {ack?.received === false && <Badge variant="red">Not received</Badge>}
                </div>

                {!disabled && (
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Serial number on the item" className="min-w-[220px] flex-1">
                      <Input
                        defaultValue={ack?.serial ?? ""}
                        placeholder={a.serial ? "Type what you see" : "Serial number"}
                        onBlur={(e) =>
                          e.target.value.trim() &&
                          void acknowledge(a.id, { received: true, serial: e.target.value.trim(), condition: "Good" })
                        }
                      />
                    </Field>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void acknowledge(a.id, { received: false, note: "Not received" })}
                    >
                      <X className="size-3.5" /> I did not receive this
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      )}

      {mode !== "ACKNOWLEDGE" && (
        <section className="space-y-3">
          <div>
            <h4 className="text-[15px] font-semibold">Anything else you were given</h4>
            <p className="text-[13px] text-muted-foreground">
              A monitor from your manager, a SIM, an access card. HR will check each one before it
              goes on the register.
            </p>
          </div>

          {caseData.assets.declared.map((d) => (
            <Card key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-[14px] font-medium">{d.name}</p>
                <p className="text-[12px] text-muted-foreground">
                  {pretty(d.category)}{d.serial ? ` · ${d.serial}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={d.status === "APPROVED" ? "green" : d.status === "REJECTED" ? "red" : "amber"}>
                  {d.status === "PENDING" ? "Awaiting HR" : d.status.charAt(0) + d.status.slice(1).toLowerCase()}
                </Badge>
                {!disabled && d.status === "PENDING" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await http.del(`${base}/assets/declared/${d.id}`);
                      onRefresh();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </Card>
          ))}

          {!disabled && (
            <Card className="space-y-4 p-5">
              <FormGrid columns={2}>
                <Field label="What is it?" htmlFor="asset-cat">
                  <Select
                    items={CATS.map((c) => ({ value: c, label: pretty(c) }))}
                    value={draft.category}
                    onValueChange={(v) => setDraft({ ...draft, category: String(v) })}
                  >
                    <SelectTrigger id="asset-cat"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATS.map((c) => <SelectItem key={c} value={c}>{pretty(c)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Name / model" htmlFor="asset-name" required>
                  <Input
                    id="asset-name"
                    value={draft.name}
                    placeholder="Dell U2720Q"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
                <Field label="Serial number" htmlFor="asset-serial" hint="If there is one on the item.">
                  <Input
                    id="asset-serial"
                    value={draft.serial}
                    onChange={(e) => setDraft({ ...draft, serial: e.target.value })}
                  />
                </Field>
                <Field label="Condition" htmlFor="asset-cond">
                  <Input
                    id="asset-cond"
                    value={draft.condition}
                    onChange={(e) => setDraft({ ...draft, condition: e.target.value })}
                  />
                </Field>
              </FormGrid>
              <Button size="sm" disabled={busy} onClick={() => void declare()}>
                <Plus className="size-3.5" /> Add this item
              </Button>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

/* ── The section itself ─────────────────────────────────────────────────────────────── */

export function SectionForm({
  section,
  caseData,
  errors,
  disabled,
  values,
  rows,
  onValues,
  onRows,
  onRefresh,
  policies = [],
  base,
}: SectionFormProps) {
  const [signature, setSignature] = useState(caseData.declaration?.fullName ?? "");
  const [busy, setBusy] = useState(false);

  // The server returns section errors as plain sentences. Match them to a field by its
  // label so the message lands on the control it is about, and show the leftovers above.
  const fieldError = (f: TemplateField) =>
    errors.find((e) => e.toLowerCase().startsWith(f.label.toLowerCase()));
  const matched = new Set((section.fields ?? []).map(fieldError).filter(Boolean) as string[]);
  const generalErrors = errors.filter((e) => !matched.has(e));

  const inputFields = (section.fields ?? []).filter((f) => f.type !== "file");
  const fileFields = (section.fields ?? []).filter((f) => f.type === "file");

  return (
    <div className="space-y-6">
      {section.description && (
        <p className="text-[14px] leading-relaxed text-muted-foreground">{section.description}</p>
      )}

      {section.key in caseData.sections && caseData.sections[section.key]?.status === "CHANGES_REQUESTED" && (
        <div className="rounded-lg border border-[color:var(--bad)]/30 bg-[color:var(--bad-bg,transparent)] p-4">
          <p className="text-[14px] font-medium text-[color:var(--bad)]">HR asked for a change here</p>
          <p className="mt-1 text-[13px]">{caseData.sections[section.key]?.note}</p>
        </div>
      )}

      {generalErrors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-[color:var(--warn)]/30 p-4 text-[13px]">
          {generalErrors.map((e) => (
            <li key={e} className="text-[color:var(--warn)]">{e}</li>
          ))}
        </ul>
      )}

      {isRepeatingKind(section.kind) ? (
        <RepeatingRows section={section} rows={rows} disabled={disabled} onRows={onRows} />
      ) : section.kind === "ASSETS" ? (
        <AssetsSection section={section} caseData={caseData} disabled={disabled} onRefresh={onRefresh} base={base} />
      ) : section.kind === "ACKNOWLEDGMENT" ? (
        <div className="space-y-3">
          {policies.length === 0 && (
            <p className="text-[13px] text-muted-foreground">No policies have been published yet.</p>
          )}
          {policies.map((p) => {
            const accepted = caseData.acknowledgments.some((a) => a.policyId === p.id);
            return (
              <Card key={p.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">{p.title}</p>
                  {p.category && <p className="text-[12px] text-muted-foreground">{p.category}</p>}
                </div>
                {accepted ? (
                  <Badge variant="green" className="gap-1 shrink-0"><Check className="size-3" /> Accepted</Badge>
                ) : (
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[13px]">
                    <Checkbox
                      disabled={disabled || busy}
                      onCheckedChange={async (c: boolean) => {
                        if (!c) return;
                        setBusy(true);
                        try {
                          await http.post(`${base}/acknowledge`, { policyIds: [p.id] });
                          onRefresh();
                        } catch (e) {
                          toast.error(apiError(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                    I accept
                  </label>
                )}
              </Card>
            );
          })}
        </div>
      ) : section.kind === "DECLARATION" ? (
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-5 text-[14px] leading-relaxed">
            {section.declarationText}
          </div>
          {caseData.declaration ? (
            <p className="text-[13px] text-[color:var(--ok)]">
              Signed by {caseData.declaration.fullName}.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Type your full name to sign" htmlFor="sig" className="min-w-[260px] flex-1">
                <Input id="sig" value={signature} disabled={disabled} onChange={(e) => setSignature(e.target.value)} />
              </Field>
              <Button
                disabled={disabled || busy || signature.trim().length < 2}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await http.post(`${base}/declare`, { fullName: signature.trim() });
                    toast.success("Declaration signed");
                    onRefresh();
                  } catch (e) {
                    toast.error(apiError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Sign
              </Button>
            </div>
          )}
        </div>
      ) : (
        <FormGrid columns={2}>
          {inputFields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={values[f.key]}
              error={fieldError(f)}
              disabled={disabled}
              onChange={(v) => onValues({ ...values, [f.key]: v })}
            />
          ))}
        </FormGrid>
      )}

      {(section.documents?.length || fileFields.length > 0) && (
        <section className="space-y-3">
          <h4 className="text-[15px] font-semibold">Documents</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(section.documents ?? []).map((d) => (
              <DocumentSlot
                base={base}
                key={d.category}
                category={d.category}
                label={d.category.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                help={d.help}
                required={d.required}
                sectionKey={section.key}
                caseData={caseData}
                disabled={disabled}
                onRefresh={onRefresh}
              />
            ))}
            {fileFields.map((f) => (
              <DocumentSlot
                base={base}
                key={f.key}
                category={f.proofCategory ?? f.key}
                label={f.label}
                help={f.help}
                required={f.required}
                sectionKey={section.key}
                caseData={caseData}
                disabled={disabled}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
