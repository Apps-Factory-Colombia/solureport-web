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

export function getPool(): Pool {
  if (!globalThis.solureportPool) {
    globalThis.solureportPool = new Pool({
      connectionString: getConnectionString(),
      max: Number(process.env.SOLUREPORT_DB_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // These are OLTP requests, not analytical batches. PostgreSQL JIT was
      // spending ~2.4s compiling the report query for only a few rows.
      options: process.env.SOLUREPORT_DB_OPTIONS || "-c jit=off",
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
