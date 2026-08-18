import fs from "node:fs";
import process from "node:process";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });

const connectionString = process.env.SOLUREPORT_DATABASE_URL;
if (!connectionString) {
  throw new Error("SOLUREPORT_DATABASE_URL no esta configurada en .env.local");
}

const sqlPath = new URL("../../database-v2/010_reconcile_legacy_duplicates.sql", import.meta.url);
const migrationSql = fs
  .readFileSync(sqlPath, "utf8")
  .replace(/^COMMIT;\s*$/m, "-- COMMIT omitido por simulacion");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  await client.query(migrationSql);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");

  const summary = await client.query(`
    SELECT phase, snapshot
    FROM legacy_backup.v2_dedup_20260817_summary
    ORDER BY created_at
  `);

  const checks = await client.query(`
    SELECT jsonb_build_object(
      'activity_map_survivors', (
        SELECT count(*)
        FROM public.actividades_operativas ao
        JOIN legacy_backup.v2_dedup_20260817_activity_map am
          ON am.loser_id = ao.id
      ),
      'maintenance_map_survivors', (
        SELECT count(*)
        FROM public.mantenimientos_programados mp
        JOIN legacy_backup.v2_dedup_20260817_maintenance_map mm
          ON mm.loser_id = mp.id
      ),
      'active_liquidation_rows', (
        SELECT count(*) FROM public.liquidacion_items WHERE estado <> 'anulado'
      ),
      'active_liquidation_sum', (
        SELECT coalesce(sum(valor_ganado), 0)
        FROM public.liquidacion_items
        WHERE estado <> 'anulado'
      )
    ) AS checks
  `);

  const mapping = await client.query(`
    SELECT reason, count(*)::integer AS duplicate_rows
    FROM legacy_backup.v2_dedup_20260817_activity_map
    GROUP BY reason
    ORDER BY reason
  `);

  const financialImpact = await client.query(`
    WITH affected_before AS (
      SELECT
        li.tipo,
        coalesce(sum(li.valor_ganado) FILTER (WHERE li.estado <> 'anulado'), 0) AS total
      FROM legacy_backup.v2_dedup_20260817_liquidation li
      GROUP BY li.tipo
    ), affected_after AS (
      SELECT
        li.tipo,
        coalesce(sum(li.valor_ganado) FILTER (WHERE li.estado <> 'anulado'), 0) AS total
      FROM public.liquidacion_items li
      WHERE li.actividad_id IN (
        SELECT DISTINCT winner_id
        FROM legacy_backup.v2_dedup_20260817_activity_map
      )
      GROUP BY li.tipo
    )
    SELECT
      coalesce(b.tipo, a.tipo) AS tipo,
      coalesce(b.total, 0) AS before_total,
      coalesce(a.total, 0) AS after_total,
      coalesce(b.total, 0) - coalesce(a.total, 0) AS removed_total
    FROM affected_before b
    FULL JOIN affected_after a USING (tipo)
    ORDER BY tipo
  `);

  const examples = await client.query(`
    SELECT codigo, tipo, estado, valor_aplicado
    FROM public.actividades_operativas
    WHERE codigo IN (
      'AG-20260815-Y1X03XAJOC08',
      'AG-20260815-IDXNKOOE3U7O',
      'AG-20260815-JSPCJ0G2ZQVH',
      'AG-20260815-WUKP9U2OXAIO',
      'AG-20260728-6D53093A',
      'MIG-R-7B3613BE168A4C0E9FF462A2'
    )
    ORDER BY codigo
  `);

  console.log(JSON.stringify({
    summary: summary.rows,
    checks: checks.rows,
    mapping: mapping.rows,
    financialImpact: financialImpact.rows,
    examples: examples.rows,
  }, null, 2));
  await client.query("ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
