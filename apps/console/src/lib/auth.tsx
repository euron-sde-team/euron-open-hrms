"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { http, tokenStore } from "@/lib/api";
import type { Operator, OperatorLoginResponse as LoginResult } from "@open-hrms/types";

interface AuthState {
  admin: Operator | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Operator | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setAdmin(null);
      setLoading(false);
      return;
    }
    try {
      const { admin } = await http.get<{ admin: Operator }>("/platform/me");
      setAdmin(admin);
    } catch {
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await http.post<LoginResult>("/platform/auth/login", { email, password });
    if (res.mfaRequired) return res; // caller proceeds to the 2FA step
    if (res.token && res.admin) { tokenStore.set(res.token); setAdmin(res.admin); }
    return res;
  }, []);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    const res = await http.post<LoginResult>("/platform/auth/login/mfa", { mfaToken, code });
    if (res.token && res.admin) { tokenStore.set(res.token); setAdmin(res.admin); }
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setAdmin(null);
    router.push("/login");
  }, [router]);

  return <AuthContext.Provider value={{ admin, loading, login, verifyMfa, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
