import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db/postgres";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "El correo es obligatorio." }, { status: 400 });
    const { rowCount } = await dbQuery("SELECT 1 FROM public.usuarios WHERE lower(email) = $1 AND estado = 'activo' LIMIT 1", [email]);
    return NextResponse.json({ data: (rowCount || 0) > 0 });
  } catch {
    return NextResponse.json({ error: "No fue posible validar el correo." }, { status: 500 });
  }
}
