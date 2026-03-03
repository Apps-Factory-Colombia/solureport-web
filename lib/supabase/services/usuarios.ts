import { supabase } from "../client";
import { User } from "@/lib/types";

function mapRow(row: any): User {
  return {
    id: row.id,
    nombre: row.nombre,
    apellido: row.apellido,
    email: row.email,
    telefono: row.telefono || "",
    rol: row.rol,
    estado: row.estado,
    grupoId: row.grupo_id || undefined,
    esLider: row.es_lider || false,
    tieneRecorrido: row.tiene_recorrido || false,
    tieneMoto: row.tiene_moto || false,
    esSupervisor: row.es_supervisor || false,
    horaEntrada: row.hora_entrada || undefined,
    horaSalida: row.hora_salida || undefined,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
    avatar: row.avatar_url || undefined,
  };
}

export async function getUsuarios(): Promise<User[]> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("*")
    .order("fecha_creacion", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function getUsuarioById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return mapRow(data);
}

export async function createUsuario(user: Partial<User> & { password?: string }): Promise<User> {
  const { data, error } = await supabase
    .from("usuarios")
    .insert({
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      username: user.email,
      password_hash: user.password || "default123",
      telefono: user.telefono,
      rol: user.rol,
      estado: user.estado || "activo",
      es_lider: user.esLider || false,
      tiene_recorrido: user.tieneRecorrido || false,
      tiene_moto: user.tieneMoto || false,
      es_supervisor: user.esSupervisor || false,
      hora_entrada: user.horaEntrada || null,
      hora_salida: user.horaSalida || null,
      grupo_id: user.grupoId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateUsuario(id: string, user: Partial<User> & { password?: string }): Promise<User> {
  const updateData: any = {};
  if (user.nombre !== undefined) updateData.nombre = user.nombre;
  if (user.apellido !== undefined) updateData.apellido = user.apellido;
  if (user.email !== undefined) { updateData.email = user.email; updateData.username = user.email; }
  if (user.telefono !== undefined) updateData.telefono = user.telefono;
  if (user.rol !== undefined) updateData.rol = user.rol;
  if (user.estado !== undefined) updateData.estado = user.estado;
  if (user.esLider !== undefined) updateData.es_lider = user.esLider;
  if (user.tieneRecorrido !== undefined) updateData.tiene_recorrido = user.tieneRecorrido;
  if (user.tieneMoto !== undefined) updateData.tiene_moto = user.tieneMoto;
  if (user.esSupervisor !== undefined) updateData.es_supervisor = user.esSupervisor;
  if (user.horaEntrada !== undefined) updateData.hora_entrada = user.horaEntrada || null;
  if (user.horaSalida !== undefined) updateData.hora_salida = user.horaSalida || null;
  if (user.grupoId !== undefined) updateData.grupo_id = user.grupoId || null;
  if (user.password !== undefined && user.password.trim() !== "") updateData.password_hash = user.password;

  const { data, error } = await supabase
    .from("usuarios")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function deleteUsuario(id: string): Promise<void> {
  // 1) Relaciones livianas/directas
  await supabase.from("sesiones_usuario").delete().eq("usuario_id", id);
  await supabase.from("notificaciones").delete().eq("usuario_id", id);
  await supabase.from("registros_asistencia").delete().eq("usuario_id", id);
  await supabase.from("recorridos").delete().eq("tecnico_id", id);
  await supabase.from("acumulacion_lideres").delete().eq("lider_id", id);
  await supabase.from("lotes_aprobacion_lider").delete().eq("lider_id", id);
  await supabase.from("items_liquidacion").delete().eq("tecnico_id", id);
  await supabase
    .from("items_aprobacion")
    .delete()
    .or(`tecnico_id.eq.${id},lider_id.eq.${id}`);

  // 2) Relación con grupos
  await supabase.from("grupo_miembros").delete().eq("usuario_id", id);
  await supabase.from("grupos_trabajo").update({ lider_id: null }).eq("lider_id", id);

  // 3) Visitas técnicas + fotos
  const { data: visitas, error: visitasError } = await supabase
    .from("visitas_tecnicas")
    .select("id")
    .or(`tecnico_id.eq.${id},lider_id.eq.${id}`);
  if (visitasError) throw visitasError;

  const visitaIds = (visitas || []).map((v: any) => v.id);
  if (visitaIds.length > 0) {
    const { error: fotosVisitaError } = await supabase
      .from("visita_tecnica_fotos")
      .delete()
      .in("visita_tecnica_id", visitaIds);
    if (fotosVisitaError) throw fotosVisitaError;

    const { error: deleteVisitasError } = await supabase
      .from("visitas_tecnicas")
      .delete()
      .in("id", visitaIds);
    if (deleteVisitasError) throw deleteVisitasError;
  }

  // 4) Mantenimientos + reportes + fotos
  const { data: mantenimientos, error: mantenimientosError } = await supabase
    .from("mantenimientos")
    .select("id")
    .or(`tecnico_id.eq.${id},lider_id.eq.${id}`);
  if (mantenimientosError) throw mantenimientosError;

  const mantenimientoIds = (mantenimientos || []).map((m: any) => m.id);
  if (mantenimientoIds.length > 0) {
    const { error: fotosMantError } = await supabase
      .from("mantenimiento_fotos")
      .delete()
      .in("mantenimiento_id", mantenimientoIds);
    if (fotosMantError) throw fotosMantError;

    const { error: reportesMantError } = await supabase
      .from("reportes_mantenimiento")
      .delete()
      .in("mantenimiento_id", mantenimientoIds);
    if (reportesMantError) throw reportesMantError;

    const { error: deleteMantenimientosError } = await supabase
      .from("mantenimientos")
      .delete()
      .in("id", mantenimientoIds);
    if (deleteMantenimientosError) throw deleteMantenimientosError;
  }

  // 5) Reportes de actividad + fotos
  const { data: reportesActividad, error: reportesActividadError } = await supabase
    .from("reportes_actividad")
    .select("id")
    .or(`tecnico_id.eq.${id},lider_grupo_id.eq.${id}`);
  if (reportesActividadError) throw reportesActividadError;

  const reportesActividadIds = (reportesActividad || []).map((r: any) => r.id);
  if (reportesActividadIds.length > 0) {
    const { error: fotosReportesError } = await supabase
      .from("reporte_actividad_fotos")
      .delete()
      .in("reporte_actividad_id", reportesActividadIds);
    if (fotosReportesError) throw fotosReportesError;

    const { error: deleteReportesActividadError } = await supabase
      .from("reportes_actividad")
      .delete()
      .in("id", reportesActividadIds);
    if (deleteReportesActividadError) throw deleteReportesActividadError;
  }

  // 6) Registros de actividades + participantes
  const { data: registrosActividad, error: registrosActividadError } = await supabase
    .from("registros_actividades")
    .select("id")
    .eq("lider_id", id);
  if (registrosActividadError) throw registrosActividadError;

  const registrosActividadIds = (registrosActividad || []).map((r: any) => r.id);
  const { error: deleteParticipacionesTecnicoError } = await supabase
    .from("actividad_participantes")
    .delete()
    .eq("tecnico_id", id);
  if (deleteParticipacionesTecnicoError) throw deleteParticipacionesTecnicoError;

  if (registrosActividadIds.length > 0) {
    const { error: deleteParticipacionesRegistroError } = await supabase
      .from("actividad_participantes")
      .delete()
      .in("registro_actividad_id", registrosActividadIds);
    if (deleteParticipacionesRegistroError) throw deleteParticipacionesRegistroError;

    const { error: deleteRegistrosActividadError } = await supabase
      .from("registros_actividades")
      .delete()
      .in("id", registrosActividadIds);
    if (deleteRegistrosActividadError) throw deleteRegistrosActividadError;
  }

  // 7) Por seguridad, romper vínculo de grupo del usuario antes de borrarlo
  await supabase.from("usuarios").update({ grupo_id: null }).eq("id", id);

  // 8) Eliminar usuario
  const { error } = await supabase.from("usuarios").delete().eq("id", id);
  if (error) throw error;
}

export async function loginUsuario(email: string, password: string): Promise<User | null> {
  const { data, error } = await supabase.rpc("validar_credenciales", {
    p_username: email,
    p_password: password,
  });
  if (error || !data || data.length === 0 || !data[0].valido) return null;
  const user = await getUsuarioById(data[0].usuario_id);
  return user;
}
