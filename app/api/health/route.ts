import { NextResponse } from "next/server";
import { dbQuery, getDatabaseConnectionInfo } from "@/lib/db/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function healthHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
    "X-SoluReport-Build": process.env.VERCEL_GIT_COMMIT_SHA || "local",
  };
}

export async function GET() {
  const connection = getDatabaseConnectionInfo();
  const build = process.env.VERCEL_GIT_COMMIT_SHA || "local";
  try {
    const { rows } = await dbQuery<{ database: string; version: string }>("SELECT current_database() AS database, version() AS version");
    const { rows: counts } = await dbQuery<{ tables: string }>("SELECT COUNT(*)::text AS tables FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
    return NextResponse.json({ ok: true, database: rows[0]?.database, tables: Number(counts[0]?.tables || 0), schema: "v2", connection, build }, { headers: healthHeaders() });
  } catch (error) {
    console.error("Health PostgreSQL V2 falló:", error);
    return NextResponse.json({ ok: false, error: "No se pudo conectar PostgreSQL V2.", connection, build }, { status: 503, headers: healthHeaders() });
  }
}
