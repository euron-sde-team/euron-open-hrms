"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { consumeImpersonationHash } from "@open-hrms/api-client";
import type { LoginResponse, MeResponse, SessionUser } from "@open-hrms/types";
import { http, tokenStore, onWorkspaceSuspended, isWorkspaceSuspendedError } from "@/lib/api";
import { can as canPerform, isStaffUser } from "@/lib/permissions";

const TRUST_KEY = "hrms.trust";

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  impersonated: boolean;
  /**
   * The signed-in user's workspace has been suspended or cancelled. The API
   * answers every request with 403 WORKSPACE_SUSPENDED; the shell shows a
   * full-page notice instead of the app (or a login loop).
   */
  suspended: boolean;
  login: (email: string, password: string) => Promise<LoginResponse>;
  verifyMfa: (mfaToken: string, code: string, trustDevice: boolean) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  can: (perm: string) => boolean;
  isStaff: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonated, setImpersonated] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const router = useRouter();

  // Any request, from any page, can be the one that discovers the suspension.
  useEffect(() => onWorkspaceSuspended(() => setSuspended(true)), []);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setImpersonated(false);
      setLoading(false);
      return;
    }
    try {
      const { user, impersonated } = await http.get<MeResponse>("/auth/me");
      setUser(user);
      setImpersonated(!!impersonated);
      setSuspended(false);
    } catch (e) {
      // A suspended workspace still has a valid session: keep the token so the
      // notice can offer a deliberate sign-out instead of a silent logout.
      if (isWorkspaceSuspendedError(e)) setSuspended(true);
      setUser(null);
      setImpersonated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Operator impersonation hand-off: an #imp=<token> in the URL is an operator
    // signing in as this workspace's admin (minted + audited by the platform).
    // Consume it (which also strips it from the address bar), then load the session.
    if (typeof window !== "undefined") {
      const token = consumeImpersonationHash(window);
      if (token) tokenStore.set(token);
    }
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const trustToken = typeof window !== "undefined" ? window.localStorage.getItem(TRUST_KEY) : null;
    const res = await http.post<LoginResponse>("/auth/login", { email, password, trustToken });
    if (res.token && res.user) {
      tokenStore.set(res.token);
      setUser(res.user);
      setSuspended(false);
    }
    return res;
  }, []);

  const verifyMfa = useCallback(async (mfaToken: string, code: string, trustDevice: boolean) => {
    const res = await http.post<LoginResponse>("/auth/login/mfa", { mfaToken, code, trustDevice });
    if (res.token && res.user) {
      tokenStore.set(res.token);
      if (res.trustToken && typeof window !== "undefined") window.localStorage.setItem(TRUST_KEY, res.trustToken);
      setUser(res.user);
      setSuspended(false);
    }
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setSuspended(false);
    router.push("/login");
  }, [router]);

  const can = useCallback((perm: string) => canPerform(user, perm), [user]);

  return (
    <AuthContext.Provider
      value={{ user, loading, impersonated, suspended, login, verifyMfa, logout, refresh, can, isStaff: isStaffUser(user) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
