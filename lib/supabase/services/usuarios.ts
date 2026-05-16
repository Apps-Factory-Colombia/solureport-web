import { supabase } from "../client";
import { User, UserSchedule, UserScheduleDraft } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";
import { invalidateMantenimientosCache, invalidateReportesMantenimientoCache } from "./mantenimientos";

const USUARIOS_CACHE_KEY = "usuarios:list";
const USUARIOS_CACHE_TTL = 60_000;

const DAY_ORDER: Record<UserSchedule["diaSemana"], number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

type UserPayload = Partial<User> & { password?: string; horarios?: UserScheduleDraft[] };

function normalizeTimeValue(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 5);
}

function mapScheduleRow(row: any): UserSchedule {
  return {
    id: row.id,
    usuarioId: row.usuario_id,
    diaSemana: row.dia_semana,
    activo: row.activo ?? true,
    horaEntrada: normalizeTimeValue(row.hora_entrada),
    horaSalida: normalizeTimeValue(row.hora_salida),
  };
}

function mapRow(row: any, horarios: UserSchedule[] = []): User {
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
    horaEntrada: normalizeTimeValue(row.hora_entrada),
    horaSalida: normalizeTimeValue(row.hora_salida),
    horarios,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
    avatar: row.avatar_url || undefined,
  };
}

function getPrimarySchedule(horarios?: UserScheduleDraft[]): UserScheduleDraft | undefined {
  return (horarios || [])
    .filter((horario) => horario.activo && horario.horaEntrada && horario.horaSalida)
    .sort((a, b) => DAY_ORDER[a.diaSemana] - DAY_ORDER[b.diaSemana])[0];
}

function isMissingSchedulesTableError(error: { message?: string; details?: string } | null): boolean {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return message.includes("usuario_horarios") || (message.includes("relation") && message.includes("does not exist"));
}

async function getHorariosUsuarioMap(userIds: string[]): Promise<Record<string, UserSchedule[]>> {
  if (userIds.length === 0) return {};

  const { data, error } = await supabase
    .from("usuario_horarios")
    .select("*")
    .in("usuario_id", userIds);

  if (error) {
    const message = `${error.message || ""} ${error.details || ""}`.toLowerCase();
    if (message.includes("usuario_horarios") || message.includes("relation") || message.includes("does not exist")) {
      return {};
    }
    throw error;
  }

  return (data || []).reduce<Record<string, UserSchedule[]>>((acc, row: any) => {
    const mapped = mapScheduleRow(row);
    if (!acc[mapped.usuarioId || ""]) acc[mapped.usuarioId || ""] = [];
    acc[mapped.usuarioId || ""].push(mapped);
    acc[mapped.usuarioId || ""].sort((a, b) => DAY_ORDER[a.diaSemana] - DAY_ORDER[b.diaSemana]);
    return acc;
  }, {});
}

async function syncHorariosUsuario(userId: string, horarios: UserScheduleDraft[]): Promise<void> {
  if (horarios.length === 0) {
    const { error } = await supabase.from("usuario_horarios").delete().eq("usuario_id", userId);
    if (isMissingSchedulesTableError(error)) {
      throw new Error('Debes ejecutar la migración de "usuario_horarios" antes de guardar horarios por día.');
    }
    if (error) throw error;
    return;
  }

  const rows = await Promise.all(
    horarios.map(async (horario) => {
      if (!horario.activo) {
        return {
          usuario_id: userId,
          dia_semana: horario.diaSemana,
          activo: false,
          hora_entrada: null,
          hora_salida: null,
        };
      }

      if (!horario.horaEntrada || !horario.horaSalida) {
        throw new Error(`Debes configurar hora de entrada y salida para ${horario.diaSemana}.`);
      }

      return {
        usuario_id: userId,
        dia_semana: horario.diaSemana,
        activo: true,
        hora_entrada: horario.horaEntrada,
        hora_salida: horario.horaSalida,
      };
    })
  );

  const { error } = await supabase
    .from("usuario_horarios")
    .upsert(rows, { onConflict: "usuario_id,dia_semana" });

  if (isMissingSchedulesTableError(error)) {
    throw new Error('Debes ejecutar la migración de "usuario_horarios" antes de guardar horarios por día.');
  }
  if (error) throw error;
}

export async function getUsuarios(): Promise<User[]> {
  return getCachedValue(USUARIOS_CACHE_KEY, USUARIOS_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("usuarios")
      .select("*")
      .order("fecha_creacion", { ascending: false });
    if (error) throw error;

    const rows = data || [];
    const schedulesByUser = await getHorariosUsuarioMap(rows.map((row: any) => row.id));
    return rows.map((row: any) => mapRow(row, schedulesByUser[row.id] || []));
  });
}

export async function getUsuarioById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;

  const schedulesByUser = await getHorariosUsuarioMap([id]);
  return mapRow(data, schedulesByUser[id] || []);
}

export async function createUsuario(user: UserPayload): Promise<User> {
  const primarySchedule = getPrimarySchedule(user.horarios);
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
      hora_entrada: primarySchedule?.horaEntrada || user.horaEntrada || null,
      hora_salida: primarySchedule?.horaSalida || user.horaSalida || null,
      grupo_id: user.grupoId || null,
    })
    .select()
    .single();
  if (error) throw error;

  if (user.horarios !== undefined) {
    await syncHorariosUsuario(data.id, user.horarios);
  }

  invalidateCachedValue(USUARIOS_CACHE_KEY);
  const createdUser = await getUsuarioById(data.id);
  if (!createdUser) throw new Error("No se pudo cargar el usuario creado.");
  return createdUser;
}

export async function updateUsuario(id: string, user: UserPayload): Promise<User> {
  const updateData: any = {};
  const primarySchedule = getPrimarySchedule(user.horarios);
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
  if (user.horarios !== undefined) {
    updateData.hora_entrada = primarySchedule?.horaEntrada || null;
    updateData.hora_salida = primarySchedule?.horaSalida || null;
  } else {
    if (user.horaEntrada !== undefined) updateData.hora_entrada = user.horaEntrada || null;
    if (user.horaSalida !== undefined) updateData.hora_salida = user.horaSalida || null;
  }
  if (user.grupoId !== undefined) updateData.grupo_id = user.grupoId || null;
  if (user.password !== undefined && user.password.trim() !== "") updateData.password_hash = user.password;

  const { data, error } = await supabase
    .from("usuarios")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  if (user.horarios !== undefined) {
    await syncHorariosUsuario(id, user.horarios);
  }

  invalidateCachedValue(USUARIOS_CACHE_KEY);
  const updatedUser = await getUsuarioById(data.id);
  if (!updatedUser) throw new Error("No se pudo cargar el usuario actualizado.");
  return updatedUser;
}

export async function deleteUsuario(id: string): Promise<void> {
  // 1) Relaciones livianas/directas
  await supabase.from("sesiones_usuario").delete().eq("usuario_id", id);
  await supabase.from("notificaciones").delete().eq("usuario_id", id);
  await supabase.from("registros_asistencia").delete().eq("usuario_id", id);
  await supabase.from("recorridos").delete().eq("tecnico_id", id);
  await supabase.from("acumulacion_lideres").delete().eq("lider_id", id);
  await supabase.from("lotes_aprobacion_lider").delete().eq("lider_id", id);
  const { error: horariosError } = await supabase.from("usuario_horarios").delete().eq("usuario_id", id);
  if (horariosError && !isMissingSchedulesTableError(horariosError)) throw horariosError;
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

  const { error: deleteMaintenanceParticipantsError } = await supabase
    .from("mantenimiento_participantes")
    .delete()
    .eq("usuario_id", id);
  if (deleteMaintenanceParticipantsError) throw deleteMaintenanceParticipantsError;

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
  invalidateCachedValue(USUARIOS_CACHE_KEY);
  invalidateMantenimientosCache();
  invalidateReportesMantenimientoCache();
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
