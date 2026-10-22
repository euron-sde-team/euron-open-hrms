"use client";

import { cn } from "@open-hrms/ui/cn";
import { productName, splitProductName } from "@/lib/runtime-env";

/** The product name as a two-tone wordmark, read from runtime config. */
export function ProductWordmark({ tailClassName }: { tailClassName?: string }) {
  const { lead, tail } = splitProductName(productName());
  return (
    <>
      {lead}
      {tail && (
        <>
          {" "}
          <span className={cn("font-normal text-muted-foreground", tailClassName)}>{tail}</span>
        </>
      )}
    </>
  );
}
