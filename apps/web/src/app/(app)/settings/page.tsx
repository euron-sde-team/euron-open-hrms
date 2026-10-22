"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveTab } from "@/lib/use-active-tab";
import {
  Check,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  X,
  Copy,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { http, apiError } from "@/lib/api";
import { productName } from "@/lib/runtime-env";
import { TwoFactorCard } from "@/components/two-factor";
import { splitEmailList } from "@/lib/email-list";
import { cn } from "@open-hrms/ui/cn";
import { applyBrandColor, DEFAULT_BRAND_COLOR, normalizeHex, THEME_PRESETS } from "@/lib/brand-theme";
import { mailToast, type MailResult } from "@/lib/mail";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@open-hrms/ui/page-header";
import { StarterContentCard } from "@/components/starter-content-card";
import { LogoUploadCard } from "@/components/logo-upload";
import { SignatureUploadCard } from "@/components/signature-upload";
import { ReminderSettingsTab } from "@/components/reminder-settings";
import { LeaveRulesTab, LEAVE_RULES_KEY, type LeaveRulesResponse } from "@/components/leave-rules-settings";
import { LetterTemplatesTab } from "@/components/letter-templates";
import { Button } from "@open-hrms/ui/button";
import { Input } from "@open-hrms/ui/input";
import { Label, FieldHint } from "@open-hrms/ui/label";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Badge } from "@open-hrms/ui/badge";
import { Switch } from "@open-hrms/ui/switch";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Skeleton } from "@open-hrms/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@open-hrms/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@open-hrms/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@open-hrms/ui/dialog";

/* ------------------------------------------------------------------ */
/* Security (2FA), the same card the profile page shows                */
/* ------------------------------------------------------------------ */

function SecurityTab() {
  return <TwoFactorCard className="max-w-2xl" />;
}

/* ------------------------------------------------------------------ */
/* Organization, profile, designations, employee-ID rule              */
/* ------------------------------------------------------------------ */

interface EmployeeIdRule {
  prefix: string;
  suffix: string;
  seqStart: number;
  padding: number;
  resetYearly: boolean;
}
interface OrgBranding {
  logoUrl?: string;
  color?: string;
  supportEmail?: string;
}
interface OrgSignatory {
  name?: string;
  title?: string;
}
interface Org {
  id: string;
  name: string;
  slug?: string;
  legalName?: string;
  address?: string;
  country?: string;
  gstin?: string;
  cin?: string;
  designations?: string[];
  emailSenderName?: string;
  /** Printed on the letterhead of generated documents. */
  website?: string;
  tagline?: string;
  /** Domain for generated official addresses (firstname.lastname@domain). */
  officialEmailDomain?: string | null;
  /** Always copied on the weekly people report, alongside admins and HR. */
  reportRecipients?: string[];
  employeeIdRule?: EmployeeIdRule | null;
  /** Default notice period in days, used when an employee's record does not state one. */
  noticePeriodDays?: number | null;
  branding?: OrgBranding | null;
  signatory?: OrgSignatory | null;
}
interface OrgResponse {
  org: Org;
}

const DEFAULT_RULE: EmployeeIdRule = {
  prefix: "",
  suffix: "",
  seqStart: 1000,
  padding: 4,
  resetYearly: false,
};

function OrganizationTab() {
  const qc = useQueryClient();
  const { refresh: refreshSession } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["org"],
    queryFn: () => http.get<OrgResponse>("/org"),
  });
  const org = data?.org;

  // Profile state, initialised lazily once the org loads.
  const [name, setName] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [designations, setDesignations] = useState<string[] | null>(null);
  const [newDesignation, setNewDesignation] = useState("");
  const [emailSenderName, setEmailSenderName] = useState<string | null>(null);
  const [website, setWebsite] = useState<string | null>(null);
  const [tagline, setTagline] = useState<string | null>(null);
  const [officialEmailDomain, setOfficialEmailDomain] = useState<string | null>(null);
  // Edited as one comma-separated string; the API splits and validates it.
  const [reportRecipients, setReportRecipients] = useState<string | null>(null);
  const [signatoryName, setSignatoryName] = useState<string | null>(null);
  const [signatoryTitle, setSignatoryTitle] = useState<string | null>(null);
  const [rule, setRule] = useState<EmployeeIdRule | null>(null);
  // Blank = unset, and exits fall back to 30 days. Not defaulted to "30" in the
  // box, because a value sitting in the field reads as a decision somebody made.
  const [noticePeriodDays, setNoticePeriodDays] = useState<string | null>(null);
  // "" = stylesheet default; otherwise a #rrggbb hex.
  const [brandColor, setBrandColor] = useState<string | null>(null);

  // Hydrate local state the first time the org arrives.
  if (org && name === null) {
    setName(org.name ?? "");
    setAddress(org.address ?? "");
    setDesignations(Array.isArray(org.designations) ? org.designations.slice() : []);
    setEmailSenderName(org.emailSenderName ?? "");
    setWebsite(org.website ?? "");
    setTagline(org.tagline ?? "");
    setOfficialEmailDomain(org.officialEmailDomain ?? "");
    setReportRecipients((org.reportRecipients ?? []).join(", "));
    setSignatoryName(org.signatory?.name ?? "");
    setSignatoryTitle(org.signatory?.title ?? "");
    setRule(org.employeeIdRule ?? null);
    setNoticePeriodDays(org.noticePeriodDays == null ? "" : String(org.noticePeriodDays));
    setBrandColor(org.branding?.color ?? "");
  }

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => http.put<Org>("/org", body),
    onSuccess: () => {
      toast.success("Organization updated");
      qc.invalidateQueries({ queryKey: ["org"] });
      // Refresh the auth session so the header badge (user.org.name, sourced
      // from /auth/me) reflects the new display name without a re-login.
      refreshSession();
      applyBrandColor(brandColor);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const defaultPrefix = ((org?.slug || "EMP").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "EMP");
  const preview = useMemo(() => {
    if (!rule) {
      const start = DEFAULT_RULE.seqStart;
      return `${defaultPrefix}-${1000 + start}`;
    }
    const yr = String(new Date().getFullYear());
    const pf = (rule.prefix || "").replace(/\{YEAR\}/g, yr);
    const sf = (rule.suffix || "").replace(/\{YEAR\}/g, yr);
    const pad = Math.max(1, Math.min(8, Number(rule.padding) || 4));
    const start = Number(rule.seqStart) || 1;
    return pf ? pf + String(start).padStart(pad, "0") + sf : `${defaultPrefix}-${1000 + start}`;
  }, [rule, defaultPrefix]);

  function addDesignation() {
    const v = newDesignation.trim();
    if (!v || (designations ?? []).includes(v)) return;
    setDesignations([...(designations ?? []), v]);
    setNewDesignation("");
  }
  function removeDesignation(i: number) {
    setDesignations((designations ?? []).filter((_, idx) => idx !== i));
  }
  function setRuleField<K extends keyof EmployeeIdRule>(k: K, v: EmployeeIdRule[K]) {
    setRule((r) => ({ ...(r ?? DEFAULT_RULE), [k]: v }));
  }

  if (isLoading || name === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization profile</CardTitle>
          <CardDescription>The display name shown across the app and on documents.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormGrid columns={2}>
            <Field label="Display name" htmlFor="org-name">
              <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Registered address" htmlFor="org-address">
              <Input id="org-address" value={address ?? ""} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <Field
              label="Email sender name"
              htmlFor="org-sender"
              className="sm:col-span-2"
              hint={
                <>
                  Shown as the sender on emails to your team (onboarding, invites, payslips). Leave
                  blank to use the default &ldquo;{productName()}&rdquo;.
                </>
              }
            >
              <Input
                id="org-sender"
                placeholder={`${name || "Your company"} HR`}
                value={emailSenderName ?? ""}
                onChange={(e) => setEmailSenderName(e.target.value)}
              />
            </Field>
            <Field label="Website" htmlFor="org-website">
              <Input
                id="org-website"
                type="url"
                inputMode="url"
                placeholder="https://www.example.com"
                value={website ?? ""}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </Field>
            <Field label="Tagline" htmlFor="org-tagline">
              <Input
                id="org-tagline"
                maxLength={120}
                placeholder="Building better workplaces"
                value={tagline ?? ""}
                onChange={(e) => setTagline(e.target.value)}
              />
            </Field>
            <Field
              label="Official email domain"
              htmlFor="org-email-domain"
              hint="New joiners get firstname.lastname@ this domain. Leave blank to use your verified sending domain."
            >
              <Input
                id="org-email-domain"
                placeholder="example.com"
                autoCapitalize="none"
                spellCheck={false}
                value={officialEmailDomain ?? ""}
                onChange={(e) => setOfficialEmailDomain(e.target.value)}
              />
            </Field>
            <Field
              label="Weekly report recipients"
              htmlFor="org-report-recipients"
              hint="Comma separated. Admins and HR always receive it; these addresses are added."
            >
              <Input
                id="org-report-recipients"
                type="text"
                inputMode="email"
                placeholder="leadership@example.com, ops@example.com"
                value={reportRecipients ?? ""}
                onChange={(e) => setReportRecipients(e.target.value)}
              />
            </Field>
            <Field label="Authorised signatory name" htmlFor="org-signatory-name">
              <Input
                id="org-signatory-name"
                placeholder="Full name"
                value={signatoryName ?? ""}
                onChange={(e) => setSignatoryName(e.target.value)}
              />
            </Field>
            <Field label="Signatory title" htmlFor="org-signatory-title">
              <Input
                id="org-signatory-title"
                placeholder="Founder &amp; CEO"
                value={signatoryTitle ?? ""}
                onChange={(e) => setSignatoryTitle(e.target.value)}
              />
            </Field>
            {/* Same reason as the employee form: this cell pairs with "Signatory
                title", which carries no hint, and a hint here would push this input
                above it. The explanation goes in the note under the grid instead. */}
            <Field label="Default notice period (days)" htmlFor="org-notice-days">
              <Input
                id="org-notice-days"
                type="number"
                min={0}
                placeholder="30"
                value={noticePeriodDays ?? ""}
                onChange={(e) => setNoticePeriodDays(e.target.value)}
              />
            </Field>
          </FormGrid>
          <p className="text-xs text-muted-foreground">
            The website and tagline appear on the letterhead of generated documents.
          </p>
          <p className="text-xs text-muted-foreground">
            Signs every issued letter (offer, relieving, appraisal and the rest). Leave blank to sign
            them as &ldquo;Authorised Signatory&rdquo;.
          </p>
          <p className="text-xs text-muted-foreground">
            The notice period applies when an exit is started and the employee&apos;s own record does
            not state one of their own. Leave it blank to fall back to 30 days.
          </p>
        </CardContent>
      </Card>

      {/* Their own cards: both save on drop, not with the Save changes button below. Together with
          the signatory name and title above, they are the letter's signature block. */}
      <LogoUploadCard />
      <SignatureUploadCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Theme colour</CardTitle>
          <CardDescription>
            The accent colour used across the app for everyone in your organization (buttons,
            links and highlights) and on generated documents like offer letters.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {THEME_PRESETS.map((p) => {
              const selected = (brandColor || DEFAULT_BRAND_COLOR) === p.color;
              return (
                <button
                  key={p.color}
                  type="button"
                  title={p.name}
                  aria-label={`Use ${p.name}`}
                  onClick={() => setBrandColor(p.color === DEFAULT_BRAND_COLOR ? "" : p.color)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-shadow ${
                    selected ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : "hover:ring-2 hover:ring-border hover:ring-offset-2 hover:ring-offset-background"
                  }`}
                  style={{ backgroundColor: p.color }}
                >
                  {selected && <Check className="h-4 w-4 text-white" />}
                </button>
              );
            })}
          </div>
          <Field
            label="Custom colour (hex)"
            htmlFor="brand-color"
            error={
              brandColor && !normalizeHex(brandColor)
                ? "Enter a 6-digit hex colour like #0f4c81. Saving will keep the default until then."
                : undefined
            }
          >
            {/* Reset sits on the control row rather than beside the field, so an error message
                under the input cannot push it out of line. */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="h-9 w-9 shrink-0 rounded-md border"
                style={{ backgroundColor: normalizeHex(brandColor) ?? DEFAULT_BRAND_COLOR }}
              />
              <Input
                id="brand-color"
                className="w-36 font-mono"
                placeholder={DEFAULT_BRAND_COLOR}
                value={brandColor ?? ""}
                onChange={(e) => setBrandColor(e.target.value)}
              />
              {brandColor && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setBrandColor("")}>
                  Reset to default
                </Button>
              )}
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Designations</CardTitle>
          <CardDescription>Job titles available when adding or editing employees.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(designations ?? []).length === 0 ? (
              <span className="text-sm text-muted-foreground">No designations yet.</span>
            ) : (
              (designations ?? []).map((d, i) => (
                <Badge key={`${d}-${i}`} variant="blue" className="gap-1.5">
                  {d}
                  <button
                    type="button"
                    onClick={() => removeDesignation(i)}
                    className="rounded-full hover:opacity-70"
                    aria-label={`Remove ${d}`}
                  >
                    <X className="size-4" />
                  </button>
                </Badge>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Add a designation"
              value={newDesignation}
              onChange={(e) => setNewDesignation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addDesignation(); }
              }}
            />
            <Button type="button" variant="outline" onClick={addDesignation}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employee IDs</CardTitle>
          <CardDescription>
            Use <code className="font-mono">{"{YEAR}"}</code> in the prefix or suffix to insert the current
            year. Leave the prefix blank to use the default <span className="font-mono">{defaultPrefix}-1000+n</span> scheme.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Switch
              checked={rule !== null}
              onCheckedChange={(on) => setRule(on ? { ...DEFAULT_RULE } : null)}
            />
            <span className="text-sm">Use a custom ID format</span>
          </div>
          {rule && (
            <>
              <FormGrid columns={2}>
                <Field label="Prefix" htmlFor="rule-prefix">
                  <Input
                    id="rule-prefix"
                    placeholder="EMP-{YEAR}-"
                    value={rule.prefix}
                    onChange={(e) => setRuleField("prefix", e.target.value)}
                  />
                </Field>
                <Field label="Suffix" htmlFor="rule-suffix">
                  <Input
                    id="rule-suffix"
                    value={rule.suffix}
                    onChange={(e) => setRuleField("suffix", e.target.value)}
                  />
                </Field>
                <Field label="Start number" htmlFor="rule-start">
                  <Input
                    id="rule-start"
                    type="number"
                    value={rule.seqStart}
                    onChange={(e) => setRuleField("seqStart", Number(e.target.value))}
                  />
                </Field>
                <Field label="Number padding (digits)" htmlFor="rule-pad">
                  <Input
                    id="rule-pad"
                    type="number"
                    value={rule.padding}
                    onChange={(e) => setRuleField("padding", Number(e.target.value))}
                  />
                </Field>
              </FormGrid>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="rule-reset"
                  checked={rule.resetYearly}
                  onCheckedChange={(c) => setRuleField("resetYearly", c === true)}
                />
                <Label htmlFor="rule-reset" className="font-normal">Reset numbering each year</Label>
              </div>
            </>
          )}
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            Next ID preview: <span className="font-mono font-medium">{preview}</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              name,
              address,
              designations: designations ?? [],
              emailSenderName: emailSenderName ?? "",
              website: website ?? "",
              tagline: tagline ?? "",
              officialEmailDomain: officialEmailDomain ?? "",
              reportRecipients: splitEmailList(reportRecipients ?? ""),
              signatory: { name: signatoryName ?? "", title: signatoryTitle ?? "" },
              employeeIdRule: rule,
              noticePeriodDays: noticePeriodDays ?? "",
              // The API replaces the whole branding object, carry the
              // fields this card doesn't manage so they survive the save.
              branding: {
                logoUrl: org?.branding?.logoUrl ?? "",
                supportEmail: org?.branding?.supportEmail ?? "",
                color: normalizeHex(brandColor) ?? "",
              },
            })
          }
        >
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save changes
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Users, invite, list, role, status                                  */
/* ------------------------------------------------------------------ */

interface UserScope {
  scopeType: "ALL" | "DEPARTMENT" | "OFFICE";
  scopeIds: string[];
}
interface WorkspaceUser {
  id: string;
  email: string;
  name: string;
  role: string;
  roleKeys: string[];
  scope?: UserScope;
  status: string;
  employeeId: string | null;
  vendorId: string | null;
  createdAt: string;
  /** The person behind the login. `needsEmployee` marks accounts that have none. */
  employee?: { id: string; code: string; name: string; status: string } | null;
  needsEmployee?: boolean;
}
interface RoleSummary {
  key: string;
  name: string;
  permissions: string[];
  builtin: boolean;
  staff: boolean;
  userCount: number;
}

function userStatusVariant(status: string): "green" | "amber" | "grey" {
  if (status === "ACTIVE") return "green";
  if (status === "INVITED") return "amber";
  return "grey";
}

function InviteUserDialog({ roles }: { roles: RoleSummary[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("HR");
  // true = email an invite link (user sets own password);
  // false = email a temporary password the user signs in with and changes later.
  const [sendInvite, setSendInvite] = useState(true);

  const assignable = roles.filter((r) => r.key !== "VENDOR");
  const roleItems = assignable.map((r) => ({
    value: r.key,
    label: `${r.name}${r.builtin ? "" : " (custom)"}`,
  }));

  const invite = useMutation({
    mutationFn: () =>
      http.post<{ user: WorkspaceUser; mail?: MailResult }>("/users/invite", {
        name,
        email,
        role,
        sendInvite,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      mailToast(res.mail, sendInvite ? "Invite sent" : "Temporary password emailed");
      close();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function close() {
    setOpen(false);
    setName("");
    setEmail("");
    setRole("HR");
    setSendInvite(true);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Invite user
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>
              {sendInvite
                ? "Email a workspace login invite to a teammate."
                : "Email the user a temporary password to sign in with."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); invite.mutate(); }} className="space-y-4">
            <FormGrid columns={2}>
              <Field label="Name" htmlFor="inv-name">
                <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="inv-email">
                <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </FormGrid>
            <Field label="Role">
              <Select items={roleItems} value={role} onValueChange={(v) => setRole(v as string)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {roleItems.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-start justify-between gap-3 rounded-md bg-muted/50 px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="inv-send" className="cursor-pointer">Email an invite link</Label>
                <p className="text-[13px] text-muted-foreground">
                  {sendInvite
                    ? "The user sets their own password from the emailed link."
                    : "Instead, email them a temporary password to sign in with."}
                </p>
              </div>
              <Switch id="inv-send" checked={sendInvite} onCheckedChange={setSendInvite} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={invite.isPending || !email}>
                {invite.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {sendInvite ? "Send invite" : "Email temp password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChangeRoleDialog({
  user,
  roles,
  open,
  onOpenChange,
}: {
  user: WorkspaceUser | null;
  roles: RoleSummary[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [role, setRole] = useState(user?.role ?? "HR");
  const [scopeType, setScopeType] = useState<UserScope["scopeType"]>(user?.scope?.scopeType ?? "ALL");
  const [scopeIds, setScopeIds] = useState<string[]>(user?.scope?.scopeIds ?? []);
  const assignable = roles.filter((r) => r.key !== "VENDOR");
  const roleItems = assignable.map((r) => ({
    value: r.key,
    label: `${r.name}${r.builtin ? "" : " (custom)"}`,
  }));

  // Options for the scope multi-select (departments or offices).
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => http.get<Array<{ id: string; name: string }>>("/departments"),
  });
  const { data: orgData } = useQuery({
    queryKey: ["org"],
    queryFn: () => http.get<{ offices: Array<{ id: string; name: string }> }>("/org"),
  });
  const offices = orgData?.offices ?? [];
  const scopeOptions = scopeType === "OFFICE" ? offices : departments;

  const toggleId = (id: string) =>
    setScopeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const save = useMutation({
    mutationFn: async () => {
      // Save role first, then scope (two endpoints).
      await http.post<WorkspaceUser>(`/users/${user!.id}/role`, { role });
      await http.put<WorkspaceUser>(`/users/${user!.id}/scope`, {
        scopeType,
        scopeIds: scopeType === "ALL" ? [] : scopeIds,
      });
    },
    onSuccess: () => {
      toast.success("Role & access updated");
      qc.invalidateQueries({ queryKey: ["users"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const scopeInvalid = scopeType !== "ALL" && scopeIds.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Role &amp; access{user ? `: ${user.name}` : ""}</DialogTitle>
          <DialogDescription>Assign a role and optionally limit it to specific departments or offices.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Role">
            <Select items={roleItems} value={role} onValueChange={(v) => setRole(v as string)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {roleItems.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="space-y-2">
            <Label>Access scope</Label>
            <div className="flex flex-wrap gap-2">
              {(["ALL", "DEPARTMENT", "OFFICE"] as const).map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={scopeType === t ? "default" : "outline"}
                  onClick={() => { setScopeType(t); setScopeIds([]); }}
                >
                  {t === "ALL" ? "Whole organisation" : t === "DEPARTMENT" ? "Departments" : "Offices"}
                </Button>
              ))}
            </div>
            {scopeType !== "ALL" && (
              <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-md border p-3">
                {scopeOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No {scopeType === "OFFICE" ? "offices" : "departments"} yet.
                  </p>
                ) : (
                  scopeOptions.map((o) => (
                    <Label key={o.id} className="cursor-pointer text-sm">
                      <Checkbox checked={scopeIds.includes(o.id)} onCheckedChange={() => toggleId(o.id)} />
                      {o.name}
                    </Label>
                  ))
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {scopeType === "ALL"
                ? "This user can manage the whole organisation."
                : `This user's admin powers apply only to the selected ${scopeType === "OFFICE" ? "offices" : "departments"}.`}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={save.isPending || !user || scopeInvalid} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [roleUser, setRoleUser] = useState<WorkspaceUser | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => http.get<WorkspaceUser[]>("/users"),
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: () => http.get<RoleSummary[]>("/roles"),
  });
  const roleName = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.key, r.name])),
    [roles]
  );

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      http.post<WorkspaceUser>(`/users/${id}/status`, { status }),
    onSuccess: () => {
      toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const resend = useMutation({
    mutationFn: (id: string) =>
      http.post<{ ok: boolean; mail?: MailResult }>(`/users/${id}/resend-invite`, {}),
    onSuccess: (res) => mailToast(res.mail, "Invite resent"),
    onError: (e) => toast.error(apiError(e)),
  });

  const createEmployee = useMutation({
    mutationFn: (id: string) => http.post<{ created: boolean }>(`/users/${id}/create-employee`, {}),
    onSuccess: () => {
      toast.success("Employee record created");
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const orphans = users.filter((u) => u.needsEmployee).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Workspace users</CardTitle>
            <CardDescription>
              Every login belongs to somebody on the employee roster. New invites are paired
              automatically.
            </CardDescription>
          </div>
          <InviteUserDialog roles={roles} />
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {/* Logins created before one-person-one-identity have no employee record, so those
            people are missing from the roster, the org chart and every people feature. */}
        {orphans > 0 && (
          <div className="mx-6 mb-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {orphans} {orphans === 1 ? "account has" : "accounts have"} no employee record, so
            {orphans === 1 ? " that person is" : " those people are"} missing from the roster and
            cannot mark attendance, take leave, or be named as a reporting manager. Use
            <b> Create employee record</b> on each row below.
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden lg:table-cell">Employee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  No users yet.
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => {
                const isMe = u.id === me?.id;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.name}</div>
                      <div className="max-w-[14rem] truncate text-xs text-muted-foreground sm:hidden" title={u.email}>{u.email}</div>
                    </TableCell>
                    <TableCell className="hidden max-w-xs truncate text-sm text-muted-foreground sm:table-cell" title={u.email}>{u.email}</TableCell>
                    <TableCell className="text-sm">
                      {roleName[u.role] || u.role}
                      {u.roleKeys.length > 0 && (
                        <span className="text-muted-foreground">
                          {" "}+ {u.roleKeys.map((k) => roleName[k] || k).join(", ")}
                        </span>
                      )}
                      {u.scope && u.scope.scopeType !== "ALL" && (
                        <Badge variant="grey" className="ml-2 text-[13px]">
                          {u.scope.scopeType === "OFFICE" ? "Office" : "Dept"}-scoped ({u.scope.scopeIds.length})
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm">
                      {u.employee ? (
                        <span className="text-muted-foreground">{u.employee.code}</span>
                      ) : (
                        <Badge variant="amber">None</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={userStatusVariant(u.status)}>{u.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {/* Offered for your own account too: an admin with no employee
                            record is exactly the person most likely to be missing one. */}
                        {u.needsEmployee && u.role !== "VENDOR" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={createEmployee.isPending}
                            onClick={() => createEmployee.mutate(u.id)}
                          >
                            {createEmployee.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Create employee record
                          </Button>
                        )}
                      {isMe ? (
                        <span className="self-center text-xs text-muted-foreground">you</span>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setRoleUser(u); setRoleOpen(true); }}
                          >
                            Role
                          </Button>
                          {u.status === "INVITED" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={resend.isPending}
                              onClick={() => resend.mutate(u.id)}
                            >
                              Resend
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={setStatus.isPending}
                              onClick={() =>
                                setStatus.mutate({
                                  id: u.id,
                                  status: u.status === "DISABLED" ? "ACTIVE" : "DISABLED",
                                })
                              }
                            >
                              {u.status === "DISABLED" ? "Activate" : "Suspend"}
                            </Button>
                          )}
                        </>
                      )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      {roleOpen && (
        <ChangeRoleDialog
          key={roleUser?.id ?? "role"}
          user={roleUser}
          roles={roles}
          open={roleOpen}
          onOpenChange={setRoleOpen}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Roles & permissions                                                 */
/* ------------------------------------------------------------------ */

interface PermissionGroup {
  group: string;
  items: [string, string][];
}

function RoleDialog({
  role,
  catalog,
  open,
  onOpenChange,
}: {
  role: RoleSummary | null;
  catalog: PermissionGroup[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const readonly = role?.builtin ?? false;
  const superuser = (role?.permissions ?? []).includes("*");
  const [name, setName] = useState(role?.name ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(role?.permissions ?? [])
  );

  const save = useMutation({
    mutationFn: () => {
      const body = { name, permissions: [...selected] };
      return role
        ? http.put<RoleSummary>(`/roles/${role.key}`, body)
        : http.post<RoleSummary>("/roles", body);
    },
    onSuccess: () => {
      toast.success(role ? "Role updated" : "Role created");
      qc.invalidateQueries({ queryKey: ["roles"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  function toggle(code: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  const title = role ? (readonly ? `${role.name} (built-in)` : `Edit role: ${role.name}`) : "Create role";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {superuser
              ? "This role has all permissions (superuser)."
              : readonly
                ? "Built-in roles are read-only."
                : "Pick the permissions this role grants."}
          </DialogDescription>
        </DialogHeader>

        {!readonly && (
          <Field label="Role name" htmlFor="role-name">
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}

        {!superuser && (
          <div className="max-h-[50dvh] space-y-4 overflow-y-auto pr-1">
            {catalog.map((g) => (
              <div key={g.group} className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">
                  {g.group}
                </div>
                {g.items.map(([code, label]) => (
                  <Label key={code} className="items-start text-sm">
                    <Checkbox
                      checked={selected.has(code)}
                      disabled={readonly}
                      onCheckedChange={(c) => toggle(code, c === true)}
                      className="mt-0.5"
                    />
                    <span>
                      {label} <span className="font-mono text-xs text-muted-foreground">{code}</span>
                    </span>
                  </Label>
                ))}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {readonly ? "Close" : "Cancel"}
          </Button>
          {!readonly && (
            <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RolesTab() {
  const qc = useQueryClient();
  const [dialogRole, setDialogRole] = useState<RoleSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["roles"],
    queryFn: () => http.get<RoleSummary[]>("/roles"),
  });
  const { data: catalog = [] } = useQuery({
    queryKey: ["roles-catalog"],
    queryFn: () => http.get<PermissionGroup[]>("/roles/catalog"),
  });

  const remove = useMutation({
    mutationFn: (key: string) => http.del<{ ok: boolean }>(`/roles/${key}`),
    onSuccess: () => {
      toast.success("Role deleted");
      qc.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Roles &amp; permissions</CardTitle>
            <CardDescription>Built-in roles are read-only; create custom roles for your workspace.</CardDescription>
          </div>
          <Button onClick={() => { setDialogRole(null); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Create role
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Users</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : roles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                  No roles defined.
                </TableCell>
              </TableRow>
            ) : (
              roles.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {r.name}
                      {r.staff && <Badge variant="green">staff</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.builtin ? (
                      <span className="text-sm text-muted-foreground">Built-in</span>
                    ) : (
                      <Badge variant="violet">custom</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.permissions.includes("*") ? "All (superuser)" : r.permissions.length}
                  </TableCell>
                  <TableCell className="text-sm">{r.userCount}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setDialogRole(r); setDialogOpen(true); }}
                      >
                        {r.builtin ? "View" : <><Pencil className="mr-1 size-4" /> Edit</>}
                      </Button>
                      {!r.builtin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(r.key)}
                        >
                          <Trash2 className="mr-1 size-4" /> Delete
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {dialogOpen && (
        <RoleDialog
          key={dialogRole?.key ?? "new"}
          role={dialogRole}
          catalog={catalog}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sending email, custom domain + sender identity                     */
/* ------------------------------------------------------------------ */

interface DnsRecord {
  purpose?: string;
  type: string;
  name: string;
  value: string;
  priority?: number | null;
}
interface EmailDomain {
  domain: string;
  mailFromSubdomain: string | null;
  status: string;
  dkimStatus: string | null;
  mailFromStatus: string | null;
  dnsRecords: DnsRecord[];
  failureReason: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  isApex: boolean;
  fromAddress: string | null;
  fromName: string | null;
  replyTo: string | null;
  createdAt: string | null;
  existingDmarcTxt?: string | null;
  /** The AWS region these DNS records were issued for, vs the one in use now. */
  region: string | null;
  currentRegion: string;
  regionMismatch: boolean;
  /** The address emails are ACTUALLY sent from right now, and whether it's yours. */
  effectiveFrom: string | null;
  usingCustomDomain: boolean;
  senderFallbackReason: "NO_DOMAIN" | "NOT_VERIFIED" | "NO_FROM_ADDRESS" | null;
  mailMode: string;
}

interface TestSendResult {
  to: string;
  from: string;
  usingCustomDomain: boolean;
  mode: string;
  delivered: boolean;
  messageId: string | null;
  error: string | null;
}

function domainStatusVariant(status: string): "green" | "amber" | "red" | "grey" {
  if (status === "VERIFIED") return "green";
  if (status === "FAILED" || status === "REGION_MISMATCH") return "red";
  if (status === "DISABLED") return "grey";
  return "amber"; // PENDING
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Copy failed")
  );
}

/**
 * A DNS record value as it should be typed into a DNS manager.
 *
 * TXT values used to be generated wrapped in double quotes, which is BIND zone-file syntax
 * rather than part of the record. Hosted DNS managers add their own quoting, so pasting a
 * pre-quoted value publishes ""v=spf1 ..."" and verification fails with nothing useful to go
 * on. The generator no longer adds them, but records are stored per domain when the domain is
 * first added, so every domain onboarded before that fix still has the quotes in the database.
 * Stripping on the way out fixes those too, without a migration.
 *
 * Only a matched surrounding pair is removed; quotes inside a value are left alone.
 */
function dnsValue(raw: string): string {
  const v = String(raw ?? "").trim();
  return v.length > 1 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

function EmailDomainTab() {
  const qc = useQueryClient();
  const [domainInput, setDomainInput] = useState("");
  const [fromAddress, setFromAddress] = useState<string | null>(null);
  const [fromName, setFromName] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["email-domain"],
    queryFn: () => http.get<EmailDomain | null>("/email-domain"),
  });

  // Hydrate sender fields once the domain loads (and is verified). The backend now
  // adopts hr@<domain> on verification, so this usually mirrors what is already saved.
  if (data && fromAddress === null) {
    setFromAddress(data.fromAddress ?? `hr@${data.domain}`);
    setFromName(data.fromName ?? "");
    setReplyTo(data.replyTo ?? "");
  }

  const register = useMutation({
    mutationFn: () => http.post<EmailDomain>("/email-domain", { domain: domainInput.trim() }),
    onSuccess: () => {
      toast.success("Domain registered. Publish the DNS records shown next.");
      setDomainInput("");
      qc.invalidateQueries({ queryKey: ["email-domain"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const check = useMutation({
    mutationFn: () => http.post<EmailDomain>("/email-domain/check", {}),
    onSuccess: (res) => {
      if (res.status === "VERIFIED") toast.success("Verified. Your domain is ready to send.");
      else if (res.status === "FAILED") toast.error(res.failureReason || "Verification failed.");
      else toast.message("Still pending. DNS may not have propagated yet.");
      qc.invalidateQueries({ queryKey: ["email-domain"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const saveSender = useMutation({
    mutationFn: () =>
      http.put<EmailDomain>("/email-domain/sender", {
        fromAddress: (fromAddress ?? "").trim(),
        fromName: (fromName ?? "").trim(),
        replyTo: (replyTo ?? "").trim(),
      }),
    onSuccess: () => {
      toast.success("From address saved");
      qc.invalidateQueries({ queryKey: ["email-domain"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const reprovision = useMutation({
    mutationFn: () => http.post<EmailDomain>("/email-domain/reprovision", {}),
    onSuccess: (res) => {
      toast.success(`New records issued for ${res.currentRegion}. Publish them, then check again.`);
      qc.invalidateQueries({ queryKey: ["email-domain"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const testSend = useMutation({
    mutationFn: () => http.post<TestSendResult>("/email-domain/test", {}),
    onSuccess: (res) => {
      if (res.error) toast.error(`Send failed: ${res.error}`);
      else if (!res.delivered) toast.message(`Written to the ${res.mode} (not delivered). From: ${res.from}`);
      else toast.success(`Sent to ${res.to} from ${res.from}`);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: () => http.del<{ ok: boolean }>("/email-domain"),
    onSuccess: () => {
      toast.success("Sending domain removed");
      setFromAddress(null);
      qc.invalidateQueries({ queryKey: ["email-domain"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  // No domain yet, registration form.
  if (!data) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Use your own sending domain</CardTitle>
          <CardDescription>
            Send HRMS emails (invites, onboarding, payslips, password resets) from your own brand domain
            instead of the platform default. Setup takes about 10 minutes, plus DNS propagation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Sending domain" htmlFor="ed-domain">
            <Input
              id="ed-domain"
              placeholder="mail.yourcompany.com (recommended)"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
            />
          </Field>
          <Button disabled={register.isPending || !domainInput.trim()} onClick={() => register.mutate()}>
            {register.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Register domain
          </Button>
        </CardContent>
      </Card>
    );
  }

  const lastChecked = data.lastCheckedAt
    ? new Date(data.lastCheckedAt).toLocaleString()
    : "never";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                {data.domain}
                <Badge variant={domainStatusVariant(data.status)}>{data.status}</Badge>
              </CardTitle>
              <CardDescription>
                MAIL FROM: {data.mailFromSubdomain || "-"} · Last checked: {lastChecked}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>
                {check.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Check verification
              </Button>
              <Button variant="outline" disabled={testSend.isPending} onClick={() => testSend.mutate()}>
                {testSend.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send test email
              </Button>
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Remove
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/*
            The address emails actually go out from. Without this the page could show a
            green VERIFIED badge while every email still sent from the shared platform
            address, which is indistinguishable from the feature working.
          */}
          <div
            className={cn(
              "rounded-md border p-3 text-sm",
              data.usingCustomDomain
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-amber-500/40 bg-amber-500/5"
            )}
          >
            <div className="font-medium">
              Emails are sent from: <span className="font-mono">{data.effectiveFrom}</span>
            </div>
            {!data.usingCustomDomain && (
              <div className="mt-1 text-muted-foreground">
                {data.senderFallbackReason === "NO_FROM_ADDRESS"
                  ? "Your domain is verified, but no From address is set, so emails still go out from the platform's shared address. Set one below."
                  : data.senderFallbackReason === "NOT_VERIFIED"
                    ? "Your domain is not verified yet, so emails go out from the platform's shared address."
                    : "Emails go out from the platform's shared address."}
              </div>
            )}
            {data.mailMode === "outbox" && (
              <div className="mt-1 text-muted-foreground">
                This workspace is running in <b>outbox</b> mode: messages are written to disk, not delivered.
              </div>
            )}
          </div>

          {data.regionMismatch && (
            <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <div>
                These DNS records were issued for AWS region <b>{data.region}</b>, but this workspace now
                sends through <b>{data.currentRegion}</b>. The records name a region, so they can never
                verify the identity in use. Re-provision to get records for {data.currentRegion}.
              </div>
              <Button variant="outline" disabled={reprovision.isPending} onClick={() => reprovision.mutate()}>
                {reprovision.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Re-provision for {data.currentRegion}
              </Button>
            </div>
          )}

          {data.status === "FAILED" && data.failureReason && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {data.failureReason}
            </div>
          )}
          {data.status === "PENDING" && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              Publish the DNS records below at your DNS provider, then click <b>Check verification</b>. SES
              can take 5 to 60 minutes after DNS propagates.
            </div>
          )}
          {data.isApex && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              You&apos;re sending from a root domain. A subdomain (<b>mail.{data.domain}</b>) is recommended
              for reputation isolation.
            </div>
          )}

          <div>
            <div className="mb-2 text-sm font-medium">DNS records to publish</div>
            <div className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
              {data.dnsRecords.length === 0 ? (
                <div className="text-muted-foreground">No records.</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pr-3 pb-1">Type</th>
                      <th className="pr-3 pb-1">Name</th>
                      <th className="pr-3 pb-1">Value</th>
                      <th className="pb-1">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dnsRecords.map((r, i) => (
                      <tr key={i} className="align-top">
                        <td className="pr-3 py-0.5">{r.type}</td>
                        <td className="pr-3 py-0.5">
                          <button type="button" className="text-left hover:underline" onClick={() => copyText(r.name)}>
                            {r.name} <Copy className="inline size-4" />
                          </button>
                        </td>
                        <td className="break-all pr-3 py-0.5">
                          {/* Shown and copied identically: what you read is what you paste. */}
                          <button type="button" className="text-left hover:underline" onClick={() => copyText(dnsValue(r.value))}>
                            {dnsValue(r.value)} <Copy className="inline size-4" />
                          </button>
                        </td>
                        <td className="py-0.5">{r.priority == null ? "-" : r.priority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {data.status === "VERIFIED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">From address</CardTitle>
            <CardDescription>
              HRMS emails for this workspace will be sent from an address on <b>@{data.domain}</b>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormGrid columns={2}>
              <Field label="From address" htmlFor="ed-from">
                <Input id="ed-from" value={fromAddress ?? ""} onChange={(e) => setFromAddress(e.target.value)} />
              </Field>
              <Field label="From name" htmlFor="ed-fromname">
                <Input id="ed-fromname" value={fromName ?? ""} onChange={(e) => setFromName(e.target.value)} />
              </Field>
              <Field label="Reply-To (optional)" htmlFor="ed-reply" className="sm:col-span-2">
                <Input
                  id="ed-reply"
                  placeholder="people who reply reach this inbox"
                  value={replyTo ?? ""}
                  onChange={(e) => setReplyTo(e.target.value)}
                />
              </Field>
            </FormGrid>
            <Button disabled={saveSender.isPending} onClick={() => saveSender.mutate()}>
              {saveSender.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save From address
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Leave types                                                         */
/* ------------------------------------------------------------------ */

interface LeaveType {
  id: string;
  name: string;
  maxPerYear: number;
  paid: boolean;
  carryForwardCap: number;
  /** Whether the company's leave rules apply to this type (see Leave rules). */
  countsTowardMonthlyLimit?: boolean;
  needsAdvanceNotice?: boolean;
}

function LeaveTypeDialog({
  leaveType,
  open,
  onOpenChange,
}: {
  leaveType: LeaveType | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const isNew = !leaveType;
  const [name, setName] = useState(leaveType?.name ?? "");
  const [maxPerYear, setMaxPerYear] = useState(leaveType?.maxPerYear ?? 12);
  const [carryForwardCap, setCarryForwardCap] = useState(leaveType?.carryForwardCap ?? 0);
  const [paid, setPaid] = useState(leaveType?.paid ?? true);
  const [countsTowardMonthlyLimit, setCountsTowardMonthlyLimit] = useState(
    leaveType?.countsTowardMonthlyLimit ?? true,
  );
  const [needsAdvanceNotice, setNeedsAdvanceNotice] = useState(leaveType?.needsAdvanceNotice ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, maxPerYear, carryForwardCap, paid, countsTowardMonthlyLimit, needsAdvanceNotice };
      return isNew
        ? http.post<LeaveType>("/leave/types", body)
        : http.put<LeaveType>(`/leave/types/${leaveType!.id}`, body);
    },
    onSuccess: () => {
      toast.success(isNew ? "Leave type created" : "Leave type saved");
      qc.invalidateQueries({ queryKey: ["leave-types"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add leave type" : "Edit leave type"}</DialogTitle>
          <DialogDescription>
            Define the annual quota, carry-forward behaviour and which leave rules apply.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
          <Field label="Name" htmlFor="lt-name">
            <Input id="lt-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <FormGrid columns={2}>
            <Field label="Days per year" htmlFor="lt-max">
              <Input
                id="lt-max"
                type="number"
                value={maxPerYear}
                onChange={(e) => setMaxPerYear(Number(e.target.value))}
              />
            </Field>
            <Field label="Carry-forward cap" htmlFor="lt-cf">
              <Input
                id="lt-cf"
                type="number"
                value={carryForwardCap}
                onChange={(e) => setCarryForwardCap(Number(e.target.value))}
              />
            </Field>
          </FormGrid>
          <div className="flex items-center gap-2">
            <Switch checked={paid} onCheckedChange={setPaid} />
            <span className="text-sm">Paid leave {paid ? "" : "(e.g. Loss of Pay)"}</span>
          </div>
          <div className="space-y-3 rounded-[12px] border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-medium">Counts toward the monthly limit</div>
                <FieldHint>
                  {paid
                    ? "Uses up the monthly paid-leave limit, when that rule is on under Leave rules."
                    : "Unpaid leave never counts toward the paid-leave limit."}
                </FieldHint>
              </div>
              <Switch
                checked={paid && countsTowardMonthlyLimit}
                disabled={!paid}
                onCheckedChange={(v) => setCountsTowardMonthlyLimit(!!v)}
                aria-label="Counts toward the monthly limit"
              />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-medium">Long leave needs advance notice</div>
                <FieldHint>Turn this off for leave nobody can plan, like sick leave.</FieldHint>
              </div>
              <Switch
                checked={needsAdvanceNotice}
                onCheckedChange={(v) => setNeedsAdvanceNotice(!!v)}
                aria-label="Long leave needs advance notice"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LeaveTypesTab() {
  const qc = useQueryClient();
  const [dialogType, setDialogType] = useState<LeaveType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: types = [], isLoading } = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => http.get<LeaveType[]>("/leave/types"),
  });
  const { data: rules } = useQuery({
    queryKey: LEAVE_RULES_KEY,
    queryFn: () => http.get<LeaveRulesResponse>("/leave/rules"),
  });
  const limitOn = !!rules?.monthlyLimit.enabled;
  const noticeOn = !!rules?.advanceNotice.enabled;
  const rulesOn = limitOn || noticeOn;
  const colSpan = rulesOn ? 6 : 5;

  const remove = useMutation({
    mutationFn: (id: string) => http.del<{ ok: boolean }>(`/leave/types/${id}`),
    onSuccess: () => {
      toast.success("Leave type deleted");
      qc.invalidateQueries({ queryKey: ["leave-types"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Leave types</CardTitle>
            <CardDescription>Annual quotas employees can apply against.</CardDescription>
          </div>
          <Button onClick={() => { setDialogType(null); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add leave type
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Leave type</TableHead>
              <TableHead>Days/yr</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Carry-forward</TableHead>
              {rulesOn && <TableHead className="hidden md:table-cell">Leave rules</TableHead>}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={colSpan}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : types.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-muted-foreground">
                  No leave types.
                </TableCell>
              </TableRow>
            ) : (
              types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.maxPerYear}</TableCell>
                  <TableCell>
                    <Badge variant={t.paid ? "green" : "grey"}>{t.paid ? "Paid" : "Unpaid"}</Badge>
                  </TableCell>
                  <TableCell>{t.carryForwardCap || 0}</TableCell>
                  {rulesOn && (
                    <TableCell className="hidden md:table-cell">
                      {(limitOn && t.countsTowardMonthlyLimit) || (noticeOn && t.needsAdvanceNotice) ? (
                        <div className="flex flex-wrap gap-1">
                          {limitOn && t.countsTowardMonthlyLimit && <Badge variant="secondary">Monthly limit</Badge>}
                          {noticeOn && t.needsAdvanceNotice && <Badge variant="secondary">Notice</Badge>}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Exempt</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setDialogType(t); setDialogOpen(true); }}
                      >
                        <Pencil className="mr-1 size-4" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(t.id)}
                      >
                        <Trash2 className="mr-1 size-4" /> Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {dialogOpen && (
        <LeaveTypeDialog
          key={dialogType?.id ?? "new"}
          leaveType={dialogType}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  actorId: string | null;
  meta: Record<string, unknown>;
  at: string;
}
interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

const ALL_ACTIONS = "__all__";

function AuditTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<string>(ALL_ACTIONS);

  const { data: actions = [] } = useQuery({
    queryKey: ["audit-actions"],
    queryFn: () => http.get<string[]>("/audit/actions"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["audit", page, action],
    queryFn: () =>
      http.get<AuditPage>("/audit", {
        page,
        pageSize: 25,
        ...(action !== ALL_ACTIONS ? { action } : {}),
      }),
  });

  const items = data?.items ?? [];
  const totalPages = data?.pages ?? 1;
  const actionItems = [
    { value: ALL_ACTIONS, label: "All actions" },
    ...actions.map((a) => ({ value: a, label: a })),
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">Audit log</CardTitle>
            <CardDescription>Every administrative action, newest first.</CardDescription>
          </div>
          <div className="w-full sm:w-60">
            <Label className="mb-1.5 block text-xs">Filter by action</Label>
            <Select items={actionItems} value={action} onValueChange={(v) => { setAction(v as string); setPage(1); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                {actionItems.map((a) => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead className="hidden md:table-cell">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                  No audit entries match.
                </TableCell>
              </TableRow>
            ) : (
              items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {new Date(a.at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="grey">{a.action}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{a.actor}</TableCell>
                  <TableCell className="hidden max-w-md truncate text-xs text-muted-foreground md:table-cell">
                    {JSON.stringify(a.meta || {}).slice(0, 140)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
      {data && data.total > 0 && (
        <div className="flex items-center justify-between border-t px-6 py-3 text-sm text-muted-foreground">
          <span>
            {data.total} {data.total === 1 ? "entry" : "entries"} · page {data.page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Leave coverage (minimum-staffing guard)                             */
/* ------------------------------------------------------------------ */

interface CoveragePolicy {
  enabled: boolean;
  minPresent: number;
  mode: "warn" | "block";
}
interface CoverageDept {
  id: string;
  name: string;
  policy: CoveragePolicy;
}
interface CoverageConfig {
  enabled: boolean;
  departments: CoverageDept[];
}

function LeaveCoverageTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["leave-coverage"],
    queryFn: () => http.get<CoverageConfig>("/leave/coverage"),
  });
  const [enabled, setEnabled] = useState(false);
  const [depts, setDepts] = useState<CoverageDept[]>([]);
  useEffect(() => {
    if (data) {
      setEnabled(data.enabled);
      setDepts(data.departments);
    }
  }, [data]);

  const setDept = (id: string, patch: Partial<CoveragePolicy>) =>
    setDepts((ds) => ds.map((d) => (d.id === id ? { ...d, policy: { ...d.policy, ...patch } } : d)));

  const save = useMutation({
    mutationFn: () =>
      http.put("/leave/coverage", {
        enabled,
        departments: depts.map((d) => ({ id: d.id, ...d.policy })),
      }),
    onSuccess: () => {
      toast.success("Leave-coverage settings saved");
      qc.invalidateQueries({ queryKey: ["leave-coverage"] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Minimum leave coverage</CardTitle>
            <CardDescription>
              Stop too many people in the same department being on leave the same day, so there&apos;s
              always someone present. Off by default, opt in per department below.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-sm text-muted-foreground">{enabled ? "On" : "Off"}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={enabled ? "" : "pointer-events-none opacity-50"}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead className="w-24">Guard</TableHead>
                <TableHead className="w-36">Min present / day</TableHead>
                <TableHead className="w-40">If it breaks coverage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {depts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    No departments yet.
                  </TableCell>
                </TableRow>
              ) : (
                depts.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      <Switch checked={d.policy.enabled} onCheckedChange={(v) => setDept(d.id, { enabled: !!v })} />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        className="w-20"
                        value={d.policy.minPresent}
                        disabled={!d.policy.enabled}
                        onChange={(e) => setDept(d.id, { minPresent: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        items={[
                          { value: "warn", label: "Warn only" },
                          { value: "block", label: "Block (override)" },
                        ]}
                        value={d.policy.mode}
                        onValueChange={(v) => setDept(d.id, { mode: v === "block" ? "block" : "warn" })}
                        disabled={!d.policy.enabled}
                      >
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="warn">Warn only</SelectItem>
                          <SelectItem value="block">Block (override)</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            <b>Warn only</b> lets the leave through but flags it to the approver. <b>Block</b> refuses it
            unless a manager overrides with a reason. Weekends and holidays are ignored.
          </p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save coverage settings
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function SettingsPageInner() {
  const { isStaff } = useAuth();
  const [tab, setTab] = useActiveTab("security");

  if (!isStaff) {
    return (
      <>
        <PageHeader title="Settings" description="Manage your account security." />
        <SecurityTab />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" description="Workspace, users, roles, email and more." />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="email">Sending email</TabsTrigger>
          <TabsTrigger value="letters">Letters</TabsTrigger>
          <TabsTrigger value="leave">Leave types</TabsTrigger>
          <TabsTrigger value="coverage">Leave coverage</TabsTrigger>
          <TabsTrigger value="leave-rules">Leave rules</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="starter">Starter content</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="security" className="mt-6">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="organization" className="mt-6">
          <OrganizationTab />
        </TabsContent>
        <TabsContent value="users" className="mt-6">
          <UsersTab />
        </TabsContent>
        <TabsContent value="roles" className="mt-6">
          <RolesTab />
        </TabsContent>
        <TabsContent value="email" className="mt-6">
          <EmailDomainTab />
        </TabsContent>
        <TabsContent value="letters" className="mt-6">
          <LetterTemplatesTab />
        </TabsContent>
        <TabsContent value="leave" className="mt-6">
          <LeaveTypesTab />
        </TabsContent>
        <TabsContent value="coverage" className="mt-6">
          <LeaveCoverageTab />
        </TabsContent>
        <TabsContent value="leave-rules" className="mt-6">
          <LeaveRulesTab />
        </TabsContent>
        <TabsContent value="reminders" className="mt-6">
          <ReminderSettingsTab />
        </TabsContent>
        <TabsContent value="starter" className="mt-6">
          <StarterContentCard />
        </TabsContent>
        <TabsContent value="audit" className="mt-6">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}
