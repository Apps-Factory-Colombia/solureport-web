"use client";

export class DataApiError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "DataApiError";
    this.status = status;
  }
}

export async function dataRequest<T>(action: string, payload?: unknown): Promise<T> {
  const response = await fetch("/api/data", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload: payload ?? {} }),
  });

  let body: { data?: T; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    throw new DataApiError("La respuesta del servidor no es válida.", response.status);
  }

  if (!response.ok) {
    throw new DataApiError(body.error || "No se pudo completar la operación.", response.status);
  }

  return body.data as T;
}
