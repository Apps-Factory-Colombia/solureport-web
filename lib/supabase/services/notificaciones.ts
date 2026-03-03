import { supabase } from "../client";

export interface Notificacion {
  id: string;
  usuarioId: string;
  titulo: string;
  mensaje: string;
  tipo: "mantenimiento" | "liquidacion" | "mensaje" | "general" | "aprobacion" | "visit" | "attendance";
  leida: boolean;
  datos?: Record<string, unknown>;
  fechaCreacion: string;
}

function mapRow(row: any): Notificacion {
  // Convertir de DB a Frontend
  const tipoFrontend =
    row.tipo === 'maintenance' ? 'mantenimiento' :
      row.tipo === 'liquidation' ? 'liquidacion' :
        row.tipo === 'approval' ? 'aprobacion' :
          row.tipo === 'visit' ? 'visit' :
            row.tipo === 'attendance' ? 'attendance' :
              row.tipo === 'general' ? 'general' : 'mensaje';

  return {
    id: row.id,
    usuarioId: row.usuario_id,
    titulo: row.titulo,
    mensaje: row.mensaje,
    tipo: tipoFrontend as Notificacion["tipo"],
    leida: row.leida || false,
    datos: row.metadata || undefined,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

export async function getNotificaciones(usuarioId?: string): Promise<Notificacion[]> {
  let query = supabase
    .from("notificaciones")
    .select("*")
    .order("fecha_creacion", { ascending: false });

  if (usuarioId) {
    query = query.eq("usuario_id", usuarioId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function createNotificacion(notif: {
  usuarioId: string;
  titulo: string;
  mensaje: string;
  tipo: Notificacion["tipo"];
  datos?: Record<string, unknown>;
}): Promise<Notificacion> {
  // Convertir de Frontend a DB
  const tipoDB =
    notif.tipo === 'mantenimiento' ? 'maintenance' :
      notif.tipo === 'liquidacion' ? 'liquidation' :
        notif.tipo === 'aprobacion' ? 'approval' :
          notif.tipo === 'visit' ? 'visit' :
            notif.tipo === 'attendance' ? 'attendance' :
              'general';

  const { data, error } = await supabase
    .from("notificaciones")
    .insert({
      usuario_id: notif.usuarioId,
      titulo: notif.titulo,
      mensaje: notif.mensaje,
      tipo: tipoDB,
      leida: false,
      metadata: notif.datos || null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function marcarLeida(id: string): Promise<void> {
  const { error } = await supabase
    .from("notificaciones")
    .update({ leida: true })
    .eq("id", id);
  if (error) throw error;
}

export async function createNotificacionesBulk(
  notifs: {
    usuarioId: string;
    titulo: string;
    mensaje: string;
    tipo: Notificacion["tipo"];
    datos?: Record<string, unknown>;
  }[]
): Promise<void> {
  const rows = notifs.map((n) => {
    const tipoDB =
      n.tipo === 'mantenimiento' ? 'maintenance' :
        n.tipo === 'liquidacion' ? 'liquidation' :
          n.tipo === 'aprobacion' ? 'approval' :
            n.tipo === 'visit' ? 'visit' :
              n.tipo === 'attendance' ? 'attendance' :
                'general';

    return {
      usuario_id: n.usuarioId,
      titulo: n.titulo,
      mensaje: n.mensaje,
      tipo: tipoDB,
      leida: false,
      metadata: n.datos || null,
    };
  });
  const { error } = await supabase.from("notificaciones").insert(rows);
  if (error) throw error;
}
