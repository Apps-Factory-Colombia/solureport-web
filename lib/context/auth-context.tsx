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
const USER_SNAPSHOT_STORAGE_KEY = "solureport_user_snapshot";

function clearStoredSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(USER_STORAGE_KEY);
  localStorage.removeItem(USER_SNAPSHOT_STORAGE_KEY);
}

function persistStoredSession(user: User) {
  if (typeof window === "undefined") return;
  localStorage.setItem(USER_STORAGE_KEY, user.id);
  localStorage.setItem(USER_SNAPSHOT_STORAGE_KEY, JSON.stringify(user));
}

function getStoredUserSnapshot(): User | null {
  if (typeof window === "undefined") return null;

  try {
    const rawSnapshot = localStorage.getItem(USER_SNAPSHOT_STORAGE_KEY);
    if (!rawSnapshot) return null;

    const parsed = JSON.parse(rawSnapshot) as User;
    if (!parsed?.id) {
      clearStoredSession();
      return null;
    }

    return parsed;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUserId = typeof window !== "undefined" ? localStorage.getItem(USER_STORAGE_KEY) : null;
    const storedUser = getStoredUserSnapshot();

    if (!savedUserId) {
      queueMicrotask(() => {
        if (storedUser?.estado === "activo") {
          setUser(storedUser);
        }
        setLoading(false);
      });
      return;
    }

    if (storedUser?.estado === "activo") {
      queueMicrotask(() => {
        setUser(storedUser);
        setLoading(false);
      });
    }

    if (savedUserId) {
      getUsuarioById(savedUserId)
        .then((u) => {
          if (u && u.estado === "activo") {
            setUser(u);
            persistStoredSession(u);
          } else {
            setUser(null);
            clearStoredSession();
          }
        })
        .catch(() => {
          setUser(null);
          clearStoredSession();
        })
        .finally(() => setLoading(false));
    }
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      const loggedUser = await loginUsuario(email, password);
      if (loggedUser) {
        setUser(loggedUser);
        persistStoredSession(loggedUser);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    clearStoredSession();
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
