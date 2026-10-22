import * as React from "react"

import { cn } from "../lib/cn"

/**
 * Multi-line text field, matching Input's metrics and focus treatment.
 *
 * `field-sizing-content` lets the box grow as the user types, but it also sizes an
 * empty field to its (empty) content, which silently overrode the `rows` callers
 * pass and collapsed every textarea to the min-height floor. When `rows` is given we
 * drop the fixed floor and derive the min-height from it, so `rows` sets the starting
 * height and auto-grow still applies beyond it.
 */
function Textarea({ className, rows, style, ...props }: React.ComponentProps<"textarea">) {
  // 22px line-height + 24px vertical padding (py-3 twice), matching the classes below.
  const minHeight = rows ? `calc(${rows} * 22px + 24px)` : undefined;
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      style={minHeight ? { minHeight, ...style } : style}
      className={cn(
        "flex field-sizing-content w-full rounded-[10px] border border-input bg-card px-3.5 py-3",
        !rows && "min-h-24",
        "text-[16px] leading-[22px] text-foreground shadow-[var(--elev-1)]",
        "transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] outline-none",
        "placeholder:text-[color:var(--faint)]",
        "hover:border-[color:color-mix(in_srgb,var(--primary)_35%,var(--input))]",
        "focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/18",
        "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
        "aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/18",
        "dark:bg-input/25 dark:disabled:bg-input/40 dark:aria-invalid:border-destructive/60",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
