"use client"

import * as React from "react"

import { cn } from "../lib/cn"

/**
 * Form label, sentence case at readable size, the way Apple writes them.
 *
 * (Previously 11.5px uppercase with letter-spacing, which read as a shouty
 * micro-caption rather than a label and was a large part of why forms felt
 * cramped and hard to scan.)
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-[15px] leading-[20px] font-medium text-foreground select-none",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

/** Secondary helper text under a field. */
function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-hint"
      className={cn("text-[13px] leading-[18px] text-muted-foreground", className)}
      {...props}
    />
  )
}

/** Validation message under a field. */
function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-error"
      className={cn("text-[13px] leading-[18px] font-medium text-destructive", className)}
      {...props}
    />
  )
}

export { Label, FieldHint, FieldError }
