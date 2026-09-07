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
  const configured = Number(process.env.SOLUREPORT_DB_POOL_MAX || 2);
  if (!Number.isFinite(configured) || configured < 1) return 2;

  // Vercel can run several serverless instances at the same time. A large
  // per-instance pool exhausts Supabase direct-connection slots very quickly;
  // keep the safe ceiling here even if an old deployment still has a larger
  // value configured. The transaction pooler can queue the rest of the work.
  return Math.min(Math.floor(configured), 2);
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

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
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
