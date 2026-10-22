"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../lib/cn"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-5 data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

/**
 * Two shapes, both Apple's:
 *  - `default` is the iOS segmented control, a recessed grey track with the
 *    selected segment raised on a white capsule.
 *  - `line` is the macOS/Safari underline tab, for page-level section nav.
 */
// `max-w-full` + `flex-wrap` and a min-height instead of a fixed one: the list could
// previously neither wrap nor scroll, so a 3-tab list overflowed the whole document at
// 390px (measured: /leave +78px, /reimbursements +38px). Wrapping to a second row beats
// a hidden horizontal scroller here, and it avoids clipping the raised capsule's shadow.
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit max-w-full flex-wrap items-center justify-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch",
  {
    variants: {
      variant: {
        default:
          "gap-0.5 rounded-[11px] bg-[color:var(--grey-bg)] p-1 group-data-horizontal/tabs:min-h-11 dark:bg-[color:var(--line-2)]",
        line: "gap-1 rounded-none border-b border-[color:var(--hairline)] bg-transparent group-data-horizontal/tabs:min-h-11 group-data-horizontal/tabs:w-full group-data-horizontal/tabs:justify-start",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
        "text-[15px] font-medium text-muted-foreground select-none",
        "transition-[color,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",

        // Segmented control: raised white capsule on select.
        "group-data-[variant=default]/tabs-list:h-9 group-data-[variant=default]/tabs-list:rounded-[8px] group-data-[variant=default]/tabs-list:px-4",
        "group-data-[variant=default]/tabs-list:hover:text-foreground",
        "group-data-[variant=default]/tabs-list:data-active:bg-card group-data-[variant=default]/tabs-list:data-active:text-foreground",
        "group-data-[variant=default]/tabs-list:data-active:font-semibold group-data-[variant=default]/tabs-list:data-active:shadow-[var(--elev-2)]",

        // Underline tabs: 2px brand rule under the active tab.
        "group-data-[variant=line]/tabs-list:h-11 group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:px-3.5",
        "group-data-[variant=line]/tabs-list:hover:text-foreground",
        "group-data-[variant=line]/tabs-list:data-active:font-semibold group-data-[variant=line]/tabs-list:data-active:text-foreground",
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity after:duration-200",
        "group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:-bottom-px group-data-horizontal/tabs:after:h-[2.5px] group-data-horizontal/tabs:after:rounded-full",
        "group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-px group-data-vertical/tabs:after:w-[2.5px]",
        "group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-[15px] outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
