"use client";

import { useState, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@open-hrms/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { WorkspaceSuspended } from "@/components/workspace-suspended";

/**
 * Swap the whole UI for the suspension notice the moment any request reports
 * it. Done here rather than per page so no screen can be half-rendered with
 * failing queries behind it. Public document verification stays reachable:
 * it needs no session and serves third parties, not the suspended workspace.
 */
function SuspendedGate({ children }: { children: ReactNode }) {
  const { suspended, user, logout } = useAuth();
  const pathname = usePathname();
  if (suspended && !pathname.startsWith("/verify/")) {
    return <WorkspaceSuspended orgName={user?.org?.name} onSignOut={logout} />;
  }
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TooltipProvider>
          <SuspendedGate>{children}</SuspendedGate>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
