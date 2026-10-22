"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "../lib/cn"
import { CheckIcon } from "lucide-react"

/**
 * Checkbox at 22px, Apple's control size, up from the previous 16px, which
 * was both hard to hit and visually lost next to body text. The `after`
 * pseudo-element extends the hit area beyond the visible box.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px] border-input bg-card",
        "transition-[background-color,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] outline-none",
        "after:absolute after:-inset-x-3 after:-inset-y-2.5",
        "hover:border-[color:color-mix(in_srgb,var(--primary)_50%,var(--input))]",
        "focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/25",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "group-has-disabled/field:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/20",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-checked:shadow-[var(--elev-1)]",
        "dark:bg-input/25 dark:data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current [&>svg]:size-4 [&>svg]:stroke-[3]"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
