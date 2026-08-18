import { User, UserScheduleDraft } from "@/lib/types";
import { dataRequest } from "../client";

export type UserPayload = Partial<User> & { username?: string; password?: string; horarios?: UserScheduleDraft[] };

export async function getUsuarios(): Promise<User[]> { return dataRequest<User[]>("users.list"); }
export async function getUsuarioById(id: string): Promise<User | null> { return dataRequest<User | null>("users.get", { id }); }
export async function createUsuario(user: UserPayload): Promise<User> { return dataRequest<User>("users.create", user); }
export async function updateUsuario(id: string, user: UserPayload): Promise<User> { return dataRequest<User>("users.update", { id, ...user }); }
export async function deleteUsuario(id: string): Promise<void> { await dataRequest("users.delete", { id }); }

export async function loginUsuario(email: string, password: string): Promise<User | null> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) return null;
  const body = await response.json() as { data?: User };
  return body.data || null;
}
