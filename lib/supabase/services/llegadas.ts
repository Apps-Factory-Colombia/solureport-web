import { supabase } from "../client";
import { ArrivalRecord } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const LLEGADAS_CACHE_KEY = "llegadas:list";
const LLEGADAS_CACHE_TTL = 20_000;

const DAY_NAMES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const;

type ScheduleMap = Record<string, { activo: boolean; horaEntrada?: string; horaSalida?: string }>;

interface LlegadaRow {
  id: string;
  usuario_id: string;
  fecha: string;
  hora_entrada_programada?: string | null;
  hora_salida_programada?: string | null;
  hora_entrada_real?: string | null;
  hora_salida_real?: string | null;
  estado_entrada?: ArrivalRecord["estadoEntrada"];
  estado_salida?: ArrivalRecord["estadoSalida"];
  tarde?: boolean | null;
  minutos_retraso?: number | null;
  foto_llegada_url?: string | null;
  ubicacion_llegada_precision_metros?: number | string | null;
  ubicacion_llegada_timestamp?: string | null;
  ubicacion_llegada_direccion?: string | null;
  mensaje_enviado?: string | null;
  tipo_mensaje?: ArrivalRecord["tipoMensaje"];
  descuento_aplicado?: boolean | null;
  porcentaje_descuento?: number | string | null;
  fecha_creacion?: string | null;
}

interface UsuarioHorarioRow {
  usuario_id: string;
  dia_semana: string;
  activo?: boolean | null;
  hora_entrada?: string | null;
  hora_salida?: string | null;
}

function normalizeTimeValue(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 5);
}

function getScheduleDay(fecha: string): string {
  const [year, month, day] = fecha.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return DAY_NAMES[date.getDay()];
}

function mapRow(row: LlegadaRow, schedulesByUser: ScheduleMap = {}): ArrivalRecord {
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
    fotoLlegadaUrl: row.foto_llegada_url || undefined,
    ubicacionLlegadaPrecisionMetros:
      typeof row.ubicacion_llegada_precision_metros === "number"
        ? row.ubicacion_llegada_precision_metros
        : row.ubicacion_llegada_precision_metros
          ? Number(row.ubicacion_llegada_precision_metros)
          : undefined,
    ubicacionLlegadaTimestamp: row.ubicacion_llegada_timestamp || undefined,
    ubicacionLlegadaDireccion: row.ubicacion_llegada_direccion || undefined,
    mensajeEnviado: row.mensaje_enviado || undefined,
    tipoMensaje: row.tipo_mensaje || undefined,
    descuentoAplicado: row.descuento_aplicado || false,
    porcentajeDescuento: parseFloat(row.porcentaje_descuento) || 0,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

export async function getLlegadas(): Promise<ArrivalRecord[]> {
  return getCachedValue(LLEGADAS_CACHE_KEY, LLEGADAS_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("registros_asistencia")
      .select("*")
      .order("fecha_creacion", { ascending: false })
      .order("fecha", { ascending: false });
    if (error) throw error;

    const rows = (data || []) as LlegadaRow[];
    const userIds = [...new Set(rows.map((row) => row.usuario_id).filter(Boolean))];
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
        schedulesByUser = ((schedules || []) as UsuarioHorarioRow[]).reduce<ScheduleMap>((acc, schedule) => {
          acc[`${schedule.usuario_id}-${schedule.dia_semana}`] = {
            activo: schedule.activo ?? true,
            horaEntrada: normalizeTimeValue(schedule.hora_entrada),
            horaSalida: normalizeTimeValue(schedule.hora_salida),
          };
          return acc;
        }, {});
      }
    }

    return rows.map((row) => mapRow(row, schedulesByUser));
  });
}

export async function updateLlegada(id: string, updates: Partial<{
  mensajeEnviado: string;
  tipoMensaje: string;
  descuentoAplicado: boolean;
  porcentajeDescuento: number;
}>): Promise<ArrivalRecord> {
  const updateData: Record<string, string | boolean | number> = {};
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
  invalidateCachedValue(LLEGADAS_CACHE_KEY);
  return mapRow(data);
}
