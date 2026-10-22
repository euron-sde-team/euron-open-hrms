"use client";

/**
 * Letter template editor.
 *
 * Organisations edit the wording of every letter HRMS issues. Content is edited as an
 * ordered list of typed pieces rather than as free rich text: HR controls every word, while
 * the page layout, measure, page breaks, signature block and verification strip stay under
 * the PDF kit's control. A single long pasted paragraph in a rich text field is all it takes
 * to push a signature onto a page of its own, on a document that goes to a bank.
 *
 * The screen is deliberately shaped like the letter, not like the data behind it. Someone
 * editing an offer letter should see paragraphs they can type into, not a form full of
 * block types, and the structural settings almost nobody changes (title, stamp, address
 * block, which date to print) sit behind "More options".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown, ArrowUp, ChevronDown, Eye, Loader2, Plus, RotateCcw, Save, Search, X,
} from "lucide-react";
import { toast } from "sonner";
import { api, http, apiError } from "@/lib/api";
import { cn } from "@open-hrms/ui/cn";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Textarea } from "@open-hrms/ui/textarea";
import { Badge } from "@open-hrms/ui/badge";
import { Field } from "@open-hrms/ui/field";
import { Switch } from "@open-hrms/ui/switch";
import { Skeleton } from "@open-hrms/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@open-hrms/ui/card";

type BlockType =
  | "paragraph" | "heading" | "bullets" | "note"
  | "salaryTable" | "revisionTable" | "settlementTable" | "detailGrid"
  | "signature" | "acceptance";

interface Block {
  type: BlockType;
  text?: string;
  items?: string[];
  pairs?: [string, string][];
  annual?: boolean;
}

interface Template {
  title: string;
  marker: string | null;
  showRecipient: boolean;
  recipientLines?: string[];
  /** Which date is printed at the top of the letter. */
  dateSource?: "issue" | "joining" | "effective" | "lastWorkingDay";
  blocks: Block[];
  updatedAt?: string;
}

interface LetterKind {
  key: string;
  label: string;
  description: string;
  category: string;
  allowedDynamicBlocks: string[];
  group: string;
  customised: boolean;
  template: Template;
}

interface Token {
  key: string;
  label: string;
  group: string;
  example: string;
}

/**
 * The details people reach for constantly. Shown as one-click chips; everything else lives
 * behind "All details", because forty-nine chips on screen is a wall, not a palette.
 */
const COMMON_TOKENS = [
  "employee.firstName", "employee.fullName", "employee.designation",
  "employee.joiningDate", "org.legalName", "letter.effectiveDate",
  "letter.lastWorkingDay", "employee.code",
];

/** What can be added, in the words of someone writing a letter. */
const ADD_CHOICES: { type: BlockType; label: string }[] = [
  { type: "paragraph", label: "Paragraph" },
  { type: "heading", label: "Heading" },
  { type: "bullets", label: "Bullet list" },
];

const DYNAMIC_LABELS: Record<string, string> = {
  salaryTable: "Salary table",
  revisionTable: "Before and after comparison",
  settlementTable: "Settlement figures",
  detailGrid: "Detail grid",
  acceptance: "Sign-and-return block",
  signature: "Signature",
  note: "Small print",
};

/** Blocks whose content is generated, so they show a one-line description, not an editor. */
const COMPUTED: Record<string, string> = {
  salaryTable: "Their salary breakdown, gross and annual CTC, filled in automatically.",
  revisionTable: "Previous CTC, the increase, and the revised CTC.",
  settlementTable: "Pending salary, leave encashment, recoveries and the net amount.",
  signature: "Your authorised signatory's name, title and signature image.",
  acceptance: "A place for the employee to sign and date their acceptance.",
};

const DATE_CHOICES = [
  { value: "issue", label: "The date it is issued" },
  { value: "joining", label: "Their joining date" },
  { value: "effective", label: "The effective date" },
  { value: "lastWorkingDay", label: "Their last working day" },
];

const emptyBlock = (type: BlockType): Block => {
  if (type === "bullets") return { type, items: [""] };
  if (type === "salaryTable") return { type, annual: true };
  if (type === "detailGrid") return { type, pairs: [["", ""]] };
  if (["paragraph", "heading", "note"].includes(type)) return { type, text: "" };
  return { type };
};

/**
 * A textarea that is exactly as tall as its content.
 *
 * Row-count arithmetic was close but never right: a short line left a gap, and a long clause
 * scrolled inside a two-line box. Measuring scrollHeight after every change is the only way
 * to make the field behave like the paragraph it represents.
 */
function AutoTextarea({ className, value, onChange, onFocus, ...rest }: React.ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(fit, [value]);
  return (
    <Textarea
      {...rest}
      ref={ref}
      rows={1}
      value={value}
      onFocus={onFocus}
      onChange={(e) => { onChange?.(e); fit(); }}
      className={cn("resize-none overflow-hidden", className)}
    />
  );
}

export function LetterTemplatesTab() {
  const qc = useQueryClient();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAllTokens, setShowAllTokens] = useState(false);
  const [tokenFilter, setTokenFilter] = useState("");
  // The field that last had focus, so a detail is inserted where the person was typing.
  const lastFocused = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  const { data: kinds = [], isLoading } = useQuery({
    queryKey: ["letter-templates"],
    queryFn: () => http.get<LetterKind[]>("/letter-templates"),
  });
  const { data: tokens = [] } = useQuery({
    queryKey: ["letter-tokens"],
    queryFn: () => http.get<Token[]>("/letter-templates/tokens"),
  });

  const active = useMemo(() => kinds.find((k) => k.key === activeKey) || null, [kinds, activeKey]);

  useEffect(() => {
    if (!activeKey && kinds[0]) setActiveKey(kinds[0].key);
  }, [kinds, activeKey]);
  useEffect(() => {
    if (active) setDraft(structuredClone(active.template));
    setShowAdvanced(false);
    setPreviewUrl((url) => { if (url) URL.revokeObjectURL(url); return null; });
  }, [active]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const dirty = useMemo(
    () => !!(active && draft) && JSON.stringify(draft) !== JSON.stringify(active.template),
    [active, draft]
  );

  const save = useMutation({
    mutationFn: () => http.put<LetterKind>(`/letter-templates/${activeKey}`, draft),
    onSuccess: () => {
      toast.success("Saved. New letters of this type will use your wording.");
      qc.invalidateQueries({ queryKey: ["letter-templates"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const reset = useMutation({
    mutationFn: () => http.del<LetterKind>(`/letter-templates/${activeKey}`),
    onSuccess: (res) => {
      setDraft(structuredClone(res.template));
      toast.success("Back to the standard wording");
      qc.invalidateQueries({ queryKey: ["letter-templates"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const preview = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/letter-templates/${activeKey}/preview`, { template: draft }, { responseType: "blob" });
      return URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
    },
    onSuccess: (url) => setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return url; }),
    onError: async (e: unknown) => {
      // A validation failure arrives as a blob because the request asked for one, so the
      // message has to be read out of it or the person just sees "[object Blob]".
      const data = (e as { response?: { data?: unknown } })?.response?.data;
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text());
          toast.error(parsed?.error || parsed?.message || "Could not render the preview");
          return;
        } catch { /* fall through */ }
      }
      toast.error(apiError(e));
    },
  });

  const patch = (p: Partial<Template>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setBlocks = (fn: (b: Block[]) => Block[]) =>
    setDraft((d) => (d ? { ...d, blocks: fn(d.blocks) } : d));

  const move = (i: number, by: number) =>
    setBlocks((b) => {
      const j = i + by;
      const a = b[i];
      const c = b[j];
      if (!a || !c) return b; // out of range: nothing to swap
      const next = [...b];
      next[i] = c;
      next[j] = a;
      return next;
    });

  const insertToken = (key: string) => {
    const el = lastFocused.current;
    if (!el) {
      navigator.clipboard?.writeText(`{{${key}}}`);
      toast.message(`Copied. Click into the text where you want it, then paste.`);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = `${el.value.slice(0, start)}{{${key}}}${el.value.slice(end)}`;
    // Drive the change through React's own setter so the block's onChange runs and the
    // draft stays the single source of truth.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const caret = start + key.length + 4;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
  };

  const track = (e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    lastFocused.current = e.currentTarget;
  };

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  const grouped = kinds.reduce<Record<string, LetterKind[]>>((acc, k) => {
    (acc[k.group] ||= []).push(k);
    return acc;
  }, {});

  const tokenByKey = Object.fromEntries(tokens.map((t) => [t.key, t]));
  const commonTokens = COMMON_TOKENS.map((k) => tokenByKey[k]).filter((t): t is NonNullable<typeof t> => !!t);
  const filteredTokens = tokenFilter.trim()
    ? tokens.filter((t) => `${t.label} ${t.key}`.toLowerCase().includes(tokenFilter.trim().toLowerCase()))
    : tokens;

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Which letter */}
      <nav className="space-y-4">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group}>
            <div className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</div>
            <div className="space-y-0.5">
              {items.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => setActiveKey(k.key)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                    k.key === activeKey && "bg-primary/10 font-medium text-foreground"
                  )}
                >
                  <span className="truncate">{k.label}</span>
                  {k.customised && <Badge variant="blue" className="shrink-0 text-[11px]">Edited</Badge>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {active && draft && (
        <div className="min-w-0 space-y-4">
          {/* The letter */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base">{active.label}</CardTitle>
                  <CardDescription>{active.description}</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={preview.isPending} onClick={() => preview.mutate()}>
                    {preview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                    Preview
                  </Button>
                  <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                    {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-1">
              <p className="mb-2 text-sm text-muted-foreground">
                Write the letter below. Anything in
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">{"{{ }}"}</code>
                is filled in for each person automatically.
              </p>

              {draft.blocks.map((b, i) => (
                <BlockEditor
                  key={i}
                  block={b}
                  index={i}
                  last={i === draft.blocks.length - 1}
                  onMove={move}
                  onRemove={() => setBlocks((bs) => bs.filter((_, j) => j !== i))}
                  onChange={(next) => setBlocks((bs) => bs.map((x, j) => (j === i ? next : x)))}
                  onFocusField={track}
                />
              ))}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">Add</span>
                {ADD_CHOICES.map((c) => (
                  <Button key={c.type} variant="outline" size="sm" onClick={() => setBlocks((bs) => [...bs, emptyBlock(c.type)])}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> {c.label}
                  </Button>
                ))}
                {active.allowedDynamicBlocks.map((t) => (
                  <Button key={t} variant="outline" size="sm" onClick={() => setBlocks((bs) => [...bs, emptyBlock(t as BlockType)])}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> {DYNAMIC_LABELS[t] || t}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Details you can drop in */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Insert a detail</CardTitle>
              <CardDescription>
                Click into the text where you want it, then click one of these.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {commonTokens.map((tk) => (
                  <button
                    key={tk.key}
                    type="button"
                    title={`For example: ${tk.example}`}
                    onClick={() => insertToken(tk.key)}
                    className="rounded border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
                  >
                    {tk.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowAllTokens((v) => !v)}
                  className="rounded border border-dashed px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  {showAllTokens ? "Show fewer" : `All ${tokens.length} details`}
                </button>
              </div>

              {showAllTokens && (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-8 pl-8 text-sm"
                      placeholder="Search details"
                      value={tokenFilter}
                      onChange={(e) => setTokenFilter(e.target.value)}
                    />
                  </div>
                  <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                    {filteredTokens.map((tk) => (
                      <button
                        key={tk.key}
                        type="button"
                        title={`For example: ${tk.example}`}
                        onClick={() => insertToken(tk.key)}
                        className="rounded border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
                      >
                        <span className="text-muted-foreground">{tk.group}</span> · {tk.label}
                      </button>
                    ))}
                    {filteredTokens.length === 0 && (
                      <p className="text-xs text-muted-foreground">Nothing matches that.</p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Everything most people never touch */}
          <Card>
            <CardHeader className="pb-0">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <div>
                  <CardTitle className="text-base">More options</CardTitle>
                  <CardDescription>
                    Heading, confidentiality stamp, who it is addressed to, and which date it shows.
                  </CardDescription>
                </div>
                <ChevronDown className={cn("size-4 shrink-0 transition-transform", showAdvanced && "rotate-180")} />
              </button>
            </CardHeader>
            {showAdvanced && (
              <CardContent className="space-y-4 pt-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Heading at the top" htmlFor="lt-title">
                    <Input id="lt-title" value={draft.title} onFocus={track} onChange={(e) => patch({ title: e.target.value })} />
                  </Field>
                  <Field label="Stamp above the heading" htmlFor="lt-marker">
                    <Input
                      id="lt-marker"
                      placeholder="Leave blank for none"
                      value={draft.marker ?? ""}
                      onFocus={track}
                      onChange={(e) => patch({ marker: e.target.value || null })}
                    />
                  </Field>
                </div>

                <Field label="Date printed at the top">
                  <div className="flex flex-wrap gap-1.5">
                    {DATE_CHOICES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => patch({ dateSource: c.value as Template["dateSource"] })}
                        className={cn(
                          "rounded-md border px-2.5 py-1.5 text-sm hover:bg-muted",
                          (draft.dateSource ?? "issue") === c.value && "border-primary bg-primary/10"
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </Field>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="pr-4">
                    <div className="text-sm font-medium">Address it to the employee</div>
                    <p className="text-xs text-muted-foreground">
                      Turn this off for letters written to whomsoever it may concern, such as an
                      experience certificate.
                    </p>
                  </div>
                  <Switch checked={draft.showRecipient} onCheckedChange={(v) => patch({ showRecipient: v })} />
                </div>

                {draft.showRecipient && (
                  <Field label="Address block">
                    <div className="space-y-2">
                      {(draft.recipientLines ?? []).map((line, i) => (
                        <div key={i} className="flex gap-2">
                          <Input
                            value={line}
                            onFocus={track}
                            onChange={(e) =>
                              patch({ recipientLines: (draft.recipientLines ?? []).map((l, j) => (j === i ? e.target.value : l)) })
                            }
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Remove line"
                            onClick={() => patch({ recipientLines: (draft.recipientLines ?? []).filter((_, j) => j !== i) })}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => patch({ recipientLines: [...(draft.recipientLines ?? []), ""] })}
                      >
                        <Plus className="mr-2 h-4 w-4" /> Add line
                      </Button>
                    </div>
                  </Field>
                )}

                {active.customised && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 p-3">
                    <p className="text-sm text-muted-foreground">
                      Go back to the standard wording. Your edits to this letter are discarded.
                    </p>
                    <Button
                      variant="outline"
                      disabled={reset.isPending}
                      onClick={() => {
                        if (window.confirm("Discard your wording and go back to the standard letter?")) reset.mutate();
                      }}
                    >
                      {reset.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                      Reset
                    </Button>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {previewUrl && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preview</CardTitle>
                <CardDescription>
                  Rendered from what is on screen, using a sample employee. Previews are never filed
                  as documents and carry no verification code.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <iframe src={previewUrl} title="Letter preview" className="h-[46rem] w-full rounded-md border" />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One piece of the letter.
 *
 * Controls sit in a strip that only appears on hover or focus, so reading the letter is not
 * competing with three buttons per paragraph.
 */
function BlockEditor({
  block, index, last, onMove, onRemove, onChange, onFocusField,
}: {
  block: Block;
  index: number;
  last: boolean;
  onMove: (i: number, by: number) => void;
  onRemove: () => void;
  onChange: (b: Block) => void;
  onFocusField: (e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
}) {
  const isText = ["paragraph", "heading", "note"].includes(block.type);
  const computed = COMPUTED[block.type];

  return (
    <div className="group relative rounded-md border border-transparent px-2 py-1 hover:border-border hover:bg-muted/20">
      <div className="pointer-events-none absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Button variant="ghost" size="sm" aria-label="Move up" disabled={index === 0} onClick={() => onMove(index, -1)}>
          <ArrowUp className="size-3.5" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Move down" disabled={last} onClick={() => onMove(index, 1)}>
          <ArrowDown className="size-3.5" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Remove" onClick={onRemove}>
          <X className="size-3.5" />
        </Button>
      </div>

      {isText && (
        <AutoTextarea
          className={cn(
            "resize-none border-transparent bg-transparent shadow-none focus-visible:border-input focus-visible:bg-background",
            block.type === "heading" && "text-base font-semibold",
            block.type === "note" && "text-xs text-muted-foreground"
          )}
          placeholder={
            block.type === "heading" ? "Section heading" : block.type === "note" ? "Small print" : "Write a paragraph"
          }
          value={block.text ?? ""}
          onFocus={onFocusField}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
        />
      )}

      {block.type === "bullets" && (
        <div className="space-y-1.5">
          {(block.items ?? []).map((item, k) => (
            <div key={k} className="flex items-start gap-2">
              <span className="pt-2.5 text-muted-foreground">&bull;</span>
              <AutoTextarea
                className="border-transparent bg-transparent shadow-none focus-visible:border-input focus-visible:bg-background"
                placeholder="A term or condition"
                value={item}
                onFocus={onFocusField}
                onChange={(e) =>
                  onChange({ ...block, items: (block.items ?? []).map((it, m) => (m === k ? e.target.value : it)) })
                }
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Remove point"
                className="mt-1"
                onClick={() => onChange({ ...block, items: (block.items ?? []).filter((_, m) => m !== k) })}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...block, items: [...(block.items ?? []), ""] })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add point
          </Button>
        </div>
      )}

      {computed && (
        <div className="flex flex-wrap items-center gap-2 px-1 py-1.5">
          <Badge variant="grey" className="text-[11px]">{DYNAMIC_LABELS[block.type] || block.type}</Badge>
          <span className="text-xs text-muted-foreground">{computed}</span>
          {block.type === "salaryTable" && (
            <label className="ml-auto mr-16 flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={block.annual !== false} onCheckedChange={(v) => onChange({ ...block, annual: v })} />
              Show annual CTC
            </label>
          )}
        </div>
      )}
    </div>
  );
}
