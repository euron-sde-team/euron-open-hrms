"use client";

/**
 * Renders one template field as the right control for its type.
 *
 * The whole point of the form builder is that a tenant composes fields on the server and the
 * UI renders whatever comes back, so this is the single place that decides what a `date` or
 * a `select` looks like. Adding a field type means adding one case here and one on the
 * server; nothing else in the wizard changes.
 *
 * Validation is deliberately NOT duplicated here. The server validates on every autosave and
 * hands back plain-language errors, which is what gets displayed. Re-implementing the PAN
 * regex in the browser would just create two versions of the truth to keep in step.
 */

import { Input } from "@open-hrms/ui/input";
import { Textarea } from "@open-hrms/ui/textarea";
import { Checkbox } from "@open-hrms/ui/checkbox";
import { Field } from "@open-hrms/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-hrms/ui/select";
import { PhoneField, splitPhone, joinPhone } from "@/components/phone-field";
import type { TemplateField } from "@/lib/onboarding-forms";

export function FieldInput({
  field,
  value,
  error,
  disabled,
  onChange,
  idPrefix = "",
}: {
  field: TemplateField;
  value: unknown;
  error?: string;
  disabled?: boolean;
  onChange: (value: unknown) => void;
  idPrefix?: string;
}) {
  const id = `${idPrefix}${field.key}`;
  const str = value == null ? "" : String(value);

  // A checkbox reads as its own statement rather than a label above an empty box, so it
  // opts out of the Field wrapper's label-on-top layout.
  if (field.type === "checkbox") {
    return (
      <div className="flex min-w-0 items-start gap-2.5 py-1.5">
        <Checkbox
          id={id}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(c: boolean) => onChange(c === true)}
          className="mt-0.5"
        />
        <label htmlFor={id} className="cursor-pointer text-[14px] leading-snug">
          {field.label}
          {field.help && <span className="block text-[12px] text-muted-foreground">{field.help}</span>}
          {error && <span className="block text-[12px] text-[color:var(--bad)]">{error}</span>}
        </label>
      </div>
    );
  }

  const control = (() => {
    switch (field.type) {
      case "textarea":
      case "address":
        return (
          <Textarea
            id={id}
            value={str}
            disabled={disabled}
            rows={field.type === "address" ? 3 : 4}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case "phone": {
        const { dialCode, number } = splitPhone(str);
        return (
          <PhoneField
            id={id}
            dialCode={dialCode}
            number={number}
            placeholder={field.placeholder ?? "Phone number"}
            onDialCodeChange={(d) => onChange(number ? joinPhone(d, number) : "")}
            onNumberChange={(n) => onChange(n ? joinPhone(dialCode, n) : "")}
            disabled={disabled}
          />
        );
      }

      case "select":
        return (
          <Select
            items={[{ value: "", label: `Select ${field.label.toLowerCase()}` }, ...(field.options ?? []).map((o) => ({ value: o, label: o }))]}
            value={str}
            disabled={disabled}
            onValueChange={(v) => onChange(String(v ?? ""))}
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case "multiselect": {
        const selected = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {(field.options ?? []).map((o) => (
              <label key={o} className="flex cursor-pointer items-center gap-2 text-[14px]">
                <Checkbox
                  checked={selected.includes(o)}
                  disabled={disabled}
                  onCheckedChange={(c: boolean) =>
                    onChange(c ? [...selected, o] : selected.filter((x) => x !== o))
                  }
                />
                {o}
              </label>
            ))}
          </div>
        );
      }

      case "number":
        return (
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            value={str}
            disabled={disabled}
            min={field.min}
            max={field.max}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          />
        );

      case "date":
        return (
          <Input id={id} type="date" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        );

      case "email":
        return (
          <Input
            id={id}
            type="email"
            autoComplete="email"
            value={str}
            disabled={disabled}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      // A `file` field is satisfied by an upload, not a typed value, so the section renders
      // an uploader for it instead. Reaching here means a template asked for one outside a
      // section that handles uploads; say so rather than showing a dead text box.
      case "file":
        return (
          <p className="rounded-md border border-dashed px-3 py-2 text-[13px] text-muted-foreground">
            Upload handled in the documents area of this step.
          </p>
        );

      default:
        return (
          <Input
            id={id}
            value={str}
            disabled={disabled}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  })();

  return (
    <Field label={field.label} htmlFor={id} required={field.required} hint={field.help} error={error}>
      {control}
    </Field>
  );
}
