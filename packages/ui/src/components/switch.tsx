"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "../lib/cn"

/**
 * Toggle at iOS proportions, 51×31 with a 27px thumb, the exact metrics of
 * the system switch. (Previously 32×18, which was smaller than the text
 * beside it and read as a checkbox.) `sm` is 40×24 for dense rows.
 */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent p-0.5",
        "transition-[background-color,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] outline-none",
        "after:absolute after:-inset-x-2 after:-inset-y-2",
        "focus-visible:ring-4 focus-visible:ring-ring/30",
        "aria-invalid:ring-4 aria-invalid:ring-destructive/20",
        "data-[size=default]:h-[31px] data-[size=default]:w-[51px]",
        "data-[size=sm]:h-6 data-[size=sm]:w-10",
        "data-checked:bg-primary data-unchecked:bg-[color:var(--faint)]",
        "dark:data-unchecked:bg-input",
        "data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] ring-0",
          "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          "group-data-[size=default]/switch:size-[27px] group-data-[size=sm]/switch:size-5",
          "group-data-[size=default]/switch:data-checked:translate-x-5",
          "group-data-[size=sm]/switch:data-checked:translate-x-4",
          "data-unchecked:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
