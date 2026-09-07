import { User, UserScheduleDraft } from "@/lib/types";
import { DataApiError, dataRequest } from "../client";

export type UserPayload = Partial<User> & { username?: string; password?: string; horarios?: UserScheduleDraft[] };

export async function getUsuarios(): Promise<User[]> { return dataRequest<User[]>("users.list"); }
export async function getUsuarioById(id: string): Promise<User | null> { return dataRequest<User | null>("users.get", { id }); }
export async function createUsuario(user: UserPayload): Promise<User> { return dataRequest<User>("users.create", user); }
export async function updateUsuario(id: string, user: UserPayload): Promise<User> { return dataRequest<User>("users.update", { id, ...user }); }
export type UserDeleteResult = { id: string; deleted: boolean; archived: boolean; message: string };
export async function deleteUsuario(id: string): Promise<UserDeleteResult> { return dataRequest<UserDeleteResult>("users.delete", { id }); }

export async function loginUsuario(email: string, password: string): Promise<User | null> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  let body: { data?: User; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    if (!response.ok) throw new DataApiError("La respuesta del servidor no es válida.", response.status);
  }
  if (!response.ok) {
    if (response.status === 401) return null;
    throw new DataApiError(body.error || "No fue posible iniciar sesión.", response.status);
  }
  return body.data || null;
}
