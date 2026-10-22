"use client";

import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api";
import { Input } from "@open-hrms/ui/input";

interface OrgResponse {
  org?: { designations?: string[] };
}

/**
 * Designation picker: pick from the org's managed designation list OR type a new
 * one. Backed by a native <datalist> so it stays a plain text field (any value is
 * allowed) while offering the existing titles as suggestions. The managed list
 * lives in org settings (Settings → Organization → Designations).
 */
export function DesignationField({
  id = "designation",
  value,
  onChange,
  placeholder = "Select or type",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { data } = useQuery({
    queryKey: ["org"],
    queryFn: () => http.get<OrgResponse>("/org"),
  });
  const options = Array.from(
    new Set((data?.org?.designations ?? []).map((d) => String(d).trim()).filter(Boolean)),
  );
  const listId = `${id}-options`;

  return (
    <>
      <Input
        id={id}
        list={listId}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {options.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </>
  );
}
