"use client"

import * as React from "react"

import { cn } from "../lib/cn"
import { Label, FieldHint, FieldError } from "./label"

/**
 * Form layout primitives.
 *
 * The problem they solve: forms were laid out as a bare `grid grid-cols-2` with each field
 * an ad-hoc `<div class="space-y-2">`. Grid cells stretch to the tallest in the row, and the
 * control sat directly under its own label, so as soon as ONE label wrapped to two lines its
 * control dropped ~16px below its neighbour. The compensation dialog showed it plainly:
 * "Statutory deductions (PF etc.)" wraps, so its input hung lower than "Allowances" beside it.
 *
 * `Field` fixes it structurally rather than by shortening labels: the cell is a flex column
 * and the control is pushed to the bottom with `mt-auto`, so controls line up along a common
 * baseline no matter how many lines each label takes. Labels stay top aligned, which is what
 * makes a column of fields read as a column.
 *
 * Using these also means hint and error text stop being re-invented per page (20 pages were
 * hand-rolling `text-xs text-muted-foreground`), so validation finally looks the same everywhere.
 *
 * KNOWN LIMIT, worth understanding before adding a hint to one half of a pair: `mt-auto`
 * bottom-anchors the control AND anything below it, so a `hint` on only ONE cell of a
 * two-up row lifts that cell's control by the height of the hint. Measured at 24px in the
 * documents upload dialog ("Type" sat 24px below "Who can see it"). Options, in order of
 * preference: give both cells a hint, put the hint on a full-width field, or render it as a
 * `FieldHint` on the grid's next row with `sm:col-start-2` so it sits under its own control
 * without changing the row's cell heights. An `error` behaves the same way, but errors are
 * transient and usually appear on the cell the user is already looking at.
 */

export function FormGrid({
  className,
  columns = 2,
  children,
  ...props
}: React.ComponentProps<"div"> & { columns?: 1 | 2 | 3 }) {
  return (
    <div
      data-slot="form-grid"
      className={cn(
        "grid gap-x-5 gap-y-4",
        // Always single column on small screens: two ~130px columns cannot hold a 44px
        // control with a real label.
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div data-slot="field" className={cn("flex min-w-0 flex-col", className)} {...props}>
      {label && (
        <Label htmlFor={htmlFor} className="mb-2 block leading-snug">
          {label}
          {required && (
            <span aria-hidden className="ml-0.5 text-[color:var(--bad)]">
              *
            </span>
          )}
        </Label>
      )}
      {/* mt-auto is the whole trick: it pins the control to the bottom of a stretched grid
          cell, so a two-line label beside a one-line label no longer offsets the inputs. */}
      <div className="mt-auto">{children}</div>
      {error ? (
        <FieldError className="mt-1.5">{error}</FieldError>
      ) : hint ? (
        <FieldHint className="mt-1.5">{hint}</FieldHint>
      ) : null}
    </div>
  )
}

/** A titled group of fields, for dialogs that cover more than one topic. */
export function FormSection({
  title,
  description,
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & { title?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <section data-slot="form-section" className={cn("space-y-4", className)} {...props}>
      {(title || description) && (
        <div className="space-y-0.5">
          {title && <h3 className="text-[15px] font-semibold">{title}</h3>}
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}
