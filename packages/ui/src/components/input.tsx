import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "../lib/cn"

/**
 * Text field, sized to Apple's HIG.
 *
 * `default` is a 44px control with 16px text, the comfortable touch target
 * Apple specifies, and 16px keeps mobile Safari from zooming on focus. Use
 * `compact` (36px) only for dense inline editing inside table rows; never for
 * a form a person actually fills in.
 */
function Input({
  className,
  type,
  inputSize = "default",
  ...props
}: React.ComponentProps<"input"> & { inputSize?: "default" | "compact" | "lg" }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-size={inputSize}
      className={cn(
        "w-full min-w-0 border border-input bg-card text-foreground shadow-[var(--elev-1)]",
        "transition-[border-color,box-shadow,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] outline-none",
        "placeholder:text-[color:var(--faint)]",
        "hover:border-[color:color-mix(in_srgb,var(--primary)_35%,var(--input))]",
        "focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/18",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
        "aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/18",
        // A file input renders a native button + filename label. Flex-centering the
        // input centres the label. The native ::file-selector-button sits on the text baseline, so it renders high
        // in a fixed-height control. Only EXPLICIT vertical margins move it: `my-auto`
        // computes to 0px on this pseudo-element (verified in Chrome), and
        // `vertical-align: middle` doesn't centre it either. --file-btn-my is therefore
        // set per size to (control height - 28px button - 2px border) / 2.
        "file:mr-3 file:inline-flex file:h-7 file:items-center file:cursor-pointer file:rounded-[7px] file:border-0 file:bg-muted file:px-3 file:text-[14px] file:font-medium file:text-foreground",
        "file:my-(--file-btn-my)",
        "[&[type=file]]:flex [&[type=file]]:items-center [&[type=file]]:py-0 [&[type=file]]:text-[14px]",
        "data-[size=default]:[--file-btn-my:7px] data-[size=compact]:[--file-btn-my:3px] data-[size=lg]:[--file-btn-my:11px]",
        // Padding is set via a CSS variable rather than `data-[size=*]:px-*`, because a
        // variant-prefixed padding utility is a different tailwind-merge group than a
        // caller's plain `pl-11`, both survive, and the variant wins the cascade. That
        // silently ate the left padding every icon-in-input search field asks for.
        "px-(--input-px)",
        "data-[size=default]:h-11 data-[size=default]:rounded-[10px] data-[size=default]:[--input-px:0.875rem] data-[size=default]:text-[16px]",
        "data-[size=compact]:h-9 data-[size=compact]:rounded-[8px] data-[size=compact]:[--input-px:0.75rem] data-[size=compact]:text-[15px]",
        "data-[size=lg]:h-[52px] data-[size=lg]:rounded-[12px] data-[size=lg]:[--input-px:1rem] data-[size=lg]:text-[17px]",
        "dark:bg-input/25 dark:disabled:bg-input/40 dark:aria-invalid:border-destructive/60",
        className
      )}
      {...props}
    />
  )
}

export { Input }
