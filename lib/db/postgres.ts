import { Pool, PoolClient, QueryResultRow } from "pg";

declare global {
  var solureportPool: Pool | undefined;
}

function getConnectionString(): string {
  const value = process.env.SOLUREPORT_DATABASE_URL || process.env.DATABASE_URL;
  if (!value) {
    throw new Error("Falta SOLUREPORT_DATABASE_URL para conectar PostgreSQL V2.");
  }
  return value;
}

function getPoolMax(): number {
  const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
  const configured = Number(process.env.SOLUREPORT_DB_POOL_MAX || (isVercel ? 2 : 4));
  if (!Number.isFinite(configured) || configured < 1) return isVercel ? 2 : 4;

  // Vercel can run several serverless instances at the same time, so keep the
  // conservative per-instance ceiling there. Dockploy runs one long-lived
  // container; allowing a small configurable pool prevents six independent
  // admin-screen requests from waiting behind one another after login.
  return Math.min(Math.floor(configured), isVercel ? 2 : 6);
}

function getConnectionSettings() {
  const connectionString = getConnectionString();
  let port = "";
  let hostname = "";
  try {
    const parsed = new URL(connectionString);
    port = parsed.port;
    hostname = parsed.hostname;
  } catch {
    // Let `pg` return its normal connection-string error below.
  }
  const isPooler = port === "6543" || hostname.includes(".pooler.supabase.com");
  return { connectionString, isPooler };
}

export function getDatabaseConnectionInfo() {
  try {
    const parsed = new URL(getConnectionString());
    const port = parsed.port || "5432";
    return {
      port,
      mode: port === "6543" || parsed.hostname.includes(".pooler.supabase.com") ? "pooler" : "direct",
    } as const;
  } catch {
    return { port: null, mode: "not_configured" } as const;
  }
}

export function isDatabaseCapacityError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  const code = String(candidate?.code || "");
  const message = String(candidate?.message || error || "").toLowerCase();
  return code === "53300"
    || code === "57P03"
    || code.startsWith("08")
    || message.includes("remaining connection slots")
    || message.includes("too many connections")
    || message.includes("connection terminated")
    || message.includes("connection refused")
    || message.includes("timeout");
}

export function getPool(): Pool {
  if (!globalThis.solureportPool) {
    const { connectionString, isPooler } = getConnectionSettings();
    const startupOptions = isPooler
      ? undefined
      : (process.env.SOLUREPORT_DB_OPTIONS || "-c jit=off");
    globalThis.solureportPool = new Pool({
      connectionString,
      max: getPoolMax(),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      maxUses: 500,
      // These are OLTP requests, not analytical batches. PostgreSQL JIT was
      // spending ~2.4s compiling the report query for only a few rows.
      // Supabase Transaction Pooler rejects the `options` startup parameter,
      // so it must not be sent on port 6543.
      ...(startupOptions ? { options: startupOptions } : {}),
      ssl: process.env.SOLUREPORT_DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    });
  }
  return globalThis.solureportPool;
}

const POOL_ACQUIRE_ATTEMPTS = 3;

/**
 * Obtiene una conexión del pool. Si el pool está saturado y la espera vence, se
 * reintenta unas veces con una pausa corta. Solo se reintenta la adquisición de
 * la conexión: en ese punto ninguna sentencia se ha ejecutado, así que reintentar
 * no puede duplicar una escritura.
 */
async function acquireClient(): Promise<PoolClient> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= POOL_ACQUIRE_ATTEMPTS; attempt += 1) {
    try {
      return await getPool().connect();
    } catch (error) {
      lastError = error;
      if (!isDatabaseCapacityError(error) || attempt === POOL_ACQUIRE_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  const client = await acquireClient();
  try {
    return await client.query<T>(text, values);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await acquireClient();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
