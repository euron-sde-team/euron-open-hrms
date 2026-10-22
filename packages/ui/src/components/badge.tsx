import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../lib/cn"

// Status pill, Apple-style: sentence case at 13px on a fully-rounded, softly
// tinted capsule. (Was 11px bold uppercase in a 4px box, loud, cramped and
// barely legible at a glance.)
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2.5 py-[3px] text-[13px] leading-[17px] font-medium whitespace-nowrap transition-all focus-visible:ring-4 focus-visible:ring-ring/30 [&>svg]:pointer-events-none [&>svg]:size-3.5!",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent-50)] text-[var(--accent-700)]",
        secondary: "bg-[var(--grey-bg)] text-[var(--grey-fg)]",
        destructive: "bg-[var(--bad-bg)] text-[var(--bad)]",
        outline: "border-border text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Vanilla tag colours (use these for statuses/types):
        green: "bg-[var(--ok-bg)] text-[var(--ok)]",
        amber: "bg-[var(--warn-bg)] text-[var(--warn)]",
        red: "bg-[var(--bad-bg)] text-[var(--bad)]",
        blue: "bg-[var(--info-bg)] text-[var(--info)]",
        grey: "bg-[var(--grey-bg)] text-[var(--grey-fg)]",
        violet: "bg-[var(--accent-50)] text-[var(--accent-700)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
