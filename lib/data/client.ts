"use client";

export class DataApiError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "DataApiError";
    this.status = status;
  }
}

const READ_CACHE_TTL_MS = 5_000;
const readCache = new Map<string, { expiresAt: number; value: unknown }>();
const readRequestsInFlight = new Map<string, Promise<unknown>>();
let readCacheGeneration = 0;
const cacheableActions = new Set([
  "arrivals.list",
  "catalog.list",
  "clients.get",
  "clients.list",
  "config.get",
  "contracts.list",
  "dashboard.metrics",
  "groups.get",
  "groups.list",
  "liquidation.periodEntries",
  "liquidation.periodSummary",
  "maintenances.adminPage",
  "maintenances.list",
  "maintenances.overdue",
  "maintenances.reports",
  "notifications.list",
  "periods.list",
  "reports.accumulations",
  "reports.batches",
  "reports.list",
  "users.get",
  "users.list",
]);

async function executeDataRequest<T>(action: string, payload?: unknown): Promise<T> {
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

export function clearDataRequestCache() {
  readCacheGeneration += 1;
  readCache.clear();
  readRequestsInFlight.clear();
}

export async function dataRequest<T>(action: string, payload?: unknown): Promise<T> {
  if (!cacheableActions.has(action)) {
    const result = await executeDataRequest<T>(action, payload);
    clearDataRequestCache();
    return result;
  }

  const key = `${action}:${JSON.stringify(payload ?? {})}`;
  const cached = readCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) readCache.delete(key);

  const inFlight = readRequestsInFlight.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const requestGeneration = readCacheGeneration;
  const request = executeDataRequest<T>(action, payload)
    .then((value) => {
      if (requestGeneration === readCacheGeneration) {
        readCache.set(key, { expiresAt: Date.now() + READ_CACHE_TTL_MS, value });
      }
      return value;
    })
    .finally(() => {
      readRequestsInFlight.delete(key);
    });
  readRequestsInFlight.set(key, request);
  return request;
}
