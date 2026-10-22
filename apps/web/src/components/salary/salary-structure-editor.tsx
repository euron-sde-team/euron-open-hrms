"use client";

/**
 * Compensation, stated the way Indian HR actually states it: one annual CTC.
 *
 * HR agrees a CTC with a candidate, not six monthly figures, so that is the input.
 * The structure derives basic, HRA and the rest, and a balancing allowance absorbs
 * the remainder so the breakup reconciles to the CTC exactly. The breakup itself is
 * computed on the SERVER (`POST /salary/structures/preview`) rather than in the
 * browser, so the figure HR agrees to at hire time is produced by the same code
 * that will run payroll, not a second implementation that drifts from it.
 *
 * Used by every path that sets pay: add employee, invite a candidate, edit an
 * invite, and Set compensation. One editor is what stops those four disagreeing,
 * which is exactly how they got into a state where each had its own arithmetic.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Loader2 } from "lucide-react";
import { http } from "@/lib/api";
import { useOrgPayroll, formatMoney } from "@/lib/currency";
import { Field, FormGrid } from "@open-hrms/ui/field";
import { Input } from "@open-hrms/ui/input";
import { Checkbox } from "@open-hrms/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@open-hrms/ui/select";

export interface StatutoryValue {
  pf?: { applicable?: boolean; restrictToCeiling?: boolean; uan?: string; override?: number | null };
  esi?: { applicable?: boolean; override?: number | null };
  professionalTax?: { applicable?: boolean; state?: string; override?: number | null };
}

export interface SalaryValue {
  annualCtc: number | null;
  structureId: string | null;
  statutory?: StatutoryValue;
}

interface Structure { id: string; name: string; isDefault?: boolean }

interface Preview {
  monthly: { key: string; label: string; amount: number }[];
  gross: number;
  annualGross: number;
  deductions: { key?: string; label: string; amount: number; overridden?: boolean }[];
  employerContributions: { key?: string; label: string; amount: number }[];
  net: number;
  trueAnnualCtc: number;
  /** True when the organisation quotes CTC with its own contributions already inside it. */
  ctcIncludesEmployerContributions?: boolean;
  currency: string;
}

export function SalaryStructureEditor({
  value,
  onChange,
  employmentType,
  /** Compact rendering for a dialog that already has a lot in it. */
  dense = false,
}: {
  value: SalaryValue;
  onChange: (next: SalaryValue) => void;
  employmentType?: string | null;
  dense?: boolean;
}) {
  const { country, currency, locale } = useOrgPayroll();
  const [showStatutory, setShowStatutory] = useState(false);
  const money = (n: number) => formatMoney(n, currency, locale);

  const { data: structures = [] } = useQuery({
    queryKey: ["salary-structures"],
    queryFn: () => http.get<Structure[]>("/salary/structures"),
    staleTime: 5 * 60 * 1000,
  });

  // Debounced so typing a CTC does not fire a request per keystroke.
  const [debouncedCtc, setDebouncedCtc] = useState(value.annualCtc);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedCtc(value.annualCtc), 350);
    return () => clearTimeout(id);
  }, [value.annualCtc]);

  const { data: preview, isFetching, error } = useQuery({
    queryKey: ["salary-preview", debouncedCtc, value.structureId, employmentType, value.statutory],
    queryFn: () =>
      http.post<Preview>("/salary/structures/preview", {
        annualCtc: debouncedCtc,
        structureId: value.structureId,
        employmentType,
        statutory: value.statutory,
      }),
    enabled: Number(debouncedCtc) > 0,
    retry: false,
  });

  const set = (patch: Partial<SalaryValue>) => onChange({ ...value, ...patch });
  const setStat = (patch: StatutoryValue) =>
    onChange({ ...value, statutory: { ...(value.statutory ?? {}), ...patch } });

  const stat = value.statutory ?? {};
  const monthlyCtc = Number(value.annualCtc) > 0 ? Math.round(Number(value.annualCtc) / 12) : 0;

  return (
    <div className="space-y-4">
      <FormGrid columns={2}>
        <Field label={`Annual CTC (${currency})`} hint={monthlyCtc ? `${money(monthlyCtc)} a month` : undefined}>
          <Input
            type="number"
            min={0}
            inputMode="decimal"
            className="text-right tabular-nums"
            placeholder="1200000"
            value={value.annualCtc ?? ""}
            onChange={(e) => set({ annualCtc: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </Field>
        {country === "IN" && structures.length > 0 && (
          <Field label="Salary structure" hint="Defines how the CTC is split.">
            <Select
              // `items` is what lets SelectValue render the NAME; without it the
              // trigger prints the raw id ("in-standard") at the user.
              items={structures.map((s) => ({
                value: s.id,
                label: s.isDefault ? `${s.name} (default)` : s.name,
              }))}
              value={value.structureId ?? structures.find((s) => s.isDefault)?.id ?? structures[0]?.id ?? ""}
              onValueChange={(v) => set({ structureId: String(v) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {structures.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.isDefault ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </FormGrid>

      {/* The breakup. Shown as soon as there is a CTC, so HR sees what they are agreeing to. */}
      {Number(value.annualCtc) > 0 && (
        <div className="rounded-lg border">
          {error ? (
            <p className="flex items-start gap-2 p-4 text-[13px] text-[color:var(--warn)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {(error as { message?: string })?.message ?? "That CTC does not fit this structure."}
            </p>
          ) : !preview ? (
            <p className="flex items-center gap-2 p-4 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Working out the breakup…
            </p>
          ) : (
            <div className={isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <table className="w-full text-[13px]">
                <tbody>
                  {preview.monthly.map((l) => (
                    <tr key={l.key} className="border-b last:border-0">
                      <td className="px-4 py-2">{l.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(l.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-b bg-muted/40 font-medium">
                    <td className="px-4 py-2">Monthly gross</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(preview.gross)}</td>
                  </tr>

                  {preview.deductions.map((l) => (
                    <tr key={l.key ?? l.label} className="border-b last:border-0 text-muted-foreground">
                      <td className="px-4 py-2">
                        {l.label}
                        {l.overridden && (
                          <span className="ml-2 rounded bg-[color:var(--warn-wash,transparent)] text-[11px] text-[color:var(--warn)]">
                            set by hand
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">- {money(l.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-b font-medium">
                    <td className="px-4 py-2">Take-home (before tax)</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(preview.net)}</td>
                  </tr>

                  {/* What the role actually costs, which the employee's payslip never shows. */}
                  {preview.employerContributions.map((l) => (
                    <tr key={l.key ?? l.label} className="border-b last:border-0 text-muted-foreground">
                      <td className="px-4 py-2">{l.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(l.amount)}</td>
                    </tr>
                  ))}
                  {/* Under the inclusive convention this row lands back on the CTC that
                      was typed, so calling it "true" cost would read as a coincidence.
                      Naming the convention is what makes the smaller gross above make
                      sense rather than look like an error. */}
                  <tr className="bg-muted/40 font-medium">
                    <td className="px-4 py-2">
                      {preview.ctcIncludesEmployerContributions
                        ? "Total annual cost (the quoted CTC)"
                        : "True annual cost (CTC plus employer contributions)"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(preview.trueAnnualCtc)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                {preview.ctcIncludesEmployerContributions
                  ? "This organisation quotes CTC inclusive of employer contributions, so they are reserved out of the CTC and the salary above is the remainder. Change this under Payroll, Country and rules."
                  : "This organisation quotes CTC as gross salary, so employer contributions are paid on top and the role costs more than the CTC. Change this under Payroll, Country and rules."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Statutory: computed by default, overridable when reality disagrees. */}
      {country === "IN" && !dense && (
        <div className="rounded-lg border">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] font-medium"
            onClick={() => setShowStatutory((v) => !v)}
          >
            Statutory (PF, ESI, professional tax)
            <ChevronDown className={`size-4 transition-transform ${showStatutory ? "rotate-180" : ""}`} />
          </button>
          {showStatutory && (
            <div className="space-y-4 border-t px-4 py-4">
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                These are worked out each payroll run from the rates in Payroll settings.
                Change them here only for this person.
              </p>

              <div className="space-y-2">
                <label className="flex items-start gap-2.5">
                  <Checkbox
                    checked={stat.pf?.applicable !== false}
                    onCheckedChange={(v) => setStat({ pf: { ...(stat.pf ?? {}), applicable: !!v } })}
                  />
                  <span className="text-[13px]">In the PF scheme</span>
                </label>
                {stat.pf?.applicable !== false && (
                  <div className="ml-7 space-y-2">
                    <label className="flex items-start gap-2.5">
                      <Checkbox
                        checked={stat.pf?.restrictToCeiling !== false}
                        onCheckedChange={(v) => setStat({ pf: { ...(stat.pf ?? {}), restrictToCeiling: !!v } })}
                      />
                      <span className="text-[13px]">
                        Contribute on the {currency === "INR" ? "₹15,000" : "statutory"} wage ceiling
                        <span className="block text-[12px] text-muted-foreground">
                          Uncheck to contribute on full basic.
                        </span>
                      </span>
                    </label>
                    <FormGrid columns={2}>
                      <Field label="UAN" hint="From a previous employer, if they have one.">
                        <Input
                          value={stat.pf?.uan ?? ""}
                          onChange={(e) => setStat({ pf: { ...(stat.pf ?? {}), uan: e.target.value } })}
                        />
                      </Field>
                      <Field label="Override monthly PF" hint="Leave blank to use the computed amount.">
                        <Input
                          type="number"
                          min={0}
                          className="text-right tabular-nums"
                          value={stat.pf?.override ?? ""}
                          onChange={(e) =>
                            setStat({ pf: { ...(stat.pf ?? {}), override: e.target.value === "" ? null : Number(e.target.value) } })
                          }
                        />
                      </Field>
                    </FormGrid>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-2.5">
                <Checkbox
                  checked={stat.esi?.applicable !== false}
                  onCheckedChange={(v) => setStat({ esi: { ...(stat.esi ?? {}), applicable: !!v } })}
                />
                <span className="text-[13px]">
                  In the ESI scheme
                  <span className="block text-[12px] text-muted-foreground">
                    Applies only up to the coverage limit; higher earners are outside the scheme anyway.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5">
                <Checkbox
                  checked={stat.professionalTax?.applicable !== false}
                  onCheckedChange={(v) =>
                    setStat({ professionalTax: { ...(stat.professionalTax ?? {}), applicable: !!v } })
                  }
                />
                <span className="text-[13px]">Pays professional tax</span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
