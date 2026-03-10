import { supabase } from "../client";
import { ArrivalRecord } from "@/lib/types";

const DAY_NAMES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const;

type ScheduleMap = Record<string, { activo: boolean; horaEntrada?: string; horaSalida?: string }>;

function normalizeTimeValue(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 5);
}

function getScheduleDay(fecha: string): string {
  const [year, month, day] = fecha.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return DAY_NAMES[date.getDay()];
}

function mapRow(row: any, schedulesByUser: ScheduleMap = {}): ArrivalRecord {
  const dayName = getScheduleDay(row.fecha);
  const schedule = schedulesByUser[`${row.usuario_id}-${dayName}`];
  const horaEsperada = schedule?.activo
    ? schedule.horaEntrada || row.hora_entrada_programada || ""
    : row.hora_entrada_programada || "";
  const horaSalidaProgramada = schedule?.activo
    ? schedule.horaSalida || row.hora_salida_programada || undefined
    : row.hora_salida_programada || undefined;

  return {
    id: row.id,
    usuarioId: row.usuario_id,
    fecha: row.fecha,
    horaEsperada,
    horaLlegada: row.hora_entrada_real || "",
    horaSalidaProgramada,
    horaSalidaReal: row.hora_salida_real || undefined,
    estadoEntrada: row.estado_entrada || "no_reportado",
    estadoSalida: row.estado_salida || "no_reportado",
    tarde: row.tarde || false,
    minutosRetraso: row.minutos_retraso || 0,
    mensajeEnviado: row.mensaje_enviado || undefined,
    tipoMensaje: row.tipo_mensaje || undefined,
    descuentoAplicado: row.descuento_aplicado || false,
    porcentajeDescuento: parseFloat(row.porcentaje_descuento) || 0,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

export async function getLlegadas(): Promise<ArrivalRecord[]> {
  const { data, error } = await supabase
    .from("registros_asistencia")
    .select("*")
    .order("fecha", { ascending: false });
  if (error) throw error;

  const rows = data || [];
  const userIds = [...new Set(rows.map((row: any) => row.usuario_id).filter(Boolean))];
  let schedulesByUser: ScheduleMap = {};

  if (userIds.length > 0) {
    const { data: schedules, error: schedulesError } = await supabase
      .from("usuario_horarios")
      .select("usuario_id, dia_semana, activo, hora_entrada, hora_salida")
      .in("usuario_id", userIds);

    if (schedulesError) {
      const message = `${schedulesError.message || ""} ${schedulesError.details || ""}`.toLowerCase();
      if (!message.includes("usuario_horarios") && !(message.includes("relation") && message.includes("does not exist"))) {
        throw schedulesError;
      }
    } else {
      schedulesByUser = (schedules || []).reduce<ScheduleMap>((acc, schedule: any) => {
        acc[`${schedule.usuario_id}-${schedule.dia_semana}`] = {
          activo: schedule.activo ?? true,
          horaEntrada: normalizeTimeValue(schedule.hora_entrada),
          horaSalida: normalizeTimeValue(schedule.hora_salida),
        };
        return acc;
      }, {});
    }
  }

  return rows.map((row: any) => mapRow(row, schedulesByUser));
}

export async function updateLlegada(id: string, updates: Partial<{
  mensajeEnviado: string;
  tipoMensaje: string;
  descuentoAplicado: boolean;
  porcentajeDescuento: number;
}>): Promise<ArrivalRecord> {
  const updateData: any = {};
  if (updates.mensajeEnviado !== undefined) updateData.mensaje_enviado = updates.mensajeEnviado;
  if (updates.tipoMensaje !== undefined) updateData.tipo_mensaje = updates.tipoMensaje;
  if (updates.descuentoAplicado !== undefined) updateData.descuento_aplicado = updates.descuentoAplicado;
  if (updates.porcentajeDescuento !== undefined) updateData.porcentaje_descuento = updates.porcentajeDescuento;

  const { data, error } = await supabase
    .from("registros_asistencia")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}
