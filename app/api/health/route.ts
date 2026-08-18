import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db/postgres";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { rows } = await dbQuery<{ database: string; version: string }>("SELECT current_database() AS database, version() AS version");
    const { rows: counts } = await dbQuery<{ tables: string }>("SELECT COUNT(*)::text AS tables FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
    return NextResponse.json({ ok: true, database: rows[0]?.database, tables: Number(counts[0]?.tables || 0), schema: "v2" });
  } catch (error) {
    console.error("Health PostgreSQL V2 falló:", error);
    return NextResponse.json({ ok: false, error: "No se pudo conectar PostgreSQL V2." }, { status: 503 });
  }
}
