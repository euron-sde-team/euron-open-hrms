"use client"

import * as React from "react"

import { cn } from "../lib/cn"

/**
 * Make a wide table comfortable to move around in.
 *
 * These tables are routinely wider than the 1180px content column (the employees roster
 * hides ~470px at 390px wide), and the only way to reach the far columns was a trackpad
 * swipe or a scrollbar that macOS hides until you are already scrolling. So:
 *
 *  - click and drag anywhere in the table pans it, with a grab cursor to advertise that
 *  - the wheel scrolls horizontally when there is nowhere left to go vertically, so a
 *    plain mouse can reach the Actions column
 *  - the region is focusable and labelled, so arrow keys, Home and End work and a screen
 *    reader announces it as scrollable
 *
 * All of it is inert when the table fits: no grab cursor, no tab stop, no wheel capture.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = React.useState(false)
  const drag = React.useRef<{ startX: number; startLeft: number } | null>(null)
  const [dragging, setDragging] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setScrollable(el.scrollWidth > el.clientWidth + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // The table's own width changes when rows load, not just when the container resizes.
    const inner = el.firstElementChild
    if (inner) ro.observe(inner)
    return () => ro.disconnect()
  }, [])

  // Dragging must not hijack clicking a button, opening a menu or selecting text in a cell.
  const fromInteractive = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest("button, a, input, select, textarea, label, [role=checkbox], [data-no-drag]")

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrollable || e.button !== 0 || fromInteractive(e.target)) return
    const el = ref.current
    if (!el) return
    drag.current = { startX: e.clientX, startLeft: el.scrollLeft }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!drag.current || !el) return
    const dx = e.clientX - drag.current.startX
    // Only claim the gesture once it is clearly a drag, so a slightly shaky click still clicks.
    if (!dragging && Math.abs(dx) < 4) return
    el.scrollLeft = drag.current.startLeft - dx
    e.preventDefault()
  }
  const endDrag = () => {
    drag.current = null
    setDragging(false)
  }

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || !scrollable || e.shiftKey) return // shift+wheel is already horizontal
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // real horizontal input, leave it alone
    const atStart = el.scrollLeft <= 0
    const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1
    // Only take over when the page itself has nothing more to give in that direction,
    // otherwise the table would trap the wheel and the page would stop scrolling.
    if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return
    el.scrollLeft += e.deltaY
  }

  return (
    <div
      ref={ref}
      data-slot="table-container"
      className={cn(
        "scroll-shadow-x relative w-full overflow-x-auto",
        scrollable && "cursor-grab",
        dragging && "cursor-grabbing select-none",
      )}
      // Focusable only when there is something to scroll, so we do not add empty tab stops.
      tabIndex={scrollable ? 0 : -1}
      role={scrollable ? "region" : undefined}
      aria-label={scrollable ? "Scrollable table. Use arrow keys, or drag to pan." : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onWheel={onWheel}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-[15px]", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-[color:var(--hairline)] transition-colors duration-150 hover:bg-muted/60 has-aria-expanded:bg-muted/60 data-[state=selected]:bg-accent",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-12 px-4 text-left align-middle text-[13px] font-semibold whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * `wrap` opts a column out of the default nowrap and lets it truncate to a width
 * instead. Cells are nowrap by default so numbers, dates and codes stay on one line,
 * but that also means one long free-text or email column can push a table hundreds of
 * pixels wide. Use `wrap` on those columns rather than widening the whole table.
 */
function TableCell({
  className,
  wrap,
  ...props
}: React.ComponentProps<"td"> & { wrap?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-4 py-3.5 align-middle [&:has([role=checkbox])]:pr-0",
        wrap ? "max-w-[42ch] whitespace-normal break-words" : "whitespace-nowrap",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
