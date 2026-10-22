"use client";

import { useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@open-hrms/ui/cn";
import type { Employee } from "@open-hrms/types";

type Option = { value: string; label: string; exited: boolean };

/**
 * Type-to-search employee picker.
 *
 * The API returns employees in table order, which is effectively random, so a
 * plain Select buried new joiners at the bottom of an unsorted list that showed
 * nine names at a time. HR could not find them. This sorts current staff by name,
 * puts exited employees after them, tagged "Exited", and lets HR type a name or code.
 */
export function EmployeeCombobox({
  employees,
  value,
  onValueChange,
  placeholder = "Search by name or code",
}: {
  employees: Employee[];
  value: string;
  onValueChange: (id: string) => void;
  placeholder?: string;
}) {
  const items = useMemo<Option[]>(
    () =>
      employees
        .map((e) => {
          const exited = e.status === "EXITED";
          // "Exited" lives in the label so it stays visible once picked and is searchable.
          const name = `${e.firstName} ${e.lastName ?? ""} (${e.code})`.replace(/\s+/g, " ");
          return { value: e.id, label: exited ? `${name} · Exited` : name, exited };
        })
        .sort((a, b) => Number(a.exited) - Number(b.exited) || a.label.localeCompare(b.label)),
    [employees],
  );
  const selected = items.find((i) => i.value === value) ?? null;

  return (
    <Combobox.Root
      items={items}
      value={selected}
      onValueChange={(v) => onValueChange((v as Option | null)?.value ?? "")}
      isItemEqualToValue={(a: Option, b: Option) => a.value === b.value}
      autoHighlight
    >
      <Combobox.InputGroup className="relative">
        <Combobox.Input
          placeholder={placeholder}
          className={cn(
            "h-11 w-full min-w-0 rounded-[10px] border border-input bg-card pl-3.5 pr-10 text-[16px] text-foreground shadow-[var(--elev-1)] outline-none",
            "transition-[border-color,box-shadow] duration-200 placeholder:text-[color:var(--faint)]",
            "hover:border-[color:color-mix(in_srgb,var(--primary)_35%,var(--input))]",
            "focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/18 dark:bg-input/25",
          )}
        />
        <Combobox.Trigger
          aria-label="Show employees"
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground"
        >
          <ChevronDownIcon className="size-[18px]" />
        </Combobox.Trigger>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="start" className="isolate z-50">
          <Combobox.Popup className="w-max min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))] rounded-[14px] bg-popover p-1 text-popover-foreground shadow-[var(--elev-4)] ring-1 ring-black/5 dark:ring-white/10">
            <Combobox.Empty>
              <div className="px-3 py-2.5 text-sm text-muted-foreground">No employee matches that.</div>
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto overscroll-contain outline-none data-empty:p-0">
              {(item: Option) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-[8px] px-2.5 py-2 text-[15px] outline-none select-none data-highlighted:bg-muted"
                >
                  <Combobox.ItemIndicator className="col-start-1">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                  <span className={cn("col-start-2 truncate", item.exited && "text-muted-foreground")}>{item.label}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
