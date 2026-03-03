"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { User } from "@/lib/types";
import { loginUsuario, getUsuarioById } from "@/lib/supabase/services/usuarios";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const USER_STORAGE_KEY = "solureport_user_id";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUserId = typeof window !== "undefined" ? localStorage.getItem(USER_STORAGE_KEY) : null;
    if (savedUserId) {
      getUsuarioById(savedUserId)
        .then((u) => {
          if (u && u.estado === "activo") {
            setUser(u);
          } else {
            localStorage.removeItem(USER_STORAGE_KEY);
          }
        })
        .catch(() => {
          localStorage.removeItem(USER_STORAGE_KEY);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      const loggedUser = await loginUsuario(email, password);
      if (loggedUser) {
        setUser(loggedUser);
        localStorage.setItem(USER_STORAGE_KEY, loggedUser.id);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(USER_STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
