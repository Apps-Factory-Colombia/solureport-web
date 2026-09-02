/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db/postgres";
import { issueSession, verifyPassword } from "@/lib/db/auth";

export const runtime = "nodejs";

function mapUser(row: any) {
  return {
    id: row.id,
    username: row.username,
    nombre: row.nombre,
    apellido: row.apellido,
    email: row.email,
    telefono: row.telefono || "",
    rol: row.rol,
    estado: row.estado,
    grupoId: row.grupo_id || undefined,
    esLider: Boolean(row.es_lider),
    tieneRecorrido: Boolean(row.tiene_recorrido),
    tieneMoto: Boolean(row.tiene_moto),
    esSupervisor: row.rol === "supervisor",
    horarios: row.horarios || [],
    fechaCreacion: row.created_at ? String(row.created_at).split("T")[0] : "",
    avatar: row.avatar_url || undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const identifier = String(body?.email || body?.username || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!identifier || !password) return NextResponse.json({ error: "Usuario/correo y contraseña son obligatorios." }, { status: 400 });

    const { rows } = await dbQuery(
      `SELECT u.*,
              COALESCE((SELECT json_agg(json_build_object(
                'id', ah.id, 'usuarioId', ah.usuario_id, 'diaSemana',
                CASE ah.dia_semana WHEN 1 THEN 'lunes' WHEN 2 THEN 'martes' WHEN 3 THEN 'miercoles'
                  WHEN 4 THEN 'jueves' WHEN 5 THEN 'viernes' WHEN 6 THEN 'sabado' ELSE 'domingo' END,
                'activo', ah.activo, 'horaEntrada', left(ah.hora_entrada::text, 5),
                'horaSalida', left(ah.hora_salida::text, 5)
              ) ORDER BY ah.dia_semana) FROM public.asistencia_horarios ah WHERE ah.usuario_id = u.id), '[]'::json) AS horarios,
              (SELECT gm.grupo_id FROM public.grupo_miembros gm
                WHERE gm.usuario_id = u.id AND gm.fecha_inicio <= (now() AT TIME ZONE 'America/Bogota')::date
                  AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= (now() AT TIME ZONE 'America/Bogota')::date) LIMIT 1) AS grupo_id,
              EXISTS (SELECT 1 FROM public.grupos_trabajo g WHERE g.lider_id = u.id AND g.estado = 'activo') AS es_lider
         FROM public.usuarios u
        WHERE lower(u.email) = $1 OR lower(u.username) = $1
        LIMIT 1`,
      [identifier],
    );
    const row = rows[0];
    if (!row || row.estado !== "activo" || !(await verifyPassword(password, row.password_hash))) {
      return NextResponse.json({ error: "Credenciales incorrectas." }, { status: 401 });
    }

    await dbQuery("UPDATE public.usuarios SET ultimo_acceso = clock_timestamp() WHERE id = $1", [row.id]);
    await dbQuery("UPDATE public.sesiones_usuario SET revoked_at = clock_timestamp() WHERE usuario_id = $1 AND revoked_at IS NULL", [row.id]);
    const response = NextResponse.json({ data: mapUser(row) });
    const token = await issueSession(row.id, request, response);
    if (request.headers.get("x-solureport-client") === "mobile") {
      return NextResponse.json({ data: mapUser(row), token });
    }
    return response;
  } catch (error) {
    console.error("Error en login PostgreSQL V2:", error);
    return NextResponse.json({ error: "No fue posible iniciar sesión." }, { status: 500 });
  }
}
