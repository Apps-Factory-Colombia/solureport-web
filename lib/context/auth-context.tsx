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

  const refreshSession = useCallback(async (initial = false) => {
    try {
      const response = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
      const body = await response.json() as { data?: User | null };
      if (body.data) {
        setUser(body.data);
      } else if (initial) {
        setUser(null);
      }
    } catch {
      // A temporary network failure must not erase the authenticated user.
      // The next heartbeat/focus event will retry the session validation.
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession(true);

    // The server renews the rolling session window on this heartbeat. The
    // focus listener also covers returning to the tab after a long pause.
    const heartbeat = window.setInterval(() => { void refreshSession(); }, 10 * 60 * 1000);
    const onFocus = () => { void refreshSession(); };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshSession]);

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
