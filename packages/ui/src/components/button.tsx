import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../lib/cn"

/**
 * Button, sized to Apple's HIG.
 *
 * `default` is a 44px tap target with 16px text. The size ramp is strictly
 * monotonic, xs < sm < default < lg, which the previous scale was not (`lg`
 * was the same height as `default` with *less* horizontal padding, so "large"
 * buttons rendered smaller than normal ones).
 *
 * Press feedback is Apple's: a small scale-down on active rather than a
 * translate, easing on the standard spring curve.
 */
const buttonVariants = cva(
  [
    "group/button relative inline-flex shrink-0 items-center justify-center gap-2",
    "border border-transparent bg-clip-padding font-semibold whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-200",
    "ease-[cubic-bezier(0.32,0.72,0,1)] outline-none",
    "focus-visible:ring-4 focus-visible:ring-ring/35",
    "active:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-40",
    "aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/20",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[var(--elev-2)] hover:brightness-110 active:brightness-95",
        outline:
          "border-border bg-card text-foreground shadow-[var(--elev-1)] hover:bg-muted hover:border-[color:color-mix(in_srgb,var(--primary)_35%,var(--border))] aria-expanded:bg-muted dark:bg-input/25",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] aria-expanded:bg-secondary",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted dark:hover:bg-muted/60",
        destructive:
          "bg-destructive text-white shadow-[var(--elev-2)] hover:brightness-110 focus-visible:ring-destructive/30",
        "destructive-soft":
          "bg-[var(--bad-bg)] text-[var(--bad)] hover:brightness-[0.97] focus-visible:ring-destructive/25",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-11 rounded-[10px] px-5 text-[16px]",
        xs: "h-8 gap-1.5 rounded-[7px] px-3 text-[13px] [&_svg:not([class*='size-'])]:size-4",
        sm: "h-9 gap-1.5 rounded-[8px] px-4 text-[15px] [&_svg:not([class*='size-'])]:size-[18px]",
        lg: "h-[52px] rounded-[12px] px-7 text-[17px] [&_svg:not([class*='size-'])]:size-6",
        icon: "size-11 rounded-[10px]",
        "icon-xs": "size-8 rounded-[7px] [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-9 rounded-[8px] [&_svg:not([class*='size-'])]:size-[18px]",
        "icon-lg": "size-[52px] rounded-[12px] [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
