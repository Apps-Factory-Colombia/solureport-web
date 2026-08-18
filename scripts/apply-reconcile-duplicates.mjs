import fs from "node:fs";
import process from "node:process";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });

const connectionString = process.env.SOLUREPORT_DATABASE_URL;
if (!connectionString) {
  throw new Error("SOLUREPORT_DATABASE_URL no esta configurada en .env.local");
}

const sqlPath = new URL("../../database-v2/010_reconcile_legacy_duplicates.sql", import.meta.url);
const migrationSql = fs.readFileSync(sqlPath, "utf8");
const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  await client.query(migrationSql);
  const result = await client.query(`
    SELECT phase, snapshot, created_at
    FROM legacy_backup.v2_dedup_20260817_summary
    ORDER BY created_at
  `);
  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await client.end();
}
