import { cn } from "../lib/cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-[10px] bg-[color:color-mix(in_srgb,var(--faint)_22%,transparent)]", className)}
      {...props}
    />
  )
}

export { Skeleton }
