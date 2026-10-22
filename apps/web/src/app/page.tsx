"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

/**
 * The root has no page of its own: it sends a signed-in user to the
 * dashboard and everyone else to sign in. Client-side because the session
 * token lives in localStorage, which the server cannot see.
 */
export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) router.replace(user ? "/dashboard" : "/login");
  }, [loading, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-7 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}
