"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { User } from "@/lib/types";
import { loginUsuario } from "@/lib/data/services/usuarios";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "include" })
      .then((response) => response.json() as Promise<{ data?: User | null }>)
      .then((body) => { if (!cancelled) setUser(body.data || null); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const loggedUser = await loginUsuario(email, password);
    if (!loggedUser) return false;
    setUser(loggedUser);
    return true;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  }, []);

  return <AuthContext.Provider value={{ user, isAuthenticated: Boolean(user), loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
