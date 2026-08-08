import { supabase } from "../client";
import { ArrivalRecord, ScheduleDay, User } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const LLEGADAS_CACHE_KEY = "llegadas:list";
const LLEGADAS_CACHE_TTL = 20_000;

const DAY_NAMES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const;
const AUTO_NO_REGISTRADO_REASON_PREFIX = "[AUTO ";
const HOLIDAY_DATES = new Set(["2026-08-07"]);

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
  razon_tardanza?: string | null;
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

function getScheduleDay(fecha: string): ScheduleDay {
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
    razonTardanza: row.razon_tardanza || undefined,
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
    porcentajeDescuento:
      typeof row.porcentaje_descuento === "number"
        ? row.porcentaje_descuento
        : row.porcentaje_descuento
          ? Number(row.porcentaje_descuento)
          : 0,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

function getBogotaNow(): { fecha: string; hora: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return {
    fecha: `${get("year")}-${get("month")}-${get("day")}`,
    hora: `${get("hour")}:${get("minute")}`,
  };
}

function getScheduleForUser(user: User, fecha: string) {
  const dayName = getScheduleDay(fecha);
  const hasDailySchedules = Boolean(user.horarios && user.horarios.length > 0);
  const daySchedule = user.horarios?.find(
    (schedule) => schedule.diaSemana === dayName && schedule.activo && schedule.horaEntrada && schedule.horaSalida
  );

  return {
    horaEntrada: normalizeTimeValue(hasDailySchedules ? daySchedule?.horaEntrada : user.horaEntrada),
    horaSalida: normalizeTimeValue(hasDailySchedules ? daySchedule?.horaSalida : user.horaSalida),
  };
}

function attendanceCompleteness(row: LlegadaRow): number {
  return (row.hora_salida_real ? 2 : 0) + (row.hora_entrada_real ? 1 : 0);
}

/**
 * Creates/updates today's missing attendance rows once the configured cut-off is reached.
 * It is intentionally idempotent so refreshing the admin module is safe.
 */
export async function ensureNoRegistradosForToday(
  users: User[],
  discountPercentage: number,
  automaticDays: ScheduleDay[] = ["lunes", "martes", "miercoles", "jueves", "viernes"],
  automaticTime = "08:30",
): Promise<number> {
  const now = getBogotaNow();
  if (HOLIDAY_DATES.has(now.fecha)) return clearAutomaticSanctionsForDate(now.fecha);
  if (now.hora < automaticTime) return 0;
  if (!automaticDays.includes(getScheduleDay(now.fecha))) return 0;

  const scheduledUsers = users
    .filter((user) => user.estado === "activo" && user.rol !== "admin")
    .map((user) => ({ user, schedule: getScheduleForUser(user, now.fecha) }))
    .filter(({ schedule }) => Boolean(schedule.horaEntrada && schedule.horaSalida));

  if (scheduledUsers.length === 0) return 0;

  const { data, error } = await supabase
    .from("registros_asistencia")
    .select("*")
    .eq("fecha", now.fecha)
    .in("usuario_id", scheduledUsers.map(({ user }) => user.id));
  if (error) throw error;

  const rowsByUser = new Map<string, LlegadaRow>();
  for (const row of (data || []) as LlegadaRow[]) {
    const current = rowsByUser.get(row.usuario_id);
    if (!current || attendanceCompleteness(row) > attendanceCompleteness(current) ||
      (attendanceCompleteness(row) === attendanceCompleteness(current) &&
        String(row.fecha_creacion || "") > String(current.fecha_creacion || ""))) {
      rowsByUser.set(row.usuario_id, row);
    }
  }

  let changed = 0;
  for (const { user, schedule } of scheduledUsers) {
    const existing = rowsByUser.get(user.id);
    if (existing?.hora_entrada_real) continue;

    // Preserve a row already processed or manually adjusted by the administrator.
    if (existing?.razon_tardanza?.startsWith(AUTO_NO_REGISTRADO_REASON_PREFIX) ||
      (existing?.estado_entrada === "no_reportado" && existing.descuento_aplicado)) continue;

    const payload = {
      hora_entrada_programada: schedule.horaEntrada,
      hora_salida_programada: schedule.horaSalida,
      estado_entrada: "no_reportado",
      estado_salida: existing?.estado_salida || "no_reportado",
      minutos_retraso: 0,
      tarde: true,
      razon_tardanza: `[AUTO ${automaticTime}] No registró la entrada antes del corte configurado.`,
      descuento_aplicado: Number(discountPercentage) > 0,
      porcentaje_descuento: Math.max(0, Math.min(100, Number(discountPercentage) || 0)),
    };

    if (existing) {
      const { error: updateError } = await supabase
        .from("registros_asistencia")
        .update(payload)
        .eq("id", existing.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase
        .from("registros_asistencia")
        .insert({ usuario_id: user.id, fecha: now.fecha, ...payload });
      if (insertError) throw insertError;
    }
    changed += 1;
  }

  if (changed > 0) invalidateCachedValue(LLEGADAS_CACHE_KEY);
  return changed;
}

async function clearAutomaticSanctionsForDate(fecha: string): Promise<number> {
  const { data, error } = await supabase
    .from("registros_asistencia")
    .select("id")
    .eq("fecha", fecha)
    .is("hora_entrada_real", null)
    .ilike("razon_tardanza", `${AUTO_NO_REGISTRADO_REASON_PREFIX}%`);
  if (error) throw error;

  const automaticIds = (data || []).map((row) => row.id as string).filter(Boolean);
  if (automaticIds.length === 0) return 0;

  const { error: updateError } = await supabase
    .from("registros_asistencia")
    .update({
      tarde: false,
      descuento_aplicado: false,
      porcentaje_descuento: 0,
      razon_tardanza: null,
    })
    .in("id", automaticIds);
  if (updateError) throw updateError;

  invalidateCachedValue(LLEGADAS_CACHE_KEY);
  return automaticIds.length;
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
  estadoEntrada: ArrivalRecord["estadoEntrada"];
  estadoSalida: ArrivalRecord["estadoSalida"];
  tarde: boolean;
  minutosRetraso: number;
  razonTardanza: string | null;
  horaLlegada: string | null;
}>): Promise<ArrivalRecord> {
  const updateData: Record<string, string | boolean | number | null> = {};
  if (updates.mensajeEnviado !== undefined) updateData.mensaje_enviado = updates.mensajeEnviado;
  if (updates.tipoMensaje !== undefined) updateData.tipo_mensaje = updates.tipoMensaje;
  if (updates.descuentoAplicado !== undefined) updateData.descuento_aplicado = updates.descuentoAplicado;
  if (updates.porcentajeDescuento !== undefined) updateData.porcentaje_descuento = updates.porcentajeDescuento;
  if (updates.estadoEntrada !== undefined) updateData.estado_entrada = updates.estadoEntrada;
  if (updates.estadoSalida !== undefined) updateData.estado_salida = updates.estadoSalida;
  if (updates.tarde !== undefined) updateData.tarde = updates.tarde;
  if (updates.minutosRetraso !== undefined) updateData.minutos_retraso = updates.minutosRetraso;
  if (updates.razonTardanza !== undefined) updateData.razon_tardanza = updates.razonTardanza;
  if (updates.horaLlegada !== undefined) updateData.hora_entrada_real = updates.horaLlegada;

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
