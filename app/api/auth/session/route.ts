import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, renewSession } from "@/lib/db/auth";
import { dbQuery } from "@/lib/db/postgres";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ data: null });
    const { rows } = await dbQuery(
      `SELECT
         EXISTS (SELECT 1 FROM public.grupos_trabajo g WHERE g.lider_id = $1 AND g.estado = 'activo') AS es_lider,
         (SELECT g.id FROM public.grupos_trabajo g WHERE g.lider_id = $1 AND g.estado = 'activo' ORDER BY g.created_at LIMIT 1) AS grupo_id`,
      [user.id],
    );
    const profile = rows[0] || {};
    const response = NextResponse.json({ data: {
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      telefono: user.telefono || "",
      rol: user.rol,
      estado: user.estado,
      tieneRecorrido: user.tiene_recorrido,
      tieneMoto: user.tiene_moto,
      esSupervisor: user.rol === "supervisor",
      grupoId: profile.grupo_id || undefined,
      esLider: Boolean(profile.es_lider) || user.rol === "lider",
      groupLeaderId: profile.es_lider ? user.id : undefined,
      routesEnabled: false,
      fechaCreacion: "",
      avatar: user.avatar_url || undefined,
    } });
    try {
      await renewSession(request, response);
    } catch (renewError) {
      console.error("No se pudo renovar la sesión; se conserva la sesión actual:", renewError);
    }
    return response;
  } catch (error) {
    console.error("Error validando sesión:", error);
    return NextResponse.json({ data: null });
  }
}
