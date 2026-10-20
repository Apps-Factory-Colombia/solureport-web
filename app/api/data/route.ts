/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, hashPassword, renewSession } from "@/lib/db/auth";
import { dbQuery, isDatabaseCapacityError, withTransaction } from "@/lib/db/postgres";
import { calculateLiquidationAmount, isLegacyAppliedValueCalculation } from "@/lib/utils/liquidation-math";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type UserContext = NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>;
type Payload = Record<string, any>;

const dayToNumber: Record<string, number> = {
  lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7,
};
const numberToDay = ["", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
// Todas las fechas operativas de SoluReport pertenecen a la jornada de
// Colombia. PostgreSQL puede tener una zona horaria de servidor distinta
// (normalmente UTC), por lo que CURRENT_DATE no es seguro para permisos de
// grupos ni para vigencia de sus miembros.
const BOGOTA_DATE_SQL = "(now() AT TIME ZONE 'America/Bogota')::date";
const BOGOTA_NOW_SQL = "(now() AT TIME ZONE 'America/Bogota')";
let liquidationFreezeSchemaPromise: Promise<boolean> | null = null;

async function hasLiquidationFreezeSchema() {
  if (!liquidationFreezeSchemaPromise) {
    liquidationFreezeSchemaPromise = dbQuery(
      `SELECT to_regclass('public.liquidacion_periodo_items') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'liquidacion_items'
               AND column_name = 'es_arrastre'
          ) AS ready`,
    ).then(({ rows }) => Boolean(rows[0]?.ready)).catch(() => false);
  }
  return liquidationFreezeSchemaPromise;
}

// La fecha de vencimiento operativa incluye la hora programada. Cuando una
// fila histórica no tiene hora, se considera vigente hasta el final de ese
// día, que conserva el comportamiento anterior basado únicamente en fecha.
function maintenanceScheduledDateSql(scheduleAlias = "m", contractAlias = "cm") {
  // The saved schedule date is final: an administrator may adjust individual
  // contract dates, so the contract-derived date is only a legacy fallback.
  // Contract days are capped at 28 by the API, making this fallback safe.
  return `(COALESCE(${scheduleAlias}.fecha_programada, CASE
    WHEN ${contractAlias}.id IS NOT NULL AND ${scheduleAlias}.numero IS NOT NULL
      THEN (make_date(${contractAlias}.anio, ${contractAlias}.mes_inicio, 1)
        + ((${scheduleAlias}.numero - 1) * ${contractAlias}.frecuencia_meses) * INTERVAL '1 month'
        + (${contractAlias}.dia_inicio - 1) * INTERVAL '1 day')::date
    ELSE NULL
  END))`;
}

function maintenanceDueAtSql(scheduleAlias = "m", scheduledDateExpression?: string) {
  const scheduledDate = scheduledDateExpression || `${scheduleAlias}.fecha_programada`;
  return `(${scheduledDate}::timestamp + COALESCE(${scheduleAlias}.hora_programada, TIME '23:59:59'))`;
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  const isoDate = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw.split("T")[0] || null : parsed.toISOString().slice(0, 10);
}

function jsonArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

const PUBLIC_STORAGE_BUCKETS = new Set([
  "fotos-mantenimientos",
  "fotos-reportes",
  "fotos-visitas",
  "fotos-recorridos",
  "bitacoras-fotos",
]);

function maintenanceEvidenceUrl(item: any, fallbackBucket = "fotos-mantenimientos"): string | undefined {
  const storedUrl = String(item?.url || "").trim();
  const storedKey = String(item?.key || item?.storage_key || "").trim();
  if (/^(?:https?:|data:image\/)/i.test(storedUrl)) return storedUrl;
  if (storedUrl.startsWith("//")) return `https:${storedUrl}`;

  const storageBaseUrl = String(
    process.env.SOLUREPORT_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  ).trim().replace(/\/+$/, "");
  const rawUrlPath = storedUrl || storedKey;
  const looksLikeStoragePath = /^\/?storage\/v1\//i.test(rawUrlPath);
  if (looksLikeStoragePath) {
    if (!storageBaseUrl) return undefined;
    return `${storageBaseUrl}/${rawUrlPath.replace(/^\/+/, "")}`;
  }

  const hostWithoutScheme = storedUrl.match(/^([\w.-]+\.supabase\.(?:co|in)\/.*)$/i);
  if (hostWithoutScheme) return `https://${hostWithoutScheme[1]}`;

  let bucket = String(item?.bucket || item?.storage_bucket || fallbackBucket).trim();
  let key = storedKey || storedUrl;
  const bucketPrefix = key.split("/", 1)[0];
  if (!item?.bucket && !item?.storage_bucket && PUBLIC_STORAGE_BUCKETS.has(bucketPrefix)) {
    bucket = bucketPrefix;
    key = key.slice(bucketPrefix.length + 1);
  }
  if (!storageBaseUrl || !bucket || !key) return undefined;

  const encodedKey = key.replace(/^\/+/, "").split("/").map((segment) =>
    encodeURIComponent(segment).replace(/%25([0-9a-f]{2})/gi, "%$1"),
  ).join("/");
  return `${storageBaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedKey}`;
}

function semanticParticipantPayload(participants: any[]) {
  return participants
    .map((participant) => ({
      tecnico_id: String(participant.tecnicoId || participant.tecnico_id || "").trim(),
    }))
    .filter((participant) => participant.tecnico_id);
}

async function calculateSemanticFingerprint(client: any, payload: Payload, type: string, sedeId: string | null, grupoId: string) {
  const { rows } = await client.query(
    `SELECT public.calcular_huella_semantica_actividad(
       $1::text, $2::uuid, $3::uuid, $4::uuid, $5::date, $6::text, $7::text,
       $8::uuid, $9::text, $10::uuid, $11::text, $12::text, $13::text,
       $14::text, $15::text, $16::text, $17::text, $18::text, $19::text,
       $20::text, $21::jsonb
     ) AS huella_semantica`,
    [
      type,
      payload.clienteId || null,
      sedeId,
      grupoId,
      dateOnly(payload.fechaOperacion),
      payload.descripcion || "Actividad operativa",
      payload.observaciones || null,
      payload.catalogoActividadId || null,
      payload.especificacion || null,
      payload.mantenimientoProgramadoId || null,
      payload.titulo || payload.descripcion || null,
      payload.tipoPendiente || null,
      payload.descripcionPendiente || null,
      payload.tipoVisita || "imprevisto",
      payload.receptorNombre || null,
      payload.receptorCedula || null,
      payload.receptorCargo || null,
      payload.puntoPartida || null,
      payload.puntoLlegada || null,
      payload.tipoRecorrido || "normal",
      JSON.stringify(semanticParticipantPayload(jsonArray(payload.participantes || payload.participants))),
    ],
  );
  const fingerprint = String(rows[0]?.huella_semantica || "").trim();
  if (!fingerprint) throw new Error("No se pudo calcular la identidad semántica de la actividad.");
  return fingerprint;
}

function timeMinutes(value: unknown): number | null {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function percentage(value: unknown, fallback = 0) {
  return Math.max(0, Math.min(100, number(value, fallback)));
}

function attendanceThresholds(settings: any) {
  const configuredLateStart = timeMinutes(settings.horaInicioDescuentoTardanza);
  const configuredCutoff = timeMinutes(settings.horaDescuentoAutomatico);
  return { lateStartMinutes: configuredLateStart, noReportCutoffMinutes: configuredCutoff };
}

function attendanceDiscountForTime(settings: any, actualMinutes: number | null, scheduledMinutes: number | null) {
  const { lateStartMinutes, noReportCutoffMinutes } = attendanceThresholds(settings);
  const latePercentage = percentage(settings.porcentajeDescuentoTardanza);
  const noReportPercentage = percentage(settings.porcentajeDescuentoNoReportado, 30);
  const reposicionPercentage = percentage(settings.porcentajeDescuentoReposicion, 0);
  const scheduled = scheduledMinutes ?? lateStartMinutes ?? 0;

  if (actualMinutes == null) {
    return { estado: "no_reportado", categoria: "no_reportado", minutosRetraso: 0, minutosAdeudados: Math.max(0, Math.floor(number(settings.minutosNoReportado, 30))), porcentaje: noReportPercentage };
  }
  if (lateStartMinutes == null || actualMinutes < lateStartMinutes) {
    return { estado: "a_tiempo", categoria: "a_tiempo", minutosRetraso: 0, minutosAdeudados: 0, porcentaje: 0 };
  }

  const minutesLate = Math.max(0, actualMinutes - scheduled);
  if (noReportCutoffMinutes != null && actualMinutes >= noReportCutoffMinutes) {
    return { estado: "tarde", categoria: "reposicion", minutosRetraso: minutesLate, minutosAdeudados: minutesLate, porcentaje: reposicionPercentage };
  }
  return { estado: "tarde", categoria: "tardanza_leve", minutosRetraso: minutesLate, minutosAdeudados: minutesLate, porcentaje: latePercentage };
}

function bogotaClock() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * A shared activity must represent one complete 100% split, but administration
 * may assign all of it to one technician. Zero is therefore valid for a
 * participant: it keeps the participant visible without adding payment.
 * Invalid or incomplete totals are normalized before PostgreSQL sees them.
 */
function normalizePercentageRows<T extends Record<string, any>>(items: T[]): Array<T & { porcentaje: number }> {
  const parsed = items.map((item) => ({ ...item, porcentaje: number(item.porcentaje, 0) }));
  if (!parsed.length) return parsed;

  const total = parsed.reduce((sum, item) => sum + item.porcentaje, 0);
  const valid = parsed.every((item) => item.porcentaje >= 0 && item.porcentaje <= 100)
    && Math.abs(total - 100) <= 0.01;
  if (valid) return parsed;

  const basis = parsed.map((item) => Math.max(0, item.porcentaje));
  const hasPositiveBasis = basis.some((value) => value > 0);
  const normalizedBasis = hasPositiveBasis ? basis : parsed.map(() => 1);
  const basisTotal = normalizedBasis.reduce((sum, value) => sum + value, 0) || parsed.length;
  let assigned = 0;

  return parsed.map((item, index) => {
    const porcentaje = index === parsed.length - 1
      ? roundCurrency(100 - assigned)
      : roundCurrency((normalizedBasis[index] * 100) / basisTotal);
    assigned += porcentaje;
    return { ...item, porcentaje: Math.max(0, porcentaje) };
  });
}

function integerField(value: unknown, label: string, minimum: number, maximum?: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || (maximum !== undefined && parsed > maximum)) {
    const range = maximum === undefined ? `mayor o igual a ${minimum}` : `entre ${minimum} y ${maximum}`;
    throw new Error(`${label} debe ser un número entero ${range}.`);
  }
  return parsed;
}

function nonNegativeMoney(value: unknown, label: string) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} debe ser un valor mayor o igual a cero.`);
  return roundCurrency(parsed);
}

function calculateContractTotals(payload: Payload) {
  const quantity = integerField(payload.cantidadMantenimientos, "La cantidad de mantenimientos", 1, 12);
  const pedestrianDoors = integerField(payload.puertasPeatonales ?? 0, "Las puertas peatonales", 0);
  const vehicleDoors = integerField(payload.puertasVehiculares ?? 0, "Las puertas vehiculares", 0);
  const pedestrianValue = nonNegativeMoney(payload.valorPuertaPeatonal, "El valor de la puerta peatonal");
  const vehicleValue = nonNegativeMoney(payload.valorPuertaVehicular, "El valor de la puerta vehicular");
  const total = roundCurrency(((pedestrianDoors * pedestrianValue) + (vehicleDoors * vehicleValue)) * quantity);
  return {
    quantity,
    pedestrianDoors,
    vehicleDoors,
    pedestrianValue,
    vehicleValue,
    total,
    perMaintenance: roundCurrency(total / quantity),
    frequencyMonths: Math.max(1, Math.floor(12 / quantity)),
  };
}

async function writeAudit(
  client: any,
  actorId: string | undefined,
  entityType: string,
  entityId: string,
  action: "crear" | "actualizar" | "anular",
  before: unknown,
  after: unknown,
) {
  if (!actorId) return;
  await client.query(
    `INSERT INTO public.auditoria_eventos
      (actor_id, entidad_tipo, entidad_id, accion, datos_antes, datos_despues)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [actorId, entityType, entityId, action, JSON.stringify(before ?? null), JSON.stringify(after ?? null)],
  );
}

function mapUser(row: any, includeSensitiveFields = false): any {
  const schedules = jsonArray(row.horarios).map((item) => ({
    id: item.id,
    usuarioId: item.usuarioId || item.usuario_id,
    diaSemana: item.diaSemana || numberToDay[number(item.dia_semana)],
    activo: item.activo ?? true,
    horaEntrada: item.horaEntrada || item.hora_entrada || undefined,
    horaSalida: item.horaSalida || item.hora_salida || undefined,
  }));
  return {
    id: row.id,
    username: row.username,
    nombre: row.nombre,
    apellido: row.apellido,
    ...(includeSensitiveFields ? { cedula: row.cedula || "" } : {}),
    email: row.email,
    telefono: row.telefono || "",
    rol: row.rol,
    estado: row.estado === "bloqueado" ? "inactivo" : row.estado,
    grupoId: row.grupo_id || undefined,
    liderId: row.lider_id || undefined,
    esLider: Boolean(row.es_lider),
    tieneRecorrido: Boolean(row.tiene_recorrido),
    tieneMoto: Boolean(row.tiene_moto),
    esSupervisor: row.rol === "supervisor",
    horaEntrada: row.hora_entrada ? String(row.hora_entrada).slice(0, 5) : undefined,
    horaSalida: row.hora_salida ? String(row.hora_salida).slice(0, 5) : undefined,
    horarios: schedules,
    fechaCreacion: dateOnly(row.created_at) || "",
    avatar: row.avatar_url || undefined,
  };
}

function mapClient(row: any): any {
  return {
    id: row.id,
    nombre: row.nombre,
    nitCedula: row.identificador_fiscal || "",
    edificio: row.sede_nombre || "",
    direccion: row.sede_direccion || "",
    ciudad: row.sede_ciudad || "Bogotá",
    contacto: row.contacto_nombre || "",
    correo: row.correo || "",
    correoAliado: row.correo_aliado || undefined,
    telefono: row.telefono || "",
    frecuenciaMantenimiento: number(row.frecuencia_mantenimiento, 4),
    puertasPeatonales: number(row.puertas_peatonales),
    puertasVehiculares: number(row.puertas_vehiculares),
    estado: row.estado,
    fechaCreacion: dateOnly(row.created_at) || "",
    sedeId: row.sede_id || undefined,
  };
}

function mapGroup(row: any): any {
  return {
    id: row.id,
    nombre: row.nombre,
    liderId: row.lider_id || "",
    miembros: jsonArray(row.miembros),
    reporterosIds: jsonArray(row.reportadores),
    estado: row.estado,
    fechaCreacion: dateOnly(row.created_at) || "",
  };
}

function mapPeriod(row: any): any {
  return {
    id: row.id,
    fechaInicio: dateOnly(row.fecha_inicio) || "",
    fechaFin: dateOnly(row.fecha_fin) || "",
    estado: row.estado,
    fechaCierre: row.fecha_cierre ? dateOnly(row.fecha_cierre) : undefined,
    liquidacionCongeladaEn: row.liquidacion_congelada_en || undefined,
    arrastrePendientesEn: row.arrastre_pendientes_en || undefined,
    liquidacionVersion: number(row.liquidacion_version, 1),
  };
}

function mapMaintenance(row: any): any {
  const sourceState = row.estado_usuario || row.estado;
  const state = sourceState === "ejecutado" ? "realizado" : sourceState === "asignado" ? "programado" : sourceState;
  const contractualDate = row.contrato_id && row.contrato_anio
    ? contractMaintenanceScheduledDate(row, row.numero)
    : null;
  const scheduledDate = dateOnly(row.fecha_programada_efectiva) || dateOnly(row.fecha_programada) || contractualDate || "";
  const participants = jsonArray(row.participantes).map((item) => ({
    id: item.id,
    usuarioId: item.usuarioId || item.usuario_id,
    porcentaje: number(item.porcentaje),
    valorCalculado: number(item.valorCalculado ?? item.valor_calculado ?? item.valorGanado),
    rol: item.rol || item.rol_participacion,
    estado: item.estado || "activo",
    estadoReporte: item.estadoReporte || item.estado_reporte || "pendiente",
    entregaId: item.entregaId || item.entrega_id || undefined,
    fechaCreacion: item.fechaCreacion || item.fecha_creacion || undefined,
  }));
  return {
    id: row.id,
    codigoRegistro: row.codigo || undefined,
    clienteId: row.cliente_id,
    tecnicoId: row.tecnico_principal_id || "",
    origen: row.contrato_id ? "contrato" : "mantenimiento",
    contratoId: row.contrato_id || undefined,
    contratoMantenimientoId: row.id,
    sedeId: row.sede_id || undefined,
    grupoId: row.grupo_id || undefined,
    liderId: row.lider_id || undefined,
    tecnicoPrincipalId: row.tecnico_principal_id || undefined,
    titulo: row.titulo || undefined,
    fechaProgramada: scheduledDate,
    horaProgramada: row.hora_programada ? String(row.hora_programada).slice(0, 5) : undefined,
    proximaFecha: dateOnly(row.proxima_fecha) || undefined,
    estado: state,
    observaciones: row.observaciones || undefined,
    tipoPendiente: row.tipo_pendiente || undefined,
    descripcionPendiente: row.descripcion_pendiente || undefined,
    valorRecaudado: number(row.valor_recaudado),
    costoTecnicoTotal: number(row.costo_tecnico_presupuestado),
    participantes: participants,
    fechaCreacion: dateOnly(row.created_at) || "",
    fechaCierre: dateOnly(row.fecha_realizado) || undefined,
    clienteNombre: row.cliente_nombre || undefined,
    edificio: row.sede_nombre || undefined,
  };
}

function mapContract(row: any, maintenanceRows: any[] = []): any {
  const contractSchedule = buildContractSchedule({
    anio: row.anio,
    mesInicio: row.mes_inicio,
    diaInicio: row.dia_inicio,
    cantidadMantenimientos: row.cantidad_mantenimientos,
  });
  return {
    id: row.id,
    clienteId: row.cliente_id,
    anio: number(row.anio),
    mesInicio: number(row.mes_inicio, 1),
    diaInicio: number(row.dia_inicio, 1),
    puertasPeatonales: number(row.puertas_peatonales),
    puertasVehiculares: number(row.puertas_vehiculares),
    valorPuertaPeatonal: number(row.valor_puerta_peatonal),
    valorPuertaVehicular: number(row.valor_puerta_vehicular),
    costoTotalAnual: number(row.costo_total_anual),
    cantidadMantenimientos: number(row.cantidad_mantenimientos),
    costoPorMantenimiento: number(row.costo_por_mantenimiento),
    mantenimientosRealizados: maintenanceRows.map((item) => {
      const scheduledDate = dateOnly(item.fecha_programada)
        || contractSchedule.find((expected) => expected.numero === number(item.numero))?.fechaProgramada
        || "";
      return {
        id: item.id,
        numero: number(item.numero),
        mes: Number(scheduledDate.slice(5, 7)) || number(item.numero),
        fechaProgramada: scheduledDate,
        fechaRealizado: dateOnly(item.fecha_realizado) || undefined,
        tecnicoId: item.tecnico_principal_id || undefined,
        estado: item.estado === "ejecutado" ? "realizado" : item.estado === "asignado" ? "programado" : item.estado,
        valorRecaudado: number(item.valor_recaudado),
      };
    }),
    estado: row.estado === "cancelado" ? "cerrado" : row.estado,
    fechaCreacion: dateOnly(row.created_at) || "",
  };
}

async function userRows(where = "", values: unknown[] = []) {
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
               WHERE gm.usuario_id = u.id AND gm.fecha_inicio <= ${BOGOTA_DATE_SQL}
                 AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= ${BOGOTA_DATE_SQL}) LIMIT 1) AS grupo_id,
            EXISTS (SELECT 1 FROM public.grupos_trabajo g WHERE g.lider_id = u.id AND g.estado = 'activo') AS es_lider
       FROM public.usuarios u ${where}
      ORDER BY u.created_at DESC`, values,
  );
  return rows;
}

async function groupRows(where = "", values: unknown[] = []) {
  const { rows } = await dbQuery(
    `SELECT g.*,
            COALESCE((SELECT json_agg(gm.usuario_id ORDER BY gm.usuario_id)
              FROM public.grupo_miembros gm WHERE gm.grupo_id = g.id
                 AND gm.fecha_inicio <= ${BOGOTA_DATE_SQL} AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= ${BOGOTA_DATE_SQL})), '[]'::json) AS miembros,
            COALESCE((SELECT json_agg(gr.usuario_id ORDER BY gr.usuario_id)
              FROM public.grupo_reportadores_actividad gr WHERE gr.grupo_id = g.id
                 AND gr.fecha_inicio <= ${BOGOTA_DATE_SQL} AND (gr.fecha_fin IS NULL OR gr.fecha_fin >= ${BOGOTA_DATE_SQL})), '[]'::json) AS reportadores
       FROM public.grupos_trabajo g ${where}
      ORDER BY g.created_at DESC`, values,
  );
  return rows;
}

async function currentUserGroupContext(userId: string) {
  const { rows } = await dbQuery(
    `SELECT g.id AS grupo_id,
            g.lider_id,
            COALESCE((SELECT json_agg(gm.usuario_id ORDER BY gm.usuario_id)
              FROM public.grupo_miembros gm
             WHERE gm.grupo_id = g.id
               AND gm.fecha_inicio <= ${BOGOTA_DATE_SQL}
               AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= ${BOGOTA_DATE_SQL})), '[]'::json) AS miembros,
            COALESCE((SELECT json_agg(gr.usuario_id ORDER BY gr.usuario_id)
              FROM public.grupo_reportadores_actividad gr
             WHERE gr.grupo_id = g.id
               AND gr.fecha_inicio <= ${BOGOTA_DATE_SQL}
               AND (gr.fecha_fin IS NULL OR gr.fecha_fin >= ${BOGOTA_DATE_SQL})), '[]'::json) AS reportadores,
            public.usuario_puede_reportar_grupo($1::uuid, g.id, ${BOGOTA_DATE_SQL}) AS puede_reportar,
            CASE WHEN g.lider_id = $1::uuid THEN 0 ELSE 1 END AS prioridad_lider,
            g.created_at
       FROM public.grupos_trabajo g
      WHERE COALESCE(g.estado, 'activo') = 'activo'
        AND (
          g.lider_id = $1::uuid
          OR EXISTS (
            SELECT 1
              FROM public.grupo_miembros gm
             WHERE gm.grupo_id = g.id
               AND gm.usuario_id = $1::uuid
               AND gm.fecha_inicio <= ${BOGOTA_DATE_SQL}
               AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= ${BOGOTA_DATE_SQL})
          )
        )
      ORDER BY CASE WHEN public.usuario_puede_reportar_grupo($1::uuid, g.id, ${BOGOTA_DATE_SQL}) THEN 0 ELSE 1 END,
               prioridad_lider,
               g.created_at DESC
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    grupoId: row.grupo_id,
    liderId: row.lider_id || "",
    miembros: jsonArray(row.miembros).map((id) => String(id)),
    reporterosIds: jsonArray(row.reportadores).map((id) => String(id)),
    puedeReportar: Boolean(row.puede_reportar),
  };
}

async function clientRows(where = "", values: unknown[] = []) {
  const { rows } = await dbQuery(
    `SELECT c.*, s.id AS sede_id, s.nombre AS sede_nombre, s.direccion AS sede_direccion,
            s.puertas_peatonales, s.puertas_vehiculares
       FROM public.clientes c
       LEFT JOIN LATERAL (
         SELECT cs.* FROM public.cliente_sedes cs WHERE cs.cliente_id = c.id
         ORDER BY (cs.estado = 'activo') DESC, cs.created_at ASC LIMIT 1
       ) s ON true
       ${where}
      ORDER BY c.created_at DESC`, values,
  );
  return rows;
}

async function periodRows() {
  const { rows } = await dbQuery("SELECT * FROM public.periodos_liquidacion ORDER BY fecha_inicio DESC");
  return rows;
}

function canonicalActivityId(id: unknown): string {
  const value = String(id || "");
  return value.includes(":") ? value.split(":")[0] : value;
}

function canonicalParticipantId(id: unknown): string | null {
  const value = String(id || "");
  return value.includes(":") ? value.split(":")[1] || null : null;
}

async function activityRows(payload: Payload = {}) {
  const freezeSchemaReady = payload.periodoId ? await hasLiquidationFreezeSchema() : false;
  const values: unknown[] = [];
  let selectedPeriodParam: number | null = null;
  const filters: string[] = [
    // During the legacy migration, scheduled maintenance rows were copied to
    // actividades_operativas so the old screens could still find them. They
    // are planning records, not technical reports, and must never appear in
    // approvals, reports or financial exports as completed work.
    `NOT (
      a.tipo = 'mantenimiento'
      AND COALESCE(a.metadata->>'migrated_from', '') = 'mantenimientos'
      AND COALESCE(a.metadata->>'legacy_estado', '') IN ('programado', 'pendiente')
    )`,
  ];
  if (payload.startDate) { values.push(payload.startDate); filters.push(`a.fecha_operacion >= $${values.length}`); }
  if (payload.endDate) { values.push(payload.endDate); filters.push(`a.fecha_operacion <= $${values.length}`); }
  if (payload.periodoId) {
    values.push(payload.periodoId);
    selectedPeriodParam = values.length;
    const periodDateFilter = `EXISTS (SELECT 1 FROM public.periodos_liquidacion pp WHERE pp.id = $${selectedPeriodParam} AND a.fecha_operacion BETWEEN pp.fecha_inicio AND pp.fecha_fin)`;
    // La pertenencia a un corte queda registrada en la liquidación. La fecha
    // de la actividad es el respaldo para actividades aún no materializadas;
    // no se debe descartar un item que el administrador ya asignó al período.
    const periodMembershipFilter = `OR EXISTS (
      SELECT 1 FROM public.liquidacion_items li_period
       WHERE li_period.periodo_id = $${selectedPeriodParam}
         AND li_period.actividad_id = a.id
    )${freezeSchemaReady ? `
      OR EXISTS (
        SELECT 1 FROM public.liquidacion_periodo_items snapshot_period
         WHERE snapshot_period.periodo_id = $${selectedPeriodParam}
           AND snapshot_period.actividad_id = a.id
      )` : ""}`;
    filters.push(`(${periodDateFilter} ${periodMembershipFilter})`);
  }
  if (payload.activityId) { values.push(payload.activityId); filters.push(`a.id = $${values.length}`); }
  if (payload.tecnicoId) { values.push(payload.tecnicoId); filters.push(`EXISTS (SELECT 1 FROM public.actividades_operativas_participantes fp WHERE fp.actividad_id = a.id AND fp.tecnico_id = $${values.length})`); }
  if (payload.grupoId) { values.push(payload.grupoId); filters.push(`a.grupo_id = $${values.length}`); }
  if (payload.liderId) { values.push(payload.liderId); filters.push(`g.lider_id = $${values.length}`); }
  if (payload.tipo) { values.push(payload.tipo === "actividad_grupal" ? "actividad" : payload.tipo === "mantenimiento_preventivo" ? "mantenimiento" : payload.tipo); filters.push(`a.tipo = $${values.length}`); }
  if (Array.isArray(payload.tipos) && payload.tipos.length > 0) {
    const normalizedTypes = payload.tipos
      .map((type) => type === "actividad_grupal" ? "actividad" : type === "mantenimiento_preventivo" ? "mantenimiento" : String(type))
      .filter((type) => ["actividad", "mantenimiento", "visita_tecnica", "recorrido"].includes(type));
    if (normalizedTypes.length > 0) {
      values.push(normalizedTypes);
      filters.push(`a.tipo = ANY($${values.length}::text[])`);
    }
  }

  // Liquidación, reportes y comprobantes deben leer el mismo valor por período.
  // Para períodos congelados la fotografía es la fuente de verdad; para períodos
  // abiertos se usan los ítems vivos y mapReport aplica el fallback de aprobaciones
  // cuando todavía no existe una fila materializada.
  const periodLiquidationRows = selectedPeriodParam !== null
    ? freezeSchemaReady
      ? `COALESCE((SELECT json_agg(json_build_object(
          'id', effective_liquidation.id,
          'participanteId', effective_liquidation.participante_id,
          'tecnicoId', effective_liquidation.tecnico_id,
          'estado', effective_liquidation.estado,
          'valorBase', effective_liquidation.valor_base,
          'valorGanado', effective_liquidation.valor_ganado,
          'valorGanadoOriginal', effective_liquidation.valor_ganado_original,
          'descuentoTardanza', effective_liquidation.descuento_tardanza,
          'porcentajeDescuentoTardanza', effective_liquidation.porcentaje_descuento_tardanza
        ) ORDER BY effective_liquidation.created_at)
        FROM (
          SELECT s.id, s.participante_id, s.tecnico_id, s.estado, s.valor_base,
                 s.valor_ganado, s.valor_ganado_original, s.descuento_tardanza,
                 s.porcentaje_descuento_tardanza, s.fecha_snapshot AS created_at
            FROM public.liquidacion_periodo_items s
           WHERE s.periodo_id = $${selectedPeriodParam} AND s.actividad_id = a.id
          UNION ALL
          SELECT li.id, li.participante_id, li.tecnico_id, li.estado, li.valor_base,
                 li.valor_ganado, li.valor_ganado_original, li.descuento_tardanza,
                 li.porcentaje_descuento_tardanza, li.created_at
            FROM public.liquidacion_items li
           WHERE li.periodo_id = $${selectedPeriodParam} AND li.actividad_id = a.id
             AND NOT EXISTS (SELECT 1 FROM public.liquidacion_periodo_items s2 WHERE s2.periodo_id = $${selectedPeriodParam})
        ) effective_liquidation), '[]'::json)`
      : `COALESCE((SELECT json_agg(json_build_object(
          'id', li.id, 'participanteId', li.participante_id, 'tecnicoId', li.tecnico_id,
          'estado', li.estado, 'valorBase', li.valor_base, 'valorGanado', li.valor_ganado,
          'valorGanadoOriginal', li.valor_ganado_original, 'descuentoTardanza', li.descuento_tardanza,
          'porcentajeDescuentoTardanza', li.porcentaje_descuento_tardanza
        ) ORDER BY li.created_at)
        FROM public.liquidacion_items li
       WHERE li.periodo_id = $${selectedPeriodParam} AND li.actividad_id = a.id), '[]'::json)`
    : `COALESCE((SELECT json_agg(json_build_object(
          'id', li.id, 'participanteId', li.participante_id, 'tecnicoId', li.tecnico_id,
          'estado', li.estado, 'valorBase', li.valor_base, 'valorGanado', li.valor_ganado,
          'valorGanadoOriginal', li.valor_ganado_original, 'descuentoTardanza', li.descuento_tardanza,
          'porcentajeDescuentoTardanza', li.porcentaje_descuento_tardanza
        ) ORDER BY li.created_at) FROM public.liquidacion_items li WHERE li.actividad_id = a.id), '[]'::json)`;
  const hasPagination = payload.limit !== undefined || payload.offset !== undefined;
  let pagination = "";
  if (hasPagination) {
    const limit = Math.min(50, Math.max(1, Math.floor(number(payload.limit, 10))));
    const offset = Math.max(0, Math.floor(number(payload.offset)));
    values.push(limit);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;
    pagination = `LIMIT $${limitParam} OFFSET $${offsetParam}`;
  }
  const { rows } = await dbQuery(
    `SELECT a.*, c.nombre AS cliente_nombre, s.nombre AS sede_nombre, s.direccion AS sede_direccion,
            g.nombre AS grupo_nombre, g.lider_id AS grupo_lider_id,
            ca.id AS catalogo_actividad_id, ca.codigo AS catalogo_codigo, ca.nombre AS catalogo_nombre, ca.categoria AS catalogo_categoria, ac.especificacion,
            am.mantenimiento_programado_id, am.titulo AS mantenimiento_titulo,
            am.prioridad AS mantenimiento_prioridad, am.tipo_pendiente, am.descripcion_pendiente,
            am.receptor_nombre AS mantenimiento_receptor, am.firmado AS mantenimiento_firmado,
            av.tipo_visita, av.receptor_nombre AS visita_receptor, av.receptor_cedula, av.receptor_cargo,
            av.firmado AS visita_firmado, ar.punto_partida, ar.punto_llegada, ar.tipo_recorrido,
            ar.inicio_recorrido, ar.fin_recorrido,
            COALESCE((SELECT json_agg(json_build_object(
              'id', p.id, 'tecnicoId', p.tecnico_id, 'rol', p.rol_participacion,
              'mantenimientoParticipanteId', (SELECT mp.id
                FROM public.mantenimientos_programados_participantes mp
               WHERE mp.mantenimiento_id = am.mantenimiento_programado_id
                 AND mp.usuario_id = p.tecnico_id
               ORDER BY (mp.estado = 'activo') DESC, mp.created_at DESC
               LIMIT 1),
              'porcentaje', p.porcentaje, 'valorBase', p.valor_base, 'valorGanado', p.valor_ganado,
              'estadoReporte', COALESCE((SELECT d.estado FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id LIMIT 1), 'pendiente'),
              'entregaId', (SELECT d.id FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id LIMIT 1),
              'entregaObservaciones', (SELECT d.observaciones FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id ORDER BY d.updated_at DESC LIMIT 1),
              'entregaActividadesRealizadas', (SELECT d.actividades_realizadas FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id ORDER BY d.updated_at DESC LIMIT 1),
              'entregaTipoPendiente', (SELECT d.tipo_pendiente FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id ORDER BY d.updated_at DESC LIMIT 1),
              'entregaDescripcionPendiente', (SELECT d.descripcion_pendiente FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id ORDER BY d.updated_at DESC LIMIT 1),
              'entregaReceptorNombre', (SELECT d.receptor_nombre FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id ORDER BY d.updated_at DESC LIMIT 1),
              'entregaFirmado', COALESCE((SELECT d.firmado FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id ORDER BY d.updated_at DESC LIMIT 1), false),
              'entregaFirmaReceptorUrl', (SELECT d.firma_receptor_url FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id ORDER BY d.updated_at DESC LIMIT 1),
              'entregaFotoBitacoraUrl', (SELECT d.foto_bitacora_url FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id ORDER BY d.updated_at DESC LIMIT 1),
              'entregaEnviadoPorId', (SELECT d.enviado_por_id FROM public.actividades_operativas_entregas d WHERE d.actividad_id = p.actividad_id AND d.participante_id = p.id ORDER BY d.updated_at DESC LIMIT 1),
              'entregaEvidencias', COALESCE((SELECT json_agg(json_build_object(
                'id', e.id, 'participanteId', e.participante_id, 'tipo', e.tipo,
                'bucket', e.storage_bucket, 'key', e.storage_key, 'url', e.url,
                'orden', e.orden, 'subidoPorId', e.subido_por_id, 'fechaSubida', e.created_at
              ) ORDER BY e.tipo, e.orden, e.created_at)
                FROM public.actividades_operativas_evidencias e
               WHERE e.actividad_id = p.actividad_id AND e.participante_id = p.id), '[]'::json)
            ) ORDER BY p.created_at) FROM public.actividades_operativas_participantes p WHERE p.actividad_id = a.id), '[]'::json) AS participantes,
            COALESCE((SELECT json_agg(json_build_object(
              'id', ap.id, 'participanteId', ap.participante_id, 'revisorId', ap.revisor_id,
              'estado', ap.estado, 'comentario', ap.comentario, 'revisadoEn', ap.revisado_en
            ) ORDER BY ap.created_at) FROM public.actividades_operativas_aprobaciones ap WHERE ap.actividad_id = a.id), '[]'::json) AS aprobaciones,
            COALESCE((SELECT json_agg(json_build_object(
              'id', e.id, 'participanteId', e.participante_id, 'tipo', e.tipo, 'bucket', e.storage_bucket, 'key', e.storage_key, 'url', e.url, 'orden', e.orden, 'subidoPorId', e.subido_por_id
            ) ORDER BY e.tipo, e.orden) FROM public.actividades_operativas_evidencias e WHERE e.actividad_id = a.id), '[]'::json) AS evidencias,
            COALESCE((SELECT json_agg(json_build_object(
              'id', d.id, 'participanteId', d.participante_id, 'estado', d.estado,
              'observaciones', d.observaciones, 'fechaEjecucion', d.fecha_ejecucion,
              'actividadesRealizadas', d.actividades_realizadas, 'tipoPendiente', d.tipo_pendiente,
              'descripcionPendiente', d.descripcion_pendiente, 'receptorNombre', d.receptor_nombre,
              'firmado', d.firmado, 'firmaReceptorUrl', d.firma_receptor_url,
              'fotoBitacoraUrl', d.foto_bitacora_url, 'enviadoPorId', d.enviado_por_id,
              'enviadoEn', d.enviado_en
            ) ORDER BY d.created_at) FROM public.actividades_operativas_entregas d WHERE d.actividad_id = a.id), '[]'::json) AS entregas,
            ${periodLiquidationRows} AS liquidaciones,
            ${selectedPeriodParam !== null
              ? `(SELECT $${selectedPeriodParam}::uuid)`
              : `(SELECT p.id FROM public.periodos_liquidacion p WHERE a.fecha_operacion BETWEEN p.fecha_inicio AND p.fecha_fin ORDER BY p.fecha_inicio DESC LIMIT 1)`} AS periodo_id,
            ${selectedPeriodParam !== null && freezeSchemaReady
              ? `(SELECT EXISTS (SELECT 1 FROM public.liquidacion_periodo_items frozen_items WHERE frozen_items.periodo_id = $${selectedPeriodParam}))`
              : "false"} AS liquidacion_congelada,
            COUNT(*) OVER() AS total_count
       FROM public.actividades_operativas a
       LEFT JOIN public.clientes c ON c.id = a.cliente_id
       LEFT JOIN public.cliente_sedes s ON s.id = a.sede_id
       LEFT JOIN public.grupos_trabajo g ON g.id = a.grupo_id
       LEFT JOIN public.actividades_operativas_catalogo ac ON ac.actividad_id = a.id
       LEFT JOIN public.catalogo_actividades ca ON ca.id = ac.catalogo_actividad_id
       LEFT JOIN public.actividades_operativas_mantenimientos am ON am.actividad_id = a.id
       LEFT JOIN public.actividades_operativas_visitas av ON av.actividad_id = a.id
       LEFT JOIN public.actividades_operativas_recorridos ar ON ar.actividad_id = a.id
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY a.fecha_operacion DESC, a.created_at DESC
       ${pagination}`, values,
  );
  return rows;
}

function mapReport(row: any, participant: any, index: number): any {
  const type = row.tipo === "actividad" ? "actividad_grupal" : row.tipo === "mantenimiento" ? "mantenimiento_preventivo" : row.tipo;
  const isMaintenance = row.tipo === "mantenimiento";
  // For group activities, `a.descripcion` is the client/building text sent
  // by the mobile form. The catalog activity is the actual work performed
  // and must be the primary description shown by approvals, reports and
  // liquidation. Client and specification continue to travel in their own
  // fields, so this does not lose any context.
  const reportDescription = type === "actividad_grupal"
    ? row.catalogo_nombre || row.descripcion || ""
    : row.descripcion || row.catalogo_nombre || "";
  const allEvidence = jsonArray(row.evidencias);
  const deliveries = jsonArray(row.entregas);
  const participantDelivery = isMaintenance && participant?.id
    ? deliveries.find((item) => item?.participanteId === participant.id)
    : undefined;
  const canUseLegacyMaintenanceFields = Boolean(
    isMaintenance
      && participantDelivery
      && participantDelivery.enviadoPorId
      && (!participant?.tecnicoId || participantDelivery.enviadoPorId === participant.tecnicoId),
  );
  const evidence = isMaintenance && participant
    ? (jsonArray(participant.entregaEvidencias).length
      ? jsonArray(participant.entregaEvidencias)
      : allEvidence.filter((item) => item?.participanteId === participant.id
        || (!item?.participanteId && item?.subidoPorId && item.subidoPorId === participant.tecnicoId)))
    : allEvidence;
  const evidenceFallbackBucket = isMaintenance
    ? "fotos-mantenimientos"
    : row.tipo === "visita_tecnica"
      ? "fotos-visitas"
      : row.tipo === "recorrido"
        ? "fotos-recorridos"
        : "fotos-reportes";
  const ofType = (kind: string) => evidence
    .filter((item) => item.tipo === kind)
    .sort((a, b) => number(a.orden) - number(b.orden))
    .map((item) => maintenanceEvidenceUrl(item, evidenceFallbackBucket))
    .filter((url): url is string => Boolean(url));
  const deliveryBitacoraUrl = maintenanceEvidenceUrl(
    { url: participantDelivery?.fotoBitacoraUrl },
    isMaintenance ? "bitacoras-fotos" : evidenceFallbackBucket,
  );
  const deliverySignatureUrl = maintenanceEvidenceUrl(
    { url: participantDelivery?.firmaReceptorUrl },
    evidenceFallbackBucket,
  );
  const liquidation = jsonArray(row.liquidaciones).find((item) => item.participanteId === participant?.id || item.tecnicoId === participant?.tecnicoId);
  const approvals = jsonArray(row.aprobaciones);
  const approval = approvals.find((item) => item.participanteId === participant?.id)
    || (participant?.id ? approvals.find((item) => !item.participanteId) : approvals[0]);
  const participantBase = number(participant?.valorBase, number(row.valor_base));
  const participantPercentage = number(participant?.porcentaje, 100);
  const legacyAppliedAmount = number(row.valor_aplicado) * participantPercentage / 100;
  const storedParticipantAmount = number(participant?.valorGanado, legacyAppliedAmount);
  const normalizedParticipantAmount = !row.liquidacion_congelada && row.tipo !== "recorrido" && isLegacyAppliedValueCalculation({
    storedAmount: storedParticipantAmount,
    baseValue: participantBase,
    appliedValue: number(row.valor_aplicado),
    percentage: participantPercentage,
  })
    ? calculateLiquidationAmount(participantBase, participantPercentage)
    : storedParticipantAmount;
  // Older approved reports can exist without a corresponding liquidation row.
  // Keep them visible in the same approved-only source used by the mobile app;
  // the fallback is deterministic and does not create a duplicate database row.
  const effectiveLiquidation = liquidation || (!row.liquidacion_congelada && approval?.estado === "aprobada"
    ? {
        id: `fallback:${row.id}:${participant?.id || "activity"}:${row.periodo_id || "period"}`,
        estado: "aprobado",
        valorBase: participantBase,
        valorGanado: normalizedParticipantAmount,
        valorGanadoOriginal: normalizedParticipantAmount,
        descuentoTardanza: 0,
        porcentajeDescuentoTardanza: 0,
      }
    : undefined);
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const reportId = participant?.id ? `${row.id}:${participant.id}` : `${row.id}:${index}`;
  return {
    id: reportId,
    actividadOperativaId: row.id,
    participanteId: participant?.id,
    mantenimientoParticipanteId: participant?.mantenimientoParticipanteId || participant?.mantenimiento_participante_id || undefined,
    aprobacionId: approval?.id,
    codigoRegistro: row.codigo,
    tipo: type,
    actividadId: row.catalogo_actividad_id || undefined,
    actividadCodigo: row.catalogo_codigo || undefined,
    actividadNombre: row.catalogo_nombre || undefined,
    actividadCategoria: row.catalogo_categoria || undefined,
    mantenimientoId: row.tipo === "mantenimiento" ? row.mantenimiento_programado_id || undefined : undefined,
    visitaTecnicaId: row.tipo === "visita_tecnica" ? row.id : undefined,
    recorridoId: row.tipo === "recorrido" ? row.id : undefined,
    tipoVisita: row.tipo_visita || undefined,
    registroActividadId: row.tipo === "actividad" ? row.id : undefined,
    tecnicoId: participant?.tecnicoId || row.creado_por_id,
    reportadoPorId: row.creado_por_id,
    liderGrupoId: row.grupo_lider_id,
    grupoId: row.grupo_id,
    porcentajeParticipacion: number(participant?.porcentaje, 100),
    fecha: dateOnly(row.fecha_operacion) || "",
    clienteId: row.cliente_id,
    descripcion: reportDescription,
    actividadesRealizadas: isMaintenance
      ? participantDelivery?.actividadesRealizadas || (canUseLegacyMaintenanceFields ? metadata.actividadesRealizadas : undefined)
      : metadata.actividadesRealizadas || row.catalogo_nombre || undefined,
    especificacion: row.especificacion || metadata.especificacion || undefined,
    observaciones: isMaintenance
      ? participantDelivery?.observaciones || (canUseLegacyMaintenanceFields ? row.observaciones : undefined)
      : row.observaciones || undefined,
    fotoEvidencia: ofType("general")[0],
    fotosAntes: ofType("antes"),
    fotosDespues: ofType("despues"),
    firmaReceptor: isMaintenance
      ? deliverySignatureUrl || ofType("firma")[0]
      : ofType("firma")[0],
    datosReceptor: isMaintenance
      ? (participantDelivery?.receptorNombre ? { nombre: participantDelivery.receptorNombre, cedula: "", cargo: "" } : (canUseLegacyMaintenanceFields ? metadata.datosReceptor : undefined))
      : metadata.datosReceptor || (row.visita_receptor ? { nombre: row.visita_receptor, cedula: row.receptor_cedula || "", cargo: row.receptor_cargo || "" } : undefined),
    bitacora: isMaintenance
      ? Boolean(deliveryBitacoraUrl || ofType("bitacora").length > 0)
      : ofType("bitacora").length > 0,
    fotoBitacora: isMaintenance
      ? deliveryBitacoraUrl || ofType("bitacora")[0]
      : ofType("bitacora")[0],
    estadoEntrega: participant?.estadoReporte || participantDelivery?.estado || "pendiente",
    puntoPartida: row.punto_partida,
    puntoLlegada: row.punto_llegada,
    tipoRecorrido: row.tipo_recorrido === "con_herramienta" ? "con_herramienta" : row.tipo_recorrido === "normal" ? "normal" : undefined,
    fotoHerramienta: ofType("herramienta")[0],
    estadoAprobacionLider: approval?.estado === "aprobada" ? "aprobado" : approval?.estado === "rechazada" ? "rechazado" : "pendiente",
    fechaAprobacionLider: approval?.revisadoEn ? dateOnly(approval.revisadoEn) : undefined,
    costoCliente: row.valor_cliente == null ? undefined : number(row.valor_cliente),
    costoActividadDefault: number(row.valor_base),
    valorSugerido: row.valor_sugerido == null ? undefined : number(row.valor_sugerido),
    valorSugeridoGlobal: row.valor_sugerido == null ? undefined : number(row.valor_sugerido),
    motivoSugerenciaValor: row.motivo_modificacion_valor || undefined,
    // A recorrido can have a real administrative value different from the
    // configured snapshot. Keep that fact in the API response so the web
    // does not replace it with the current default after a reload.
    valorModificado: (row.tipo === "recorrido" && Math.abs(number(row.valor_aplicado) - number(row.valor_base)) > 0.01)
      || (row.valor_sugerido != null && number(row.valor_sugerido) !== number(row.valor_base)),
    motivoModificacionValor: row.motivo_modificacion_valor || undefined,
    costoActividad: normalizedParticipantAmount,
    participantes: jsonArray(row.participantes),
    liquidacionId: effectiveLiquidation?.id,
    liquidacionEstado: effectiveLiquidation?.estado,
    liquidacionCongelada: Boolean(row.liquidacion_congelada),
    liquidacionValorBase: effectiveLiquidation ? number(effectiveLiquidation.valorBase) : undefined,
    liquidacionValorGanado: effectiveLiquidation ? number(effectiveLiquidation.valorGanado) : undefined,
    liquidacionValorGanadoOriginal: effectiveLiquidation ? number(effectiveLiquidation.valorGanadoOriginal) : undefined,
    liquidacionDescuentoTardanza: effectiveLiquidation ? number(effectiveLiquidation.descuentoTardanza) : undefined,
    liquidacionPorcentajeDescuentoTardanza: effectiveLiquidation ? number(effectiveLiquidation.porcentajeDescuentoTardanza) : undefined,
    costoAdministrable: Boolean(row.costo_administrable),
    firmado: row.tipo === "visita_tecnica" ? Boolean(row.visita_firmado) : row.tipo === "mantenimiento" ? Boolean(participantDelivery?.firmado || participantDelivery?.firmaReceptorUrl || (canUseLegacyMaintenanceFields && row.mantenimiento_firmado)) : false,
    correoEnviado: Boolean(metadata.correoEnviado),
    fechaUltimoEnvioCorreo: metadata.fechaUltimoEnvioCorreo || undefined,
    periodoId: row.periodo_id || metadata.periodoId || "",
    fechaCreacion: dateOnly(row.created_at) || "",
    esHistoricoContrato: Boolean(metadata.esHistoricoContrato),
    valorActividadBaseGlobal: number(row.valor_base),
    valorActividadAplicadoGlobal: number(row.valor_aplicado),
    clienteNombre: row.cliente_nombre,
    sedeNombre: row.sede_nombre,
    sedeDireccion: row.sede_direccion,
  };
}

function mapReportRows(rows: any[], payload: Payload = {}) {
  return rows.flatMap((row) => {
    const participants = jsonArray(row.participantes);
    const scopedParticipants = payload.participantOnly && payload.tecnicoId
      ? participants.filter((participant) => participant?.tecnicoId === payload.tecnicoId)
      : participants;
    return (scopedParticipants.length ? scopedParticipants : [null]).map((participant, index) => mapReport(row, participant, index));
  });
}

async function reportRows(payload: Payload = {}) {
  return mapReportRows(await activityRows(payload), payload);
}

async function reportPageRows(payload: Payload = {}) {
  const limit = Math.min(50, Math.max(1, Math.floor(number(payload.limit, 10))));
  const offset = Math.max(0, Math.floor(number(payload.offset)));
  const rows = await activityRows({ ...payload, limit, offset });
  const items = mapReportRows(rows, payload);
  const total = number(rows[0]?.total_count, 0);
  return {
    items,
    page: Math.floor(offset / limit),
    pageSize: limit,
    total,
    hasMore: offset + rows.length < total,
  };
}

function currentMonthRange(referenceDate = bogotaClock().date) {
  const [year, month] = referenceDate.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startDate: monthStart,
    endDate: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * A scheduled maintenance is globally delivered only after every active
 * participant has an operational delivery. A single technician's delivery
 * must never remove the maintenance from the admin's pending/overdue views.
 */
function anySubmittedMaintenanceDeliveryPredicate(scheduleAlias = "m") {
  return `EXISTS (
    SELECT 1
      FROM public.actividades_operativas_mantenimientos am_any
      JOIN public.actividades_operativas_participantes ap_any
        ON ap_any.actividad_id = am_any.actividad_id
      JOIN public.actividades_operativas_entregas d_any
        ON d_any.actividad_id = ap_any.actividad_id
       AND d_any.participante_id = ap_any.id
     WHERE am_any.mantenimiento_programado_id = ${scheduleAlias}.id
       AND d_any.estado IN ('enviada', 'aprobada')
       AND COALESCE(d_any.fecha_ejecucion, ${BOGOTA_DATE_SQL}) <= ${BOGOTA_DATE_SQL}
  )`;
}

function allSubmittedMaintenanceDeliveryPredicate(scheduleAlias = "m", dateRange?: { start: string; end: string }) {
  const rangeFilter = dateRange
    ? `
         AND COALESCE(d_all.fecha_ejecucion, ${scheduleAlias}.fecha_realizado, ${scheduleAlias}.fecha_programada)
             BETWEEN ${dateRange.start}::date AND ${dateRange.end}::date`
    : "";
  return `EXISTS (
    SELECT 1
      FROM public.mantenimientos_programados_participantes mp_all
     WHERE mp_all.mantenimiento_id = ${scheduleAlias}.id
       AND mp_all.estado = 'activo'
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public.mantenimientos_programados_participantes mp_missing
     WHERE mp_missing.mantenimiento_id = ${scheduleAlias}.id
       AND mp_missing.estado = 'activo'
       AND NOT EXISTS (
         SELECT 1
           FROM public.actividades_operativas_mantenimientos am_all
           JOIN public.actividades_operativas_participantes ap_all
             ON ap_all.actividad_id = am_all.actividad_id
            AND ap_all.tecnico_id = mp_missing.usuario_id
           JOIN public.actividades_operativas_entregas d_all
             ON d_all.actividad_id = ap_all.actividad_id
            AND d_all.participante_id = ap_all.id
          WHERE am_all.mantenimiento_programado_id = ${scheduleAlias}.id
            AND d_all.estado IN ('enviada', 'aprobada')
            AND COALESCE(d_all.fecha_ejecucion, ${BOGOTA_DATE_SQL}) <= ${BOGOTA_DATE_SQL}${rangeFilter}
       )
   )`;
}

function partiallySubmittedMaintenanceDeliveryPredicate(scheduleAlias = "m") {
  const anyDelivery = anySubmittedMaintenanceDeliveryPredicate(scheduleAlias);
  const allDeliveries = allSubmittedMaintenanceDeliveryPredicate(scheduleAlias);
  return `((${anyDelivery}) AND NOT (${allDeliveries}))`;
}

/**
 * Keeps legacy rows that were already closed without an operational delivery,
 * but reopens the effective global state of rows that were incorrectly closed
 * after only one of several participants delivered.
 */
function globallyCompletedMaintenancePredicate(scheduleAlias = "m", scheduledDateExpression?: string) {
  const partialDelivery = partiallySubmittedMaintenanceDeliveryPredicate(scheduleAlias);
  const allDeliveries = allSubmittedMaintenanceDeliveryPredicate(scheduleAlias);
  // A future-dated schedule cannot be completed, even if a legacy/imported
  // row was stored with estado=ejecutado or contains a delivery timestamp in
  // the future. Otherwise it disappears from Próximos and is shown as
  // Historial before its scheduled day.
  const scheduleHasStarted = `${scheduledDateExpression || `${scheduleAlias}.fecha_programada`} <= ${BOGOTA_DATE_SQL}`;
  return `(${scheduleHasStarted} AND (((${scheduleAlias}.admin_completado_at IS NOT NULL) OR (${scheduleAlias}.estado IN ('ejecutado', 'completado', 'realizado') AND NOT (${partialDelivery})) OR (${allDeliveries}))))`;
}

async function dashboardMetrics(payload: Payload = {}) {
  const clock = bogotaClock();
  const scheduledDateExpression = maintenanceScheduledDateSql("m", "cm");
  const maintenanceDueAt = maintenanceDueAtSql("m", scheduledDateExpression);
  let startDate = dateOnly(payload.startDate) || currentMonthRange(clock.date).startDate;
  let endDate = dateOnly(payload.endDate) || currentMonthRange(clock.date).endDate;

  if (payload.periodoId) {
    const { rows: periodRowsResult } = await dbQuery(
      "SELECT fecha_inicio, fecha_fin FROM public.periodos_liquidacion WHERE id = $1",
      [payload.periodoId],
    );
    if (!periodRowsResult[0]) throw new Error("No se encontró el período solicitado.");
    startDate = dateOnly(periodRowsResult[0].fecha_inicio) || startDate;
    endDate = dateOnly(periodRowsResult[0].fecha_fin) || endDate;
  }

  if (startDate > endDate) throw new Error("El rango de métricas no es válido.");

  // These predicates are shared by the dashboard counters and the
  // maintenance inbox. A multi-technician maintenance is complete only when
  // every active participant has sent a delivery. This prevents one delivery
  // from hiding the maintenance from pending/overdue views or inflating the
  // completed counters.
  const globallyCompletedMaintenance = globallyCompletedMaintenancePredicate("m", scheduledDateExpression);
  const partiallySubmittedMaintenanceDelivery = partiallySubmittedMaintenanceDeliveryPredicate();
  const allSubmittedMaintenanceDeliveryInRange = allSubmittedMaintenanceDeliveryPredicate("m", { start: "$1", end: "$2" });
  const globallyCompletedMaintenanceForMetric = globallyCompletedMaintenancePredicate(
    "m_metric",
    maintenanceScheduledDateSql("m_metric", "cm_metric"),
  );
  const globallyCompletedMaintenanceForActivity = globallyCompletedMaintenancePredicate(
    "m_report",
    maintenanceScheduledDateSql("m_report", "cm_report"),
  );
  const completedMaintenanceInRange = `(
    (${globallyCompletedMaintenance})
    AND COALESCE(m.fecha_realizado, ${scheduledDateExpression}) BETWEEN $1::date AND $2::date
    OR ${allSubmittedMaintenanceDeliveryInRange}
  )`;

  const { rows } = await dbQuery(
    `SELECT
       (SELECT COUNT(*)::int
         FROM public.mantenimientos_programados m
         LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
         WHERE ${scheduledDateExpression} BETWEEN $1::date AND $2::date
           AND ${maintenanceDueAt} >= ${BOGOTA_NOW_SQL}
           AND m.estado IN ('programado', 'asignado')
           AND NOT (${globallyCompletedMaintenance})) AS programados,
       (SELECT COUNT(*)::int
          FROM public.mantenimientos_programados m
         WHERE m.fecha_programada BETWEEN $1::date AND $2::date
           AND m.estado IN ('en_ejecucion', 'en_progreso')) AS en_ejecucion,
       (SELECT COUNT(*)::int
          FROM public.mantenimientos_programados m
         LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
         WHERE m.estado <> 'cancelado'
           AND (${completedMaintenanceInRange})) AS mantenimientos_agenda_realizados,
       (SELECT COUNT(*)::int
          FROM public.mantenimientos_programados m
         LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
         WHERE ${scheduledDateExpression} <= $2::date
           AND (
             m.estado IN ('pendiente', 'programado', 'asignado', 'en_ejecucion', 'en_progreso')
             OR (${partiallySubmittedMaintenanceDelivery})
           )
           AND NOT (${globallyCompletedMaintenance})) AS pendientes,
       (SELECT COUNT(*)::int
          FROM (
            SELECT DISTINCT am_metric.mantenimiento_programado_id::text AS canonical_id
              FROM public.actividades_operativas a_metric
              JOIN public.actividades_operativas_mantenimientos am_metric
                ON am_metric.actividad_id = a_metric.id
              JOIN public.mantenimientos_programados m_report
                ON m_report.id = am_metric.mantenimiento_programado_id
              LEFT JOIN public.contratos_mantenimiento cm_report
                ON cm_report.id = m_report.contrato_id
             WHERE a_metric.tipo = 'mantenimiento'
               AND a_metric.estado IN ('pendiente_aprobacion', 'completada', 'aprobada', 'ejecutado')
               AND a_metric.fecha_operacion BETWEEN $1::date AND $2::date
               AND ${globallyCompletedMaintenanceForActivity}
            UNION
            SELECT DISTINCT 'actividad:' || a_metric.id::text AS canonical_id
              FROM public.actividades_operativas a_metric
              LEFT JOIN public.actividades_operativas_mantenimientos am_metric
                ON am_metric.actividad_id = a_metric.id
             WHERE a_metric.tipo = 'mantenimiento'
               AND am_metric.mantenimiento_programado_id IS NULL
               AND a_metric.estado IN ('pendiente_aprobacion', 'completada', 'aprobada', 'ejecutado')
               AND a_metric.fecha_operacion BETWEEN $1::date AND $2::date
            UNION
            SELECT m_metric.id::text AS canonical_id
              FROM public.mantenimientos_programados m_metric
              LEFT JOIN public.contratos_mantenimiento cm_metric
                ON cm_metric.id = m_metric.contrato_id
             WHERE ${globallyCompletedMaintenanceForMetric}
               AND COALESCE(m_metric.fecha_realizado, ${maintenanceScheduledDateSql("m_metric", "cm_metric")}) BETWEEN $1::date AND $2::date
          ) reported_maintenance
        ) AS mantenimientos_reportados,
       (SELECT COUNT(DISTINCT a.id)::int
          FROM public.actividades_operativas a
         WHERE a.fecha_operacion BETWEEN $1::date AND $2::date
           AND a.estado <> 'cancelada') AS reportes_generados,
       (SELECT COUNT(*)::int
          FROM public.usuarios u
         WHERE u.rol = 'tecnico' AND u.estado = 'activo') AS tecnicos_activos,
       (SELECT COUNT(*)::int
          FROM public.mantenimientos_programados m
         LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
         WHERE ${maintenanceDueAt} < ${BOGOTA_NOW_SQL}
           AND (
             m.estado IN ('pendiente', 'programado', 'asignado', 'en_ejecucion', 'en_progreso')
             OR (${partiallySubmittedMaintenanceDelivery})
           )
           AND NOT (${globallyCompletedMaintenance})) AS vencidos
    `,
    [startDate, endDate],
  );
  const row = rows[0] || {};
  return {
    startDate,
    endDate,
    today: clock.date,
    generatedAt: new Date().toISOString(),
    programados: number(row.programados),
    enEjecucion: number(row.en_ejecucion),
    realizados: number(row.mantenimientos_reportados),
    mantenimientosAgendaRealizados: number(row.mantenimientos_agenda_realizados),
    pendientes: number(row.pendientes),
    vencidos: number(row.vencidos),
    reportesGenerados: number(row.reportes_generados),
    tecnicosActivos: number(row.tecnicos_activos),
  };
}

async function overdueMaintenanceRows(payload: Payload = {}) {
  const today = bogotaClock().date;
  const values: unknown[] = [];
  const scheduledDateExpression = maintenanceScheduledDateSql();
  const globallyCompletedMaintenance = globallyCompletedMaintenancePredicate("m", scheduledDateExpression);
  const partiallySubmittedMaintenanceDelivery = partiallySubmittedMaintenanceDeliveryPredicate();
  const maintenanceDueAt = maintenanceDueAtSql("m", scheduledDateExpression);
  const filters = [
    `${maintenanceDueAt} < ${BOGOTA_NOW_SQL}`,
    `(
      m.estado IN ('pendiente', 'programado', 'asignado', 'en_ejecucion', 'en_progreso')
      OR (${partiallySubmittedMaintenanceDelivery})
    )`,
    `NOT (${globallyCompletedMaintenance})`,
  ];
  if (payload.clienteId) {
    values.push(payload.clienteId);
    filters.push(`m.cliente_id = $${values.length}`);
  }
  if (payload.grupoId) {
    values.push(payload.grupoId);
    filters.push(`m.grupo_id = $${values.length}`);
  }
  const { rows } = await dbQuery(
    `SELECT m.*, ${scheduledDateExpression} AS fecha_programada_efectiva,
        c.nombre AS cliente_nombre, s.nombre AS sede_nombre, g.lider_id AS lider_id,
       COALESCE((SELECT json_agg(json_build_object(
          'id', mp.id,
          'usuario_id', mp.usuario_id,
          'rol_participacion', mp.rol_participacion,
          'porcentaje', mp.porcentaje,
          'valor_calculado', mp.valor_ganado,
          'estado', mp.estado,
          'estado_reporte', 'pendiente'
        ) ORDER BY mp.rol_participacion = 'principal' DESC, mp.created_at)
          FROM public.mantenimientos_programados_participantes mp
         WHERE mp.mantenimiento_id = m.id AND mp.estado = 'activo'), '[]'::json) AS participantes
       FROM public.mantenimientos_programados m
       JOIN public.clientes c ON c.id = m.cliente_id
       LEFT JOIN public.cliente_sedes s ON s.id = m.sede_id
       LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
       LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
      WHERE ${filters.join(" AND ")}
      ORDER BY ${maintenanceDueAt} DESC, m.created_at DESC` ,
    values,
  );
  return {
    today,
    generatedAt: new Date().toISOString(),
    total: rows.length,
    items: rows.map(mapMaintenance),
  };
}

async function getLiveLiquidationRows(periodId: string, technicianIds?: string[] | null) {
  const freezeSchemaReady = await hasLiquidationFreezeSchema();
  const carryExpression = freezeSchemaReady ? "COALESCE(li.es_arrastre, false)" : "false";
  const periodMembershipExpression = `EXISTS (
      SELECT 1 FROM public.liquidacion_items li_period
       WHERE li_period.periodo_id = pl.id
         AND li_period.actividad_id = a.id
    )${freezeSchemaReady ? `
      OR EXISTS (
        SELECT 1 FROM public.liquidacion_periodo_items snapshot_period
         WHERE snapshot_period.periodo_id = pl.id
           AND snapshot_period.actividad_id = a.id
      )` : ""}`;
  const liveBaseValueSql = "COALESCE(li.valor_base, p.valor_base, a.valor_base, 0)";
  const livePercentageSql = "COALESCE(li.porcentaje, p.porcentaje, 0)";
  const liveStoredGrossSql = `COALESCE(li.valor_ganado_original, p.valor_ganado, a.valor_aplicado * ${livePercentageSql} / 100)`;
  const liveGrossSql = `CASE
    WHEN a.tipo <> 'recorrido'
      AND ${liveBaseValueSql} > 0
      AND ABS(${liveBaseValueSql} - COALESCE(a.valor_aplicado, 0)) > 0.01
      AND ABS(${liveStoredGrossSql} - (COALESCE(a.valor_aplicado, 0) * ${livePercentageSql} / 100)) <= 0.01
    THEN ROUND(${liveBaseValueSql} * ${livePercentageSql} / 100, 2)
    ELSE ${liveStoredGrossSql}
  END`;
  const values: unknown[] = [periodId];
  const scope = technicianIds && technicianIds.length > 0
    ? (() => {
        values.push(technicianIds);
        return "AND p.tecnico_id = ANY($2::uuid[])";
      })()
    : "";

  const { rows } = await dbQuery(
    `SELECT
        COALESCE(li.id::text, 'fallback:' || a.id::text || ':' || p.id::text || ':' || pl.id::text) AS id,
        a.id AS actividad_id,
        a.codigo,
        a.descripcion,
        a.tipo,
        a.fecha_operacion,
        a.cliente_id,
        a.sede_id,
        a.grupo_id,
        g.nombre AS grupo_nombre,
        g.lider_id AS grupo_lider_id,
        c.nombre AS cliente_nombre,
        s.nombre AS sede_nombre,
        COALESCE(li.periodo_id, pl.id) AS periodo_id,
        p.id AS participante_id,
        p.tecnico_id,
        u.nombre,
        u.apellido,
        u.email,
        u.rol,
        ${livePercentageSql} AS porcentaje,
        ${liveBaseValueSql} AS valor_base,
        CASE
          WHEN a.tipo <> 'recorrido' AND GREATEST(
            COALESCE(li.porcentaje_descuento_tardanza, 0),
            COALESCE(attendance_discount.porcentaje, 0)
          ) > 0 THEN ROUND(
            ${liveGrossSql}
            * (1 - GREATEST(
              COALESCE(li.porcentaje_descuento_tardanza, 0),
              COALESCE(attendance_discount.porcentaje, 0)
            ) / 100), 2)
          WHEN ${liveGrossSql} <> ${liveStoredGrossSql} THEN ${liveGrossSql}
          ELSE COALESCE(li.valor_ganado, p.valor_ganado, a.valor_aplicado * ${livePercentageSql} / 100)
        END AS valor_ganado,
        ${liveGrossSql} AS valor_ganado_original,
        CASE WHEN a.tipo <> 'recorrido' THEN ROUND(
          ${liveGrossSql}
          * GREATEST(COALESCE(li.porcentaje_descuento_tardanza, 0), COALESCE(attendance_discount.porcentaje, 0)) / 100, 2)
          ELSE 0 END AS descuento_tardanza,
        CASE WHEN a.tipo <> 'recorrido' THEN GREATEST(
          COALESCE(li.porcentaje_descuento_tardanza, 0),
          COALESCE(attendance_discount.porcentaje, 0)
        ) ELSE 0 END AS porcentaje_descuento_tardanza,
        CASE
          WHEN li.estado IN ('anulado', 'rechazado') THEN 'anulado'
          WHEN li.estado IN ('aprobado', 'pagado')
            OR EXISTS (
              SELECT 1 FROM public.actividades_operativas_aprobaciones ap
               WHERE ap.actividad_id = a.id AND ap.participante_id = p.id AND ap.estado = 'aprobada'
            )
            OR (a.tipo = 'mantenimiento' AND EXISTS (
              SELECT 1 FROM public.actividades_operativas_aprobaciones ap
               WHERE ap.actividad_id = a.id AND ap.participante_id IS NULL AND ap.estado = 'aprobada'
            )) THEN 'aprobado'
          ELSE 'pendiente'
        END AS estado_liquidacion,
        ${carryExpression} AS es_arrastre,
        0::numeric AS extra_lider_porcentaje,
        false AS extra_lider_activo,
        COALESCE(li.created_at, a.created_at) AS created_at
     FROM public.actividades_operativas a
     JOIN public.periodos_liquidacion pl ON pl.id = $1
     JOIN public.actividades_operativas_participantes p ON p.actividad_id = a.id
     JOIN public.usuarios u ON u.id = p.tecnico_id
     LEFT JOIN public.liquidacion_items li
       ON li.periodo_id = pl.id
      AND li.actividad_id = a.id
      AND li.participante_id = p.id
     LEFT JOIN public.grupos_trabajo g ON g.id = a.grupo_id
     LEFT JOIN public.clientes c ON c.id = a.cliente_id
     LEFT JOIN public.cliente_sedes s ON s.id = a.sede_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(MAX(r.porcentaje_descuento), 0) AS porcentaje
         FROM public.registros_asistencia r
        WHERE pl.estado = 'abierto'
          AND r.usuario_id = p.tecnico_id
          AND r.fecha BETWEEN pl.fecha_inicio AND pl.fecha_fin
          AND r.descuento_aplicado = true
     ) attendance_discount ON true
    WHERE a.estado NOT IN ('cancelada', 'rechazada')
      AND (a.fecha_operacion BETWEEN pl.fecha_inicio AND pl.fecha_fin OR ${periodMembershipExpression} OR ${carryExpression})
      ${scope}
    ORDER BY a.fecha_operacion DESC, COALESCE(li.created_at, a.created_at) DESC, p.id` ,
    values,
  );

  return rows;
}

function isMissingLiquidationSnapshot(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  const message = String(candidate?.message || error || "").toLowerCase();
  return candidate?.code === "42P01" || message.includes("liquidacion_periodo_items") || message.includes("es_arrastre");
}

type LeaderExtraConfiguration = {
  percentage: number;
  active: boolean;
  excludedIds: string[];
};

function isMissingLeaderExtraConfiguration(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  const message = String(candidate?.message || error || "").toLowerCase();
  return candidate?.code === "42P01" || message.includes("acumulacion_lideres");
}

async function getLeaderExtraConfigurations(periodId: string): Promise<Map<string, LeaderExtraConfiguration>> {
  try {
    const { rows } = await dbQuery(
      `SELECT lider_id, porcentaje_extra_lider_aplicado, extra_lider_activo,
              COALESCE(tecnicos_excluidos_extra_ids, '{}'::uuid[]) AS tecnicos_excluidos_extra_ids
         FROM public.acumulacion_lideres
        WHERE periodo_id = $1`,
      [periodId],
    );
    return new Map(rows.map((row) => [String(row.lider_id), {
      percentage: number(row.porcentaje_extra_lider_aplicado),
      active: Boolean(row.extra_lider_activo),
      excludedIds: uniqueIds(jsonArray(row.tecnicos_excluidos_extra_ids).map((id) => String(id))),
    }]));
  } catch (error) {
    // Keep older deployments functional until the additive migration is
    // applied. Saving the configuration still fails with a clear message.
    if (isMissingLeaderExtraConfiguration(error)) return new Map();
    throw error;
  }
}

async function upsertLeaderExtraConfiguration(payload: Payload) {
  const liderId = String(payload.liderId || "").trim();
  const periodoId = String(payload.periodoId || "").trim();
  const percentage = number(payload.porcentaje, Number.NaN);
  if (!liderId || !periodoId) throw new Error("Debes indicar el líder y el período.");
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("El porcentaje del extra líder debe estar entre 0 y 100.");
  }

  const excludedIds = uniqueIds(idList(payload.tecnicosExcluidosExtraIds));
  const { rows: leaderRows } = await dbQuery(
    `SELECT u.id
       FROM public.usuarios u
      WHERE u.id = $1
        AND (u.rol = 'lider' OR EXISTS (
          SELECT 1 FROM public.grupos_trabajo g
           WHERE g.lider_id = u.id AND g.estado = 'activo'
        ))`,
    [liderId],
  );
  if (!leaderRows[0]) throw new Error("No se encontró el líder seleccionado.");

  const { rows: periodRows } = await dbQuery(
    "SELECT id FROM public.periodos_liquidacion WHERE id = $1",
    [periodoId],
  );
  if (!periodRows[0]) throw new Error("No se encontró el período seleccionado.");

  if (excludedIds.length > 0) {
    const { rows: eligibleRows } = await dbQuery(
      `SELECT DISTINCT gm.usuario_id
         FROM public.grupo_miembros gm
         JOIN public.grupos_trabajo g ON g.id = gm.grupo_id
        WHERE g.lider_id = $1 AND g.estado = 'activo'
          AND gm.fecha_inicio <= ${BOGOTA_DATE_SQL}
          AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= ${BOGOTA_DATE_SQL})`,
      [liderId],
    );
    const eligibleIds = new Set(eligibleRows.map((row) => String(row.usuario_id)));
    const invalidIds = excludedIds.filter((id) => !eligibleIds.has(id));
    if (invalidIds.length > 0) throw new Error("Solo puedes excluir técnicos que pertenezcan al grupo activo de este líder.");
  }

  try {
    const { rows } = await dbQuery(
      `INSERT INTO public.acumulacion_lideres (
          lider_id, periodo_id, porcentaje_extra_lider_aplicado,
          extra_lider_activo, tecnicos_excluidos_extra_ids, fecha_actualizacion
       ) VALUES ($1, $2, $3, $4, $5::uuid[], clock_timestamp())
       ON CONFLICT (lider_id, periodo_id) DO UPDATE SET
          porcentaje_extra_lider_aplicado = EXCLUDED.porcentaje_extra_lider_aplicado,
          extra_lider_activo = EXCLUDED.extra_lider_activo,
          tecnicos_excluidos_extra_ids = EXCLUDED.tecnicos_excluidos_extra_ids,
          fecha_actualizacion = clock_timestamp()
       RETURNING lider_id, periodo_id, porcentaje_extra_lider_aplicado,
                 extra_lider_activo, tecnicos_excluidos_extra_ids`,
      [liderId, periodoId, percentage, payload.activo === true, excludedIds],
    );
    const row = rows[0];
    return {
      liderId: String(row.lider_id),
      periodoId: String(row.periodo_id),
      porcentajeExtraLiderAplicado: number(row.porcentaje_extra_lider_aplicado),
      extraLiderActivo: Boolean(row.extra_lider_activo),
      tecnicosExcluidosExtraIds: uniqueIds(jsonArray(row.tecnicos_excluidos_extra_ids).map((id) => String(id))),
    };
  } catch (error) {
    if (isMissingLeaderExtraConfiguration(error)) {
      throw new Error("Falta aplicar la migración de configuración del extra líder por período.");
    }
    throw error;
  }
}

async function getLiquidationSnapshotRows(periodId: string, technicianIds?: string[] | null): Promise<any[] | null> {
  const values: unknown[] = [periodId];
  const scope = technicianIds && technicianIds.length > 0
    ? (() => {
        values.push(technicianIds);
        return "AND s.tecnico_id = ANY($2::uuid[])";
      })()
    : "";
  try {
    const { rows } = await dbQuery(
      `SELECT
          s.id,
          s.actividad_id,
          COALESCE(s.codigo_snapshot, a.codigo) AS codigo,
          s.descripcion_snapshot AS descripcion,
          s.tipo,
          s.fecha_operacion,
          s.cliente_id,
          s.sede_id,
          s.grupo_id,
          COALESCE(s.grupo_lider_id, g.lider_id) AS grupo_lider_id,
          g.nombre AS grupo_nombre,
          c.nombre AS cliente_nombre,
          COALESCE(s.sede_snapshot, sede.nombre) AS sede_nombre,
          s.periodo_id,
          s.participante_id,
          s.tecnico_id,
          u.nombre,
          u.apellido,
          u.email,
          u.rol,
          s.porcentaje,
          s.valor_base,
          s.valor_ganado,
          s.valor_ganado_original,
          s.descuento_tardanza,
          s.porcentaje_descuento_tardanza,
          s.estado AS estado_liquidacion,
          s.extra_lider_porcentaje,
          s.extra_lider_activo,
          s.es_arrastre,
          s.fecha_snapshot AS created_at
       FROM public.liquidacion_periodo_items s
       LEFT JOIN public.actividades_operativas a ON a.id = s.actividad_id
       LEFT JOIN public.usuarios u ON u.id = s.tecnico_id
       LEFT JOIN public.grupos_trabajo g ON g.id = s.grupo_id
       LEFT JOIN public.clientes c ON c.id = s.cliente_id
       LEFT JOIN public.cliente_sedes sede ON sede.id = s.sede_id
      WHERE s.periodo_id = $1 ${scope}
      ORDER BY s.fecha_operacion DESC, s.fecha_snapshot DESC, s.participante_id` ,
      values,
    );
    if (rows.length > 0) return rows;
    // Some older closed periods have no frozen snapshot because they were
    // closed before the snapshot migration. An empty table is not evidence
    // that the period had no liquidation rows; let callers fall back to live
    // liquidation items in that case, even when the period is closed.
    return null;
  } catch (error) {
    if (isMissingLiquidationSnapshot(error)) return null;
    throw error;
  }
}

async function getLiquidationRows(periodId: string, technicianIds?: string[] | null) {
  const snapshotRows = await getLiquidationSnapshotRows(periodId, technicianIds);
  return snapshotRows !== null ? snapshotRows : getLiveLiquidationRows(periodId, technicianIds);
}

async function freezeLiquidationPeriod(periodId: string) {
  if (!(await hasLiquidationFreezeSchema())) {
    throw new Error("Falta aplicar la migración 029 de congelamiento de liquidaciones antes de cerrar el período.");
  }
  return withTransaction(async (client) => {
    const { rows: periodRows } = await client.query(
      `SELECT id, fecha_inicio, fecha_fin, estado, fecha_cierre
         FROM public.periodos_liquidacion
        WHERE id = $1
        FOR UPDATE`,
      [periodId],
    );
    const period = periodRows[0];
    if (!period) throw new Error("No se encontró el período de liquidación.");
    if (period.estado === "cerrado") return { ...period, congelado: true, snapshotRows: 0, arrastreRows: 0 };

    const { rows: configRows } = await client.query(
      "SELECT porcentaje_extra_lider, extra_lider_activo FROM public.configuracion_empresa WHERE id = 1",
    );
    const extraPercentage = Math.max(0, Math.min(100, number(configRows[0]?.porcentaje_extra_lider)));
    const extraActive = Boolean(configRows[0]?.extra_lider_activo);
    const freezePercentageSql = "COALESCE(li.porcentaje, p.porcentaje, 0)";
    const freezeBaseSql = "COALESCE(li.valor_base, p.valor_base, a.valor_base, 0)";
    const freezeStoredGrossSql = `COALESCE(li.valor_ganado_original, p.valor_ganado, a.valor_aplicado * ${freezePercentageSql} / 100, 0)`;
    const freezeGrossSql = `CASE
      WHEN a.tipo <> 'recorrido'
        AND ${freezeBaseSql} > 0
        AND ABS(${freezeBaseSql} - COALESCE(a.valor_aplicado, 0)) > 0.01
        AND ABS(${freezeStoredGrossSql} - (COALESCE(a.valor_aplicado, 0) * ${freezePercentageSql} / 100)) <= 0.01
      THEN ROUND(${freezeBaseSql} * ${freezePercentageSql} / 100, 2)
      ELSE ${freezeStoredGrossSql}
    END`;
    const freezeDiscountPercentageSql = "COALESCE(li.porcentaje_descuento_tardanza, 0)";
    const freezeNetSql = `CASE
      WHEN a.tipo <> 'recorrido' AND ${freezeDiscountPercentageSql} > 0
        THEN ROUND(${freezeGrossSql} * (1 - ${freezeDiscountPercentageSql} / 100), 2)
      WHEN ${freezeGrossSql} <> ${freezeStoredGrossSql} THEN ${freezeGrossSql}
      ELSE COALESCE(li.valor_ganado, p.valor_ganado, a.valor_aplicado * ${freezePercentageSql} / 100, 0)
    END`;
    const freezeDiscountSql = `CASE
      WHEN a.tipo <> 'recorrido' AND ${freezeDiscountPercentageSql} > 0
        THEN ROUND(${freezeGrossSql} * ${freezeDiscountPercentageSql} / 100, 2)
      WHEN ${freezeGrossSql} <> ${freezeStoredGrossSql} THEN 0
      ELSE COALESCE(li.descuento_tardanza, 0)
    END`;

    const { rows: snapshotRows } = await client.query(
      `INSERT INTO public.liquidacion_periodo_items (
          periodo_id, liquidacion_item_id, actividad_id, participante_id, tecnico_id,
          cliente_id, sede_id, grupo_id, grupo_lider_id, codigo_snapshot,
          fecha_operacion, tipo, descripcion_snapshot, sede_snapshot, porcentaje,
          valor_base, valor_ganado, valor_ganado_original, descuento_tardanza,
          porcentaje_descuento_tardanza, estado, extra_lider_porcentaje,
          extra_lider_activo, es_arrastre, fecha_snapshot
       )
       SELECT
          $1, li.id, a.id, p.id, p.tecnico_id,
          a.cliente_id, a.sede_id, a.grupo_id, g.lider_id, a.codigo,
          a.fecha_operacion, a.tipo, a.descripcion, s.nombre,
          ${freezePercentageSql},
          ${freezeBaseSql},
          ${freezeNetSql},
          ${freezeGrossSql},
          ${freezeDiscountSql}, ${freezeDiscountPercentageSql},
          CASE
            WHEN li.estado IN ('anulado', 'rechazado') THEN 'anulado'
            WHEN li.estado IN ('aprobado', 'pagado')
              OR EXISTS (
                SELECT 1 FROM public.actividades_operativas_aprobaciones ap
                 WHERE ap.actividad_id = a.id AND ap.participante_id = p.id AND ap.estado = 'aprobada'
              )
              OR (a.tipo = 'mantenimiento' AND EXISTS (
                SELECT 1 FROM public.actividades_operativas_aprobaciones ap
                 WHERE ap.actividad_id = a.id AND ap.participante_id IS NULL AND ap.estado = 'aprobada'
              )) THEN 'aprobado'
            ELSE 'pendiente'
          END,
          $2, $3, COALESCE(li.es_arrastre, false), clock_timestamp()
         FROM public.actividades_operativas a
         JOIN public.actividades_operativas_participantes p ON p.actividad_id = a.id
         LEFT JOIN public.liquidacion_items li
           ON li.periodo_id = $1 AND li.actividad_id = a.id AND li.participante_id = p.id
         LEFT JOIN public.grupos_trabajo g ON g.id = a.grupo_id
         LEFT JOIN public.cliente_sedes s ON s.id = a.sede_id
        WHERE a.estado NOT IN ('cancelada', 'rechazada')
          AND (a.fecha_operacion BETWEEN $4 AND $5 OR COALESCE(li.es_arrastre, false))
       ON CONFLICT (periodo_id, actividad_id, participante_id) DO NOTHING
       RETURNING id`,
      [period.id, extraPercentage, extraActive, period.fecha_inicio, period.fecha_fin],
    );

    const { rows: nextPeriods } = await client.query(
      `SELECT id, fecha_inicio
         FROM public.periodos_liquidacion
        WHERE estado = 'abierto' AND fecha_inicio > $1
        ORDER BY fecha_inicio ASC
        LIMIT 1
        FOR UPDATE`,
      [period.fecha_fin],
    );
    let carriedRows = 0;
    if (nextPeriods[0]) {
      const result = await client.query(
        `INSERT INTO public.liquidacion_items (
            periodo_id, actividad_id, participante_id, tecnico_id, fecha_operacion,
            tipo, porcentaje, valor_base, valor_ganado, valor_ganado_original,
            estado, descripcion_snapshot, sede_snapshot, descuento_tardanza,
            porcentaje_descuento_tardanza, es_arrastre, periodo_origen_id, item_origen_id
         )
         SELECT
            $1, s.actividad_id, s.participante_id, s.tecnico_id,
            GREATEST(s.fecha_operacion, $3::date),
            s.tipo, s.porcentaje, s.valor_base, s.valor_ganado, s.valor_ganado_original,
            'pendiente', s.descripcion_snapshot, s.sede_snapshot, s.descuento_tardanza,
            s.porcentaje_descuento_tardanza, true, s.periodo_id, s.liquidacion_item_id
           FROM public.liquidacion_periodo_items s
          WHERE s.periodo_id = $2 AND s.estado = 'pendiente'
         ON CONFLICT DO NOTHING`,
        [nextPeriods[0].id, period.id, nextPeriods[0].fecha_inicio],
      );
      carriedRows = result.rowCount || 0;
    }

    const { rows: closedRows } = await client.query(
      `UPDATE public.periodos_liquidacion
          SET estado = 'cerrado',
              fecha_cierre = COALESCE(fecha_cierre, clock_timestamp()),
              liquidacion_congelada_en = clock_timestamp(),
              arrastre_pendientes_en = CASE WHEN $2::int > 0 THEN clock_timestamp() ELSE arrastre_pendientes_en END,
              liquidacion_version = COALESCE(liquidacion_version, 1) + 1,
              updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING *`,
      [period.id, carriedRows],
    );
    return { ...closedRows[0], congelado: true, snapshotRows: snapshotRows.length, arrastreRows: carriedRows };
  });
}

async function canonicalLiquidationSummary(payload: Payload, user: UserContext, scopeOverride?: string[] | null) {
  const requestedUserId = payload.usuarioId || payload.tecnicoId;
  const userScope = scopeOverride !== undefined
    ? scopeOverride
    : ["admin", "supervisor"].includes(user.rol)
      ? (requestedUserId ? [String(requestedUserId)] : null)
      : [user.id];
  const periodId = String(payload.periodoId || "").trim();
  if (!periodId) throw new Error("Debes indicar el período de liquidación.");

  const { rows: periodRowsResult } = await dbQuery(
    "SELECT id, fecha_inicio, fecha_fin, estado FROM public.periodos_liquidacion WHERE id = $1",
    [periodId],
  );
  if (!periodRowsResult[0]) throw new Error("No se encontró el período de liquidación.");

  const snapshotRows = await getLiquidationSnapshotRows(periodId, userScope);
  const liquidationRows = snapshotRows !== null
    ? snapshotRows
    : await getLiveLiquidationRows(periodId, userScope);
  const settings = await getConfig();
  const leaderExtraConfigs = await getLeaderExtraConfigurations(periodId);
  const grouped = new Map<string, any>();
  const extraBaseByLeader = new Map<string, { approved: number; pending: number; percentage: number; active: boolean }>();

  for (const row of liquidationRows) {
    const state = String(row.estado_liquidacion || row.estado || "pendiente");
    if (state === "anulado" || state === "rechazado") continue;
    const current = grouped.get(row.tecnico_id) || {
      tecnicoId: row.tecnico_id,
      nombre: `${row.nombre || ""} ${row.apellido || ""}`.trim(),
      email: row.email || "",
      rol: row.rol,
      esLider: false,
      actividades: 0,
      actividadesAprobadas: 0,
      totalBruto: 0,
      totalNoRecorridos: 0,
      totalNoRecorridosAprobados: 0,
      totalNoRecorridosPendientes: 0,
      totalRecorridos: 0,
      descuentoValor: 0,
      totalAprobado: 0,
      totalPendiente: 0,
      totalRecorridosPendientes: 0,
      extraLider: 0,
      extraLiderPendiente: 0,
      baseExtraLiderAprobado: 0,
      baseExtraLiderPendiente: 0,
      porcentajeExtraLiderAplicado: snapshotRows !== null
        ? number(row.extra_lider_porcentaje)
        : leaderExtraConfigs.get(String(row.tecnico_id))?.percentage ?? number(settings.porcentajeExtraLider),
      extraLiderActivo: snapshotRows !== null
        ? Boolean(row.extra_lider_activo)
        : leaderExtraConfigs.get(String(row.tecnico_id))?.active ?? Boolean(settings.extraLiderActivo),
      tecnicosExcluidosExtraIds: leaderExtraConfigs.get(String(row.tecnico_id))?.excludedIds || [],
      total: 0,
    };
    const gross = number(row.valor_ganado_original);
    const earned = number(row.valor_ganado);
    const isApproved = state === "aprobado" || state === "pagado";
    current.actividades += 1;
    if (isApproved) current.actividadesAprobadas += 1;
    current.totalBruto += gross;
    if (isApproved) current.totalAprobado += earned;
    else current.totalPendiente += earned;
    if (row.tipo === "recorrido" && isApproved) current.totalRecorridos += earned;
    else if (row.tipo === "recorrido") current.totalRecorridosPendientes += earned;
    else {
      current.totalNoRecorridos += gross;
      if (isApproved) {
        current.totalNoRecorridosAprobados += earned;
        current.descuentoValor += number(row.descuento_tardanza);
      } else {
        current.totalNoRecorridosPendientes += earned;
      }
    }
    if (row.grupo_lider_id && row.grupo_lider_id === row.tecnico_id) current.esLider = true;
    if (row.grupo_lider_id && row.grupo_lider_id !== row.tecnico_id && row.tipo !== "recorrido") {
      const savedConfig = leaderExtraConfigs.get(String(row.grupo_lider_id));
      if (!savedConfig?.excludedIds.includes(String(row.tecnico_id))) {
        const existingExtra = extraBaseByLeader.get(row.grupo_lider_id) || {
          approved: 0,
          pending: 0,
          percentage: snapshotRows !== null
            ? number(row.extra_lider_porcentaje)
            : savedConfig?.percentage ?? number(settings.porcentajeExtraLider),
          active: snapshotRows !== null
            ? Boolean(row.extra_lider_activo)
            : savedConfig?.active ?? Boolean(settings.extraLiderActivo),
        };
        if (isApproved) existingExtra.approved += earned;
        else existingExtra.pending += earned;
        extraBaseByLeader.set(row.grupo_lider_id, existingExtra);
      }
    }
    grouped.set(row.tecnico_id, current);
  }

  const extraLeaderIds = uniqueIds([
    ...extraBaseByLeader.keys(),
    ...leaderExtraConfigs.keys(),
  ]).filter((leaderId) => userScope === null || userScope.includes(leaderId));
  if (extraLeaderIds.length > 0) {
    const missingLeaderIds = extraLeaderIds.filter((leaderId) => !grouped.has(leaderId));
    if (missingLeaderIds.length > 0) {
      const { rows: leaderRows } = await dbQuery(
        "SELECT id, nombre, apellido, email, rol FROM public.usuarios WHERE id = ANY($1::uuid[])",
        [missingLeaderIds],
      );
      for (const leader of leaderRows) {
        grouped.set(leader.id, {
          tecnicoId: leader.id,
          nombre: `${leader.nombre || ""} ${leader.apellido || ""}`.trim(),
          email: leader.email || "",
          rol: leader.rol,
          esLider: true,
          actividades: 0,
          actividadesAprobadas: 0,
          totalBruto: 0,
          totalNoRecorridos: 0,
          totalNoRecorridosAprobados: 0,
          totalNoRecorridosPendientes: 0,
          totalRecorridos: 0,
          descuentoValor: 0,
          totalAprobado: 0,
          totalPendiente: 0,
          totalRecorridosPendientes: 0,
          extraLider: 0,
          extraLiderPendiente: 0,
          baseExtraLiderAprobado: 0,
          baseExtraLiderPendiente: 0,
          porcentajeExtraLiderAplicado: extraBaseByLeader.get(leader.id)?.percentage
            ?? leaderExtraConfigs.get(String(leader.id))?.percentage
            ?? number(settings.porcentajeExtraLider),
          extraLiderActivo: extraBaseByLeader.get(leader.id)?.active
            ?? leaderExtraConfigs.get(String(leader.id))?.active
            ?? Boolean(settings.extraLiderActivo),
          tecnicosExcluidosExtraIds: leaderExtraConfigs.get(String(leader.id))?.excludedIds || [],
          total: 0,
        });
      }
    }
  }

  const technicians = [...grouped.values()].map((row) => {
    const extraConfig = extraBaseByLeader.get(row.tecnicoId);
    const extraLider = extraConfig?.active
      ? roundCurrency(extraConfig.approved * extraConfig.percentage / 100)
      : 0;
    const extraLiderPendiente = extraConfig?.active
      ? roundCurrency(extraConfig.pending * extraConfig.percentage / 100)
      : 0;
    row.extraLider = extraLider;
    row.extraLiderPendiente = extraLiderPendiente;
    row.baseExtraLiderAprobado = roundCurrency(extraConfig?.approved || 0);
    row.baseExtraLiderPendiente = roundCurrency(extraConfig?.pending || 0);
    // `getLiveLiquidationRows` (and frozen snapshots) already expose
    // `valor_ganado` net of attendance discounts. Keep the discount as a
    // separate informational total, but do not subtract it a second time.
    row.total = roundCurrency(row.totalAprobado + extraLider);
    return {
      tecnicoId: row.tecnicoId,
      nombre: row.nombre,
      email: row.email,
      rol: row.rol,
      esLider: Boolean(row.esLider),
      actividades: number(row.actividades),
      actividadesAprobadas: number(row.actividadesAprobadas),
      totalBruto: number(row.totalBruto),
      totalNoRecorridos: number(row.totalNoRecorridos),
      totalNoRecorridosAprobados: number(row.totalNoRecorridosAprobados),
      totalNoRecorridosPendientes: number(row.totalNoRecorridosPendientes),
      totalRecorridos: number(row.totalRecorridos),
      descuentoValor: number(row.descuentoValor),
      totalAprobado: number(row.totalAprobado),
      totalPendiente: number(row.totalPendiente),
      totalRecorridosPendientes: number(row.totalRecorridosPendientes),
      extraLider,
      extraLiderPendiente,
      baseExtraLiderAprobado: number(row.baseExtraLiderAprobado),
      baseExtraLiderPendiente: number(row.baseExtraLiderPendiente),
      porcentajeExtraLiderAplicado: number(row.porcentajeExtraLiderAplicado),
      extraLiderActivo: Boolean(row.extraLiderActivo),
      tecnicosExcluidosExtraIds: leaderExtraConfigs.get(String(row.tecnicoId))?.excludedIds || [],
      total: number(row.total),
    };
  }).sort((a, b) => `${a.nombre} ${a.tecnicoId}`.localeCompare(`${b.nombre} ${b.tecnicoId}`));
  const totals = technicians.reduce((acc, row) => ({
    actividades: acc.actividades + row.actividades,
    actividadesAprobadas: acc.actividadesAprobadas + row.actividadesAprobadas,
    totalBruto: acc.totalBruto + row.totalBruto,
    totalNoRecorridos: acc.totalNoRecorridos + row.totalNoRecorridos,
    totalNoRecorridosAprobados: acc.totalNoRecorridosAprobados + row.totalNoRecorridosAprobados,
    totalNoRecorridosPendientes: acc.totalNoRecorridosPendientes + row.totalNoRecorridosPendientes,
    totalRecorridos: acc.totalRecorridos + row.totalRecorridos,
    totalRecorridosPendientes: acc.totalRecorridosPendientes + row.totalRecorridosPendientes,
    descuentoValor: acc.descuentoValor + row.descuentoValor,
    totalAprobado: acc.totalAprobado + row.totalAprobado,
    totalPendiente: acc.totalPendiente + row.totalPendiente,
    extraLider: acc.extraLider + row.extraLider,
    extraLiderPendiente: acc.extraLiderPendiente + row.extraLiderPendiente,
    baseExtraLiderAprobado: acc.baseExtraLiderAprobado + row.baseExtraLiderAprobado,
    baseExtraLiderPendiente: acc.baseExtraLiderPendiente + row.baseExtraLiderPendiente,
    total: acc.total + row.total,
  }), {
    actividades: 0, actividadesAprobadas: 0, totalBruto: 0, totalNoRecorridos: 0,
    totalNoRecorridosAprobados: 0, totalNoRecorridosPendientes: 0,
    totalRecorridos: 0, totalRecorridosPendientes: 0, descuentoValor: 0, totalAprobado: 0,
    totalPendiente: 0, extraLider: 0, extraLiderPendiente: 0,
    baseExtraLiderAprobado: 0, baseExtraLiderPendiente: 0, total: 0,
  });

  return {
    periodoId: periodId,
    fechaInicio: dateOnly(periodRowsResult[0].fecha_inicio) || "",
    fechaFin: dateOnly(periodRowsResult[0].fecha_fin) || "",
    estado: periodRowsResult[0].estado,
    congelado: snapshotRows !== null,
    congeladoEn: null,
    generatedAt: new Date().toISOString(),
    totals,
    technicians,
  };
}

async function exportReportRows(payload: Payload = {}) {
  const range = payload.periodoId
    ? await (async () => {
        const { rows } = await dbQuery("SELECT fecha_inicio, fecha_fin FROM public.periodos_liquidacion WHERE id = $1", [payload.periodoId]);
        if (!rows[0]) throw new Error("No se encontró el período solicitado.");
        return { startDate: dateOnly(rows[0].fecha_inicio), endDate: dateOnly(rows[0].fecha_fin) };
      })()
    : { startDate: dateOnly(payload.startDate), endDate: dateOnly(payload.endDate) };
  const sourceRows = await activityRows({
    ...payload,
    startDate: range.startDate || undefined,
    endDate: range.endDate || undefined,
    limit: undefined,
    offset: undefined,
  });
  // Exportes financieros y operativos representan una actividad una sola vez.
  // Los participantes siguen disponibles dentro de la fila, pero no generan
  // una segunda línea del mismo reporte.
  const items = sourceRows.map((row) => mapReport(row, jsonArray(row.participantes)[0], 0));
  return {
    startDate: range.startDate || "",
    endDate: range.endDate || "",
    generatedAt: new Date().toISOString(),
    total: items.length,
    items,
  };
}

async function applyUserSchedules(client: any, userId: string, schedules: any[] = []) {
  await client.query("DELETE FROM public.asistencia_horarios WHERE usuario_id = $1", [userId]);
  for (const schedule of schedules) {
    const day = dayToNumber[String(schedule.diaSemana || "")];
    if (!day) continue;
    await client.query(
      `INSERT INTO public.asistencia_horarios (usuario_id, dia_semana, activo, hora_entrada, hora_salida)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, day, schedule.activo !== false, schedule.horaEntrada || null, schedule.horaSalida || null],
    );
  }
}

async function deleteUser(payload: Payload, actor: UserContext) {
  const id = String(payload.id || "").trim();
  if (!id) throw new Error("Debes indicar el usuario que deseas eliminar.");
  if (id === actor.id) throw new Error("No puedes eliminar la cuenta con la que estás administrando el sistema.");

  return withTransaction(async (client) => {
    const userResult = await client.query("SELECT * FROM public.usuarios WHERE id = $1 FOR UPDATE", [id]);
    const target = userResult.rows[0];
    if (!target) throw new Error("No se encontró el usuario que intentas eliminar.");
    if (target.rol === "admin") {
      const { rows } = await client.query("SELECT COUNT(*)::int AS total FROM public.usuarios WHERE rol = 'admin' AND estado = 'activo'");
      if (number(rows[0]?.total) <= 1) throw new Error("No puedes eliminar al último administrador activo del sistema.");
    }

    // La eliminación solicitada por administración es física. Primero se
    // borran dependencias históricas que usan ON DELETE RESTRICT y después
    // se elimina la cuenta. Todo corre dentro de esta transacción: si una
    // dependencia no está contemplada, no se borra parcialmente nada.
    const { rows: createdActivityRows } = await client.query(
      "SELECT id FROM public.actividades_operativas WHERE creado_por_id = $1",
      [id],
    );
    const createdActivityIds = createdActivityRows.map((row: any) => row.id);
    const { rows: participantRows } = await client.query(
      "SELECT id, actividad_id FROM public.actividades_operativas_participantes WHERE tecnico_id = $1",
      [id],
    );
    const participantIds = participantRows.map((row: any) => row.id);

    if (createdActivityIds.length > 0) {
      await client.query("DELETE FROM public.lote_aprobacion_items WHERE aprobacion_id IN (SELECT id FROM public.actividades_operativas_aprobaciones WHERE actividad_id = ANY($1::uuid[]))", [createdActivityIds]);
      await client.query("DELETE FROM public.liquidacion_items WHERE actividad_id = ANY($1::uuid[])", [createdActivityIds]);
      await client.query("DELETE FROM public.actividades_operativas_aprobaciones WHERE actividad_id = ANY($1::uuid[])", [createdActivityIds]);
      await client.query("DELETE FROM public.actividades_operativas WHERE id = ANY($1::uuid[])", [createdActivityIds]);
    }

    if (participantIds.length > 0) {
      await client.query("DELETE FROM public.lote_aprobacion_items WHERE aprobacion_id IN (SELECT id FROM public.actividades_operativas_aprobaciones WHERE participante_id = ANY($1::uuid[]))", [participantIds]);
      await client.query("DELETE FROM public.liquidacion_items WHERE participante_id = ANY($1::uuid[])", [participantIds]);
      await client.query("DELETE FROM public.actividades_operativas_aprobaciones WHERE participante_id = ANY($1::uuid[])", [participantIds]);
      await client.query("DELETE FROM public.actividades_operativas_entregas WHERE participante_id = ANY($1::uuid[]) OR enviado_por_id = $2", [participantIds, id]);
      await client.query("DELETE FROM public.actividades_operativas_evidencias WHERE participante_id = ANY($1::uuid[]) OR subido_por_id = $2", [participantIds, id]);
      await client.query("DELETE FROM public.actividades_operativas_participantes WHERE id = ANY($1::uuid[])", [participantIds]);
    }

    await client.query("DELETE FROM public.actividades_operativas_entregas WHERE enviado_por_id = $1", [id]);
    await client.query("DELETE FROM public.actividades_operativas_evidencias WHERE subido_por_id = $1", [id]);
    await client.query("DELETE FROM public.actividades_operativas_aprobaciones WHERE revisor_id = $1", [id]);
    await client.query("DELETE FROM public.lote_aprobacion_items WHERE lote_id IN (SELECT id FROM public.lotes_aprobacion WHERE lider_id = $1)", [id]);
    await client.query("DELETE FROM public.lotes_aprobacion WHERE lider_id = $1", [id]);
    await client.query("DELETE FROM public.asistencia_descuentos WHERE tecnico_id = $1 OR asistencia_id IN (SELECT id FROM public.registros_asistencia WHERE usuario_id = $1)", [id]);
    await client.query("DELETE FROM public.registros_asistencia WHERE usuario_id = $1", [id]);
    await client.query("DELETE FROM public.mantenimientos_programados_participantes WHERE usuario_id = $1", [id]);
    await client.query("UPDATE public.mantenimientos_programados SET tecnico_principal_id = NULL, updated_at = clock_timestamp() WHERE tecnico_principal_id = $1", [id]);
    await client.query("UPDATE public.grupos_trabajo SET lider_id = NULL, updated_at = clock_timestamp() WHERE lider_id = $1", [id]);
    await client.query("DELETE FROM public.grupo_miembros WHERE usuario_id = $1", [id]);
    await client.query("DELETE FROM public.grupo_reportadores_actividad WHERE usuario_id = $1", [id]);
    await client.query("DELETE FROM public.operaciones_idempotencia WHERE actor_id = $1", [id]);
    await client.query("DELETE FROM public.auditoria_eventos WHERE actor_id = $1", [id]);
    await client.query("DELETE FROM public.sesiones_usuario WHERE usuario_id = $1", [id]);
    await client.query("DELETE FROM public.notificaciones WHERE usuario_id = $1", [id]);
    await client.query("DELETE FROM public.asistencia_horarios WHERE usuario_id = $1", [id]);
    await client.query("DELETE FROM public.usuarios WHERE id = $1", [id]);
    return { deleted: true, archived: false, id, message: "Usuario eliminado definitivamente junto con sus datos, asignaciones, historial y sesiones." };
  });
}

async function deleteOperationalActivities(client: any, activityIds: string[]) {
  if (!activityIds.length) return;

  // These tables use RESTRICT for financial/audit references, so they must
  // be removed before the operational activity. The transaction guarantees
  // that a failure rolls back the complete deletion.
  await client.query(
    "DELETE FROM public.lote_aprobacion_items WHERE aprobacion_id IN (SELECT id FROM public.actividades_operativas_aprobaciones WHERE actividad_id = ANY($1::uuid[]))",
    [activityIds],
  );
  await client.query("DELETE FROM public.liquidacion_items WHERE actividad_id = ANY($1::uuid[])", [activityIds]);
  await client.query("DELETE FROM public.actividades_operativas_aprobaciones WHERE actividad_id = ANY($1::uuid[])", [activityIds]);
  await client.query("DELETE FROM public.notificaciones WHERE entidad_id = ANY($1::uuid[])", [activityIds]);
  await client.query("DELETE FROM public.envios_correo WHERE entidad_id = ANY($1::uuid[])", [activityIds]);
  await client.query("DELETE FROM public.operaciones_idempotencia WHERE recurso_id = ANY($1::uuid[])", [activityIds]);
  await client.query("DELETE FROM public.auditoria_eventos WHERE entidad_id = ANY($1::uuid[])", [activityIds]);
  await client.query("DELETE FROM public.actividades_operativas WHERE id = ANY($1::uuid[])", [activityIds]);
}

async function deleteScheduledMaintenances(client: any, maintenanceIds: string[]) {
  if (!maintenanceIds.length) return;

  // The assignment table cascades in the current schema, but delete it
  // explicitly so this operation remains deterministic across environments
  // and never leaves a participant row pointing at a deleted maintenance.
  await client.query(
    "DELETE FROM public.mantenimientos_programados_participantes WHERE mantenimiento_id = ANY($1::uuid[])",
    [maintenanceIds],
  );
  await client.query(
    "DELETE FROM public.notificaciones WHERE entidad_tipo = 'mantenimiento_programado' AND entidad_id = ANY($1::uuid[])",
    [maintenanceIds],
  );
  await client.query("DELETE FROM public.envios_correo WHERE entidad_id = ANY($1::uuid[])", [maintenanceIds]);
  await client.query("DELETE FROM public.operaciones_idempotencia WHERE recurso_id = ANY($1::uuid[])", [maintenanceIds]);
  await client.query("DELETE FROM public.auditoria_eventos WHERE entidad_id = ANY($1::uuid[])", [maintenanceIds]);
  await client.query("DELETE FROM public.actividades_operativas_mantenimientos WHERE mantenimiento_programado_id = ANY($1::uuid[])", [maintenanceIds]);
  await client.query("DELETE FROM public.mantenimientos_programados WHERE id = ANY($1::uuid[])", [maintenanceIds]);
}

async function deleteClient(payload: Payload) {
  const id = String(payload.id || "").trim();
  if (!id) throw new Error("Debes indicar el cliente que deseas eliminar.");

  return withTransaction(async (client) => {
    const clientResult = await client.query("SELECT id, nombre FROM public.clientes WHERE id = $1 FOR UPDATE", [id]);
    const target = clientResult.rows[0];
    if (!target) throw new Error("No se encontró el cliente que intentas eliminar.");

    const { rows: contractRows } = await client.query(
      "SELECT id FROM public.contratos_mantenimiento WHERE cliente_id = $1 FOR UPDATE",
      [id],
    );
    const contractIds = contractRows.map((row: any) => row.id);
    const { rows: maintenanceRows } = await client.query(
      `SELECT id
         FROM public.mantenimientos_programados
        WHERE cliente_id = $1 OR contrato_id = ANY($2::uuid[])
        FOR UPDATE`,
      [id, contractIds],
    );
    const maintenanceIds = maintenanceRows.map((row: any) => row.id);
    const { rows: activityRows } = await client.query(
      `SELECT DISTINCT a.id
         FROM public.actividades_operativas a
         LEFT JOIN public.actividades_operativas_mantenimientos am ON am.actividad_id = a.id
         LEFT JOIN public.mantenimientos_programados m ON m.id = am.mantenimiento_programado_id
        WHERE a.cliente_id = $1
           OR a.sede_id IN (SELECT id FROM public.cliente_sedes WHERE cliente_id = $1)
           OR m.cliente_id = $1
           OR m.contrato_id = ANY($2::uuid[])`,
      [id, contractIds],
    );
    const activityIds = activityRows.map((row: any) => row.id);

    await deleteOperationalActivities(client, activityIds);
    await deleteScheduledMaintenances(client, maintenanceIds);
    if (contractIds.length) {
      await client.query(
        "DELETE FROM public.auditoria_eventos WHERE entidad_tipo = 'contrato_mantenimiento' AND entidad_id = ANY($1::uuid[])",
        [contractIds],
      );
      await client.query("DELETE FROM public.contratos_mantenimiento WHERE id = ANY($1::uuid[])", [contractIds]);
    }
    await client.query("DELETE FROM public.cliente_sedes WHERE cliente_id = $1", [id]);
    await client.query("DELETE FROM public.clientes WHERE id = $1", [id]);

    return {
      id,
      deleted: true,
      archived: false,
      message: `Cliente ${target.nombre || ""} eliminado definitivamente junto con sus sedes, contratos, mantenimientos, reportes, aprobaciones y liquidaciones.`,
    };
  });
}

async function deleteCatalogActivity(payload: Payload) {
  const id = String(payload.id || "").trim();
  if (!id) throw new Error("Debes indicar la actividad del catálogo que deseas eliminar.");

  return withTransaction(async (client) => {
    const activityResult = await client.query(
      "SELECT id, codigo, nombre FROM public.catalogo_actividades WHERE id = $1 FOR UPDATE",
      [id],
    );
    const target = activityResult.rows[0];
    if (!target) throw new Error("No se encontró la actividad del catálogo que intentas eliminar.");

    // Operational reports keep their own description/value snapshots. Remove
    // only the master-data link, so deleting a catalog definition does not
    // erase already completed field work or financial evidence.
    await client.query("DELETE FROM public.actividades_operativas_catalogo WHERE catalogo_actividad_id = $1", [id]);
    await client.query("DELETE FROM public.catalogo_actividad_precios WHERE actividad_id = $1", [id]);
    await client.query("DELETE FROM public.catalogo_actividades WHERE id = $1", [id]);

    return {
      id,
      deleted: true,
      archived: false,
      message: `Actividad ${target.codigo || target.nombre || ""} eliminada definitivamente del catálogo y de su historial de precios.`,
    };
  });
}

async function deleteGroup(payload: Payload) {
  const id = String(payload.id || "").trim();
  if (!id) throw new Error("Debes indicar el grupo que deseas eliminar.");

  return withTransaction(async (client) => {
    const groupResult = await client.query("SELECT id, nombre FROM public.grupos_trabajo WHERE id = $1 FOR UPDATE", [id]);
    const target = groupResult.rows[0];
    if (!target) throw new Error("No se encontró el grupo que intentas eliminar.");

    const { rows: maintenanceRows } = await client.query(
      "SELECT id FROM public.mantenimientos_programados WHERE grupo_id = $1 FOR UPDATE",
      [id],
    );
    const maintenanceIds = maintenanceRows.map((row: any) => row.id);
    const { rows: activityRows } = await client.query(
      `SELECT DISTINCT a.id
         FROM public.actividades_operativas a
         LEFT JOIN public.actividades_operativas_mantenimientos am ON am.actividad_id = a.id
        WHERE a.grupo_id = $1 OR am.mantenimiento_programado_id = ANY($2::uuid[])`,
      [id, maintenanceIds],
    );
    const activityIds = activityRows.map((row: any) => row.id);

    await deleteOperationalActivities(client, activityIds);
    await deleteScheduledMaintenances(client, maintenanceIds);

    const { rows: batchRows } = await client.query("SELECT id FROM public.lotes_aprobacion WHERE grupo_id = $1 FOR UPDATE", [id]);
    const batchIds = batchRows.map((row: any) => row.id);
    if (batchIds.length) {
      await client.query("DELETE FROM public.lote_aprobacion_items WHERE lote_id = ANY($1::uuid[])", [batchIds]);
      await client.query("DELETE FROM public.lotes_aprobacion WHERE id = ANY($1::uuid[])", [batchIds]);
    }
    await client.query("DELETE FROM public.auditoria_eventos WHERE entidad_tipo = 'grupo_trabajo' AND entidad_id = $1", [id]);
    await client.query("DELETE FROM public.grupo_reportadores_actividad WHERE grupo_id = $1", [id]);
    await client.query("DELETE FROM public.grupo_miembros WHERE grupo_id = $1", [id]);
    await client.query("DELETE FROM public.grupos_trabajo WHERE id = $1", [id]);

    return {
      id,
      deleted: true,
      archived: false,
      message: `Grupo ${target.nombre || ""} eliminado definitivamente junto con sus membresías, mantenimientos, reportes, aprobaciones y liquidaciones.`,
    };
  });
}

async function requireAdmin(user: UserContext) {
  if (!["admin", "supervisor"].includes(user.rol)) throw new Error("No tienes permisos para esta operación.");
}

type MaintenanceParticipantInput = {
  usuarioId: string;
  porcentaje: number;
  valorCalculado?: number;
  rol?: "principal" | "acompanante";
};

function normalizeMaintenanceParticipants(payload: Payload, fallbackUserId?: string): MaintenanceParticipantInput[] {
  const raw = jsonArray(payload.participantes || payload.participants);
  const source = raw.length ? raw : [{ usuarioId: payload.tecnicoId || fallbackUserId, porcentaje: 100 }];
  const unique = new Map<string, MaintenanceParticipantInput>();
  for (const item of source) {
    const usuarioId = String(item?.usuarioId || item?.usuario_id || item?.tecnicoId || item?.tecnico_id || "").trim();
    if (!usuarioId) continue;
    const porcentaje = number(item?.porcentaje, 0);
    if (unique.has(usuarioId)) throw new Error("No puedes asignar dos veces al mismo técnico en un mantenimiento.");
    unique.set(usuarioId, {
      usuarioId,
      porcentaje,
      valorCalculado: item?.valorCalculado ?? item?.valor_calculado ?? item?.valorGanado ?? item?.valor_ganado,
      rol: item?.rol === "principal" || item?.esResponsable === true ? "principal" : "acompanante",
    });
  }
  const participants = Array.from(unique.values());
  if (!participants.length) throw new Error("El mantenimiento requiere al menos un técnico asignado.");
  const principalIndex = participants.findIndex((item) => item.rol === "principal");
  if (principalIndex < 0) participants[0].rol = "principal";
  else participants.forEach((item, index) => { if (index !== principalIndex) item.rol = "acompanante"; });
  const total = participants.reduce((sum, item) => sum + item.porcentaje, 0);
  if (Math.abs(total - 100) > 0.01) throw new Error("La suma de porcentajes de los técnicos asignados debe ser exactamente 100%.");
  return participants;
}

/**
 * Makes the canonical operational activity contain every active maintenance
 * assignee. A first delivery must not wait for the other technician, but the
 * shared activity still needs a valid participant row for each assignee so
 * approvals and liquidation can see the same maintenance. Existing complete
 * participant sets are left untouched; only incomplete legacy sets are
 * rebuilt from the maintenance assignment split.
 */
async function ensureMaintenanceActivityParticipants(client: any, activityId: string, maintenanceId: string) {
  const { rows: maintenanceRows } = await client.query(
    `SELECT costo_tecnico_presupuestado, sede_id, fecha_programada
       FROM public.mantenimientos_programados
      WHERE id = $1`,
    [maintenanceId],
  );
  const maintenance = maintenanceRows[0];
  if (!maintenance) throw new Error("No se encontró el mantenimiento asociado al reporte.");

  const { rows: assignmentRows } = await client.query(
    `SELECT usuario_id, rol_participacion, porcentaje
       FROM public.mantenimientos_programados_participantes
      WHERE mantenimiento_id = $1 AND estado = 'activo'
      ORDER BY rol_participacion = 'principal' DESC, created_at`,
    [maintenanceId],
  );
  // Historical maintenance activities may not have an assignment snapshot.
  // They can still be edited by administration using their existing
  // operational participant rows; there is nothing to synthesize in that
  // case, so do not block the save.
  if (!assignmentRows.length) return;

  const assignments = normalizePercentageRows(assignmentRows);
  const { rows: existingRows } = await client.query(
    `SELECT id, tecnico_id
       FROM public.actividades_operativas_participantes
      WHERE actividad_id = $1
      FOR UPDATE`,
    [activityId],
  );
  const existingByTechnician = new Map(existingRows.map((row: any) => [String(row.tecnico_id), row]));
  const missing = assignments.some((item) => !existingByTechnician.has(String(item.usuario_id)));
  const valueBase = number(maintenance.costo_tecnico_presupuestado);

  for (const item of assignments) {
    const porcentaje = item.porcentaje;
    const valorGanado = roundCurrency(valueBase * porcentaje / 100);
    if (!missing && existingByTechnician.has(String(item.usuario_id))) continue;

    await client.query(
      `INSERT INTO public.actividades_operativas_participantes
        (actividad_id, tecnico_id, rol_participacion, porcentaje, valor_base, valor_ganado)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (actividad_id, tecnico_id) DO UPDATE SET
         rol_participacion = EXCLUDED.rol_participacion,
         porcentaje = EXCLUDED.porcentaje,
         valor_base = EXCLUDED.valor_base,
         valor_ganado = EXCLUDED.valor_ganado,
         updated_at = clock_timestamp()`,
      [activityId, item.usuario_id, item.rol_participacion, porcentaje, valueBase, valorGanado],
    );
  }
}

async function replaceMaintenanceParticipants(client: any, maintenanceId: string, payload: Payload, fallbackUserId?: string) {
  const participants = normalizeMaintenanceParticipants(payload, fallbackUserId);
  const ids = participants.map((item) => item.usuarioId);
  const { rows: activeUsers } = await client.query(
    "SELECT id FROM public.usuarios WHERE id = ANY($1::uuid[]) AND estado = 'activo' AND rol <> 'admin'",
    [ids],
  );
  const activeIds = new Set(activeUsers.map((row: any) => String(row.id)));
  const invalid = ids.find((id) => !activeIds.has(id));
  if (invalid) throw new Error("Todos los técnicos asignados deben existir y estar activos.");

  const { rows: maintenanceRows } = await client.query(
    "SELECT id, costo_tecnico_presupuestado, fecha_programada, grupo_id, cliente_id, sede_id FROM public.mantenimientos_programados WHERE id = $1 FOR UPDATE",
    [maintenanceId],
  );
  const maintenance = maintenanceRows[0];
  if (!maintenance) throw new Error("No se encontró el mantenimiento para asignar sus técnicos.");
  const defaultValue = number(maintenance.costo_tecnico_presupuestado);
  const maintenanceLabel = String(
    payload.titulo || payload.descripcionPendiente || payload.observaciones || "programado",
  ).trim();

  // Never delete participant rows while editing a maintenance. A submitted
  // delivery, approval or liquidation item may reference that row. Reuse
  // the same participant id when possible and retire only the users removed
  // from the assignment, preserving the operational history.
  const { rows: currentParticipants } = await client.query(
    `SELECT id, usuario_id
       FROM public.mantenimientos_programados_participantes
      WHERE mantenimiento_id = $1
      FOR UPDATE`,
    [maintenanceId],
  );
  const currentByUserId = new Map<string, any>(currentParticipants.map((row: any) => [String(row.usuario_id), row]));
  const requestedIds = new Set(ids);
  for (const currentParticipant of currentParticipants) {
    if (!requestedIds.has(String(currentParticipant.usuario_id))) {
      await client.query(
        `UPDATE public.mantenimientos_programados_participantes
            SET estado = 'retirado',
                fecha_retiro = GREATEST(clock_timestamp(), fecha_asignacion),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [currentParticipant.id],
      );
    }
  }
  for (const item of participants) {
    const value = item.valorCalculado == null ? roundCurrency(defaultValue * item.porcentaje / 100) : Math.max(0, number(item.valorCalculado));
    const currentParticipant = currentByUserId.get(item.usuarioId);
    if (currentParticipant) {
      await client.query(
        `UPDATE public.mantenimientos_programados_participantes
            SET rol_participacion = $2,
                porcentaje = $3,
                valor_ganado = $4,
                estado = 'activo',
                fecha_retiro = NULL,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [currentParticipant.id, item.rol || "acompanante", item.porcentaje, value],
      );
    } else {
      await client.query(
        `INSERT INTO public.mantenimientos_programados_participantes
          (mantenimiento_id, usuario_id, rol_participacion, porcentaje, valor_ganado)
         VALUES ($1,$2,$3,$4,$5)`,
        [maintenanceId, item.usuarioId, item.rol || "acompanante", item.porcentaje, value],
      );
    }
    await client.query(
      `INSERT INTO public.notificaciones
        (usuario_id, tipo, titulo, mensaje, entidad_tipo, entidad_id, clave_dedupe, metadata)
       VALUES ($1,'mantenimiento',$2,$3,'mantenimiento_programado',$4,$5,$6::jsonb)
       ON CONFLICT (usuario_id, clave_dedupe) WHERE clave_dedupe IS NOT NULL DO NOTHING`,
      [
        item.usuarioId,
        "Mantenimiento asignado",
        `Tienes asignado el mantenimiento ${maintenanceLabel} para el ${dateOnly(maintenance.fecha_programada) || "día programado"}. Puedes diligenciar tu entrega de forma independiente.`,
        maintenanceId,
        `mantenimiento-asignacion:${maintenanceId}:${item.usuarioId}`,
        JSON.stringify({ mantenimientoId: maintenanceId, fechaProgramada: dateOnly(maintenance.fecha_programada), grupoId: maintenance.grupo_id }),
      ],
    );
  }
  const principal = participants.find((item) => item.rol === "principal") || participants[0];
  await client.query(
    "UPDATE public.mantenimientos_programados SET tecnico_principal_id = $2, estado = CASE WHEN estado = 'pendiente' THEN 'asignado' ELSE estado END, updated_at = clock_timestamp() WHERE id = $1",
    [maintenanceId, principal.usuarioId],
  );
  return participants;
}

async function getMaintenanceParticipantRows(maintenanceId: string) {
  const { rows } = await dbQuery(
    `SELECT mp.id, mp.mantenimiento_id, mp.usuario_id, mp.rol_participacion,
            mp.porcentaje, mp.valor_ganado AS valor_calculado, mp.estado,
            mp.created_at AS fecha_creacion,
            delivery.id AS entrega_id, delivery.estado AS estado_reporte,
            delivery.observaciones AS entrega_observaciones,
            delivery.fecha_ejecucion AS fecha_entrega,
            delivery.actividades_realizadas AS entrega_actividades_realizadas,
            delivery.tipo_pendiente AS entrega_tipo_pendiente,
            delivery.descripcion_pendiente AS entrega_descripcion_pendiente,
            delivery.receptor_nombre AS entrega_receptor_nombre,
            delivery.firmado AS entrega_firmado,
            delivery.firma_receptor_url AS entrega_firma_receptor_url,
            delivery.foto_bitacora_url AS entrega_foto_bitacora_url,
            delivery.enviado_por_id AS entrega_enviado_por_id,
            COALESCE(delivery.evidencias, '[]'::json) AS entrega_evidencias
       FROM public.mantenimientos_programados_participantes mp
       LEFT JOIN LATERAL (
         SELECT a.id AS actividad_id
           FROM public.actividades_operativas_mantenimientos am
           JOIN public.actividades_operativas a ON a.id = am.actividad_id
          WHERE am.mantenimiento_programado_id = mp.mantenimiento_id
          ORDER BY a.created_at DESC
          LIMIT 1
       ) linked ON true
       LEFT JOIN LATERAL (
         SELECT ap.id AS participante_id
           FROM public.actividades_operativas_participantes ap
          WHERE ap.actividad_id = linked.actividad_id
            AND ap.tecnico_id = mp.usuario_id
          ORDER BY ap.created_at
          LIMIT 1
       ) activity_participant ON true
       LEFT JOIN LATERAL (
         SELECT d.id, d.estado, d.observaciones, d.fecha_ejecucion,
                d.actividades_realizadas, d.tipo_pendiente,
                d.descripcion_pendiente, d.receptor_nombre, d.firmado,
                d.firma_receptor_url, d.foto_bitacora_url, d.enviado_por_id,
                (SELECT json_agg(json_build_object(
                   'id', e.id, 'participanteId', e.participante_id,
                   'tipo', e.tipo, 'bucket', e.storage_bucket,
                   'key', e.storage_key, 'url', e.url, 'orden', e.orden,
                   'subidoPorId', e.subido_por_id,
                   'fechaSubida', e.created_at
                 ) ORDER BY e.tipo, e.orden, e.created_at)
                   FROM public.actividades_operativas_evidencias e
                  WHERE e.actividad_id = d.actividad_id
                    AND e.participante_id = d.participante_id) AS evidencias
           FROM public.actividades_operativas_entregas d
           WHERE d.actividad_id = linked.actividad_id
             AND d.participante_id = activity_participant.participante_id
           ORDER BY d.updated_at DESC NULLS LAST
           LIMIT 1
       ) delivery ON true
      WHERE mp.mantenimiento_id = $1
        AND mp.estado = 'activo'
      ORDER BY mp.rol_participacion = 'principal' DESC, mp.created_at`,
    [maintenanceId],
  );
  return rows;
}

function applyOwnMaintenanceDelivery(maintenance: any, participants: any[], userId: string) {
  const ownParticipant = participants.find((participant) => String(participant.usuario_id) === String(userId));
  if (!ownParticipant || !ownParticipant.entrega_id) return maintenance;

  const evidence = jsonArray(ownParticipant.entrega_evidencias).map((item) => ({
    id: item.id,
    mantenimiento_id: maintenance.id,
    tipo: item.tipo,
    url: maintenanceEvidenceUrl(item),
    orden: number(item.orden),
    participante_id: item.participanteId || ownParticipant.id,
    fecha_subida: item.fechaSubida || "",
  })).filter((item) => Boolean(item.url));

  maintenance.actividadesRealizadas = ownParticipant.entrega_actividades_realizadas || undefined;
  maintenance.observaciones = ownParticipant.entrega_observaciones || undefined;
  maintenance.tipoPendiente = ownParticipant.entrega_tipo_pendiente || undefined;
  maintenance.descripcionPendiente = ownParticipant.entrega_descripcion_pendiente || undefined;
  maintenance.nombreReceptor = ownParticipant.entrega_receptor_nombre || undefined;
  maintenance.firmado = Boolean(ownParticipant.entrega_firmado);
  maintenance.firmaReceptorUrl = maintenanceEvidenceUrl(
    { url: ownParticipant.entrega_firma_receptor_url },
  );
  maintenance.fotoBitacoraUrl = maintenanceEvidenceUrl(
    { url: ownParticipant.entrega_foto_bitacora_url },
  )
    || evidence.find((item) => item.tipo === "bitacora")?.url
    || undefined;
  maintenance.tieneBitacora = Boolean(maintenance.fotoBitacoraUrl);
  maintenance.fotos_antes = evidence.filter((item) => item.tipo === "antes");
  maintenance.fotos_despues = evidence.filter((item) => item.tipo === "despues");
  return maintenance;
}

function reconcileMaintenanceDisplayState(maintenance: any, participants: any[]) {
  const activeParticipants = participants.filter((participant) => participant.estado === "activo");
  const anySubmitted = activeParticipants.some((participant) => ["enviada", "aprobada"].includes(String(participant.estado_reporte)));
  const allSubmitted = activeParticipants.length > 0
    && activeParticipants.every((participant) => ["enviada", "aprobada"].includes(String(participant.estado_reporte)));

  // If an old row was closed after only one participant delivered, expose its
  // effective state as pending so the remaining technicians can report. Keep
  // historical rows with no delivery untouched; those can be legacy/manual
  // closures and must not change financial history implicitly.
  if (anySubmitted && !allSubmitted && ["ejecutado", "completado", "realizado"].includes(String(maintenance.estado))) {
    maintenance.estado = "programado";
    maintenance.fechaCierre = undefined;
  } else if (allSubmitted) {
    maintenance.estado = "realizado";
  }
  return maintenance;
}

async function enrichMaintenance(row: any, userId?: string) {
  const maintenance = mapMaintenance(row);
  const participants = await getMaintenanceParticipantRows(row.id);
  maintenance.participantes = participants;
  reconcileMaintenanceDisplayState(maintenance, participants);
  if (userId) applyOwnMaintenanceDelivery(maintenance, participants, userId);
  return maintenance;
}

type MaintenanceCategory = "esta_semana" | "proximos" | "vencidos" | "historial";
type AdminMaintenanceView = "todos" | "programados" | "proximos" | "vencidos" | "realizados" | "calendario";

function addCalendarDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maintenanceWeekRange(referenceDate = bogotaClock().date) {
  const date = new Date(`${referenceDate}T00:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return {
    start: addCalendarDays(referenceDate, -daysSinceMonday),
    end: addCalendarDays(referenceDate, 6 - daysSinceMonday),
  };
}

function maintenanceCategory(payload: Payload): MaintenanceCategory {
  const value = String(payload.category || payload.tab || "esta_semana");
  return ["esta_semana", "proximos", "vencidos", "historial"].includes(value)
    ? value as MaintenanceCategory
    : "esta_semana";
}

function adminMaintenanceView(payload: Payload): AdminMaintenanceView {
  const value = String(payload.view || "todos");
  return ["todos", "programados", "proximos", "vencidos", "realizados", "calendario"].includes(value)
    ? value as AdminMaintenanceView
    : "todos";
}

/**
 * Returns the authoritative visibility rule for one mobile/web user.
 *
 * A maintenance may have one participant or many; the participant count is
 * never part of the visibility decision. Every active assignment is enough
 * for that technician to see the maintenance, while a group leader keeps
 * the group-wide view. The authenticated user parameter is used by callers,
 * never an arbitrary user id supplied by the client.
 */
function maintenanceVisibleToUserPredicate(userParam: string, maintenanceAlias = "m", groupAlias = "g") {
  return `(
    ${maintenanceAlias}.tecnico_principal_id = ${userParam}
    OR ${groupAlias}.lider_id = ${userParam}
    OR EXISTS (
      SELECT 1
        FROM public.mantenimientos_programados_participantes mp_visibility
       WHERE mp_visibility.mantenimiento_id = ${maintenanceAlias}.id
         AND mp_visibility.usuario_id = ${userParam}
         AND COALESCE(mp_visibility.estado, 'activo') = 'activo'
         AND mp_visibility.fecha_retiro IS NULL
    )
  )`;
}

function monthRange(value: unknown, fallbackDate: string) {
  const candidate = String(value || "");
  const month = /^\d{4}-\d{2}$/.test(candidate) ? candidate : fallbackDate.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

async function maintenancePageRows(payload: Payload, user: UserContext) {
  const adminView = payload.adminView === true;
  const view = adminView ? adminMaintenanceView(payload) : null;
  const category = maintenanceCategory(payload);
  const today = bogotaClock().date;
  const week = maintenanceWeekRange(today);
  const pageSize = Math.min(25, Math.max(1, Math.floor(number(payload.pageSize, 10))));
  const page = Math.max(1, Math.floor(number(payload.page, 1)));
  const offset = (page - 1) * pageSize;
  const privileged = ["admin", "supervisor"].includes(user.rol);
  const hasUserScope = !adminView && (Boolean(payload.usuarioId) || !privileged);
  const values: unknown[] = [];
  const filters: string[] = ["m.estado <> 'cancelado'"];
  const scheduledDateExpression = maintenanceScheduledDateSql();
  const globallyCompletedMaintenance = globallyCompletedMaintenancePredicate("m", scheduledDateExpression);
  const partiallySubmittedMaintenanceDelivery = partiallySubmittedMaintenanceDeliveryPredicate();
  const maintenanceDueAt = maintenanceDueAtSql("m", scheduledDateExpression);
  let userScopeParam: string | null = null;

  if (hasUserScope) {
    values.push(user.id);
    userScopeParam = `$${values.length}`;
    filters.push(maintenanceVisibleToUserPredicate(userScopeParam));
  }
  const ownSubmittedDelivery = userScopeParam ? `EXISTS (
    SELECT 1
      FROM public.actividades_operativas_mantenimientos am_scope
      JOIN public.actividades_operativas_participantes ap_scope
        ON ap_scope.actividad_id = am_scope.actividad_id
      JOIN public.actividades_operativas_entregas d_scope
        ON d_scope.actividad_id = ap_scope.actividad_id
        AND d_scope.participante_id = ap_scope.id
      WHERE am_scope.mantenimiento_programado_id = m.id
        AND (
          ap_scope.tecnico_id = ${userScopeParam}
          OR d_scope.enviado_por_id = ${userScopeParam}
        )
        AND d_scope.estado IN ('enviada', 'aprobada')
        AND COALESCE(d_scope.fecha_ejecucion, ${BOGOTA_DATE_SQL}) <= ${BOGOTA_DATE_SQL}
   )` : null;
  // Admin lists represent the state of the whole maintenance. A technician
  // can complete only their own delivery, but the global row remains pending
  // until every active participant has delivered.
  const displayDelivery = adminView ? globallyCompletedMaintenance : ownSubmittedDelivery;
  const displayStateExpression = adminView
    ? `(CASE WHEN ${globallyCompletedMaintenance} THEN 'ejecutado' ELSE m.estado END)`
    : displayDelivery
      ? `(CASE WHEN ${globallyCompletedMaintenance} OR ${displayDelivery} THEN 'ejecutado' ELSE m.estado END)`
      : "m.estado";

  if (adminView) {
    if (view === "programados") {
      filters.push("m.estado IN ('programado', 'asignado', 'en_ejecucion', 'en_progreso')");
      filters.push(`${maintenanceDueAt} >= ${BOGOTA_NOW_SQL}`);
      filters.push(`NOT (${globallyCompletedMaintenance})`);
    } else if (view === "proximos") {
      filters.push(`m.estado IN ('pendiente', 'programado', 'asignado', 'en_ejecucion', 'en_progreso')`);
      // La bandeja administrativa muestra todo lo pendiente del mes actual.
      // Los elementos anteriores a hoy siguen perteneciendo a Vencidos.
      filters.push(`${scheduledDateExpression} >= date_trunc('month', ${BOGOTA_DATE_SQL})::date`);
      filters.push(`${scheduledDateExpression} < (date_trunc('month', ${BOGOTA_DATE_SQL}) + INTERVAL '1 month')::date`);
      filters.push(`${maintenanceDueAt} >= ${BOGOTA_NOW_SQL}`);
      filters.push(`NOT (${globallyCompletedMaintenance})`);
    } else if (view === "vencidos") {
      filters.push(`${maintenanceDueAt} < ${BOGOTA_NOW_SQL}`);
      filters.push(`(
        m.estado IN ('pendiente', 'programado', 'asignado', 'en_ejecucion', 'en_progreso')
        OR (${partiallySubmittedMaintenanceDelivery})
      )`);
      filters.push(`NOT (${globallyCompletedMaintenance})`);
    } else if (view === "realizados") {
      filters.push(`${globallyCompletedMaintenance}`);
      if (payload.periodoId) {
        values.push(payload.periodoId);
        filters.push(`EXISTS (
          SELECT 1 FROM public.periodos_liquidacion period_filter
           WHERE period_filter.id = $${values.length}
              AND COALESCE(m.fecha_realizado, ${scheduledDateExpression}) BETWEEN period_filter.fecha_inicio AND period_filter.fecha_fin
        )`);
      }
    } else if (view === "calendario") {
      const range = monthRange(payload.month, today);
      values.push(range.start, range.end);
      filters.push(`${scheduledDateExpression} BETWEEN $${values.length - 1}::date AND $${values.length}::date`);
    } else if (payload.status) {
      const status = String(payload.status);
      if (status === "vencido") {
        filters.push(`${maintenanceDueAt} < ${BOGOTA_NOW_SQL}`);
        filters.push(`(
          m.estado IN ('pendiente', 'programado', 'asignado', 'en_ejecucion', 'en_progreso')
          OR (${partiallySubmittedMaintenanceDelivery})
        )`);
        filters.push(`NOT (${globallyCompletedMaintenance})`);
      } else if (status === "realizado" || status === "completado") {
        filters.push(`${globallyCompletedMaintenance}`);
      } else if (["pendiente", "programado", "asignado", "en_ejecucion", "en_progreso"].includes(status)) {
        values.push(status);
        filters.push(`m.estado = $${values.length}`);
        filters.push(`NOT (${globallyCompletedMaintenance})`);
      }
    }
  } else if (category === "historial") {
    filters.push(ownSubmittedDelivery
      ? `(${globallyCompletedMaintenance} OR ${ownSubmittedDelivery})`
      : `${globallyCompletedMaintenance}`);
  } else {
    filters.push(`NOT (${globallyCompletedMaintenance})`);
    if (ownSubmittedDelivery) filters.push(`NOT (${ownSubmittedDelivery})`);
    if (category === "esta_semana") {
      values.push(week.start, week.end);
      filters.push(`${scheduledDateExpression} BETWEEN $${values.length - 1}::date AND $${values.length}::date`);
      filters.push(`${maintenanceDueAt} >= ${BOGOTA_NOW_SQL}`);
    } else if (category === "proximos") {
      values.push(week.end);
      filters.push(`${scheduledDateExpression} > $${values.length}::date`);
    } else {
      filters.push(`${maintenanceDueAt} < ${BOGOTA_NOW_SQL}`);
    }
  }

  const search = String(payload.search || "").trim();
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    const searchParam = `$${values.length}`;
    filters.push(`lower(concat_ws(' ',
      coalesce(activity.codigo, 'MP-' || to_char(${scheduledDateExpression}, 'YYYYMMDD') || '-' || upper(left(replace(m.id::text, '-', ''), 10))),
      coalesce(activity.titulo, ''), coalesce(activity.descripcion, ''),
      coalesce(activity.descripcion_pendiente, ''), coalesce(m.observaciones, ''),
      coalesce(m.tipo_pendiente, ''), coalesce(c.nombre, ''), coalesce(s.nombre, ''), coalesce(s.direccion, ''),
      coalesce((SELECT string_agg(u.nombre || ' ' || u.apellido, ' ')
                  FROM public.mantenimientos_programados_participantes mp_search
                  JOIN public.usuarios u ON u.id = mp_search.usuario_id
                 WHERE mp_search.mantenimiento_id = m.id AND mp_search.estado = 'activo'), '')
    )) LIKE ${searchParam}`);
  }

  if (adminView && payload.month && view !== "calendario" && !(view === "programados" && search)) {
    const range = monthRange(payload.month, today);
    values.push(range.start, range.end);
    filters.push(`${scheduledDateExpression} BETWEEN $${values.length - 1}::date AND $${values.length}::date`);
  }

  const baseFrom = `
    FROM public.mantenimientos_programados m
    JOIN public.clientes c ON c.id = m.cliente_id
    LEFT JOIN public.cliente_sedes s ON s.id = m.sede_id
    LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
    LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
    LEFT JOIN LATERAL (
      SELECT am.titulo, am.descripcion_pendiente, a.descripcion, a.codigo
        FROM public.actividades_operativas_mantenimientos am
        JOIN public.actividades_operativas a ON a.id = am.actividad_id
       WHERE am.mantenimiento_programado_id = m.id
       ORDER BY a.created_at DESC
       LIMIT 1
    ) activity ON true
    WHERE ${filters.join(" AND ")}`;
  const order = adminView
    ? view === "vencidos" || view === "realizados"
      ? view === "realizados"
        ? `COALESCE(m.fecha_realizado, ${scheduledDateExpression}) DESC NULLS LAST, m.created_at DESC, m.id DESC`
        : `${maintenanceDueAt} DESC NULLS LAST, m.created_at DESC, m.id DESC`
      : view === "calendario"
        ? `${scheduledDateExpression} ASC NULLS LAST, m.created_at ASC, m.id ASC`
        : `${maintenanceDueAt} ASC NULLS LAST, m.created_at ASC, m.id ASC`
    : category === "vencidos"
      ? `${maintenanceDueAt} DESC NULLS LAST, m.created_at DESC, m.id DESC`
      : category === "historial"
        ? `COALESCE(m.fecha_realizado, ${scheduledDateExpression}) DESC NULLS LAST, m.created_at DESC, m.id DESC`
      : `${maintenanceDueAt} ASC NULLS LAST, m.created_at ASC, m.id ASC`;

  const pageValues = [...values, pageSize, offset];
  const limitParam = pageValues.length - 1;
  const offsetParam = pageValues.length;
  const { rows } = await dbQuery(
    `SELECT m.*,
      ${scheduledDateExpression} AS fecha_programada_efectiva,
      ${displayStateExpression} AS estado_usuario,
      COALESCE(activity.codigo, 'MP-' || to_char(${scheduledDateExpression}, 'YYYYMMDD') || '-' || upper(left(replace(m.id::text, '-', ''), 10))) AS codigo,
      COALESCE(activity.titulo, c.nombre, 'Mantenimiento programado') AS titulo,
      COALESCE(activity.descripcion, activity.descripcion_pendiente, m.observaciones) AS descripcion,
      c.nombre AS cliente_nombre, s.nombre AS sede_nombre, g.lider_id AS lider_id,
      COALESCE((SELECT json_agg(json_build_object(
        'id', mp.id,
        'usuario_id', mp.usuario_id,
        'rol_participacion', mp.rol_participacion,
        'porcentaje', mp.porcentaje,
        'valor_calculado', mp.valor_ganado,
        'estado', mp.estado,
        'estado_reporte', COALESCE((
          SELECT d.estado
            FROM public.actividades_operativas_mantenimientos am2
            JOIN public.actividades_operativas_participantes ap2 ON ap2.actividad_id = am2.actividad_id AND ap2.tecnico_id = mp.usuario_id
            JOIN public.actividades_operativas_entregas d ON d.actividad_id = ap2.actividad_id AND d.participante_id = ap2.id
           WHERE am2.mantenimiento_programado_id = m.id
           ORDER BY d.updated_at DESC
           LIMIT 1
        ), 'pendiente'),
        'entrega_id', (
          SELECT d.id
            FROM public.actividades_operativas_mantenimientos am2
            JOIN public.actividades_operativas_participantes ap2 ON ap2.actividad_id = am2.actividad_id AND ap2.tecnico_id = mp.usuario_id
            JOIN public.actividades_operativas_entregas d ON d.actividad_id = ap2.actividad_id AND d.participante_id = ap2.id
           WHERE am2.mantenimiento_programado_id = m.id
           ORDER BY d.updated_at DESC
           LIMIT 1
        )
      ) ORDER BY mp.rol_participacion = 'principal' DESC, mp.created_at)
        FROM public.mantenimientos_programados_participantes mp
       WHERE mp.mantenimiento_id = m.id AND mp.estado = 'activo'), '[]'::json) AS participantes,
      COUNT(*) OVER() AS total_count
    ${baseFrom}
    ORDER BY ${order}
    LIMIT $${limitParam} OFFSET $${offsetParam}`,
    pageValues,
  );

  let total = number(rows[0]?.total_count, 0);
  if (rows.length === 0 && offset > 0) {
    const countResult = await dbQuery(`SELECT COUNT(*)::int AS total ${baseFrom}`, values);
    total = number(countResult.rows[0]?.total, 0);
  }

  let adminCounts: { todos: number; programados: number; proximos: number; vencidos: number; realizados: number } | undefined;
  if (adminView && payload.includeCounts === true) {
    const countValues: unknown[] = [today];
    let realizedFilter = globallyCompletedMaintenance;
    if (payload.periodoId) {
      countValues.push(payload.periodoId);
      realizedFilter += ` AND EXISTS (
        SELECT 1 FROM public.periodos_liquidacion period_count
         WHERE period_count.id = $${countValues.length}
           AND COALESCE(m.fecha_realizado, ${scheduledDateExpression}) BETWEEN period_count.fecha_inicio AND period_count.fecha_fin
      )`;
    }
    const { rows: countRows } = await dbQuery(
      `SELECT
        COUNT(*) FILTER (WHERE m.estado <> 'cancelado')::int AS todos,
        COUNT(*) FILTER (WHERE m.estado IN ('programado', 'asignado', 'en_ejecucion', 'en_progreso')
          AND ${maintenanceDueAt} >= ${BOGOTA_NOW_SQL}
          AND NOT (${globallyCompletedMaintenance}))::int AS programados,
        COUNT(*) FILTER (WHERE m.estado IN ('pendiente', 'programado', 'asignado', 'en_ejecucion', 'en_progreso')
           AND ${scheduledDateExpression} >= date_trunc('month', $1::date)::date
           AND ${scheduledDateExpression} < (date_trunc('month', $1::date) + INTERVAL '1 month')::date
          AND ${maintenanceDueAt} >= ${BOGOTA_NOW_SQL}
          AND NOT (${globallyCompletedMaintenance}))::int AS proximos,
        COUNT(*) FILTER (WHERE (
            m.estado IN ('pendiente', 'programado', 'asignado', 'en_ejecucion', 'en_progreso')
            OR (${partiallySubmittedMaintenanceDelivery})
          )
          AND ${maintenanceDueAt} < ${BOGOTA_NOW_SQL}
          AND NOT (${globallyCompletedMaintenance}))::int AS vencidos,
        COUNT(*) FILTER (WHERE m.estado <> 'cancelado' AND ${realizedFilter})::int AS realizados
        FROM public.mantenimientos_programados m
        LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id`,
      countValues,
    );
    adminCounts = {
      todos: number(countRows[0]?.todos),
      programados: number(countRows[0]?.programados),
      proximos: number(countRows[0]?.proximos),
      vencidos: number(countRows[0]?.vencidos),
      realizados: number(countRows[0]?.realizados),
    };
  }

  let statusCounts: { pendientes: number; enProgreso: number; completados: number; total: number } | undefined;
  if (Boolean(payload.includeStatusCounts)) {
    const statusValues: unknown[] = [];
    const statusFilters = ["m.estado <> 'cancelado'", `${scheduledDateExpression} BETWEEN $1::date AND $2::date`];
    statusValues.push(week.start, week.end);
    let statusUserParam: string | null = null;
    if (hasUserScope) {
      statusValues.push(user.id);
      statusUserParam = `$${statusValues.length}`;
      statusFilters.push(maintenanceVisibleToUserPredicate(statusUserParam));
    }
    const statusOwnSubmittedDelivery = statusUserParam ? `EXISTS (
      SELECT 1
        FROM public.actividades_operativas_mantenimientos am_scope
        JOIN public.actividades_operativas_participantes ap_scope
          ON ap_scope.actividad_id = am_scope.actividad_id
        JOIN public.actividades_operativas_entregas d_scope
          ON d_scope.actividad_id = ap_scope.actividad_id
         AND d_scope.participante_id = ap_scope.id
       WHERE am_scope.mantenimiento_programado_id = m.id
         AND ap_scope.tecnico_id = ${statusUserParam}
         AND d_scope.estado IN ('enviada', 'aprobada')
         AND COALESCE(d_scope.fecha_ejecucion, ${BOGOTA_DATE_SQL}) <= ${BOGOTA_DATE_SQL}
    )` : null;
     const statusGloballyCompleted = globallyCompletedMaintenance;
    const statusPartiallySubmitted = partiallySubmittedMaintenanceDeliveryPredicate();
    const statusPendingBase = `(
      m.estado IN ('pendiente', 'programado', 'asignado')
      OR (${statusPartiallySubmitted})
    )`;
    const statusPendingFilter = statusOwnSubmittedDelivery
      ? `${statusPendingBase} AND NOT (${statusOwnSubmittedDelivery})`
      : statusPendingBase;
    const statusInProgressFilter = statusOwnSubmittedDelivery
      ? `m.estado IN ('en_progreso', 'en_ejecucion') AND NOT (${statusOwnSubmittedDelivery})`
      : "m.estado IN ('en_progreso', 'en_ejecucion')";
    const statusCompletedFilter = statusOwnSubmittedDelivery
      ? `(${statusGloballyCompleted} OR ${statusOwnSubmittedDelivery})`
      : statusGloballyCompleted;
    const { rows: counts } = await dbQuery(
      `SELECT
        COUNT(*) FILTER (WHERE ${statusPendingFilter})::int AS pendientes,
        COUNT(*) FILTER (WHERE ${statusInProgressFilter})::int AS "enProgreso",
        COUNT(*) FILTER (WHERE ${statusCompletedFilter})::int AS completados,
        COUNT(*)::int AS total
        FROM public.mantenimientos_programados m
        LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
        LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
      WHERE ${statusFilters.join(" AND ")}`,
      statusValues,
    );
    statusCounts = {
      pendientes: number(counts[0]?.pendientes),
      enProgreso: number(counts[0]?.enProgreso),
      completados: number(counts[0]?.completados),
      total: number(counts[0]?.total),
    };
  }

  return {
    items: rows.map(mapMaintenance),
    page,
    pageSize,
    total,
    totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
    hasNextPage: offset + rows.length < total,
    hasPreviousPage: page > 1 && total > 0,
    category,
    ...(adminView ? { view } : {}),
    weekStart: week.start,
    weekEnd: week.end,
    generatedAt: new Date().toISOString(),
    ...(adminCounts ? { counts: adminCounts } : {}),
    ...(statusCounts ? { statusCounts } : {}),
  };
}

function requestedUserRole(payload: Payload): string | undefined {
  if (payload.esSupervisor === true) return "supervisor";
  if (payload.esSupervisor === false && (payload.rol === undefined || payload.rol === "supervisor")) return "tecnico";
  return payload.rol === undefined ? undefined : String(payload.rol);
}

function attendanceDate(value: unknown, fallback = bogotaClock().date) {
  const candidate = String(value || fallback).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) throw new Error("La fecha de asistencia no es válida.");
  return candidate;
}

function attendanceRange(payload: Payload) {
  if (payload.fechaInicio && payload.fechaFin) {
    const start = attendanceDate(payload.fechaInicio);
    const end = attendanceDate(payload.fechaFin);
    if (start > end) throw new Error("El rango de asistencia es inválido.");
    return { start, end };
  }
  const month = String(payload.mes || bogotaClock().date.slice(0, 7)).slice(0, 7);
  const half = payload.quincena === "segunda" ? "segunda" : "primera";
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("El mes de la quincena no es válido.");
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-${half === "primera" ? "01" : "16"}`,
    end: `${month}-${String(half === "primera" ? 15 : lastDay).padStart(2, "0")}`,
  };
}

async function attendanceRows(start: string, end: string, payload: Payload = {}) {
  const values: unknown[] = [start, end];
  const conditions = ["r.fecha BETWEEN $1 AND $2"];
  if (payload.usuarioId) {
    values.push(payload.usuarioId);
    conditions.push(`r.usuario_id = $${values.length}`);
  }
  if (payload.estado && payload.estado !== "todos") {
    values.push(payload.estado);
    conditions.push(`r.estado_entrada = $${values.length}`);
  }
  if (payload.incidenciasOnly === true) {
    conditions.push(`(r.estado_entrada IN ('tarde', 'no_reportado') OR r.categoria_llegada IN ('tardanza_leve', 'tardanza_mayor', 'reposicion', 'no_reportado'))`);
  }
  if (payload.search) {
    values.push(`%${String(payload.search).trim()}%`);
    conditions.push(`((u.nombre || ' ' || u.apellido) ILIKE $${values.length}
      OR COALESCE(r.razon_tardanza, '') ILIKE $${values.length}
      OR COALESCE(r.categoria_llegada, '') ILIKE $${values.length}
      OR COALESCE(to_char(r.hora_entrada_real, 'HH24:MI'), '') ILIKE $${values.length})`);
  }
  const limit = Math.min(2000, Math.max(1, Number(payload.limit) || 500));
  const offset = Math.max(0, Number(payload.offset) || 0);
  values.push(limit, offset);
  const compactColumns = payload.compact === true
    ? `r.id, r.usuario_id, r.fecha, r.hora_entrada_programada, r.hora_entrada_real,
       r.hora_salida_programada, r.hora_salida_real, r.estado_entrada, r.estado_salida,
       r.minutos_retraso, r.minutos_adeudados, r.categoria_llegada, r.regla_id,
       r.regla_version, r.porcentaje_regla_aplicada, r.tipo_descuento, r.calculado_en,
       r.motivo_ajuste, r.ajustado_por_id, r.ajustado_en, r.razon_tardanza,
       r.descuento_aplicado, r.porcentaje_descuento, r.created_at`
    : "r.*";
  const { rows } = await dbQuery(
    `SELECT ${compactColumns},
            left(r.hora_entrada_programada::text, 5) AS hora_esperada,
            left(r.hora_entrada_real::text, 5) AS hora_llegada,
            left(r.hora_salida_programada::text, 5) AS hora_salida_programada_text,
            left(r.hora_salida_real::text, 5) AS hora_salida_real_text,
            u.nombre AS usuario_nombre,
            u.apellido AS usuario_apellido,
            u.avatar_url AS usuario_avatar,
            p.id AS periodo_id,
            p.estado AS periodo_estado,
            p.fecha_inicio AS periodo_fecha_inicio,
            p.fecha_fin AS periodo_fecha_fin,
            COALESCE((SELECT MAX(li.porcentaje_descuento_tardanza)
                        FROM public.liquidacion_items li
                       WHERE li.tecnico_id = r.usuario_id
                         AND li.periodo_id = p.id
                         AND li.estado <> 'anulado'), 0) AS liquidacion_porcentaje,
            COALESCE((SELECT SUM(li.descuento_tardanza)
                        FROM public.liquidacion_items li
                       WHERE li.tecnico_id = r.usuario_id
                         AND li.periodo_id = p.id
                         AND li.estado <> 'anulado'), 0) AS liquidacion_valor,
            (SELECT am.estado
               FROM public.asistencia_memorando_eventos ame
               JOIN public.asistencia_memorandos am ON am.id = ame.memorando_id
              WHERE ame.asistencia_id = r.id
              ORDER BY am.created_at DESC
              LIMIT 1) AS memorando_estado
       FROM public.registros_asistencia r
       JOIN public.usuarios u ON u.id = r.usuario_id
       LEFT JOIN LATERAL (
         SELECT id, estado, fecha_inicio, fecha_fin
           FROM public.periodos_liquidacion
          WHERE r.fecha BETWEEN fecha_inicio AND fecha_fin
          ORDER BY fecha_inicio DESC
          LIMIT 1
       ) p ON TRUE
      WHERE ${conditions.join(" AND ")}
      ORDER BY r.fecha DESC, r.hora_entrada_programada ASC, u.apellido ASC, u.nombre ASC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return rows;
}

function mapAttendanceRow(row: any): any {
  return {
    ...mapArrival(row),
    usuarioNombre: [row.usuario_nombre, row.usuario_apellido].filter(Boolean).join(" "),
    usuarioAvatar: row.usuario_avatar || undefined,
    periodoId: row.periodo_id || undefined,
    periodoEstado: row.periodo_estado || undefined,
    periodoFechaInicio: dateOnly(row.periodo_fecha_inicio) || undefined,
    periodoFechaFin: dateOnly(row.periodo_fecha_fin) || undefined,
    liquidacionPorcentaje: number(row.liquidacion_porcentaje),
    liquidacionValor: number(row.liquidacion_valor),
    memorandoEstado: row.memorando_estado || undefined,
  };
}

function attendanceSummary(rows: any[], fecha = "") {
  return {
    fecha,
    total: rows.length,
    reportados: rows.filter((row) => row.estado_entrada !== "no_reportado").length,
    aTiempo: rows.filter((row) => (row.categoria_llegada || row.estado_entrada) === "a_tiempo").length,
    tardanzas: rows.filter((row) => ["tardanza_leve", "tardanza_mayor"].includes(row.categoria_llegada)).length,
    reposiciones: rows.filter((row) => row.categoria_llegada === "reposicion").length,
    noReportados: rows.filter((row) => row.estado_entrada === "no_reportado").length,
    minutosAdeudados: rows.reduce((sum, row) => sum + number(row.minutos_adeudados ?? row.minutos_retraso), 0),
    descuentoTotal: rows.reduce((sum, row) => sum + number(row.porcentaje_descuento), 0),
  };
}

function inferMemoType(rows: any[]) {
  if (rows.some((row) => row.categoria_llegada === "no_reportado")) return "omision_marcacion";
  if (rows.some((row) => row.categoria_llegada === "reposicion")) return "reposicion";
  if (rows.some((row) => row.categoria_llegada === "tardanza_mayor")) return "retardo_severo";
  return "impuntualidad";
}

function mapMemo(row: any, events: any[] = []): any {
  return {
    id: row.id,
    usuarioId: row.usuario_id || undefined,
    periodoId: row.periodo_id || undefined,
    periodoFechaInicio: dateOnly(row.periodo_fecha_inicio) || undefined,
    periodoFechaFin: dateOnly(row.periodo_fecha_fin) || undefined,
    numero: row.numero,
    tipo: row.tipo,
    estado: row.estado,
    titulo: row.titulo,
    narrativa: row.narrativa || undefined,
    fundamento: row.fundamento || undefined,
    regimenSancionatorio: row.regimen_sancionatorio || undefined,
    plantillaVersion: row.plantilla_version || undefined,
    pdfUrl: row.pdf_url || undefined,
    firmadoEn: row.firmado_en || undefined,
    anuladoEn: row.anulado_en || undefined,
    motivoAnulacion: row.motivo_anulacion || undefined,
    eliminadoEn: row.eliminado_en || undefined,
    firmaTrabajadorNombre: row.firma_trabajador_nombre || undefined,
    firmaTrabajadorDocumento: row.firma_trabajador_documento || undefined,
    generadoEn: row.generado_en || row.created_at,
    usuarioNombre: [row.usuario_nombre, row.usuario_apellido].filter(Boolean).join(" "),
    eventos: events.map((event) => ({
      id: event.id,
      asistenciaId: event.asistencia_id || undefined,
      fecha: dateOnly(event.fecha_snapshot) || "",
      horaProgramada: event.hora_programada_snapshot ? String(event.hora_programada_snapshot).slice(0, 5) : undefined,
      horaLlegada: event.hora_llegada_snapshot ? String(event.hora_llegada_snapshot).slice(0, 5) : undefined,
      minutosRetraso: number(event.minutos_snapshot),
      minutosAdeudados: number(event.minutos_adeudados_snapshot),
      estado: event.estado_snapshot || undefined,
      categoria: event.categoria_snapshot || undefined,
      porcentaje: number(event.porcentaje_snapshot),
      fotoUrl: event.foto_url_snapshot || undefined,
      ubicacion: event.ubicacion_snapshot || undefined,
    })),
  };
}

async function attendanceDay(payload: Payload, user: UserContext) {
  await requireAdmin(user);
  const fecha = attendanceDate(payload.fecha);
  if (fecha === bogotaClock().date) {
    const settings = await getConfig();
    const { noReportCutoffMinutes } = attendanceThresholds(settings);
    if (noReportCutoffMinutes != null && bogotaClock().minutes >= noReportCutoffMinutes) {
      const users = (await userRows()).map((row) => mapUser(row));
      await ensureArrivals({ users, fecha, porcentajeNoReportado: settings.porcentajeDescuentoNoReportado, automaticDays: settings.diasDescuentoAutomatico }, settings);
    }
  }
  const rows = await attendanceRows(fecha, fecha, payload);
  const periodRow = rows.find((row) => row.periodo_id);
  const period = periodRow
    ? { id: periodRow.periodo_id, fechaInicio: dateOnly(periodRow.periodo_fecha_inicio), fechaFin: dateOnly(periodRow.periodo_fecha_fin), estado: periodRow.periodo_estado }
    : null;
  return { fecha, records: rows.map(mapAttendanceRow), summary: attendanceSummary(rows, fecha), period };
}

async function attendanceHistory(payload: Payload, user: UserContext) {
  await requireAdmin(user);
  const start = attendanceDate(payload.fechaInicio, bogotaClock().date);
  const end = attendanceDate(payload.fechaFin, start);
  if (start > end) throw new Error("El rango de asistencia es inválido.");
  const values: unknown[] = [start, end];
  const conditions = ["r.fecha BETWEEN $1 AND $2"];
  if (payload.usuarioId) { values.push(payload.usuarioId); conditions.push(`r.usuario_id = $${values.length}`); }
  if (payload.estado && payload.estado !== "todos") { values.push(payload.estado); conditions.push(`r.estado_entrada = $${values.length}`); }
  if (payload.search && String(payload.search).trim()) {
    values.push(`%${String(payload.search).trim()}%`);
    conditions.push(`((u.nombre || ' ' || u.apellido) ILIKE $${values.length}
      OR COALESCE(r.razon_tardanza, '') ILIKE $${values.length}
      OR COALESCE(r.categoria_llegada, '') ILIKE $${values.length}
      OR COALESCE(to_char(r.hora_entrada_real, 'HH24:MI'), '') ILIKE $${values.length})`);
  }
  const { rows: countRows } = await dbQuery(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE r.estado_entrada <> 'no_reportado')::int AS reportados,
            COUNT(*) FILTER (WHERE COALESCE(r.categoria_llegada, r.estado_entrada) = 'a_tiempo')::int AS a_tiempo,
            COUNT(*) FILTER (WHERE COALESCE(r.categoria_llegada, r.estado_entrada) IN ('tardanza_leve', 'tardanza_mayor'))::int AS tardanzas,
            COUNT(*) FILTER (WHERE r.categoria_llegada = 'reposicion')::int AS reposiciones,
            COUNT(*) FILTER (WHERE r.estado_entrada = 'no_reportado')::int AS no_reportados,
            COALESCE(SUM(COALESCE(r.minutos_adeudados, r.minutos_retraso, 0)), 0)::int AS minutos_adeudados
       FROM public.registros_asistencia r
       JOIN public.usuarios u ON u.id = r.usuario_id WHERE ${conditions.join(" AND ")}`,
    values,
  );
  const page = Math.max(1, Math.floor(number(payload.page, 1)));
  const pageSize = Math.min(100, Math.max(1, Math.floor(number(payload.pageSize, 20))));
  const rows = await attendanceRows(start, end, { ...payload, limit: pageSize, offset: (page - 1) * pageSize });
  const summary = {
    total: number(countRows[0]?.total),
    reportados: number(countRows[0]?.reportados),
    aTiempo: number(countRows[0]?.a_tiempo),
    tardanzas: number(countRows[0]?.tardanzas),
    reposiciones: number(countRows[0]?.reposiciones),
    noReportados: number(countRows[0]?.no_reportados),
    minutosAdeudados: number(countRows[0]?.minutos_adeudados),
  };
  return { fechaInicio: start, fechaFin: end, total: summary.total, page, pageSize, summary, records: rows.map(mapAttendanceRow) };
}

async function attendanceFortnightly(payload: Payload, user: UserContext) {
  await requireAdmin(user);
  const range = attendanceRange(payload);
  const rows = await attendanceRows(range.start, range.end, { ...payload, incidenciasOnly: true, compact: true, limit: 2000, offset: 0 });
  const groups = new Map<string, any>();
  for (const row of rows) {
    const current = groups.get(row.usuario_id) || { usuarioId: row.usuario_id, nombre: [row.usuario_nombre, row.usuario_apellido].filter(Boolean).join(" "), registros: [] };
    current.registros.push(mapAttendanceRow(row));
    groups.set(row.usuario_id, current);
  }
  const trabajadores = Array.from(groups.values()).map((group) => ({
    ...group,
    eventos: group.registros.length,
    minutosAdeudados: group.registros.reduce((sum: number, row: any) => sum + number(row.minutosAdeudados), 0),
    tardanzasLeves: group.registros.filter((row: any) => row.categoriaLlegada === "tardanza_leve").length,
    tardanzasMayores: group.registros.filter((row: any) => ["tardanza_mayor", "reposicion"].includes(row.categoriaLlegada)).length,
    noReportados: group.registros.filter((row: any) => row.categoriaLlegada === "no_reportado").length,
    porcentajeDescuento: Math.min(100, group.registros.reduce((sum: number, row: any) => sum + number(row.porcentajeDescuento), 0)),
  })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const summary = {
    eventos: rows.length,
    trabajadores: trabajadores.length,
    minutosAdeudados: rows.reduce((sum, row) => sum + number(row.minutos_adeudados), 0),
    tardanzasLeves: rows.filter((row) => row.categoria_llegada === "tardanza_leve").length,
    tardanzasMayores: rows.filter((row) => ["tardanza_mayor", "reposicion"].includes(row.categoria_llegada)).length,
    noReportados: rows.filter((row) => row.categoria_llegada === "no_reportado").length,
    descuentoTotal: trabajadores.reduce((sum, worker) => sum + worker.porcentajeDescuento, 0),
  };
  const period = rows.find((row) => row.periodo_id);
  return { fechaInicio: range.start, fechaFin: range.end, periodoId: period?.periodo_id || undefined, generatedAt: new Date().toISOString(), summary, trabajadores };
}

async function attendanceMemos(payload: Payload, user: UserContext) {
  await requireAdmin(user);
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (payload.usuarioId) { values.push(payload.usuarioId); conditions.push(`m.usuario_id = $${values.length}`); }
  if (payload.periodoId) { values.push(payload.periodoId); conditions.push(`m.periodo_id = $${values.length}`); }
  if (payload.estado === "eliminados") conditions.push("m.eliminado_en IS NOT NULL");
  else {
    conditions.push("m.eliminado_en IS NULL");
    if (payload.estado && payload.estado !== "todos") { values.push(payload.estado); conditions.push(`m.estado = $${values.length}`); }
  }
  if (payload.search && String(payload.search).trim()) {
    values.push(`%${String(payload.search).trim()}%`);
    conditions.push(`(m.numero ILIKE $${values.length} OR m.titulo ILIKE $${values.length}
      OR COALESCE(m.narrativa, '') ILIKE $${values.length}
      OR (u.nombre || ' ' || u.apellido) ILIKE $${values.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows: countRows } = await dbQuery(
    `SELECT COUNT(*)::int AS total FROM public.asistencia_memorandos m
       LEFT JOIN public.usuarios u ON u.id = m.usuario_id ${where}`,
    values,
  );
  const page = Math.max(1, Math.floor(number(payload.page, 1)));
  const pageSize = Math.min(100, Math.max(1, Math.floor(number(payload.pageSize, 20))));
  const pageValues = [...values, pageSize, (page - 1) * pageSize];
  const { rows } = await dbQuery(
    `SELECT m.*, u.nombre AS usuario_nombre, u.apellido AS usuario_apellido,
            p.fecha_inicio AS periodo_fecha_inicio, p.fecha_fin AS periodo_fecha_fin
       FROM public.asistencia_memorandos m
       LEFT JOIN public.usuarios u ON u.id = m.usuario_id
       LEFT JOIN public.periodos_liquidacion p ON p.id = m.periodo_id
       ${where}
      ORDER BY m.generado_en DESC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  const ids = rows.map((row) => row.id);
  const { rows: eventRows } = ids.length
    ? await dbQuery("SELECT * FROM public.asistencia_memorando_eventos WHERE memorando_id = ANY($1::uuid[]) ORDER BY memorando_id, orden, fecha_snapshot", [ids])
    : { rows: [] };
  const eventsByMemo = new Map<string, any[]>();
  for (const event of eventRows) eventsByMemo.set(event.memorando_id, [...(eventsByMemo.get(event.memorando_id) || []), event]);
  return { items: rows.map((row) => mapMemo(row, eventsByMemo.get(row.id) || [])), total: number(countRows[0]?.total), page, pageSize };
}

async function createAttendanceMemo(payload: Payload, user: UserContext) {
  await requireAdmin(user);
  const eventIds = uniqueIds(jsonArray(payload.asistenciaIds).map((id) => String(id)));
  if (!eventIds.length) throw new Error("Selecciona al menos una incidencia para generar el memorando.");
  return withTransaction(async (client) => {
    const { rows: events } = await client.query(
      `SELECT r.*, u.nombre AS usuario_nombre, u.apellido AS usuario_apellido
         FROM public.registros_asistencia r
         JOIN public.usuarios u ON u.id = r.usuario_id
        WHERE r.id = ANY($1::uuid[])
        ORDER BY r.fecha, r.hora_entrada_programada`,
      [eventIds],
    );
    if (!events.length) throw new Error("No se encontraron las asistencias seleccionadas.");
    const usuarioId = String(payload.usuarioId || events[0].usuario_id);
    if (events.some((row) => row.usuario_id !== usuarioId)) throw new Error("Un memorando solo puede contener eventos del mismo trabajador.");
    const tipo = String(payload.tipo || inferMemoType(events));
    const periodId = payload.periodoId ? String(payload.periodoId) : null;

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`attendance-memo:${usuarioId}:${periodId || "sin-periodo"}`]);
    const { rows: existingRows } = await client.query(
      `SELECT m.*
         FROM public.asistencia_memorandos m
        WHERE m.usuario_id = $1
          AND m.periodo_id IS NOT DISTINCT FROM $2::uuid
          AND m.eliminado_en IS NULL
          AND m.estado <> 'anulado'
        ORDER BY m.generado_en DESC
        LIMIT 1
        FOR UPDATE`,
      [usuarioId, periodId],
    );
    if (existingRows[0]) {
      const existingMemo = existingRows[0];
      if (existingMemo.estado !== "firmado") {
        for (const [index, event] of events.entries()) {
          await client.query(
            `INSERT INTO public.asistencia_memorando_eventos
               (memorando_id, asistencia_id, orden, fecha_snapshot, hora_programada_snapshot,
                hora_llegada_snapshot, minutos_snapshot, minutos_adeudados_snapshot,
                estado_snapshot, categoria_snapshot, porcentaje_snapshot, foto_url_snapshot,
                ubicacion_snapshot)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (memorando_id, asistencia_id) DO NOTHING`,
            [existingMemo.id, event.id, index, event.fecha, event.hora_entrada_programada,
              event.hora_entrada_real, number(event.minutos_retraso),
              number(event.minutos_adeudados ?? event.minutos_retraso), event.estado_entrada,
              event.categoria_llegada, number(event.porcentaje_descuento), event.foto_llegada_url,
              event.ubicacion_llegada_direccion],
          );
        }
        await client.query("UPDATE public.asistencia_memorandos SET updated_at = clock_timestamp() WHERE id = $1", [existingMemo.id]);
      }
      const memoResult = await client.query(
        `SELECT m.*, u.nombre AS usuario_nombre, u.apellido AS usuario_apellido
           FROM public.asistencia_memorandos m
           LEFT JOIN public.usuarios u ON u.id = m.usuario_id
          WHERE m.id = $1`,
        [existingMemo.id],
      );
      const eventResult = await client.query(
        "SELECT * FROM public.asistencia_memorando_eventos WHERE memorando_id = $1 ORDER BY orden, fecha_snapshot",
        [existingMemo.id],
      );
      return mapMemo(memoResult.rows[0], eventResult.rows);
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtext('asistencia_memo_numbering'))");
    const { rows: sequenceRows } = await client.query("SELECT COUNT(*)::int AS total FROM public.asistencia_memorandos");
    const year = dateOnly(events[0].fecha)?.slice(0, 4) || String(new Date().getFullYear());
    const numero = `MEMO-${year}-${String(number(sequenceRows[0]?.total) + 1).padStart(3, "0")}`;
    const displayName = [events[0].usuario_nombre, events[0].usuario_apellido].filter(Boolean).join(" ");
    const title = String(payload.titulo || `Llamado de atención por ${tipo.replaceAll("_", " ")}`);
    const narrative = String(payload.narrativa || `Se deja constancia de las incidencias de asistencia registradas para ${displayName} durante el período seleccionado.`);
    const memoResult = await client.query(
      `INSERT INTO public.asistencia_memorandos
         (usuario_id,periodo_id,numero,tipo,estado,titulo,narrativa,fundamento,
          regimen_sancionatorio,plantilla_version,generado_por_id)
       VALUES ($1,$2,$3,$4,'generado',$5,$6,$7,$8,'asistencia-v4-individual',$9)
       RETURNING *`,
      [usuarioId, periodId, numero, tipo, title, narrative,
        String(payload.fundamento || "").trim() || null,
        String(payload.regimenSancionatorio || "").trim() || null, user.id],
    );
    for (const [index, event] of events.entries()) {
      await client.query(
        `INSERT INTO public.asistencia_memorando_eventos
           (memorando_id,asistencia_id,orden,fecha_snapshot,hora_programada_snapshot,
            hora_llegada_snapshot,minutos_snapshot,minutos_adeudados_snapshot,
            estado_snapshot,categoria_snapshot,porcentaje_snapshot,foto_url_snapshot,ubicacion_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (memorando_id,asistencia_id) DO NOTHING`,
        [memoResult.rows[0].id, event.id, index, event.fecha, event.hora_entrada_programada,
          event.hora_entrada_real, number(event.minutos_retraso),
          number(event.minutos_adeudados ?? event.minutos_retraso), event.estado_entrada,
          event.categoria_llegada, number(event.porcentaje_descuento), event.foto_llegada_url,
          event.ubicacion_llegada_direccion],
      );
    }
    await client.query("UPDATE public.asistencia_memorandos SET updated_at = clock_timestamp() WHERE id = $1", [memoResult.rows[0].id]);
    const eventResult = await client.query("SELECT * FROM public.asistencia_memorando_eventos WHERE memorando_id = $1 ORDER BY orden", [memoResult.rows[0].id]);
    return mapMemo({ ...memoResult.rows[0], usuario_nombre: events[0].usuario_nombre, usuario_apellido: events[0].usuario_apellido }, eventResult.rows);
  });
}

async function updateAttendanceMemo(payload: Payload, user: UserContext) {
  await requireAdmin(user);
  const id = String(payload.id || "");
  if (!id) throw new Error("Falta el memorando.");
  if (payload.action === "editar") {
    const title = String(payload.titulo || "").trim();
    if (!title) throw new Error("El título del memorando es obligatorio.");
    const { rows } = await dbQuery(
      `UPDATE public.asistencia_memorandos
          SET titulo = $2, narrativa = $3, fundamento = $4, regimen_sancionatorio = $5,
              updated_at = clock_timestamp()
        WHERE id = $1 AND eliminado_en IS NULL AND estado <> 'firmado'
        RETURNING *`,
      [id, title, String(payload.narrativa || "").trim() || null, String(payload.fundamento || "").trim() || null, String(payload.regimenSancionatorio || "").trim() || null],
    );
    if (!rows[0]) throw new Error("El memorando no existe, está eliminado o ya fue firmado.");
    return mapMemo(rows[0]);
  }
  if (payload.action === "firmar") {
    const { rows } = await dbQuery("UPDATE public.asistencia_memorandos SET estado = 'firmado', firmado_en = clock_timestamp(), firma_trabajador_nombre = $2, firma_trabajador_documento = $3, updated_at = clock_timestamp() WHERE id = $1 AND eliminado_en IS NULL RETURNING *", [id, payload.nombre || null, payload.documento || null]);
    if (!rows[0]) throw new Error("El memorando no existe o está eliminado.");
    return mapMemo(rows[0]);
  }
  if (payload.action === "anular") {
    const { rows } = await dbQuery("UPDATE public.asistencia_memorandos SET estado_previo_anulacion = CASE WHEN estado = 'anulado' THEN estado_previo_anulacion ELSE estado END, estado = 'anulado', anulado_en = clock_timestamp(), motivo_anulacion = $2, updated_at = clock_timestamp() WHERE id = $1 AND eliminado_en IS NULL RETURNING *", [id, payload.motivo || "Anulado por administración"]);
    if (!rows[0]) throw new Error("El memorando no existe o está eliminado.");
    return mapMemo(rows[0]);
  }
  if (payload.action === "desanular") {
    const { rows } = await dbQuery("UPDATE public.asistencia_memorandos SET estado = COALESCE(estado_previo_anulacion, 'generado'), estado_previo_anulacion = NULL, anulado_en = NULL, motivo_anulacion = NULL, updated_at = clock_timestamp() WHERE id = $1 AND estado = 'anulado' AND eliminado_en IS NULL RETURNING *", [id]);
    if (!rows[0]) throw new Error("El memorando no está anulado o no se puede restaurar.");
    return mapMemo(rows[0]);
  }
  if (payload.action === "eliminar") {
    const { rows } = await dbQuery("UPDATE public.asistencia_memorandos SET eliminado_en = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 AND eliminado_en IS NULL RETURNING *", [id]);
    if (!rows[0]) throw new Error("El memorando ya está eliminado o no existe.");
    return mapMemo(rows[0]);
  }
  if (payload.action === "restaurar") {
    const { rows } = await dbQuery("UPDATE public.asistencia_memorandos SET eliminado_en = NULL, updated_at = clock_timestamp() WHERE id = $1 AND eliminado_en IS NOT NULL RETURNING *", [id]);
    if (!rows[0]) throw new Error("El memorando no está eliminado o no existe.");
    return mapMemo(rows[0]);
  }
  throw new Error("Acción de memorando no soportada.");
}

async function execute(action: string, payload: Payload, user: UserContext): Promise<unknown> {
  switch (action) {
    case "users.list": {
      const includeSensitiveFields = user.rol === "admin";
      return (await userRows()).map((row) => mapUser(row, includeSensitiveFields));
    }
    case "users.get": {
      const rows = await userRows("WHERE u.id = $1", [payload.id]);
      return rows[0] ? mapUser(rows[0], user.rol === "admin") : null;
    }
    case "users.create": {
      await requireAdmin(user);
      const password = String(payload.password || "");
      if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
      const passwordHash = await hashPassword(password);
      const role = requestedUserRole(payload) || "tecnico";
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO public.usuarios (username, nombre, apellido, cedula, email, telefono, rol, estado, password_hash, avatar_url, tiene_recorrido, tiene_moto, routes_enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [payload.username || String(payload.email || "").split("@")[0], payload.nombre, payload.apellido, String(payload.cedula || "").trim() || null, String(payload.email).toLowerCase(), payload.telefono || null, role, payload.estado || "activo", passwordHash, payload.avatar || null, Boolean(payload.tieneRecorrido), Boolean(payload.tieneMoto), Boolean(payload.tieneRecorrido)],
        );
        await applyUserSchedules(client, rows[0].id, payload.horarios || []);
        return rows[0].id;
      });
      const rows = await userRows("WHERE u.id = $1", [result]);
      return mapUser(rows[0], true);
    }
    case "users.update": {
      await requireAdmin(user);
      const id = payload.id;
      const fields: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => { values.push(value); fields.push(`${column} = $${values.length}`); };
      let role = requestedUserRole(payload);
      const hasLeaderFlag = typeof payload.esLider === "boolean";
      // "Líder de Grupo" del modal debe tener un efecto persistente. En V2
      // el liderazgo se refleja en el grupo; si aún no existe grupo, al menos
      // conservamos el rol de líder para que pueda ser asignado desde Grupos.
      if (payload.esLider === true && role === "tecnico") role = "lider";
      if (payload.esLider === false && role === "lider") role = payload.esSupervisor === true ? "supervisor" : "tecnico";
      for (const [key, column] of [["nombre", "nombre"], ["apellido", "apellido"], ["cedula", "cedula"], ["email", "email"], ["telefono", "telefono"], ["estado", "estado"], ["avatar", "avatar_url"], ["tieneRecorrido", "tiene_recorrido"], ["tieneMoto", "tiene_moto"]] as const) {
        if (payload[key] !== undefined) {
          const value = key === "email"
            ? String(payload[key]).toLowerCase()
            : key === "cedula"
              ? String(payload[key] || "").trim() || null
              : payload[key];
          set(column, value);
        }
      }
      if (role !== undefined) set("rol", role);
      if (payload.password) {
        const password = String(payload.password);
        if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
        set("password_hash", await hashPassword(password));
      }
      // El perfil y sus horarios se guardan en una sola transacción. Así el
      // modal nunca puede mostrar un usuario actualizado con horarios viejos
      // (o dejar el perfil a medias si falla la segunda operación).
      await withTransaction(async (client) => {
        if (fields.length > 0) {
          values.push(id);
          await client.query(`UPDATE public.usuarios SET ${fields.join(", ")}, updated_at = clock_timestamp() WHERE id = $${values.length}`, values);
        }
        if (payload.horarios !== undefined) {
          await applyUserSchedules(client, id, payload.horarios);
        }
        if (hasLeaderFlag) {
          // Primero retiramos cualquier liderazgo anterior. Esto hace que
          // apagar "Líder de Grupo" sea una operación real y no solo visual.
          await client.query(
            "UPDATE public.grupos_trabajo SET lider_id = NULL, updated_at = clock_timestamp() WHERE lider_id = $1",
            [id],
          );
        }
        if (payload.esLider === true) {
          const { rows: memberships } = await client.query(
            `SELECT gm.grupo_id
               FROM public.grupo_miembros gm
              WHERE gm.usuario_id = $1
                AND gm.fecha_inicio <= ${BOGOTA_DATE_SQL}
                AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= ${BOGOTA_DATE_SQL})
              ORDER BY gm.fecha_inicio DESC
              LIMIT 1`,
            [id],
          );
          if (memberships[0]?.grupo_id) {
            await client.query(
              "UPDATE public.grupos_trabajo SET lider_id = $1, updated_at = clock_timestamp() WHERE id = $2",
              [id, memberships[0].grupo_id],
            );
          }
        }
      });
      const rows = await userRows("WHERE u.id = $1", [id]);
      if (!rows[0]) throw new Error("No se encontró el usuario después de actualizarlo.");
      return mapUser(rows[0], true);
    }
    case "users.delete": {
      await requireAdmin(user);
      return deleteUser(payload, user);
    }

    case "groups.list": return (await groupRows()).map(mapGroup);
    case "groups.get": { const rows = await groupRows("WHERE g.id = $1", [payload.id]); return rows[0] ? mapGroup(rows[0]) : null; }
    case "groups.currentUserContext": return currentUserGroupContext(user.id);
    case "groups.create": {
      await requireAdmin(user);
      const id = await withTransaction(async (client) => {
        const leaderId = normalizeOptionalId(payload.liderId);
        const memberIds = uniqueIds([
          ...idList(payload.miembros ?? payload.members ?? payload.memberIds),
          ...(leaderId ? [leaderId] : []),
        ]);
        const reporterIds = idList(payload.reporterosIds ?? payload.reporterIds ?? payload.reporters);
        const { rows } = await client.query("INSERT INTO public.grupos_trabajo (nombre, lider_id, estado) VALUES ($1,$2,$3) RETURNING id", [payload.nombre, leaderId, payload.estado || "activo"]);
        await replaceGroupMembers(client, rows[0].id, memberIds, reporterIds);
        return rows[0].id;
      });
      const rows = await groupRows("WHERE g.id = $1", [id]); return mapGroup(rows[0]);
    }
    case "groups.update": {
      await requireAdmin(user);
      const hasLeader = Object.prototype.hasOwnProperty.call(payload, "liderId");
      const hasMembers = Object.prototype.hasOwnProperty.call(payload, "miembros")
        || Object.prototype.hasOwnProperty.call(payload, "members")
        || Object.prototype.hasOwnProperty.call(payload, "memberIds");
      const hasReporters = Object.prototype.hasOwnProperty.call(payload, "reporterosIds")
        || Object.prototype.hasOwnProperty.call(payload, "reporterIds")
        || Object.prototype.hasOwnProperty.call(payload, "reporters");
      await withTransaction(async (client) => {
        const existing = await client.query("SELECT lider_id FROM public.grupos_trabajo WHERE id = $1 FOR UPDATE", [payload.id]);
        if (!existing.rows[0]) throw new Error("No se encontró el grupo que intentas actualizar.");
        const leaderId = hasLeader ? normalizeOptionalId(payload.liderId) : existing.rows[0].lider_id;
        await client.query(
          `UPDATE public.grupos_trabajo
              SET nombre = COALESCE($2,nombre),
                  lider_id = CASE WHEN $3::boolean THEN $4::uuid ELSE lider_id END,
                  estado = COALESCE($5,estado),
                  updated_at = clock_timestamp()
            WHERE id = $1`,
          [payload.id, payload.nombre, hasLeader, leaderId, payload.estado],
        );
        if (hasMembers || hasReporters || hasLeader) {
          const memberIds = hasMembers
            ? idList(payload.miembros ?? payload.members ?? payload.memberIds)
            : (await client.query(
              `SELECT usuario_id
                 FROM public.grupo_miembros
                WHERE grupo_id = $1
                  AND fecha_inicio <= ${BOGOTA_DATE_SQL}
                  AND (fecha_fin IS NULL OR fecha_fin >= ${BOGOTA_DATE_SQL})`,
              [payload.id],
            )).rows.map((row: any) => String(row.usuario_id));
          const reporterIds = hasReporters
            ? idList(payload.reporterosIds ?? payload.reporterIds ?? payload.reporters)
            : (await client.query(
              `SELECT usuario_id
                 FROM public.grupo_reportadores_actividad
                WHERE grupo_id = $1
                  AND fecha_inicio <= ${BOGOTA_DATE_SQL}
                  AND (fecha_fin IS NULL OR fecha_fin >= ${BOGOTA_DATE_SQL})`,
              [payload.id],
            )).rows.map((row: any) => String(row.usuario_id));
          if (leaderId) memberIds.push(leaderId);
          await replaceGroupMembers(client, payload.id, uniqueIds(memberIds), uniqueIds(reporterIds));
        }
      });
      const rows = await groupRows("WHERE g.id = $1", [payload.id]); return mapGroup(rows[0]);
    }
    case "groups.delete": { await requireAdmin(user); return deleteGroup(payload); }

    case "clients.list": return (await clientRows()).map(mapClient);
    case "clients.get": { const rows = await clientRows("WHERE c.id = $1", [payload.id]); return rows[0] ? mapClient(rows[0]) : null; }
    case "clients.create": {
      await requireAdmin(user);
      const id = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO public.clientes (nombre, identificador_fiscal, correo, correo_aliado, telefono, contacto_nombre, frecuencia_mantenimiento, estado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [payload.nombre, payload.nitCedula || null, payload.correo || null, payload.correoAliado || null, payload.telefono || null, payload.contacto || null, number(payload.frecuenciaMantenimiento, 4), payload.estado || "activo"],
        );
        await client.query("INSERT INTO public.cliente_sedes (cliente_id, nombre, direccion, puertas_peatonales, puertas_vehiculares, estado) VALUES ($1,$2,$3,$4,$5,'activo')", [rows[0].id, payload.edificio || "Sede principal", payload.direccion || "Pendiente", number(payload.puertasPeatonales), number(payload.puertasVehiculares)]);
        return rows[0].id;
      });
      const rows = await clientRows("WHERE c.id = $1", [id]); return mapClient(rows[0]);
    }
    case "clients.update": {
      await requireAdmin(user);
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE public.clientes SET nombre = COALESCE($2,nombre), identificador_fiscal = $3, correo = $4, correo_aliado = $5,
             telefono = $6, contacto_nombre = $7, frecuencia_mantenimiento = COALESCE($8,frecuencia_mantenimiento), estado = COALESCE($9,estado), updated_at = clock_timestamp()
           WHERE id = $1`,
          [payload.id, payload.nombre, payload.nitCedula || null, payload.correo || null, payload.correoAliado || null, payload.telefono || null, payload.contacto || null, payload.frecuenciaMantenimiento, payload.estado],
        );
        const { rows } = await client.query("SELECT id FROM public.cliente_sedes WHERE cliente_id = $1 ORDER BY created_at ASC LIMIT 1", [payload.id]);
        if (rows[0]) await client.query("UPDATE public.cliente_sedes SET nombre = COALESCE($2,nombre), direccion = COALESCE($3,direccion), puertas_peatonales = COALESCE($4,puertas_peatonales), puertas_vehiculares = COALESCE($5,puertas_vehiculares), updated_at = clock_timestamp() WHERE id = $1", [rows[0].id, payload.edificio, payload.direccion, payload.puertasPeatonales, payload.puertasVehiculares]);
        else await client.query("INSERT INTO public.cliente_sedes (cliente_id, nombre, direccion, puertas_peatonales, puertas_vehiculares) VALUES ($1,$2,$3,$4,$5)", [payload.id, payload.edificio || "Sede principal", payload.direccion || "Pendiente", number(payload.puertasPeatonales), number(payload.puertasVehiculares)]);
      });
      const rows = await clientRows("WHERE c.id = $1", [payload.id]); return mapClient(rows[0]);
    }
    case "clients.delete": { await requireAdmin(user); return deleteClient(payload); }

    case "catalog.list": {
      const { rows } = await dbQuery(`SELECT a.*, p.valor FROM public.catalogo_actividades a LEFT JOIN LATERAL (SELECT valor FROM public.catalogo_actividad_precios WHERE actividad_id = a.id ORDER BY fecha_inicio DESC LIMIT 1) p ON true ORDER BY a.codigo`);
      return rows.map((row) => ({ id: row.id, codigo: row.codigo, nombre: row.nombre || row.descripcion || "", categoria: row.categoria || undefined, descripcion: row.descripcion || row.nombre || "", valorEconomico: number(row.valor), estado: row.estado, historialPrecios: [], fechaCreacion: dateOnly(row.created_at) || "" }));
    }
    case "catalog.create": {
      await requireAdmin(user);
      const id = await withTransaction(async (client) => {
        const { rows } = await client.query("INSERT INTO public.catalogo_actividades (codigo, nombre, descripcion, estado) VALUES ($1,$2,$3,$4) RETURNING id", [payload.codigo, payload.descripcion, payload.descripcion, payload.estado || "activo"]);
        await client.query(`INSERT INTO public.catalogo_actividad_precios (actividad_id, valor, fecha_inicio) VALUES ($1,$2,${BOGOTA_DATE_SQL})`, [rows[0].id, number(payload.valorEconomico)]);
        return rows[0].id;
      });
      return (await execute("catalog.list", {}, user) as any[]).find((item) => item.id === id);
    }
    case "catalog.update": {
      await requireAdmin(user);
      await withTransaction(async (client) => {
        const { rows: current } = await client.query("SELECT valor FROM public.catalogo_actividad_precios WHERE actividad_id = $1 ORDER BY fecha_inicio DESC LIMIT 1", [payload.id]);
        await client.query("UPDATE public.catalogo_actividades SET codigo = COALESCE($2,codigo), nombre = COALESCE($3,nombre), descripcion = COALESCE($3,descripcion), estado = COALESCE($4,estado), updated_at = clock_timestamp() WHERE id = $1", [payload.id, payload.codigo, payload.descripcion, payload.estado]);
        if (payload.valorEconomico !== undefined && number(current[0]?.valor) !== number(payload.valorEconomico)) {
          await client.query(`UPDATE public.catalogo_actividad_precios SET fecha_fin = ${BOGOTA_DATE_SQL} - 1 WHERE actividad_id = $1 AND fecha_fin IS NULL`, [payload.id]);
          await client.query(`INSERT INTO public.catalogo_actividad_precios (actividad_id, valor, fecha_inicio) VALUES ($1,$2,${BOGOTA_DATE_SQL})`, [payload.id, number(payload.valorEconomico)]);
        }
      });
      return (await execute("catalog.list", {}, user) as any[]).find((item) => item.id === payload.id);
    }
    case "catalog.delete": { await requireAdmin(user); return deleteCatalogActivity(payload); }

    case "config.get": return getConfig();
    case "config.update": { await requireAdmin(user); return updateConfig(payload); }

    case "dashboard.metrics": { await requireAdmin(user); return dashboardMetrics(payload); }

    case "periods.list": return (await periodRows()).map(mapPeriod);
    case "periods.create": { await requireAdmin(user); const { rows } = await dbQuery("INSERT INTO public.periodos_liquidacion (fecha_inicio, fecha_fin, estado, fecha_cierre) VALUES ($1,$2,$3,$4) RETURNING *", [payload.fechaInicio, payload.fechaFin, payload.estado || "abierto", payload.estado === "cerrado" ? new Date().toISOString() : null]); return mapPeriod(rows[0]); }
    case "periods.update": { await requireAdmin(user); const { rows } = await dbQuery("UPDATE public.periodos_liquidacion SET fecha_inicio = COALESCE($2,fecha_inicio), fecha_fin = COALESCE($3,fecha_fin), estado = COALESCE($4,estado), fecha_cierre = CASE WHEN $4 = 'cerrado' THEN COALESCE(fecha_cierre,clock_timestamp()) WHEN $4 = 'abierto' THEN NULL ELSE fecha_cierre END, updated_at = clock_timestamp() WHERE id = $1 RETURNING *", [payload.id, payload.fechaInicio, payload.fechaFin, payload.estado]); return mapPeriod(rows[0]); }
    case "periods.close": {
      await requireAdmin(user);
      await freezeLiquidationPeriod(String(payload.id || ""));
      const { rows } = await dbQuery("SELECT * FROM public.periodos_liquidacion WHERE id = $1", [payload.id]);
      return mapPeriod(rows[0]);
    }
    case "periods.delete": { await requireAdmin(user); await dbQuery("DELETE FROM public.periodos_liquidacion WHERE id = $1", [payload.id]); return true; }

    case "permissions.canReport": {
      if (!payload.grupoId) return false;
      const { rows } = await dbQuery(
        "SELECT public.usuario_puede_reportar_grupo($1::uuid, $2::uuid, COALESCE($3::date, (now() AT TIME ZONE 'America/Bogota')::date)) AS permitido",
        [user.id, payload.grupoId, dateOnly(payload.fecha) || null],
      );
      return Boolean(rows[0]?.permitido);
    }

    case "contracts.list": {
      const { rows } = await dbQuery("SELECT * FROM public.contratos_mantenimiento ORDER BY anio DESC, created_at DESC");
      const ids = rows.map((row) => row.id);
      const { rows: maintenanceRows } = ids.length ? await dbQuery("SELECT * FROM public.mantenimientos_programados WHERE contrato_id = ANY($1::uuid[]) ORDER BY fecha_programada, numero", [ids]) : { rows: [] };
      return rows.map((row) => mapContract(row, maintenanceRows.filter((item) => item.contrato_id === row.id)));
    }
    case "contracts.create": { await requireAdmin(user); return createContract(payload, user); }
    case "contracts.update": { await requireAdmin(user); return updateContract(payload, user); }
    case "contracts.updateMaintenance": {
      await requireAdmin(user);
      const normalizedState = payload.estado === "realizado" ? "ejecutado" : payload.estado;
      const { rows: currentRows } = await dbQuery(
        `SELECT m.*, cm.anio AS contrato_anio, cm.mes_inicio AS contrato_mes_inicio,
                cm.dia_inicio AS contrato_dia_inicio,
                cm.cantidad_mantenimientos AS contrato_cantidad_mantenimientos
           FROM public.mantenimientos_programados m
           LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
          WHERE m.id = $1`,
        [payload.id],
      );
      const current = currentRows[0];
      if (!current) throw new Error("No se encontró el mantenimiento del contrato que intentas actualizar.");
      const contractDate = current.contrato_id
        ? contractMaintenanceScheduledDate(current, current.numero)
        : null;
      // Las fechas de un mantenimiento perteneciente a un contrato son
      // derivadas del cronograma contractual. Solo las filas independientes
      // pueden recibir una fecha manual desde este endpoint.
      const scheduledDate = dateOnly(payload.fechaProgramada) || dateOnly(current.fecha_programada) || contractDate;
      const { rows } = await dbQuery(
        `UPDATE public.mantenimientos_programados
            SET estado = COALESCE($2, estado),
                fecha_programada = COALESCE($3::date, fecha_programada),
                fecha_realizado = CASE
                  WHEN $2 = 'ejecutado' THEN GREATEST(
                    COALESCE($4::date, fecha_realizado, (now() AT TIME ZONE 'America/Bogota')::date),
                    COALESCE($3::date, fecha_programada)
                  )
                  WHEN $3::date IS NOT NULL AND fecha_realizado IS NOT NULL AND fecha_realizado < $3::date THEN NULL
                  ELSE COALESCE($4::date, fecha_realizado)
                END,
                tecnico_principal_id = COALESCE($5, tecnico_principal_id),
                valor_recaudado = COALESCE($6, valor_recaudado),
                admin_completado_at = CASE WHEN $2 IS NULL OR $2 = 'ejecutado' THEN admin_completado_at ELSE NULL END,
                admin_completado_por_id = CASE WHEN $2 IS NULL OR $2 = 'ejecutado' THEN admin_completado_por_id ELSE NULL END,
                updated_at = clock_timestamp()
          WHERE id = $1
          RETURNING *`,
        [payload.id, normalizedState, scheduledDate, payload.fechaRealizado, payload.tecnicoId, payload.valorRecaudado],
      );
      return {
        id: rows[0].id,
        numero: number(rows[0].numero),
        mes: Number(String(rows[0].fecha_programada || "").slice(5, 7)) || number(rows[0].numero),
        fechaProgramada: dateOnly(rows[0].fecha_programada),
        fechaRealizado: dateOnly(rows[0].fecha_realizado) || undefined,
        tecnicoId: rows[0].tecnico_principal_id || undefined,
        estado: rows[0].estado === "ejecutado" ? "realizado" : rows[0].estado,
        valorRecaudado: number(rows[0].valor_recaudado),
      };
    }
    case "contracts.delete": { await requireAdmin(user); return deleteContract(payload); }

    case "maintenances.page": return maintenancePageRows(payload, user);
    case "maintenances.adminPage": { await requireAdmin(user); return maintenancePageRows({ ...payload, adminView: true }, user); }
    case "maintenances.list": {
      const hasUserScope = Boolean(payload.usuarioId) || !["admin", "supervisor"].includes(user.rol);
      const values: unknown[] = hasUserScope ? [user.id] : [];
      const scope = hasUserScope
        ? `WHERE ${maintenanceVisibleToUserPredicate("$1")}`
        : "";
      const requestedLimit = payload.limit === undefined || payload.limit === null
        ? null
        : Math.min(25, Math.max(1, Math.floor(number(payload.limit, 6))));
      const listValues = [...values];
      const limitClause = requestedLimit === null
        ? ""
        : (() => {
            listValues.push(requestedLimit);
            return ` LIMIT $${listValues.length}`;
          })();
      const { rows } = await dbQuery(`SELECT m.*, ${maintenanceScheduledDateSql()} AS fecha_programada_efectiva,
        cm.anio AS contrato_anio, cm.mes_inicio AS contrato_mes_inicio,
        cm.dia_inicio AS contrato_dia_inicio, cm.cantidad_mantenimientos AS contrato_cantidad_mantenimientos,
        c.nombre AS cliente_nombre, s.nombre AS sede_nombre, g.lider_id AS lider_id,
        COALESCE((SELECT json_agg(json_build_object(
          'id', mp.id,
          'usuario_id', mp.usuario_id,
          'rol_participacion', mp.rol_participacion,
          'porcentaje', mp.porcentaje,
          'valor_calculado', mp.valor_ganado,
          'estado', mp.estado,
          'estado_reporte', COALESCE((
            SELECT d.estado
              FROM public.actividades_operativas_mantenimientos am2
              JOIN public.actividades_operativas_participantes ap2 ON ap2.actividad_id = am2.actividad_id AND ap2.tecnico_id = mp.usuario_id
              JOIN public.actividades_operativas_entregas d ON d.actividad_id = ap2.actividad_id AND d.participante_id = ap2.id
             WHERE am2.mantenimiento_programado_id = m.id
             ORDER BY d.updated_at DESC
             LIMIT 1
          ), 'pendiente'),
          'entrega_id', (
            SELECT d.id
              FROM public.actividades_operativas_mantenimientos am2
              JOIN public.actividades_operativas_participantes ap2 ON ap2.actividad_id = am2.actividad_id AND ap2.tecnico_id = mp.usuario_id
              JOIN public.actividades_operativas_entregas d ON d.actividad_id = ap2.actividad_id AND d.participante_id = ap2.id
             WHERE am2.mantenimiento_programado_id = m.id
             ORDER BY d.updated_at DESC
             LIMIT 1
          )
        ) ORDER BY mp.rol_participacion = 'principal' DESC, mp.created_at)
          FROM public.mantenimientos_programados_participantes mp
         WHERE mp.mantenimiento_id = m.id AND mp.estado = 'activo'), '[]'::json) AS participantes
        FROM public.mantenimientos_programados m
         JOIN public.clientes c ON c.id = m.cliente_id
         LEFT JOIN public.cliente_sedes s ON s.id = m.sede_id
         LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
         LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
         ${scope}
         ORDER BY ${maintenanceScheduledDateSql()} DESC, m.created_at DESC${limitClause}`, listValues);
      return rows.map(mapMaintenance);
    }
    case "maintenances.overdue": { await requireAdmin(user); return overdueMaintenanceRows(payload); }
    case "maintenances.get": {
      if (!["admin", "supervisor"].includes(user.rol)) {
        const { rows: permissionRows } = await dbQuery(
          "SELECT public.usuario_puede_reportar_mantenimiento($1::uuid, $2::uuid) AS permitido",
          [user.id, payload.id],
        );
        if (!permissionRows[0]?.permitido) return null;
      }
      const { rows } = await dbQuery(`SELECT m.*, ${maintenanceScheduledDateSql()} AS fecha_programada_efectiva,
        cm.anio AS contrato_anio, cm.mes_inicio AS contrato_mes_inicio,
        cm.dia_inicio AS contrato_dia_inicio, cm.cantidad_mantenimientos AS contrato_cantidad_mantenimientos,
        c.nombre AS cliente_nombre, s.nombre AS sede_nombre, g.lider_id AS lider_id
         FROM public.mantenimientos_programados m
         JOIN public.clientes c ON c.id = m.cliente_id
         LEFT JOIN public.cliente_sedes s ON s.id = m.sede_id
         LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
         LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
        WHERE m.id = $1`, [payload.id]);
      if (!rows[0]) return null;
      const maintenance = await enrichMaintenance(rows[0], user.id);
      return maintenance;
    }
    case "maintenances.create": { await requireAdmin(user); return createMaintenance(payload, user); }
    case "maintenances.markCompleted": {
      await requireAdmin(user);
      const maintenanceId = String(payload.id || "").trim();
      if (!maintenanceId) throw new Error("No se recibió el mantenimiento que se marcará como realizado.");

      const completedDate = dateOnly(payload.fechaRealizado) || bogotaClock().date;
      const { rows: currentRows } = await dbQuery(
        "SELECT id, estado, fecha_programada FROM public.mantenimientos_programados WHERE id = $1",
        [maintenanceId],
      );
      const current = currentRows[0];
      if (!current) throw new Error("No se encontró el mantenimiento vencido.");
      if (current.estado === "cancelado") throw new Error("Un mantenimiento cancelado no puede marcarse como realizado.");

      // This action intentionally changes only the scheduled maintenance row.
      // It does not edit the contract, regenerate dates, replace participants,
      // or remove any independent technician delivery/evidence.
      await dbQuery(
        `UPDATE public.mantenimientos_programados
            SET estado = 'ejecutado',
                fecha_realizado = COALESCE(fecha_realizado, $2::date),
                admin_completado_at = clock_timestamp(),
                admin_completado_por_id = $3::uuid,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [maintenanceId, completedDate, user.id],
      );

      const { rows } = await dbQuery(
        `SELECT m.*, ${maintenanceScheduledDateSql()} AS fecha_programada_efectiva,
                cm.anio AS contrato_anio, cm.mes_inicio AS contrato_mes_inicio,
                cm.dia_inicio AS contrato_dia_inicio, cm.cantidad_mantenimientos AS contrato_cantidad_mantenimientos,
                c.nombre AS cliente_nombre, s.nombre AS sede_nombre, g.lider_id AS lider_id
           FROM public.mantenimientos_programados m
           JOIN public.clientes c ON c.id = m.cliente_id
           LEFT JOIN public.cliente_sedes s ON s.id = m.sede_id
           LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
           LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
          WHERE m.id = $1`,
        [maintenanceId],
      );
      return rows[0] ? enrichMaintenance(rows[0]) : null;
    }
    case "maintenances.update": {
      const { rows: currentRows } = await dbQuery(
        `SELECT m.*, g.lider_id AS mantenimiento_lider_id,
                cm.anio AS contrato_anio, cm.mes_inicio AS contrato_mes_inicio,
                cm.dia_inicio AS contrato_dia_inicio,
                cm.cantidad_mantenimientos AS contrato_cantidad_mantenimientos
           FROM public.mantenimientos_programados m
           LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
           LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
          WHERE m.id = $1`,
        [payload.id],
      );
      const current = currentRows[0];
      if (!current) throw new Error("No se encontró el mantenimiento que intentas actualizar.");

      const isPrivileged = ["admin", "supervisor"].includes(user.rol);
      const { rows: permissionRows } = await dbQuery(
        "SELECT public.usuario_puede_reportar_mantenimiento($1::uuid, $2::uuid) AS permitido",
        [user.id, payload.id],
      );
      if (!isPrivileged && !permissionRows[0]?.permitido) {
        throw new Error("No tienes permisos para actualizar este mantenimiento.");
      }
      if (payload.participantes !== undefined && !isPrivileged) {
        throw new Error("Solo un administrador o supervisor puede cambiar los técnicos asignados.");
      }

      const normalizedState = ["realizado", "completado"].includes(String(payload.estado)) ? "ejecutado" : payload.estado;
      const contractDate = current.contrato_id
        ? contractMaintenanceScheduledDate(current, current.numero)
        : null;
      // Nunca permitimos que una edición administrativa desincronice una
      // fila contractual. Las filas sin contrato conservan la edición manual.
      const scheduledDate = dateOnly(payload.fechaProgramada) || dateOnly(current.fecha_programada) || contractDate;
      if (normalizedState === "ejecutado" && scheduledDate && scheduledDate > bogotaClock().date) {
        throw new Error(`Este mantenimiento estará disponible desde el ${scheduledDate}.`);
      }
      await withTransaction(async (client) => {
        if (payload.participantes !== undefined) await replaceMaintenanceParticipants(client, payload.id, payload, user.id);
        const editable = isPrivileged;
        await client.query(
          `UPDATE public.mantenimientos_programados
              SET cliente_id = CASE WHEN $2::boolean THEN COALESCE($3, cliente_id) ELSE cliente_id END,
                  sede_id = CASE WHEN $2::boolean THEN COALESCE($4, sede_id) ELSE sede_id END,
                  fecha_programada = CASE WHEN $2::boolean THEN COALESCE($5, fecha_programada) ELSE fecha_programada END,
                  hora_programada = CASE WHEN $2::boolean THEN COALESCE($6, hora_programada) ELSE hora_programada END,
                  tecnico_principal_id = CASE WHEN $2::boolean THEN COALESCE($7, tecnico_principal_id) ELSE tecnico_principal_id END,
                  grupo_id = CASE WHEN $2::boolean THEN COALESCE($8, grupo_id) ELSE grupo_id END,
                  estado = COALESCE($9, estado),
                  fecha_realizado = CASE WHEN $9 = 'ejecutado' THEN COALESCE($10::date, (now() AT TIME ZONE 'America/Bogota')::date) ELSE COALESCE($10::date, fecha_realizado) END,
                  admin_completado_at = CASE WHEN $9 IS NULL OR $9 = 'ejecutado' THEN admin_completado_at ELSE NULL END,
                  admin_completado_por_id = CASE WHEN $9 IS NULL OR $9 = 'ejecutado' THEN admin_completado_por_id ELSE NULL END,
                  observaciones = COALESCE($11, observaciones),
                  tipo_pendiente = $12,
                  descripcion_pendiente = $13,
                  costo_tecnico_presupuestado = CASE WHEN $2::boolean AND $14::numeric IS NOT NULL THEN GREATEST(0, $14::numeric) ELSE costo_tecnico_presupuestado END,
                  updated_at = clock_timestamp()
            WHERE id = $1`,
          [payload.id, editable, payload.clienteId || null, payload.sedeId || null, scheduledDate, payload.horaProgramada || null, payload.tecnicoId || null, payload.grupoId || null, normalizedState || null, dateOnly(payload.fechaCierre) || null, payload.observaciones, payload.tipoPendiente || null, payload.descripcionPendiente || null, payload.costoTecnicoTotal === undefined ? null : Math.max(0, number(payload.costoTecnicoTotal))],
        );
      });
      const { rows } = await dbQuery(`SELECT m.*, ${maintenanceScheduledDateSql()} AS fecha_programada_efectiva,
        cm.anio AS contrato_anio, cm.mes_inicio AS contrato_mes_inicio,
        cm.dia_inicio AS contrato_dia_inicio, cm.cantidad_mantenimientos AS contrato_cantidad_mantenimientos,
        c.nombre AS cliente_nombre, s.nombre AS sede_nombre, g.lider_id AS lider_id
         FROM public.mantenimientos_programados m
         JOIN public.clientes c ON c.id = m.cliente_id
         LEFT JOIN public.cliente_sedes s ON s.id = m.sede_id
         LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
         LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
        WHERE m.id = $1`, [payload.id]);
      return rows[0] ? enrichMaintenance(rows[0]) : null;
    }
    case "maintenances.delete": {
      await requireAdmin(user);
      const maintenanceId = String(payload.id || "").trim();
      if (!maintenanceId) throw new Error("Debes indicar el mantenimiento que deseas eliminar.");

      return withTransaction(async (client) => {
        const { rows: maintenanceRows } = await client.query(
          "SELECT id FROM public.mantenimientos_programados WHERE id = $1 FOR UPDATE",
          [maintenanceId],
        );
        const target = maintenanceRows[0];
        if (!target) throw new Error("No se encontró el mantenimiento que intentas eliminar.");

        // A preventive maintenance may already have a consolidated operational
        // report, approvals, deliveries, evidence and liquidation items. Find
        // those activities before removing the maintenance link, then delete
        // everything in the same transaction so approvals cannot survive as
        // orphaned rows.
        const { rows: activityRows } = await client.query(
          `SELECT a.id
             FROM public.actividades_operativas_mantenimientos am
             JOIN public.actividades_operativas a ON a.id = am.actividad_id
            WHERE am.mantenimiento_programado_id = $1
            FOR UPDATE OF a`,
          [maintenanceId],
        );
        await deleteOperationalActivities(client, activityRows.map((row: any) => row.id));
        await deleteScheduledMaintenances(client, [maintenanceId]);

        return {
          deleted: true,
          archived: false,
          id: maintenanceId,
          message: `Mantenimiento ${maintenanceId} eliminado definitivamente junto con sus reportes, aprobaciones y liquidaciones.`,
        };
      });
    }
    case "maintenances.reports": {
      const rows = await activityRows({});
      return rows.filter((row) => row.tipo === "mantenimiento").flatMap((row) => {
        const participants = jsonArray(row.participantes);
        return (participants.length ? participants : [null]).map((participant, index) => {
          const report = mapReport(row, participant, index);
          return {
            id: report.id,
            codigoRegistro: report.codigoRegistro,
            mantenimientoId: report.mantenimientoId,
            tecnicoId: report.tecnicoId,
            clienteId: report.clienteId,
            fotosAntes: report.fotosAntes || [],
            fotosDespues: report.fotosDespues || [],
            observaciones: report.observaciones || "",
            fechaGeneracion: row.created_at,
            enviado: Boolean(participant?.entregaId),
          };
        });
      });
    }

    case "activities.create": return createOperationalActivity(payload, user);
    case "maintenances.submitParticipant": return submitMaintenanceParticipant(payload, user);
    case "activities.addParticipant": return addOperationalParticipant(payload, user);
    case "activities.update": return updateOperationalActivity(payload, user);
    case "activities.finalize": return finalizeOperationalActivity(payload);
    case "activities.byCode": {
      const rows = await activityRows({});
      return rows.filter((row) => row.codigo === payload.codigo).map((row) => mapReport(row, jsonArray(row.participantes)[0], 0));
    }
    case "reports.list": return reportRows(payload);
    case "reports.page": return reportPageRows(payload);
    case "reports.export": return exportReportRows(payload);
    case "reports.approval": return updateApproval(payload, user);
    case "reports.cost": return updateActivityValues(payload);
    case "reports.clientCost": return updateActivityValues({ ...payload, clientCost: payload.value });
    case "reports.activityBase": return updateActivityValues(payload);
    case "reports.emailSent": return markReportEmail(payload);
    case "reports.delete": { await requireAdmin(user); await dbQuery("UPDATE public.actividades_operativas SET estado = 'cancelada', updated_at = clock_timestamp() WHERE id = $1", [canonicalActivityId(payload.id)]); return true; }
    case "reports.batches": {
      const { rows } = await dbQuery("SELECT l.*, COALESCE((SELECT json_agg(lai.aprobacion_id) FROM public.lote_aprobacion_items lai WHERE lai.lote_id = l.id),'[]'::json) AS aprobaciones FROM public.lotes_aprobacion l ORDER BY l.cerrado_en DESC");
      return rows.map((row) => ({ id: row.id, liderId: row.lider_id, grupoId: row.grupo_id, periodoId: row.periodo_id, reportesAprobados: jsonArray(row.aprobaciones), fechaCierre: dateOnly(row.cerrado_en), costoLiderPorRevision: number(row.costo_por_revision), totalRevisiones: number(row.total_revisiones), totalCostoLider: number(row.total_costo) }));
    }
    case "reports.accumulations": {
      const { rows } = await dbQuery("SELECT u.id AS lider_id, p.id AS periodo_id FROM public.usuarios u CROSS JOIN public.periodos_liquidacion p WHERE u.rol = 'lider' OR EXISTS (SELECT 1 FROM public.grupos_trabajo g WHERE g.lider_id = u.id AND g.estado = 'activo') ORDER BY p.fecha_inicio DESC, u.email");
      // Every leader/period pair used to execute the complete canonical
      // liquidation query. With several leaders and periods that created an
      // N+1 waterfall and made this screen noticeably slower than the other
      // admin modules. The canonical summary already contains every
      // technician for a period, so calculate one summary per period and
      // project the requested leaders from it.
      const summaries = new Map<string, Promise<Awaited<ReturnType<typeof canonicalLiquidationSummary>>>>();
      for (const row of rows) {
        if (!summaries.has(row.periodo_id)) {
          summaries.set(
            row.periodo_id,
            canonicalLiquidationSummary(
              { periodoId: row.periodo_id },
              { id: user.id, rol: "admin" } as UserContext,
              null,
            ),
          );
        }
      }
      const resolvedSummaries = new Map<string, Awaited<ReturnType<typeof canonicalLiquidationSummary>>>();
      await Promise.all([...summaries.entries()].map(async ([periodoId, promise]) => {
        resolvedSummaries.set(periodoId, await promise);
      }));
      return rows.map((row) => mapLeaderLiquidationSummary(
        row.lider_id,
        row.periodo_id,
        resolvedSummaries.get(row.periodo_id)!,
      ));
    }
    case "reports.leaderConfig": { await requireAdmin(user); return upsertLeaderExtraConfiguration(payload); }
    case "reports.saveEvidence": { await saveEvidence(payload, user); return true; }

    case "attendance.day": return attendanceDay(payload, user);
    case "attendance.history": return attendanceHistory(payload, user);
    case "attendance.fortnightly": return attendanceFortnightly(payload, user);
    case "attendance.memos": return attendanceMemos(payload, user);
    case "attendance.memo.create": return createAttendanceMemo(payload, user);
    case "attendance.memo.update": return updateAttendanceMemo(payload, user);

    case "arrivals.list": {
      const values: unknown[] = [];
      const filter = payload.usuarioId ? "WHERE r.usuario_id = $1" : "";
      if (payload.usuarioId) values.push(payload.usuarioId);
      const { rows } = await dbQuery(`SELECT r.*, left(r.hora_entrada_programada::text,5) AS hora_esperada, left(r.hora_entrada_real::text,5) AS hora_llegada, left(r.hora_salida_programada::text,5) AS hora_salida_programada_text, left(r.hora_salida_real::text,5) AS hora_salida_real_text FROM public.registros_asistencia r ${filter} ORDER BY r.fecha DESC, r.created_at DESC`, values);
      return rows.map(mapArrival);
    }
    case "arrivals.update": {
      await requireAdmin(user);
      const id = payload.id;
      // V2 derives lateness from estado_entrada; there is no legacy `tarde` column.
      const map: Record<string, string> = {
        mensajeEnviado: "mensaje_enviado",
        tipoMensaje: "tipo_mensaje",
        estadoEntrada: "estado_entrada",
        estadoSalida: "estado_salida",
        minutosRetraso: "minutos_retraso",
        razonTardanza: "razon_tardanza",
        horaLlegada: "hora_entrada_real",
      };
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [key, column] of Object.entries(map)) {
        if (payload.updates?.[key] !== undefined) {
          values.push(payload.updates[key]);
          sets.push(`${column} = $${values.length}`);
        }
      }
      if (sets.length) {
        values.push(id);
        await dbQuery(`UPDATE public.registros_asistencia SET ${sets.join(", ")}, updated_at = clock_timestamp() WHERE id = $${values.length}`, values);
      }
      const { rows } = await dbQuery("SELECT r.*, left(r.hora_entrada_programada::text,5) AS hora_esperada, left(r.hora_entrada_real::text,5) AS hora_llegada, left(r.hora_salida_programada::text,5) AS hora_salida_programada_text, left(r.hora_salida_real::text,5) AS hora_salida_real_text FROM public.registros_asistencia r WHERE r.id = $1", [id]);
      let normalizedRow = rows[0];
      if (normalizedRow) {
        // Incluso si un administrador edita la fila, el servidor vuelve a
        // calcular la tardanza contra las reglas configuradas y no contra un
        // porcentaje manual que pueda dejar la liquidación desincronizada.
        const settings = await getConfig();
        const actualMinutes = timeMinutes(String(normalizedRow.hora_entrada_real || ""));
        const effectiveActualMinutes = normalizedRow.estado_entrada === "no_reportado" ? null : actualMinutes;
        const scheduledMinutes = timeMinutes(String(normalizedRow.hora_entrada_programada || ""));
        const rule = attendanceDiscountForTime(settings, effectiveActualMinutes, scheduledMinutes);
        const appliesDiscount = rule.porcentaje > 0;
        const refreshed = await dbQuery(
          "UPDATE public.registros_asistencia SET estado_entrada = $2, minutos_retraso = $3, minutos_adeudados = $4, categoria_llegada = $5, razon_tardanza = CASE WHEN $6 = true THEN razon_tardanza ELSE NULL END, descuento_aplicado = $6, porcentaje_descuento = $7, porcentaje_regla_aplicada = $7, tipo_descuento = $8, regla_version = 'attendance-v3', calculado_en = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1 RETURNING *, left(hora_entrada_programada::text,5) AS hora_esperada, left(hora_entrada_real::text,5) AS hora_llegada, left(hora_salida_programada::text,5) AS hora_salida_programada_text, left(hora_salida_real::text,5) AS hora_salida_real_text",
          [id, rule.estado, rule.minutosRetraso, rule.minutosAdeudados, rule.categoria, appliesDiscount, appliesDiscount ? rule.porcentaje : 0, rule.categoria],
        );
        normalizedRow = refreshed.rows[0] || normalizedRow;
        await syncAttendanceDiscount(normalizedRow.id, normalizedRow.usuario_id, dateOnly(normalizedRow.fecha) || "");
      }
      return mapArrival(normalizedRow);
    }
    case "arrivals.ensure": return ensureArrivals(payload);
    case "arrivals.checkin": {
      const actual = String(payload.horaEntrada || "");
      const scheduled = String(payload.horaEntradaProgramada || "");
      const actualMinutes = timeMinutes(actual);
      const fecha = payload.fecha || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
      const settings = await getConfig();
      const scheduledMinutes = timeMinutes(scheduled);
      const rule = attendanceDiscountForTime(settings, actualMinutes, scheduledMinutes);
      const appliesDiscount = rule.porcentaje > 0;
      const discountPercentage = appliesDiscount ? rule.porcentaje : 0;
      const { rows } = await dbQuery(`INSERT INTO public.registros_asistencia (usuario_id,fecha,hora_entrada_programada,hora_salida_programada,hora_entrada_real,estado_entrada,minutos_retraso,minutos_adeudados,categoria_llegada,razon_tardanza,foto_llegada_url,ubicacion_llegada_precision_metros,ubicacion_llegada_timestamp,ubicacion_llegada_direccion,descuento_aplicado,porcentaje_descuento,porcentaje_regla_aplicada,tipo_descuento,regla_version,calculado_en) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (usuario_id,fecha) DO UPDATE SET hora_entrada_programada=EXCLUDED.hora_entrada_programada,hora_salida_programada=EXCLUDED.hora_salida_programada,hora_entrada_real=EXCLUDED.hora_entrada_real,estado_entrada=EXCLUDED.estado_entrada,minutos_retraso=EXCLUDED.minutos_retraso,minutos_adeudados=EXCLUDED.minutos_adeudados,categoria_llegada=EXCLUDED.categoria_llegada,razon_tardanza=EXCLUDED.razon_tardanza,foto_llegada_url=EXCLUDED.foto_llegada_url,ubicacion_llegada_precision_metros=EXCLUDED.ubicacion_llegada_precision_metros,ubicacion_llegada_timestamp=EXCLUDED.ubicacion_llegada_timestamp,ubicacion_llegada_direccion=EXCLUDED.ubicacion_llegada_direccion,descuento_aplicado=EXCLUDED.descuento_aplicado,porcentaje_descuento=EXCLUDED.porcentaje_descuento,porcentaje_regla_aplicada=EXCLUDED.porcentaje_regla_aplicada,tipo_descuento=EXCLUDED.tipo_descuento,regla_version=EXCLUDED.regla_version,calculado_en=EXCLUDED.calculado_en,updated_at=clock_timestamp() RETURNING *, left(hora_entrada_programada::text,5) AS hora_esperada, left(hora_entrada_real::text,5) AS hora_llegada, left(hora_salida_programada::text,5) AS hora_salida_programada_text, left(hora_salida_real::text,5) AS hora_salida_real_text`, [user.id, fecha, scheduled, payload.horaSalidaProgramada || "", actual, rule.estado, rule.minutosRetraso, rule.minutosAdeudados, rule.categoria, rule.estado === "tarde" ? (payload.razonTardanza || null) : null, payload.fotoLlegadaUrl || null, payload.ubicacionLlegada?.accuracy || null, payload.ubicacionLlegada?.capturedAt || null, payload.ubicacionLlegada?.address || null, appliesDiscount, discountPercentage, discountPercentage, rule.categoria, "attendance-v3", new Date().toISOString()]);
      await syncAttendanceDiscount(rows[0].id, user.id, fecha);
      return mapArrival(rows[0]);
    }
    case "arrivals.checkout": {
      const fecha = payload.fecha || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
      const { rows } = await dbQuery("UPDATE public.registros_asistencia SET hora_salida_real = $1, estado_salida = CASE WHEN $2 = true THEN 'salida_anticipada' ELSE 'normal' END, razon_salida_anticipada = $3, updated_at = clock_timestamp() WHERE usuario_id = $4 AND fecha = $5 RETURNING *, left(hora_entrada_programada::text,5) AS hora_esperada, left(hora_entrada_real::text,5) AS hora_llegada, left(hora_salida_programada::text,5) AS hora_salida_programada_text, left(hora_salida_real::text,5) AS hora_salida_real_text", [payload.horaSalida, Boolean(payload.salidaAnticipada), payload.razonSalidaAnticipada || null, user.id, fecha]);
      return rows[0] ? mapArrival(rows[0]) : null;
    }

    case "notifications.list": { const values: unknown[] = []; const filter = payload.usuarioId ? "WHERE usuario_id = $1" : ""; if (payload.usuarioId) values.push(payload.usuarioId); const { rows } = await dbQuery(`SELECT * FROM public.notificaciones ${filter} ORDER BY created_at DESC`, values); return rows.map(mapNotification); }
    case "notifications.create": { const { rows } = await dbQuery("INSERT INTO public.notificaciones (usuario_id, titulo, mensaje, tipo, metadata) VALUES ($1,$2,$3,$4,$5) RETURNING *", [payload.usuarioId, payload.titulo, payload.mensaje, payload.tipo === "mantenimiento" ? "mantenimiento" : payload.tipo === "liquidacion" ? "liquidacion" : payload.tipo === "aprobacion" ? "aprobacion" : payload.tipo === "visit" ? "visita" : payload.tipo === "attendance" ? "asistencia" : "general", payload.datos || {}]); return mapNotification(rows[0]); }
    case "notifications.bulk": { for (const item of jsonArray(payload.items)) await execute("notifications.create", item, user); return true; }
    case "notifications.read": { await dbQuery("UPDATE public.notificaciones SET leida_en = COALESCE(leida_en, clock_timestamp()) WHERE id = $1", [payload.id]); return true; }

    case "liquidation.periodEntries": {
      const requestedPeriodId = String(payload.periodoId || "").trim();
      const { rows: periodRows } = requestedPeriodId
        ? await dbQuery("SELECT id FROM public.periodos_liquidacion WHERE id = $1", [requestedPeriodId])
        : await dbQuery("SELECT id FROM public.periodos_liquidacion ORDER BY fecha_inicio DESC LIMIT 1");
      const periodId = String(periodRows[0]?.id || "");
      if (!periodId) return [];
      const rows = (await getLiquidationRows(periodId))
        .filter((row) => !["anulado", "rechazado"].includes(String(row.estado_liquidacion || row.estado || "")));
      const byActivity = new Map<string, any>();
      for (const row of rows) {
        const current = byActivity.get(row.actividad_id) || {
          id: row.actividad_id,
          codigoRegistro: row.codigo,
          actividadId: row.actividad_id,
          grupoId: row.grupo_id || "",
          lugar: row.sede_nombre || row.sede_snapshot || "",
          fecha: dateOnly(row.fecha_operacion),
          fotoEvidencia: undefined,
          participantes: [],
          periodoId: row.periodo_id || periodId,
        };
        current.participantes.push({
          tecnicoId: row.tecnico_id,
          porcentaje: number(row.porcentaje),
          valorCalculado: number(row.valor_ganado),
        });
        byActivity.set(row.actividad_id, current);
      }
      return [...byActivity.values()];
    }
    case "liquidation.items": {
      const rows = await getLiquidationRows(String(payload.periodoId || ""), [String(payload.usuarioId || user.id)]);
      return rows
        .filter((row) => !["anulado", "rechazado"].includes(String(row.estado_liquidacion || row.estado || "")))
        .map((row) => ({ id: row.id, codigoRegistro: row.codigo, tecnicoId: row.tecnico_id, periodoId: row.periodo_id, nombreActividad: row.descripcion, edificio: row.sede_nombre || "", fecha: dateOnly(row.fecha_operacion) || "", porcentaje: number(row.porcentaje), valorBase: number(row.valor_base), valorGanado: number(row.valor_ganado), valorGanadoOriginal: number(row.valor_ganado_original), descuentoTardanzaAplicado: number(row.descuento_tardanza), porcentajeDescuentoTardanzaAplicado: number(row.porcentaje_descuento_tardanza), tipo: row.tipo, estado: row.estado_liquidacion || row.estado || "pendiente", referenciaId: row.actividad_id, fechaCreacion: dateOnly(row.created_at) || "" }));
    }
    case "liquidation.summary": {
      const canonical = await canonicalLiquidationSummary({ periodoId: payload.periodoId }, user, [String(payload.usuarioId || user.id)]);
      const row = canonical.technicians[0] || {};
      const approved = number(row.totalAprobado);
      const discounts = number(row.descuentoValor);
      const { rows: periodRows } = await dbQuery("SELECT fecha_inicio, fecha_fin FROM public.periodos_liquidacion WHERE id = $1", [payload.periodoId]);
      const { rows: tardinessRows } = periodRows[0]
        ? await dbQuery("SELECT fecha, porcentaje_descuento, minutos_retraso, razon_tardanza FROM public.registros_asistencia WHERE usuario_id = $1 AND fecha BETWEEN $2 AND $3 AND descuento_aplicado = true AND estado_entrada = 'tarde' ORDER BY fecha", [payload.usuarioId || user.id, periodRows[0].fecha_inicio, periodRows[0].fecha_fin])
        : { rows: [] };
      const tardinessPercentage = Math.min(100, tardinessRows.reduce((max, item) => Math.max(max, number(item.porcentaje_descuento)), 0));
      return {
        totalAprobadoGenerado: approved,
        totalPendienteGenerado: number(row.totalPendiente),
        totalRecorridos: number(row.totalRecorridos),
        totalRecorridosPendientes: number(row.totalRecorridosPendientes),
        totalAcumuladoBruto: number(row.totalBruto),
        totalExtraLider: number(row.extraLider),
        totalExtraLiderPendiente: number(row.extraLiderPendiente),
        totalMultasTardanza: discounts,
        totalPorcentajeDescuentoTardanza: tardinessPercentage,
        tardanzas: tardinessRows.map((item) => ({ fecha: dateOnly(item.fecha) || "", porcentaje: number(item.porcentaje_descuento), minutos_retraso: number(item.minutos_retraso), razon_tardanza: item.razon_tardanza || undefined })),
        totalAcumulado: number(row.totalBruto) + number(row.extraLider) + number(row.extraLiderPendiente),
        totalAPagar: Math.max(0, number(row.total)),
        congelado: Boolean(canonical.congelado),
        congeladoEn: canonical.congeladoEn || null,
      };
    }
    case "liquidation.periodSummary": { return canonicalLiquidationSummary(payload, user); }
    case "liquidation.leader": {
      return getLeaderLiquidationSummary(payload.liderId || user.id, payload.periodoId);
    }
    case "cleanup.preview": return cleanupPreview(payload);
    case "cleanup.execute": return cleanupExecute(payload);
    default: throw new Error(`Operación de datos no soportada: ${action}`);
  }
}

function normalizeOptionalId(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function idList(value: unknown): string[] {
  return jsonArray(value)
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const candidate = item as Record<string, unknown>;
        return String(candidate.id || candidate.usuarioId || candidate.usuario_id || "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

async function replaceGroupMembers(client: any, groupId: string, memberIds: string[], reporterIds: string[]) {
  await client.query("DELETE FROM public.grupo_miembros WHERE grupo_id = $1", [groupId]);
  await client.query("DELETE FROM public.grupo_reportadores_actividad WHERE grupo_id = $1", [groupId]);
  for (const id of uniqueIds(memberIds)) {
    await client.query(`INSERT INTO public.grupo_miembros (grupo_id, usuario_id, fecha_inicio) VALUES ($1,$2,${BOGOTA_DATE_SQL})`, [groupId, id]);
  }
  for (const id of uniqueIds(reporterIds)) {
    await client.query(`INSERT INTO public.grupo_reportadores_actividad (grupo_id, usuario_id, fecha_inicio) VALUES ($1,$2,${BOGOTA_DATE_SQL})`, [groupId, id]);
  }
}

function configDefaults(): any {
  return { nombre: "SOLUCIONES & AUTOMATIZACIONES S.A.S.", logo: "/logo.png", correoRemitente: "notificaciones@solucionesyautomatizaciones.com", correoEmpresa: "solucionesyautomatizaciones@hotmail.com", plantillaReportePDF: "default", porcentajeDescuentoTardanza: 5, horaInicioDescuentoTardanza: "08:05", diasDescuentoAutomatico: ["lunes", "martes", "miercoles", "jueves", "viernes"], horaDescuentoAutomatico: "08:30", porcentajeDescuentoNoReportado: 30, minutosGraciaTardanza: 5, minutosCorteNoReportado: 30, minutosNoReportado: 30, porcentajeDescuentoReposicion: 0, memorandoAsistenciaAutomatico: true, fundamentoAsistencia: "", regimenSancionatorioAsistencia: "", porcentajeExtraLider: 10, extraLiderActivo: true, costoRevisionLider: 0, costoVisitaTecnicaDefault: 0, costoRecorridoNormal: 0, costoRecorridoHerramienta: 0 };
}

function mapConfig(row: any): any {
  const defaults = configDefaults();
  const days = jsonArray(row.dias_descuento_automatico).map((day) => numberToDay[number(day)]).filter(Boolean);
  return { ...defaults, nombre: row.nombre || defaults.nombre, logo: row.logo_url || defaults.logo, correoRemitente: row.correo_remitente || defaults.correoRemitente, correoEmpresa: row.correo_empresa || defaults.correoEmpresa, plantillaReportePDF: row.plantilla_reporte || defaults.plantillaReportePDF, porcentajeDescuentoTardanza: percentage(row.porcentaje_descuento_tardanza, defaults.porcentajeDescuentoTardanza), horaInicioDescuentoTardanza: row.hora_inicio_descuento_tardanza ? String(row.hora_inicio_descuento_tardanza).slice(0, 5) : defaults.horaInicioDescuentoTardanza, diasDescuentoAutomatico: days.length ? days : defaults.diasDescuentoAutomatico, horaDescuentoAutomatico: row.hora_descuento_automatico ? String(row.hora_descuento_automatico).slice(0, 5) : defaults.horaDescuentoAutomatico, porcentajeDescuentoNoReportado: percentage(row.porcentaje_descuento_no_reportado, defaults.porcentajeDescuentoNoReportado), minutosGraciaTardanza: number(row.minutos_gracia_tardanza, defaults.minutosGraciaTardanza), minutosCorteNoReportado: number(row.minutos_corte_no_reportado, defaults.minutosCorteNoReportado), minutosNoReportado: number(row.minutos_no_reportado, defaults.minutosNoReportado), porcentajeDescuentoReposicion: percentage(row.porcentaje_descuento_reposicion, defaults.porcentajeDescuentoReposicion), memorandoAsistenciaAutomatico: row.memorando_asistencia_automatico ?? defaults.memorandoAsistenciaAutomatico, fundamentoAsistencia: row.fundamento_asistencia || defaults.fundamentoAsistencia, regimenSancionatorioAsistencia: row.regimen_sancionatorio_asistencia || defaults.regimenSancionatorioAsistencia, porcentajeExtraLider: number(row.porcentaje_extra_lider, defaults.porcentajeExtraLider), extraLiderActivo: row.extra_lider_activo ?? defaults.extraLiderActivo, costoRevisionLider: number(row.costo_revision_lider), costoVisitaTecnicaDefault: number(row.costo_visita_tecnica_default), costoRecorridoNormal: number(row.costo_recorrido_normal), costoRecorridoHerramienta: number(row.costo_recorrido_herramienta) };
}

async function getConfig() { const { rows } = await dbQuery("SELECT * FROM public.configuracion_empresa WHERE id = 1"); return rows[0] ? mapConfig(rows[0]) : configDefaults(); }

async function getLeaderLiquidationSummary(liderId: string, periodoId: string) {
  // El líder se calcula sobre el conjunto completo del periodo: su extra usa
  // el trabajo aprobado y pendiente de los demás participantes, incluso si
  // todavía no han entregado todos. Para periodos cerrados la fuente ya es la
  // fotografía inmutable tomada al cierre.
  const summary = await canonicalLiquidationSummary({ periodoId }, { id: liderId, rol: "admin" } as UserContext, null);
  return mapLeaderLiquidationSummary(liderId, periodoId, summary);
}

function mapLeaderLiquidationSummary(
  liderId: string,
  periodoId: string,
  summary: Awaited<ReturnType<typeof canonicalLiquidationSummary>>,
) {
  const row: any = summary.technicians.find((item) => item.tecnicoId === liderId) || {};
  const extraPercentage = number(row.porcentajeExtraLiderAplicado);
  return {
    id: `${liderId}:${periodoId}`,
    liderId,
    periodoId,
    totalAprobadoPago: number(row.totalAprobado),
    totalPendientePago: number(row.totalPendiente),
    extraLider: number(row.extraLider),
    extraLiderPendiente: number(row.extraLiderPendiente),
    totalRecorridos: number(row.totalRecorridos),
    totalRecorridosPendientes: number(row.totalRecorridosPendientes),
    totalAcumulado: number(row.totalBruto) + number(row.extraLider) + number(row.extraLiderPendiente),
    totalAcumuladoBruto: number(row.totalBruto),
    baseExtraLiderAprobado: number(row.baseExtraLiderAprobado),
    baseExtraLiderPendiente: number(row.baseExtraLiderPendiente),
    totalDescuentosTardanza: number(row.descuentoValor),
    porcentajeExtraLiderAplicado: extraPercentage,
    extraLiderActivo: Boolean(row.extraLiderActivo),
    tecnicosExcluidosExtraIds: uniqueIds(jsonArray(row.tecnicosExcluidosExtraIds).map((id) => String(id))),
    congelado: Boolean(summary.congelado),
    congeladoEn: summary.congeladoEn || null,
  };
}

async function recalculateOpenAttendanceRules(client: any) {
  await client.query(`
    CREATE TEMP TABLE attendance_rules_recalc ON COMMIT DROP AS
    WITH rules AS (
      SELECT hora_inicio_descuento_tardanza, hora_descuento_automatico,
             porcentaje_descuento_tardanza, porcentaje_descuento_no_reportado,
             porcentaje_descuento_reposicion, minutos_no_reportado
        FROM public.configuracion_empresa WHERE id = 1
    ), classified AS (
      SELECT r.id AS asistencia_id, r.usuario_id AS tecnico_id, p.id AS periodo_id,
             CASE
               WHEN r.hora_entrada_real IS NULL THEN 'no_reportado'
               WHEN r.hora_entrada_real < rules.hora_inicio_descuento_tardanza THEN 'a_tiempo'
               WHEN r.hora_entrada_real >= rules.hora_descuento_automatico THEN 'reposicion'
               ELSE 'tardanza_leve'
             END AS categoria,
             CASE
               WHEN r.hora_entrada_real IS NULL THEN rules.porcentaje_descuento_no_reportado
               WHEN r.hora_entrada_real < rules.hora_inicio_descuento_tardanza THEN 0
               WHEN r.hora_entrada_real >= rules.hora_descuento_automatico THEN rules.porcentaje_descuento_reposicion
               ELSE rules.porcentaje_descuento_tardanza
             END AS porcentaje,
             CASE WHEN r.hora_entrada_real IS NULL THEN 0
                  ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (r.hora_entrada_real - r.hora_entrada_programada)) / 60)::integer)
              END AS minutos_retraso,
             CASE WHEN r.hora_entrada_real IS NULL THEN rules.minutos_no_reportado
                  WHEN r.hora_entrada_real < rules.hora_inicio_descuento_tardanza THEN 0
                  ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (r.hora_entrada_real - r.hora_entrada_programada)) / 60)::integer)
              END AS minutos_adeudados
        FROM public.registros_asistencia r
        JOIN public.periodos_liquidacion p
          ON r.fecha BETWEEN p.fecha_inicio AND p.fecha_fin AND p.estado = 'abierto'
        CROSS JOIN rules
    )
    SELECT *, porcentaje > 0 AS descuento_aplicado, 'attendance-v4-clock'::text AS regla_version
      FROM classified
  `);
  await client.query(`
    UPDATE public.registros_asistencia r
       SET estado_entrada = CASE WHEN x.categoria = 'no_reportado' THEN 'no_reportado'
                                 WHEN x.categoria = 'a_tiempo' THEN 'a_tiempo' ELSE 'tarde' END,
           minutos_retraso = x.minutos_retraso,
           minutos_adeudados = x.minutos_adeudados,
           categoria_llegada = x.categoria,
           descuento_aplicado = x.descuento_aplicado,
           porcentaje_descuento = x.porcentaje,
           porcentaje_regla_aplicada = x.porcentaje,
           tipo_descuento = x.categoria,
           regla_version = x.regla_version,
           calculado_en = clock_timestamp(), updated_at = clock_timestamp()
      FROM attendance_rules_recalc x WHERE r.id = x.asistencia_id
  `);
  await client.query(`
    CREATE TEMP TABLE attendance_rules_people ON COMMIT DROP AS
    SELECT tecnico_id, periodo_id,
           COALESCE(SUM(porcentaje) FILTER (WHERE descuento_aplicado), 0) AS porcentaje_bruto,
           LEAST(100, COALESCE(SUM(porcentaje) FILTER (WHERE descuento_aplicado), 0)) AS porcentaje_aplicado
      FROM attendance_rules_recalc GROUP BY tecnico_id, periodo_id
  `);
  await client.query(`
    UPDATE public.liquidacion_items li
       SET valor_ganado_original = ROUND(COALESCE(li.valor_base, ap.valor_base, a.valor_base) * COALESCE(li.porcentaje, ap.porcentaje, 0) / 100, 2),
           valor_ganado = ROUND(COALESCE(li.valor_base, ap.valor_base, a.valor_base) * COALESCE(li.porcentaje, ap.porcentaje, 0) / 100, 2),
           descuento_tardanza = 0, porcentaje_descuento_tardanza = 0, updated_at = clock_timestamp()
      FROM public.actividades_operativas a
      JOIN public.actividades_operativas_participantes ap ON ap.actividad_id = a.id
      JOIN attendance_rules_people people ON people.tecnico_id = ap.tecnico_id
      JOIN public.periodos_liquidacion pl ON pl.id = people.periodo_id AND pl.estado = 'abierto'
     WHERE li.actividad_id = a.id AND li.participante_id = ap.id
       AND li.tecnico_id = people.tecnico_id AND li.periodo_id = people.periodo_id
       AND li.tipo <> 'recorrido' AND li.estado <> 'anulado'
       AND COALESCE(li.valor_base, ap.valor_base, a.valor_base) > 0
       AND ABS(COALESCE(li.valor_base, ap.valor_base, a.valor_base) - COALESCE(a.valor_aplicado, 0)) > 0.01
       AND ABS(COALESCE(li.valor_ganado_original, ap.valor_ganado, li.valor_ganado)
         - (COALESCE(a.valor_aplicado, 0) * COALESCE(li.porcentaje, ap.porcentaje, 0) / 100)) <= 0.01
  `);
  await client.query(`
    UPDATE public.liquidacion_items li
       SET descuento_tardanza = ROUND(COALESCE(li.valor_ganado_original, li.valor_ganado) * p.porcentaje_aplicado / 100, 2),
           valor_ganado = ROUND(COALESCE(li.valor_ganado_original, li.valor_ganado) * (1 - p.porcentaje_aplicado / 100), 2),
           porcentaje_descuento_tardanza = p.porcentaje_aplicado, updated_at = clock_timestamp()
      FROM attendance_rules_people p
      JOIN public.periodos_liquidacion pl ON pl.id = p.periodo_id AND pl.estado = 'abierto'
     WHERE li.tecnico_id = p.tecnico_id AND li.periodo_id = p.periodo_id
       AND li.tipo <> 'recorrido' AND li.estado <> 'anulado'
  `);
  await client.query(`
    UPDATE public.liquidacion_items li
       SET valor_ganado = COALESCE(li.valor_ganado_original, li.valor_ganado),
           descuento_tardanza = 0, porcentaje_descuento_tardanza = 0, updated_at = clock_timestamp()
      FROM attendance_rules_people p
      JOIN public.periodos_liquidacion pl ON pl.id = p.periodo_id AND pl.estado = 'abierto'
     WHERE li.tecnico_id = p.tecnico_id AND li.periodo_id = p.periodo_id
       AND li.tipo = 'recorrido' AND li.estado <> 'anulado'
  `);
  await client.query(`
    CREATE TEMP TABLE attendance_rules_liquidation ON COMMIT DROP AS
    SELECT p.tecnico_id, p.periodo_id, p.porcentaje_bruto, p.porcentaje_aplicado,
           COALESCE(SUM(li.descuento_tardanza) FILTER (WHERE li.tipo <> 'recorrido' AND li.estado <> 'anulado'), 0) AS valor_total
      FROM attendance_rules_people p
      LEFT JOIN public.liquidacion_items li
        ON li.tecnico_id = p.tecnico_id AND li.periodo_id = p.periodo_id
     GROUP BY p.tecnico_id, p.periodo_id, p.porcentaje_bruto, p.porcentaje_aplicado
  `);
  await client.query(`
    DELETE FROM public.asistencia_descuentos ad
     USING attendance_rules_people p
     WHERE ad.tecnico_id = p.tecnico_id AND ad.periodo_id = p.periodo_id
  `);
  await client.query(`
    INSERT INTO public.asistencia_descuentos
      (asistencia_id, periodo_id, tecnico_id, porcentaje, porcentaje_acumulado,
       minutos_adeudados, valor, regla_version)
    SELECT x.asistencia_id, x.periodo_id, x.tecnico_id, x.porcentaje, t.porcentaje_aplicado,
           x.minutos_adeudados,
           CASE WHEN t.porcentaje_bruto > 0 THEN t.valor_total * x.porcentaje / t.porcentaje_bruto ELSE 0 END,
           x.regla_version
      FROM attendance_rules_recalc x
      JOIN attendance_rules_liquidation t USING (tecnico_id, periodo_id)
     WHERE x.descuento_aplicado
  `);
}

async function updateConfig(payload: Payload) {
  const current = await getConfig();
  const settings = { ...current, ...payload };
  const days = jsonArray(settings.diasDescuentoAutomatico).map((day) => dayToNumber[String(day)]).filter(Boolean);
  const lateStart = String(settings.horaInicioDescuentoTardanza || "").slice(0, 5);
  const cutoff = String(settings.horaDescuentoAutomatico || "").slice(0, 5);
  const lateStartMinutes = timeMinutes(lateStart);
  const cutoffMinutes = timeMinutes(cutoff);
  if (lateStartMinutes == null) throw new Error("Debes configurar una hora válida para iniciar la tardanza reportada.");
  if (cutoffMinutes == null) throw new Error("Debes configurar una hora de corte válida para los descuentos automáticos.");
  if (lateStartMinutes >= cutoffMinutes) throw new Error("La hora de inicio de tardanza debe ser anterior a la hora de no reporte.");
  const latePercentage = percentage(settings.porcentajeDescuentoTardanza);
  const noReportPercentage = percentage(settings.porcentajeDescuentoNoReportado, 30);
  const reposicionPercentage = percentage(settings.porcentajeDescuentoReposicion, 0);
  const noReportMinutes = Math.max(0, Math.floor(number(settings.minutosNoReportado, 30)));
  const rulesChanged = current.horaInicioDescuentoTardanza !== lateStart
    || current.horaDescuentoAutomatico !== cutoff
    || number(current.porcentajeDescuentoTardanza) !== latePercentage
    || number(current.porcentajeDescuentoNoReportado, 30) !== noReportPercentage
    || number(current.porcentajeDescuentoReposicion) !== reposicionPercentage
    || number(current.minutosNoReportado, 30) !== noReportMinutes;
  const values = [settings.nombre, settings.logo || null, settings.correoRemitente, settings.correoEmpresa || null, settings.plantillaReportePDF || "default", latePercentage, lateStart, days.length ? days : [1, 2, 3, 4, 5], cutoff, noReportPercentage, settings.porcentajeExtraLider, settings.extraLiderActivo, settings.costoRevisionLider, settings.costoVisitaTecnicaDefault, settings.costoRecorridoNormal, settings.costoRecorridoHerramienta, Math.max(0, Math.floor(number(settings.minutosGraciaTardanza, 5))), Math.max(1, Math.floor(number(settings.minutosCorteNoReportado, 30))), noReportMinutes, reposicionPercentage, settings.memorandoAsistenciaAutomatico !== false, settings.fundamentoAsistencia || null, settings.regimenSancionatorioAsistencia || null];
  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(`INSERT INTO public.configuracion_empresa (id,nombre,logo_url,correo_remitente,correo_empresa,plantilla_reporte,hora_inicio_descuento_tardanza,porcentaje_descuento_tardanza,dias_descuento_automatico,hora_descuento_automatico,porcentaje_descuento_no_reportado,porcentaje_extra_lider,extra_lider_activo,costo_revision_lider,costo_visita_tecnica_default,costo_recorrido_normal,costo_recorrido_herramienta,minutos_gracia_tardanza,minutos_corte_no_reportado,minutos_no_reportado,porcentaje_descuento_reposicion,memorando_asistencia_automatico,fundamento_asistencia,regimen_sancionatorio_asistencia) VALUES (1,$1,$2,$3,$4,$5,$7,$6,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) ON CONFLICT (id) DO UPDATE SET nombre=EXCLUDED.nombre, logo_url=EXCLUDED.logo_url, correo_remitente=EXCLUDED.correo_remitente, correo_empresa=EXCLUDED.correo_empresa, plantilla_reporte=EXCLUDED.plantilla_reporte, hora_inicio_descuento_tardanza=EXCLUDED.hora_inicio_descuento_tardanza, porcentaje_descuento_tardanza=EXCLUDED.porcentaje_descuento_tardanza, dias_descuento_automatico=EXCLUDED.dias_descuento_automatico, hora_descuento_automatico=EXCLUDED.hora_descuento_automatico, porcentaje_descuento_no_reportado=EXCLUDED.porcentaje_descuento_no_reportado, porcentaje_extra_lider=EXCLUDED.porcentaje_extra_lider, extra_lider_activo=EXCLUDED.extra_lider_activo, costo_revision_lider=EXCLUDED.costo_revision_lider, costo_visita_tecnica_default=EXCLUDED.costo_visita_tecnica_default, costo_recorrido_normal=EXCLUDED.costo_recorrido_normal, costo_recorrido_herramienta=EXCLUDED.costo_recorrido_herramienta, minutos_gracia_tardanza=EXCLUDED.minutos_gracia_tardanza, minutos_corte_no_reportado=EXCLUDED.minutos_corte_no_reportado, minutos_no_reportado=EXCLUDED.minutos_no_reportado, porcentaje_descuento_reposicion=EXCLUDED.porcentaje_descuento_reposicion, memorando_asistencia_automatico=EXCLUDED.memorando_asistencia_automatico, fundamento_asistencia=EXCLUDED.fundamento_asistencia, regimen_sancionatorio_asistencia=EXCLUDED.regimen_sancionatorio_asistencia, updated_at=clock_timestamp() RETURNING *`, values);
    if (rulesChanged) await recalculateOpenAttendanceRules(client);
    return result;
  });
  return mapConfig(rows[0]);
}

function buildContractSchedule(payload: Payload) {
  const supplied = jsonArray(payload.mantenimientosRealizados);
  const count = integerField(payload.cantidadMantenimientos, "La cantidad de mantenimientos", 1, 12);
  const interval = Math.max(1, Math.floor(12 / count));
  const startMonth = integerField(payload.mesInicio ?? 1, "El mes de inicio", 1, 12);
  const startYear = integerField(payload.anio, "El año", 2000, 2200);
  const startDay = Math.min(integerField(payload.diaInicio ?? 1, "El día de inicio", 1, 28), 28);
  const generated = Array.from({ length: count }, (_, index) => {
    const offset = index * interval;
    const monthIndex = startMonth - 1 + offset;
    const year = startYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return {
      numero: index + 1,
      mes: month,
      fechaProgramada: `${year}-${String(month).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
      estado: "pendiente",
    };
  });

  if (supplied.length > 0) {
    if (supplied.length !== count) throw new Error("El cronograma debe tener exactamente la cantidad de mantenimientos configurada.");
    return supplied.map((item, index) => {
      const fechaProgramada = dateOnly(item.fechaProgramada) || generated[index].fechaProgramada;
      return {
        ...item,
        // `numero` identifies the contract slot, while the administrator's
        // saved date and its calendar month are authoritative for operations.
        numero: integerField(item.numero ?? index + 1, "El número del mantenimiento", 1, 12),
        mes: Number(fechaProgramada.slice(5, 7)) || generated[index].mes,
        fechaProgramada,
      };
    });
  }

  return generated;
}

function contractMaintenanceScheduledDate(contract: Payload, numero: unknown) {
  const schedule = buildContractSchedule({
    anio: contract.anio ?? contract.contrato_anio,
    mesInicio: contract.mesInicio ?? contract.contrato_mes_inicio,
    diaInicio: contract.diaInicio ?? contract.contrato_dia_inicio,
    cantidadMantenimientos: contract.cantidadMantenimientos ?? contract.contrato_cantidad_mantenimientos,
  });
  const maintenanceNumber = number(numero);
  return schedule.find((item) => item.numero === maintenanceNumber)?.fechaProgramada || null;
}

async function upsertContractMaintenance(client: any, contractId: string, contract: Payload, item: Payload, index: number) {
  const numero = integerField(item.numero ?? index + 1, "El número del mantenimiento", 1, 12);
  const fechaProgramada = dateOnly(item.fechaProgramada);
  if (!fechaProgramada) throw new Error(`El mantenimiento ${index + 1} requiere una fecha programada válida.`);
  const desiredState = item.estado === "realizado" ? "ejecutado" : item.estado || "pendiente";
  const result = await client.query(
    `INSERT INTO public.mantenimientos_programados
      (contrato_id, cliente_id, sede_id, numero, fecha_programada, hora_programada,
       grupo_id, tecnico_principal_id, costo_tecnico_presupuestado, estado,
       observaciones, tipo_pendiente, descripcion_pendiente, valor_recaudado, clave_idempotencia)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (contrato_id, numero) DO UPDATE SET
       fecha_programada = EXCLUDED.fecha_programada,
       fecha_realizado = CASE
         WHEN mantenimientos_programados.estado IN ('ejecutado','completado')
           THEN GREATEST(COALESCE(mantenimientos_programados.fecha_realizado, EXCLUDED.fecha_programada), EXCLUDED.fecha_programada)
         WHEN mantenimientos_programados.fecha_realizado IS NOT NULL
           AND mantenimientos_programados.fecha_realizado < EXCLUDED.fecha_programada
           THEN NULL
         ELSE mantenimientos_programados.fecha_realizado
       END,
       hora_programada = EXCLUDED.hora_programada,
       sede_id = EXCLUDED.sede_id,
       grupo_id = EXCLUDED.grupo_id,
       tecnico_principal_id = EXCLUDED.tecnico_principal_id,
       costo_tecnico_presupuestado = EXCLUDED.costo_tecnico_presupuestado,
       observaciones = EXCLUDED.observaciones,
       tipo_pendiente = EXCLUDED.tipo_pendiente,
       descripcion_pendiente = EXCLUDED.descripcion_pendiente,
       estado = CASE WHEN mantenimientos_programados.estado IN ('ejecutado','cancelado') THEN mantenimientos_programados.estado ELSE EXCLUDED.estado END,
       updated_at = clock_timestamp()
     RETURNING *`,
    [
      contractId,
      contract.clienteId,
      item.sedeId || null,
      numero,
      fechaProgramada,
      item.horaProgramada || null,
      item.grupoId || null,
      item.tecnicoId || null,
      nonNegativeMoney(item.costoTecnicoTotal ?? contract.costoPorMantenimiento, "El costo técnico"),
      desiredState,
      item.observaciones || null,
      item.tipoPendiente || null,
      item.descripcionPendiente || null,
      nonNegativeMoney(item.valorRecaudado, "El valor recaudado"),
      `contrato:${contractId}:mantenimiento:${numero}`,
    ],
  );
  const maintenance = result.rows[0];
  if (!maintenance) throw new Error(`No se pudo crear o actualizar el mantenimiento ${numero}.`);
  return maintenance;
}

async function insertContractMaintenances(client: any, contractId: string, payload: Payload) {
  const list = buildContractSchedule(payload);
  const numbers = new Set<number>();
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const numero = integerField(item.numero ?? index + 1, "El número del mantenimiento", 1, 12);
    if (numbers.has(numero)) throw new Error("El cronograma contiene dos mantenimientos con el mismo número.");
    numbers.add(numero);
    const maintenance = await upsertContractMaintenance(client, contractId, payload, item, index);
    if (item.participantes !== undefined || item.tecnicoId) {
      await replaceMaintenanceParticipants(client, maintenance.id, {
        ...item,
        tecnicoId: item.tecnicoId || undefined,
        costoTecnicoTotal: number(item.costoTecnicoTotal || payload.costoPorMantenimiento),
        participantes: item.participantes,
      }, undefined);
    }
  }
}

async function createContract(payload: Payload, user: UserContext) {
  if (!payload.clienteId || !payload.anio || !payload.cantidadMantenimientos) throw new Error("El contrato requiere cliente, año y cantidad de mantenimientos.");
  const totals = calculateContractTotals(payload);
  const id = await withTransaction(async (client) => {
    const idempotencyKey = String(payload.claveIdempotencia || "").trim() || null;
    const result = await client.query(
      `INSERT INTO public.contratos_mantenimiento
        (cliente_id, anio, mes_inicio, dia_inicio, puertas_peatonales, puertas_vehiculares,
         valor_puerta_peatonal, valor_puerta_vehicular, costo_total_anual,
         cantidad_mantenimientos, costo_por_mantenimiento, frecuencia_meses, estado, clave_idempotencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        payload.clienteId,
        integerField(payload.anio, "El año", 2000, 2200),
        integerField(payload.mesInicio ?? 1, "El mes de inicio", 1, 12),
        integerField(payload.diaInicio ?? 1, "El día de inicio", 1, 28),
        totals.pedestrianDoors,
        totals.vehicleDoors,
        totals.pedestrianValue,
        totals.vehicleValue,
        totals.total,
        totals.quantity,
        totals.perMaintenance,
        totals.frequencyMonths,
        payload.estado || "activo",
        idempotencyKey,
      ],
    );
    let contract = result.rows[0];
    if (!contract && idempotencyKey) {
      const existing = await client.query("SELECT * FROM public.contratos_mantenimiento WHERE clave_idempotencia = $1 FOR UPDATE", [idempotencyKey]);
      contract = existing.rows[0];
    }
    if (!contract) throw new Error("No se pudo crear el contrato. Verifica que no exista otro contrato activo para el mismo cliente y año.");
    if (result.rows[0]) {
      await insertContractMaintenances(client, contract.id, { ...payload, ...totals, costoPorMantenimiento: totals.perMaintenance });
      await writeAudit(client, user.id, "contrato_mantenimiento", contract.id, "crear", null, contract);
    }
    return contract.id;
  });
  const { rows } = await dbQuery("SELECT * FROM public.contratos_mantenimiento WHERE id = $1", [id]);
  const { rows: maintenanceRows } = await dbQuery("SELECT * FROM public.mantenimientos_programados WHERE contrato_id = $1 ORDER BY fecha_programada, numero", [id]);
  return mapContract(rows[0], maintenanceRows);
}

async function reconcileContractSchedule(client: any, contractId: string, contract: Payload, payload: Payload) {
  const desired = buildContractSchedule({ ...contract, ...payload });
  const desiredNumbers = new Set(desired.map((item, index) => integerField(item.numero ?? index + 1, "El número del mantenimiento", 1, 12)));
  if (desiredNumbers.size !== desired.length) throw new Error("El cronograma contiene números de mantenimiento repetidos.");

  const currentResult = await client.query("SELECT * FROM public.mantenimientos_programados WHERE contrato_id = $1 FOR UPDATE", [contractId]);
  const currentByNumber = new Map<number, any>(currentResult.rows.map((row: any) => [number(row.numero), row]));
  const linkedResult = await client.query(
    `SELECT mantenimiento_programado_id
       FROM public.actividades_operativas_mantenimientos
      WHERE mantenimiento_programado_id = ANY($1::uuid[])`,
    [currentResult.rows.map((row: any) => row.id)],
  );
  const linkedIds = new Set(linkedResult.rows.map((row: any) => String(row.mantenimiento_programado_id)));
  let created = 0;
  let updated = 0;
  let preserved = 0;
  let cancelled = 0;

  for (let index = 0; index < desired.length; index += 1) {
    const item = desired[index];
    const numero = integerField(item.numero ?? index + 1, "El número del mantenimiento", 1, 12);
    const existing = currentByNumber.get(numero);
    const protectedHistory = existing && (
      linkedIds.has(String(existing.id))
      || ["ejecutado", "cancelado"].includes(existing.estado)
      || existing.fecha_realizado != null
      || number(existing.valor_recaudado) > 0
    );
    if (!existing) {
      const inserted = await upsertContractMaintenance(client, contractId, contract, item, index);
      if (item.participantes !== undefined || item.tecnicoId) {
        await replaceMaintenanceParticipants(client, inserted.id, { ...item, participantes: item.participantes }, undefined);
      }
      created += 1;
      continue;
    }
    if (protectedHistory) {
      preserved += 1;
      continue;
    }
    await client.query(
      `UPDATE public.mantenimientos_programados
          SET fecha_programada = $2,
              hora_programada = COALESCE($3, hora_programada),
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [existing.id, dateOnly(item.fechaProgramada), item.horaProgramada || null],
    );
    if (item.participantes !== undefined || item.tecnicoId) {
      await replaceMaintenanceParticipants(client, existing.id, { ...item, participantes: item.participantes }, undefined);
    }
    updated += 1;
  }

  for (const row of currentResult.rows) {
    if (desiredNumbers.has(number(row.numero))) continue;
    const protectedHistory = linkedIds.has(String(row.id))
      || ["ejecutado", "cancelado"].includes(row.estado)
      || row.fecha_realizado != null
      || number(row.valor_recaudado) > 0;
    if (protectedHistory) {
      preserved += 1;
      continue;
    }
    await client.query("UPDATE public.mantenimientos_programados SET estado = 'cancelado', updated_at = clock_timestamp() WHERE id = $1", [row.id]);
    cancelled += 1;
  }

  return { created, updated, preserved, cancelled };
}

async function updateContract(payload: Payload, user: UserContext) {
  const result = await withTransaction(async (client) => {
    const currentResult = await client.query("SELECT * FROM public.contratos_mantenimiento WHERE id = $1 FOR UPDATE", [payload.id]);
    const current = currentResult.rows[0];
    if (!current) throw new Error("No se encontró el contrato que intentas actualizar.");
    const merged = {
      id: current.id,
      clienteId: payload.clienteId ?? current.cliente_id,
      anio: payload.anio ?? current.anio,
      mesInicio: payload.mesInicio ?? current.mes_inicio,
      diaInicio: payload.diaInicio ?? current.dia_inicio,
      puertasPeatonales: payload.puertasPeatonales ?? current.puertas_peatonales,
      puertasVehiculares: payload.puertasVehiculares ?? current.puertas_vehiculares,
      valorPuertaPeatonal: payload.valorPuertaPeatonal ?? current.valor_puerta_peatonal,
      valorPuertaVehicular: payload.valorPuertaVehicular ?? current.valor_puerta_vehicular,
      cantidadMantenimientos: payload.cantidadMantenimientos ?? current.cantidad_mantenimientos,
      estado: payload.estado ?? current.estado,
    };
    const totals = calculateContractTotals(merged);
    const scheduleChanged = [
      ["anio", current.anio, merged.anio],
      ["mesInicio", current.mes_inicio, merged.mesInicio],
      ["diaInicio", current.dia_inicio, merged.diaInicio],
      ["cantidadMantenimientos", current.cantidad_mantenimientos, merged.cantidadMantenimientos],
    ].some(([, previous, next]) => Number(previous) !== Number(next));
    const updateResult = await client.query(
      `UPDATE public.contratos_mantenimiento
          SET cliente_id=$2, anio=$3, mes_inicio=$4, dia_inicio=$5,
              puertas_peatonales=$6, puertas_vehiculares=$7,
              valor_puerta_peatonal=$8, valor_puerta_vehicular=$9,
              costo_total_anual=$10, cantidad_mantenimientos=$11,
              costo_por_mantenimiento=$12, frecuencia_meses=$13,
              estado=$14, updated_at=clock_timestamp()
        WHERE id=$1
        RETURNING *`,
      [merged.id, merged.clienteId, integerField(merged.anio, "El año", 2000, 2200), integerField(merged.mesInicio, "El mes de inicio", 1, 12), integerField(merged.diaInicio, "El día de inicio", 1, 28), totals.pedestrianDoors, totals.vehicleDoors, totals.pedestrianValue, totals.vehicleValue, totals.total, totals.quantity, totals.perMaintenance, totals.frequencyMonths, merged.estado],
    );
    const updatedContract = updateResult.rows[0];
    let scheduleResult = { created: 0, updated: 0, preserved: 0, cancelled: 0 };
    if (payload.regenerarMantenimientos || scheduleChanged) {
      scheduleResult = await reconcileContractSchedule(client, payload.id, { ...merged, ...totals, costoPorMantenimiento: totals.perMaintenance }, payload);
      await client.query("UPDATE public.contratos_mantenimiento SET cronograma_version = cronograma_version + 1, updated_at = clock_timestamp() WHERE id = $1", [payload.id]);
    }
    await writeAudit(client, user.id, "contrato_mantenimiento", payload.id, "actualizar", current, { ...updatedContract, cronograma: scheduleResult });
    return { scheduleResult };
  });
  const { rows } = await dbQuery("SELECT * FROM public.contratos_mantenimiento WHERE id = $1", [payload.id]);
  const { rows: maintenanceRows } = await dbQuery("SELECT * FROM public.mantenimientos_programados WHERE contrato_id = $1 ORDER BY fecha_programada, numero", [payload.id]);
  return { ...mapContract(rows[0], maintenanceRows), cronogramaResultado: result.scheduleResult };
}

async function deleteContract(payload: Payload) {
  return withTransaction(async (client) => {
    const contractResult = await client.query("SELECT * FROM public.contratos_mantenimiento WHERE id = $1 FOR UPDATE", [payload.id]);
    const contract = contractResult.rows[0];
    if (!contract) throw new Error("No se encontró el contrato que intentas eliminar.");
    const { rows: scheduleRows } = await client.query(
      "SELECT id FROM public.mantenimientos_programados WHERE contrato_id = $1 FOR UPDATE",
      [payload.id],
    );
    const maintenanceIds = scheduleRows.map((row: any) => row.id);
    const activityIds = maintenanceIds.length
      ? (await client.query(
          `SELECT DISTINCT actividad_id
             FROM public.actividades_operativas_mantenimientos
            WHERE mantenimiento_programado_id = ANY($1::uuid[])`,
          [maintenanceIds],
        )).rows.map((row: any) => row.actividad_id)
      : [];

    // Este flujo es deliberadamente destructivo porque el cliente solicitó
    // eliminar el contrato y todo su historial, no archivarlo. Se limpian las
    // restricciones RESTRICT antes de eliminar las actividades y cronograma.
    if (activityIds.length > 0) {
      await client.query("DELETE FROM public.lote_aprobacion_items WHERE aprobacion_id IN (SELECT id FROM public.actividades_operativas_aprobaciones WHERE actividad_id = ANY($1::uuid[]))", [activityIds]);
      await client.query("DELETE FROM public.liquidacion_items WHERE actividad_id = ANY($1::uuid[])", [activityIds]);
      await client.query("DELETE FROM public.actividades_operativas_aprobaciones WHERE actividad_id = ANY($1::uuid[])", [activityIds]);
      await client.query("DELETE FROM public.actividades_operativas WHERE id = ANY($1::uuid[])", [activityIds]);
      await client.query("DELETE FROM public.notificaciones WHERE entidad_id = ANY($1::uuid[])", [activityIds]);
      await client.query("DELETE FROM public.envios_correo WHERE entidad_id = ANY($1::uuid[])", [activityIds]);
      await client.query("DELETE FROM public.operaciones_idempotencia WHERE recurso_id = ANY($1::uuid[])", [activityIds]);
      await client.query("DELETE FROM public.auditoria_eventos WHERE entidad_id = ANY($1::uuid[])", [activityIds]);
    }
    if (maintenanceIds.length > 0) {
      await client.query("DELETE FROM public.notificaciones WHERE entidad_tipo = 'mantenimiento_programado' AND entidad_id = ANY($1::uuid[])", [maintenanceIds]);
      await client.query("DELETE FROM public.envios_correo WHERE entidad_id = ANY($1::uuid[])", [maintenanceIds]);
      await client.query("DELETE FROM public.operaciones_idempotencia WHERE recurso_id = ANY($1::uuid[])", [maintenanceIds]);
      await client.query("DELETE FROM public.auditoria_eventos WHERE entidad_id = ANY($1::uuid[])", [maintenanceIds]);
      await client.query("DELETE FROM public.actividades_operativas_mantenimientos WHERE mantenimiento_programado_id = ANY($1::uuid[])", [maintenanceIds]);
    }
    await client.query("DELETE FROM public.auditoria_eventos WHERE entidad_tipo = 'contrato_mantenimiento' AND entidad_id = $1", [payload.id]);
    await client.query("DELETE FROM public.mantenimientos_programados WHERE contrato_id = $1", [payload.id]);
    await client.query("DELETE FROM public.contratos_mantenimiento WHERE id = $1", [payload.id]);
    return { deleted: true, archived: false, id: payload.id, message: "Contrato eliminado definitivamente con sus mantenimientos, reportes, aprobaciones y liquidaciones. Ya puedes crear otro contrato para el mismo cliente y año." };
  });
}

async function resolveMaintenanceContext(
  client: any,
  clientId: string,
  technicianId: string | null | undefined,
  fecha: string,
  requestedGroupId?: string | null,
  requestedSedeId?: string | null,
) {
  let sedeId = requestedSedeId || null;
  if (!sedeId) {
    const { rows } = await client.query(
      "SELECT id FROM public.cliente_sedes WHERE cliente_id = $1 AND estado = 'activo' ORDER BY created_at LIMIT 1",
      [clientId],
    );
    sedeId = rows[0]?.id || null;
  }

  let grupoId = requestedGroupId || null;
  if (!grupoId && technicianId) {
    const { rows } = await client.query(
      `SELECT g.id
         FROM public.grupos_trabajo g
        WHERE g.estado = 'activo'
          AND (
            g.lider_id = $1
            OR EXISTS (
              SELECT 1 FROM public.grupo_miembros gm
               WHERE gm.grupo_id = g.id
                 AND gm.usuario_id = $1
                 AND gm.fecha_inicio <= $2::date
                 AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= $2::date)
            )
          )
        ORDER BY (g.lider_id = $1) DESC, g.created_at DESC
        LIMIT 1`,
      [technicianId, fecha],
    );
    grupoId = rows[0]?.id || null;
  }

  return { grupoId, sedeId };
}

async function createMaintenance(payload: Payload, user: UserContext) {
  const clientId = payload.clienteId;
  if (!clientId || !payload.fechaProgramada) throw new Error("El mantenimiento requiere cliente y fecha.");
  const id = await withTransaction(async (client) => {
    const participantIds = jsonArray(payload.participantes || payload.participants)
      .map((item) => String(item?.usuarioId || item?.usuario_id || item?.tecnicoId || item?.tecnico_id || "").trim())
      .filter(Boolean);
    const technicianId = String(payload.tecnicoId || participantIds[0] || user.id).trim() || null;
    const context = await resolveMaintenanceContext(
      client,
      clientId,
      technicianId,
      dateOnly(payload.fechaProgramada) || bogotaClock().date,
      payload.grupoId || null,
      payload.sedeId || null,
    );
    const { rows } = await client.query(
      `INSERT INTO public.mantenimientos_programados
        (contrato_id, cliente_id, sede_id, numero, fecha_programada, hora_programada,
         grupo_id, tecnico_principal_id, costo_tecnico_presupuestado, estado,
         observaciones, tipo_pendiente, descripcion_pendiente, valor_recaudado, clave_idempotencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        payload.contratoId || null,
        clientId,
        context.sedeId,
        number(payload.numero, 1),
        payload.fechaProgramada,
        payload.horaProgramada || null,
        context.grupoId,
        technicianId,
        number(payload.costoTecnicoTotal || payload.costoActividad),
        payload.estado === "realizado" ? "ejecutado" : payload.estado || "pendiente",
        payload.observaciones || null,
        payload.tipoPendiente || null,
        payload.descripcionPendiente || null,
        number(payload.valorRecaudado),
        payload.claveIdempotencia || null,
      ],
    );
    await replaceMaintenanceParticipants(client, rows[0].id, payload, user.id);
    return rows[0].id;
  });
  const { rows } = await dbQuery(`SELECT m.*, ${maintenanceScheduledDateSql()} AS fecha_programada_efectiva,
    cm.anio AS contrato_anio, cm.mes_inicio AS contrato_mes_inicio,
    cm.dia_inicio AS contrato_dia_inicio, cm.cantidad_mantenimientos AS contrato_cantidad_mantenimientos,
    c.nombre AS cliente_nombre, s.nombre AS sede_nombre, g.lider_id AS lider_id
     FROM public.mantenimientos_programados m
     JOIN public.clientes c ON c.id = m.cliente_id
     LEFT JOIN public.cliente_sedes s ON s.id = m.sede_id
     LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
     LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
    WHERE m.id = $1`, [id]);
  return rows[0] ? enrichMaintenance(rows[0]) : null;
}

async function submitMaintenanceParticipant(payload: Payload, user: UserContext) {
  const maintenanceId = String(payload.mantenimientoId || payload.maintenanceId || payload.id || "").trim();
  if (!maintenanceId) throw new Error("El reporte requiere un mantenimiento válido.");
  const executionDate = dateOnly(payload.fechaEjecucion || payload.fechaOperacion) || bogotaClock().date;
  const today = bogotaClock().date;
  if (executionDate > today) throw new Error(`La fecha de ejecución no puede ser futura (${executionDate}).`);

  const result = await withTransaction(async (client) => {
    const { rows: maintenanceRows } = await client.query(
      `SELECT m.*, g.lider_id AS mantenimiento_lider_id,
              cm.anio AS contrato_anio, cm.mes_inicio AS contrato_mes_inicio,
              cm.dia_inicio AS contrato_dia_inicio, cm.cantidad_mantenimientos AS contrato_cantidad_mantenimientos
         FROM public.mantenimientos_programados m
         LEFT JOIN public.grupos_trabajo g ON g.id = m.grupo_id
         LEFT JOIN public.contratos_mantenimiento cm ON cm.id = m.contrato_id
        WHERE m.id = $1
        FOR UPDATE OF m`,
      [maintenanceId],
    );
    const maintenance = maintenanceRows[0];
    if (!maintenance) throw new Error("No se encontró el mantenimiento.");
    const sharedMaintenanceTitle = String(
      payload.titulo || maintenance.titulo || maintenance.descripcion_pendiente || "Mantenimiento preventivo",
    ).trim();
    const scheduledDate = maintenance.contrato_id
      ? contractMaintenanceScheduledDate(maintenance, maintenance.numero)
      : dateOnly(maintenance.fecha_programada);
    if (scheduledDate && scheduledDate > today) {
      throw new Error(`Este mantenimiento estará disponible desde el ${scheduledDate}.`);
    }

    const { rows: permissionRows } = await client.query(
      "SELECT public.usuario_puede_reportar_mantenimiento($1::uuid, $2::uuid) AS permitido",
      [user.id, maintenanceId],
    );
    if (!permissionRows[0]?.permitido) {
      throw new Error("No tienes este mantenimiento asignado para reportarlo.");
    }

    let assignmentRows = (await client.query(
      `SELECT id, usuario_id, rol_participacion, porcentaje, valor_ganado
         FROM public.mantenimientos_programados_participantes
        WHERE mantenimiento_id = $1 AND estado = 'activo'
         ORDER BY rol_participacion = 'principal' DESC, created_at`,
      [maintenanceId],
    )).rows;
    const assignment = assignmentRows.find((row: any) => String(row.usuario_id) === String(user.id));
    let selectedAssignment = assignment || assignmentRows[0];
    if (!selectedAssignment && maintenance.tecnico_principal_id && (
      String(maintenance.tecnico_principal_id) === String(user.id)
      || ["admin", "supervisor"].includes(user.rol)
    )) {
      const { rows: fallbackAssignmentRows } = await client.query(
        `INSERT INTO public.mantenimientos_programados_participantes
          (mantenimiento_id, usuario_id, rol_participacion, porcentaje, valor_ganado)
         VALUES ($1,$2,'principal',100,$3)
         ON CONFLICT (mantenimiento_id, usuario_id) DO UPDATE SET estado = 'activo', fecha_retiro = NULL, updated_at = clock_timestamp()
         RETURNING id, usuario_id, rol_participacion, porcentaje, valor_ganado`,
        [maintenanceId, maintenance.tecnico_principal_id, number(maintenance.costo_tecnico_presupuestado)],
      );
      selectedAssignment = fallbackAssignmentRows[0];
      assignmentRows = [...assignmentRows, selectedAssignment];
    }
    if (!assignment && !["admin", "supervisor"].includes(user.rol) && String(selectedAssignment?.usuario_id) !== String(user.id)) {
      throw new Error("No estás incluido como participante de este mantenimiento.");
    }
    if (!selectedAssignment) throw new Error("El mantenimiento no tiene técnicos asignados.");
    const contextCandidates = uniqueIds([
      String(selectedAssignment.usuario_id || user.id),
      String(maintenance.tecnico_principal_id || ""),
      ...assignmentRows.map((item: any) => String(item.usuario_id || "")),
    ]);
    let context = await resolveMaintenanceContext(
      client,
      maintenance.cliente_id,
      contextCandidates[0],
      executionDate,
      maintenance.grupo_id,
      maintenance.sede_id,
    );
    for (const candidateId of contextCandidates.slice(1)) {
      if (context.grupoId) break;
      context = await resolveMaintenanceContext(
        client,
        maintenance.cliente_id,
        candidateId,
        executionDate,
        maintenance.grupo_id,
        context.sedeId || maintenance.sede_id,
      );
    }
    const reportGroupId = context.grupoId;
    const reportSedeId = context.sedeId;
    if (!reportGroupId) {
      throw new Error("El técnico asignado no pertenece a un grupo de trabajo activo.");
    }
    if (!maintenance.grupo_id || !maintenance.sede_id) {
      await client.query(
        `UPDATE public.mantenimientos_programados
            SET grupo_id = COALESCE(grupo_id, $2), sede_id = COALESCE(sede_id, $3), updated_at = clock_timestamp()
          WHERE id = $1`,
        [maintenanceId, reportGroupId, reportSedeId],
      );
    }

    const { rows: linkedRows } = await client.query(
      `SELECT a.id, a.codigo, a.grupo_id, a.cliente_id, a.sede_id, a.valor_base, a.valor_aplicado,
              a.descripcion, a.observaciones, a.estado
         FROM public.actividades_operativas_mantenimientos am
         JOIN public.actividades_operativas a ON a.id = am.actividad_id
        WHERE am.mantenimiento_programado_id = $1
        ORDER BY a.created_at DESC
        LIMIT 1
        FOR UPDATE OF a`,
      [maintenanceId],
    );
    let activity = linkedRows[0];
    const key = `mantenimiento:${maintenanceId}`;
    if (!activity) {
      const { rows: existingByKey } = await client.query(
        `SELECT id, codigo, grupo_id, cliente_id, sede_id, valor_base, valor_aplicado,
                descripcion, observaciones, estado
           FROM public.actividades_operativas
          WHERE clave_idempotencia = $1
          LIMIT 1
          FOR UPDATE`,
        [key],
      );
      activity = existingByKey[0];
    }
    if (!activity) {
      const { rows: insertedRows } = await client.query(
        `INSERT INTO public.actividades_operativas
          (codigo, clave_idempotencia, origen, tipo, estado, cliente_id, sede_id, grupo_id,
           creado_por_id, fecha_operacion, descripcion, observaciones, valor_base, valor_aplicado,
           costo_administrable, metadata)
         VALUES (COALESCE($1, public.new_activity_code()), $2, 'app', 'mantenimiento', 'en_progreso',
                 $3, $4, $5, $6, $7, $8, $9, $10, $10, false, $11::jsonb)
         ON CONFLICT (clave_idempotencia) DO UPDATE SET updated_at = clock_timestamp()
         RETURNING id, codigo, grupo_id, cliente_id, sede_id, valor_base, valor_aplicado, descripcion, observaciones, estado`,
        [
          payload.codigo || null,
          key,
          maintenance.cliente_id,
          reportSedeId,
          reportGroupId,
          user.id,
          executionDate,
          sharedMaintenanceTitle,
          maintenance.observaciones || null,
          number(maintenance.costo_tecnico_presupuestado),
          JSON.stringify({ mantenimientoId: maintenanceId, fechaProgramada: scheduledDate, extemporaneo: Boolean(scheduledDate && scheduledDate < executionDate) }),
        ],
      );
      activity = insertedRows[0];
    }

    await client.query(
      `INSERT INTO public.actividades_operativas_mantenimientos
        (actividad_id, mantenimiento_programado_id, titulo, tipo_pendiente, descripcion_pendiente, receptor_nombre, firmado)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (actividad_id) DO UPDATE SET
         titulo = COALESCE(EXCLUDED.titulo, actividades_operativas_mantenimientos.titulo),
         tipo_pendiente = COALESCE(actividades_operativas_mantenimientos.tipo_pendiente, EXCLUDED.tipo_pendiente),
         descripcion_pendiente = COALESCE(actividades_operativas_mantenimientos.descripcion_pendiente, EXCLUDED.descripcion_pendiente)`,
      [activity.id, maintenanceId, sharedMaintenanceTitle, maintenance.tipo_pendiente || null, maintenance.descripcion_pendiente || null, null, false],
    );
    for (const item of assignmentRows) {
      const valueBase = number(maintenance.costo_tecnico_presupuestado);
      const valueEarned = item.valor_ganado == null ? roundCurrency(valueBase * number(item.porcentaje) / 100) : number(item.valor_ganado);
      await client.query(
        `INSERT INTO public.actividades_operativas_participantes
          (actividad_id, tecnico_id, rol_participacion, porcentaje, valor_base, valor_ganado)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (actividad_id, tecnico_id) DO NOTHING`,
        [activity.id, item.usuario_id, item.rol_participacion, item.porcentaje, valueBase, valueEarned],
      );
    }

    const { rows: activityParticipants } = await client.query(
      `SELECT id, tecnico_id, porcentaje, valor_base, valor_ganado
         FROM public.actividades_operativas_participantes
        WHERE actividad_id = $1
        ORDER BY rol_participacion = 'principal' DESC, created_at`,
      [activity.id],
    );
    const currentParticipant = activityParticipants.find((row: any) => String(row.tecnico_id) === String(user.id)) || activityParticipants[0];
    if (!currentParticipant) throw new Error("No se pudo crear el participante del reporte.");

    const { rows: reportGroupRows } = await client.query("SELECT lider_id FROM public.grupos_trabajo WHERE id = $1", [reportGroupId]);
    const leaderId = reportGroupRows[0]?.lider_id || maintenance.mantenimiento_lider_id || user.id;

    const periodDate = executionDate;
    const { rows: periodRows } = await client.query(
      `SELECT id FROM public.periodos_liquidacion
        WHERE fecha_inicio <= $1::date AND fecha_fin >= $1::date
        ORDER BY fecha_inicio DESC LIMIT 1`,
      [periodDate],
    );
    if (periodRows[0]) {
      for (const item of activityParticipants) {
        await client.query(
          `INSERT INTO public.liquidacion_items
            (periodo_id, actividad_id, participante_id, tecnico_id, fecha_operacion, tipo, porcentaje,
             valor_base, valor_ganado, valor_ganado_original, estado, descripcion_snapshot, sede_snapshot)
           VALUES ($1,$2,$3,$4,$5,'mantenimiento',$6,$7,$8,$8,'pendiente',$9,$10)
           ON CONFLICT (periodo_id, actividad_id, participante_id) DO NOTHING`,
          [periodRows[0].id, activity.id, item.id, item.tecnico_id, periodDate, item.porcentaje, item.valor_base, item.valor_ganado, activity.descripcion, reportSedeId],
        );
      }
    }

    await client.query(
      `INSERT INTO public.actividades_operativas_entregas
        (actividad_id, participante_id, estado, actividades_realizadas, observaciones,
         tipo_pendiente, descripcion_pendiente, receptor_nombre, firmado,
         firma_receptor_url, foto_bitacora_url, fecha_ejecucion, enviado_por_id, enviado_en)
       VALUES ($1,$2,'enviada',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,clock_timestamp())
       ON CONFLICT (actividad_id, participante_id) DO UPDATE SET
         estado = 'enviada', actividades_realizadas = EXCLUDED.actividades_realizadas,
         observaciones = EXCLUDED.observaciones,
         tipo_pendiente = EXCLUDED.tipo_pendiente,
         descripcion_pendiente = EXCLUDED.descripcion_pendiente,
         receptor_nombre = EXCLUDED.receptor_nombre,
         firmado = EXCLUDED.firmado,
         firma_receptor_url = EXCLUDED.firma_receptor_url,
         foto_bitacora_url = EXCLUDED.foto_bitacora_url,
         fecha_ejecucion = EXCLUDED.fecha_ejecucion,
         enviado_por_id = EXCLUDED.enviado_por_id,
         enviado_en = clock_timestamp(),
         updated_at = clock_timestamp()`,
      [
        activity.id,
        currentParticipant.id,
        payload.actividades || null,
        payload.observaciones || null,
        payload.tipoPendiente || null,
        payload.descripcionPendiente || null,
        payload.receptorNombre || null,
        Boolean(payload.firmado),
        payload.firmaReceptorUrl || null,
        payload.bitacoraUrl || null,
        executionDate,
        user.id,
      ],
    );

    await client.query(
      `UPDATE public.actividades_operativas_participantes
          SET estado_reporte = 'enviada', updated_at = clock_timestamp()
        WHERE id = $1`,
      [currentParticipant.id],
    );

    // Una reentrega reemplaza solo las evidencias de este técnico. Las
    // evidencias de los demás participantes nunca se modifican.
    await client.query(
      `DELETE FROM public.actividades_operativas_evidencias
        WHERE actividad_id = $1 AND participante_id = $2`,
      [activity.id, currentParticipant.id],
    );

    for (const evidence of jsonArray(payload.evidencias)) {
      if (!evidence?.key && !evidence?.url) continue;
      await client.query(
        `INSERT INTO public.actividades_operativas_evidencias
          (actividad_id, participante_id, tipo, storage_bucket, storage_key, url, orden, subido_por_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (storage_bucket, storage_key) DO UPDATE SET
           url = EXCLUDED.url, actividad_id = EXCLUDED.actividad_id,
           participante_id = EXCLUDED.participante_id, subido_por_id = EXCLUDED.subido_por_id
         WHERE actividades_operativas_evidencias.participante_id IS NULL
            OR actividades_operativas_evidencias.participante_id = EXCLUDED.participante_id`,
        [activity.id, currentParticipant.id, evidence.tipo || "general", evidence.bucket || "fotos-mantenimientos", evidence.key || evidence.url, evidence.url || null, number(evidence.orden), user.id],
      );
    }

    const { rows: deliveryCount } = await client.query(
      `SELECT
          COUNT(DISTINCT mp.usuario_id)::int AS total,
          COUNT(DISTINCT mp.usuario_id) FILTER (WHERE EXISTS (
            SELECT 1
              FROM public.actividades_operativas_participantes p_check
              JOIN public.actividades_operativas_entregas d_check
                ON d_check.actividad_id = p_check.actividad_id
               AND d_check.participante_id = p_check.id
             WHERE p_check.actividad_id = $1
               AND p_check.tecnico_id = mp.usuario_id
               AND d_check.estado IN ('enviada', 'aprobada')
          ))::int AS enviados
          FROM public.mantenimientos_programados_participantes mp
         WHERE mp.mantenimiento_id = $2
           AND mp.estado = 'activo'`,
      [activity.id, maintenanceId],
    );
    const complete = number(deliveryCount[0]?.total) > 0 && number(deliveryCount[0]?.enviados) >= number(deliveryCount[0]?.total);
    const nextActivityState = complete ? "pendiente_aprobacion" : "en_progreso";
    if (complete) {
      await client.query(
        `INSERT INTO public.actividades_operativas_aprobaciones
          (actividad_id, participante_id, revisor_id, estado)
         SELECT $1, NULL, $2, 'pendiente'
          WHERE NOT EXISTS (
            SELECT 1
              FROM public.actividades_operativas_aprobaciones
             WHERE actividad_id = $1 AND participante_id IS NULL
          )`,
        [activity.id, leaderId],
      );
      await client.query(
        `UPDATE public.actividades_operativas_aprobaciones
            SET estado = 'pendiente', revisado_en = NULL, updated_at = clock_timestamp()
          WHERE actividad_id = $1 AND participante_id IS NULL`,
        [activity.id],
      );
    } else {
      await client.query(
        `UPDATE public.actividades_operativas_aprobaciones
            SET estado = 'pendiente', revisado_en = NULL, updated_at = clock_timestamp()
          WHERE actividad_id = $1 AND participante_id IS NULL AND estado <> 'pendiente'`,
        [activity.id],
      );
    }
    await client.query(
      `UPDATE public.actividades_operativas
          SET estado = $2,
              fecha_operacion = CASE WHEN estado = 'borrador' THEN $3::date ELSE fecha_operacion END,
              metadata = metadata || $4::jsonb,
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [activity.id, nextActivityState, executionDate, JSON.stringify({ ultimaEntregaPorUsuario: user.id, ultimaEntregaEn: new Date().toISOString(), fechaProgramada: scheduledDate, extemporaneo: Boolean(scheduledDate && scheduledDate < executionDate) })],
    );
    await client.query(
      `UPDATE public.mantenimientos_programados
          SET estado = CASE
            WHEN $2::boolean THEN 'ejecutado'
            WHEN estado IN ('ejecutado', 'completado') THEN 'asignado'
            ELSE estado
          END,
              fecha_realizado = CASE
                WHEN $2::boolean THEN COALESCE(fecha_realizado, $3::date)
                WHEN estado IN ('ejecutado', 'completado') THEN NULL
                ELSE fecha_realizado
              END,
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [maintenanceId, complete, executionDate],
    );

    return {
      mantenimientoId: maintenanceId,
      actividadId: activity.id,
      codigo: activity.codigo,
      participanteId: currentParticipant.id,
      estado: "enviada",
      completo: complete,
      extemporaneo: Boolean(scheduledDate && scheduledDate < executionDate),
      fechaEjecucion: executionDate,
    };
  });
  await syncActivityAttendanceDiscounts(result.actividadId);
  return result;
}

async function syncActivityParticipantValue(client: any, activityId: string, participantId: string, amount: number, percentage?: number) {
  const { rows: participantRows } = await client.query(
    `SELECT id, porcentaje
       FROM public.actividades_operativas_participantes
      WHERE actividad_id = $1 AND id = $2
      FOR UPDATE`,
    [activityId, participantId],
  );
  if (!participantRows[0]) return false;

  const normalizedAmount = Math.max(0, roundCurrency(amount));
  const normalizedPercentage = percentage == null
    ? number(participantRows[0].porcentaje)
    : Math.max(0, Math.min(100, number(percentage)));

  await client.query(
    `UPDATE public.actividades_operativas_participantes
        SET porcentaje = $3,
            valor_ganado = $4,
            updated_at = clock_timestamp()
      WHERE actividad_id = $1 AND id = $2`,
    [activityId, participantId, normalizedPercentage, normalizedAmount],
  );

  const { rows: liquidationRows } = await client.query(
    `SELECT id, tipo, porcentaje_descuento_tardanza
       FROM public.liquidacion_items
      WHERE actividad_id = $1 AND participante_id = $2
        AND periodo_id IN (SELECT id FROM public.periodos_liquidacion WHERE estado = 'abierto')
      FOR UPDATE`,
    [activityId, participantId],
  );

  for (const liquidation of liquidationRows) {
    const discount = liquidation.tipo === "recorrido"
      ? 0
      : Math.max(0, Math.min(100, number(liquidation.porcentaje_descuento_tardanza)));
    const discountValue = roundCurrency(normalizedAmount * discount / 100);
    const earnedValue = roundCurrency(normalizedAmount - discountValue);

    await client.query(
      `UPDATE public.liquidacion_items
          SET valor_ganado_original = $2,
              valor_ganado = $3,
              descuento_tardanza = $4,
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [liquidation.id, normalizedAmount, earnedValue, discountValue],
    );
  }

  return true;
}

async function updateActivityValues(payload: Payload) {
  const rawId = String(payload.id || payload.actividadOperativaId || "");
  const id = canonicalActivityId(rawId);
  const directParticipantId = canonicalParticipantId(rawId)
    || String(payload.participantId || payload.participanteId || "").trim()
    || null;
  const hasTechnicalValue = payload.clientCost === undefined
    && (payload.value !== undefined || payload.costoActividad !== undefined);
  const technicalValue = payload.costoActividad !== undefined
    ? number(payload.costoActividad)
    : payload.value !== undefined && payload.clientCost === undefined
      ? number(payload.value)
      : null;
  const rawSharedParticipants = jsonArray(payload.participantOverrides || payload.sharedVisitParticipants)
    .map((item) => ({
      participantId: canonicalParticipantId(item.reportId || item.id)
        || String(item.participantId || item.participanteId || "").trim()
        || null,
      percentage: item.percentage == null ? undefined : number(item.percentage),
      amount: number(item.valorGanado ?? item.amount ?? item.valor_ganado),
    }))
    .filter((item) => item.participantId);
  const sharedParticipants = normalizePercentageRows(
    rawSharedParticipants.map((item) => ({ ...item, porcentaje: item.percentage ?? 0 })),
  ).map(({ porcentaje, ...item }) => ({ ...item, percentage: porcentaje }));

  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };
  if (payload.value !== undefined) set(payload.clientCost !== undefined ? "valor_cliente" : "valor_aplicado", number(payload.value));
  if (payload.costoActividad !== undefined) set("valor_aplicado", number(payload.costoActividad));
  if (payload.valorSugerido !== undefined) set("valor_sugerido", payload.valorSugerido == null ? null : number(payload.valorSugerido));
  if (payload.motivoModificacionValor !== undefined) set("motivo_modificacion_valor", payload.motivoModificacionValor || null);
  if (fields.length === 0 && !hasTechnicalValue) return true;

  return withTransaction(async (client) => {
    const { rows: activityRows } = await client.query(
      `SELECT a.id, a.tipo, a.valor_aplicado, am.mantenimiento_programado_id
         FROM public.actividades_operativas
          a LEFT JOIN public.actividades_operativas_mantenimientos am ON am.actividad_id = a.id
        WHERE a.id = $1
        FOR UPDATE OF a`,
      [id],
    );
    const activity = activityRows[0];
    if (!activity) throw new Error("No se encontró la actividad para actualizar.");

    if (fields.length > 0) {
      values.push(id);
      await client.query(
        `UPDATE public.actividades_operativas
            SET ${fields.join(", ")}, updated_at = clock_timestamp(), version = version + 1
          WHERE id = $${values.length}`,
        values,
      );
    }

    // A maintenance can be reviewed before every assigned technician has
    // submitted. Ensure the canonical activity has valid rows for all active
    // assignees before applying the administrator's reparto. This preserves
    // one maintenance in approvals while keeping each participant independent.
    if (activity.tipo === "mantenimiento" && activity.mantenimiento_programado_id) {
      await ensureMaintenanceActivityParticipants(client, id, activity.mantenimiento_programado_id);
    }

    if (!hasTechnicalValue || technicalValue == null) return true;

    const normalizedTechnicalValue = Math.max(0, roundCurrency(technicalValue));
    if (sharedParticipants.length > 0) {
      for (const participant of sharedParticipants) {
        await syncActivityParticipantValue(client, id, participant.participantId!, participant.amount, participant.percentage);
      }
    } else {
      const { rows: participants } = await client.query(
        `SELECT id, porcentaje
           FROM public.actividades_operativas_participantes
          WHERE actividad_id = $1
          ORDER BY created_at, id
          FOR UPDATE`,
        [id],
      );

      if (directParticipantId) {
        await syncActivityParticipantValue(client, id, directParticipantId, normalizedTechnicalValue);
      } else if (participants.length === 1) {
        await syncActivityParticipantValue(client, id, participants[0].id, normalizedTechnicalValue);
      } else if (participants.length > 1) {
        let assigned = 0;
        for (let index = 0; index < participants.length; index += 1) {
          const participantPercentage = Math.max(0, number(participants[index].porcentaje));
          const amount = index === participants.length - 1
            ? normalizedTechnicalValue - assigned
            : roundCurrency(normalizedTechnicalValue * participantPercentage / 100);
          assigned += amount;
          await syncActivityParticipantValue(client, id, participants[index].id, amount, participantPercentage);
        }
      }
    }

    return true;
  });
}

async function updateMaintenanceApproval(activityId: string, state: "aprobada" | "rechazada" | "pendiente", comment: string | null, user: UserContext) {
  return withTransaction(async (client) => {
    const { rows: activityRows } = await client.query(
      `SELECT a.id, a.tipo, a.grupo_id, g.lider_id, am.mantenimiento_programado_id
         FROM public.actividades_operativas a
         LEFT JOIN public.grupos_trabajo g ON g.id = a.grupo_id
         LEFT JOIN public.actividades_operativas_mantenimientos am ON am.actividad_id = a.id
        WHERE a.id = $1 AND a.tipo = 'mantenimiento'
        FOR UPDATE OF a`,
      [activityId],
    );
    const activity = activityRows[0];
    if (!activity) throw new Error("No se encontró el mantenimiento para aprobar.");

    // Approval is an administrative action and may happen after only one
    // technician has delivered. Materialize all assigned technicians with a
    // valid split before saving the global approval; the missing delivery is
    // intentionally not fabricated.
    if (activity.mantenimiento_programado_id) {
      await ensureMaintenanceActivityParticipants(client, activityId, activity.mantenimiento_programado_id);
    }

    const reviewerId = user.id || activity.lider_id;
    const { rows: existingApprovals } = await client.query(
      `SELECT id, participante_id
         FROM public.actividades_operativas_aprobaciones
        WHERE actividad_id = $1
        ORDER BY participante_id NULLS FIRST, updated_at DESC NULLS LAST, id`,
      [activityId],
    );
    const existingGlobal = existingApprovals.find((item: any) => item.participante_id == null);
    let globalApprovalId = existingGlobal?.id;

    if (globalApprovalId) {
      await client.query(
        `UPDATE public.actividades_operativas_aprobaciones
            SET revisor_id = $2,
                estado = $3,
                comentario = $4,
                revisado_en = CASE WHEN $3 = 'pendiente' THEN NULL ELSE clock_timestamp() END,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [globalApprovalId, reviewerId, state, comment],
      );
    } else {
      const { rows } = await client.query(
        `INSERT INTO public.actividades_operativas_aprobaciones
          (actividad_id, participante_id, revisor_id, estado, comentario, revisado_en)
         VALUES ($1, NULL, $2, $3, $4, CASE WHEN $3 = 'pendiente' THEN NULL ELSE clock_timestamp() END)
         RETURNING id`,
        [activityId, reviewerId, state, comment],
      );
      globalApprovalId = rows[0]?.id;
    }

    const legacyApprovalIds = existingApprovals
      .filter((item: any) => item.participante_id != null && item.id !== globalApprovalId)
      .map((item: any) => item.id);
    if (legacyApprovalIds.length > 0 && globalApprovalId) {
      await client.query(
        `INSERT INTO public.lote_aprobacion_items (lote_id, aprobacion_id)
         SELECT DISTINCT lote_id, $1::uuid
           FROM public.lote_aprobacion_items
          WHERE aprobacion_id = ANY($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [globalApprovalId, legacyApprovalIds],
      );
      await client.query("DELETE FROM public.lote_aprobacion_items WHERE aprobacion_id = ANY($1::uuid[])", [legacyApprovalIds]);
      await client.query("DELETE FROM public.actividades_operativas_aprobaciones WHERE id = ANY($1::uuid[])", [legacyApprovalIds]);
    }

    await client.query(
      `UPDATE public.actividades_operativas_entregas
          SET estado = $2, updated_at = clock_timestamp()
        WHERE actividad_id = $1`,
      [activityId, state === "aprobada" ? "aprobada" : state === "rechazada" ? "rechazada" : "enviada"],
    );
    await client.query(
      `UPDATE public.actividades_operativas_participantes
          SET estado_reporte = $2, updated_at = clock_timestamp()
        WHERE actividad_id = $1`,
      [activityId, state === "aprobada" ? "aprobada" : state === "rechazada" ? "rechazada" : "enviada"],
    );
    await client.query(
      `UPDATE public.liquidacion_items
          SET estado = CASE WHEN $2 = 'aprobada' THEN 'aprobado' WHEN $2 = 'rechazada' THEN 'anulado' ELSE 'pendiente' END,
              updated_at = clock_timestamp()
        WHERE actividad_id = $1
          AND periodo_id IN (SELECT id FROM public.periodos_liquidacion WHERE estado = 'abierto')`,
      [activityId, state],
    );
    await client.query(
      `UPDATE public.actividades_operativas
          SET estado = $2, updated_at = clock_timestamp(), version = version + 1
        WHERE id = $1`,
      [activityId, state === "aprobada" ? "aprobada" : state === "rechazada" ? "rechazada" : "pendiente_aprobacion"],
    );

    return true;
  });
}

async function updateApproval(payload: Payload, user: UserContext) {
  const activityId = canonicalActivityId(payload.id || payload.actividadOperativaId);
  const { rows: activityTypeRows } = await dbQuery("SELECT tipo FROM public.actividades_operativas WHERE id = $1", [activityId]);
  if (activityTypeRows[0]?.tipo === "mantenimiento") {
    const state = payload.estado === "aprobado" ? "aprobada" : payload.estado === "rechazado" ? "rechazada" : "pendiente";
    return updateMaintenanceApproval(activityId, state, payload.comentario || null, user);
  }
  const participantId = payload.participanteId || canonicalParticipantId(payload.id);
  const { rows: participantRows } = await dbQuery("SELECT id FROM public.actividades_operativas_participantes WHERE actividad_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid) ORDER BY rol_participacion = 'principal' DESC LIMIT 1", [activityId, participantId || null]);
  const participant = participantRows[0];
  if (!participant) throw new Error("No se encontró el participante de la actividad.");
  const state = payload.estado === "aprobado" ? "aprobada" : payload.estado === "rechazado" ? "rechazada" : "pendiente";
  await dbQuery(
    `INSERT INTO public.actividades_operativas_aprobaciones (actividad_id, participante_id, revisor_id, estado, comentario, revisado_en)
     VALUES ($1,$2,$3,$4,$5,CASE WHEN $4 = 'pendiente' THEN NULL ELSE clock_timestamp() END)
     ON CONFLICT (actividad_id, participante_id) DO UPDATE SET revisor_id=EXCLUDED.revisor_id, estado=EXCLUDED.estado, comentario=EXCLUDED.comentario, revisado_en=EXCLUDED.revisado_en, updated_at=clock_timestamp()`,
    [activityId, participant.id, user.id, state, payload.comentario || null],
  );
  await dbQuery(
    `UPDATE public.actividades_operativas_entregas
        SET estado = $3, updated_at = clock_timestamp()
      WHERE actividad_id = $1 AND participante_id = $2`,
    [activityId, participant.id, state === "aprobada" ? "aprobada" : state === "rechazada" ? "rechazada" : "enviada"],
  );
  await dbQuery(
    `UPDATE public.actividades_operativas_participantes
        SET estado_reporte = $3, updated_at = clock_timestamp()
      WHERE actividad_id = $1 AND id = $2`,
    [activityId, participant.id, state === "aprobada" ? "aprobada" : state === "rechazada" ? "rechazada" : "enviada"],
  );
  const { rows: approvalSummary } = await dbQuery(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ap.estado = 'aprobada')::int AS aprobadas,
            COUNT(*) FILTER (WHERE ap.estado = 'rechazada')::int AS rechazadas
       FROM public.actividades_operativas_participantes p
       LEFT JOIN public.actividades_operativas_aprobaciones ap
         ON ap.actividad_id = p.actividad_id AND ap.participante_id = p.id
      WHERE p.actividad_id = $1`,
    [activityId],
  );
  const totalApprovals = number(approvalSummary[0]?.total);
  const approvedApprovals = number(approvalSummary[0]?.aprobadas);
  const rejectedApprovals = number(approvalSummary[0]?.rechazadas);
  const activityState = rejectedApprovals > 0
    ? "rechazada"
    : totalApprovals > 0 && approvedApprovals === totalApprovals
      ? "aprobada"
      : "pendiente_aprobacion";
  await dbQuery("UPDATE public.actividades_operativas SET estado = $2, updated_at = clock_timestamp() WHERE id = $1", [activityId, activityState]);
  await dbQuery(
    `UPDATE public.liquidacion_items
        SET estado = CASE WHEN $2 = 'aprobada' THEN 'aprobado' WHEN $2 = 'rechazada' THEN 'anulado' ELSE 'pendiente' END,
            updated_at = clock_timestamp()
      WHERE actividad_id = $1 AND participante_id = $3
        AND periodo_id IN (SELECT id FROM public.periodos_liquidacion WHERE estado = 'abierto')`,
    [activityId, state, participant.id],
  );
  return true;
}

async function markReportEmail(payload: Payload) {
  const id = canonicalActivityId(payload.id);
  await dbQuery("UPDATE public.actividades_operativas SET metadata = metadata || $2::jsonb, updated_at = clock_timestamp() WHERE id = $1", [id, JSON.stringify({ correoEnviado: true, fechaUltimoEnvioCorreo: payload.sentAt || new Date().toISOString() })]);
  return true;
}

async function createOperationalActivity(payload: Payload, user: UserContext) {
  const type = String(payload.tipo || "actividad");
  if (!["actividad", "mantenimiento", "visita_tecnica", "recorrido"].includes(type)) {
    throw new Error("Tipo de actividad no válido.");
  }

  const key = String(payload.claveIdempotencia || payload.clave_idempotencia || `${type}:${payload.codigo || ""}:${payload.fechaOperacion || ""}`).trim();
  if (!key) throw new Error("La actividad requiere una clave de idempotencia.");

  const existing = await dbQuery(
    "SELECT id, codigo FROM public.actividades_operativas WHERE clave_idempotencia = $1 LIMIT 1",
    [key],
  );
  if (existing.rows[0]) return { activityId: existing.rows[0].id, codigo: existing.rows[0].codigo, reused: true };

  const participants = jsonArray(payload.participantes || payload.participants);
  if (!participants.length) throw new Error("La actividad requiere al menos un participante.");
  const totalPercentage = participants.reduce((sum, item) => sum + number(item.porcentaje), 0);
  if (totalPercentage > 100.01 || (!payload.deferSubmission && Math.abs(totalPercentage - 100) > 0.01)) throw new Error("La suma de porcentajes de los participantes debe ser 100%.");

  const valorBase = Math.max(0, number(payload.valorBase));
  const valorAplicado = Math.max(0, number(payload.valorAplicado ?? valorBase));
  const rawValorSugerido = payload.valorSugerido == null ? null : Number(payload.valorSugerido);
  if (rawValorSugerido !== null && (!Number.isFinite(rawValorSugerido) || rawValorSugerido < 0)) {
    throw new Error("El valor sugerido debe ser un número mayor o igual a cero.");
  }
  const motivoModificacionValor = String(payload.motivoModificacionValor || "").trim();
  const tieneValorSugeridoDiferente = rawValorSugerido !== null && Math.abs(rawValorSugerido - valorBase) > 0.01;
  if (tieneValorSugeridoDiferente && !motivoModificacionValor) {
    throw new Error("Una sugerencia de valor diferente requiere una razón.");
  }
  const valorSugerido = tieneValorSugeridoDiferente ? rawValorSugerido : null;

  let activityId: string;
  let semanticFingerprintForRace: string | null = null;
  try {
    const createdActivity = await withTransaction(async (client) => {
    let sedeId = payload.sedeId || null;
    if (!sedeId) {
      const { rows } = await client.query("SELECT id FROM public.cliente_sedes WHERE cliente_id = $1 AND estado = 'activo' ORDER BY created_at LIMIT 1", [payload.clienteId]);
      sedeId = rows[0]?.id || null;
    }
    if (type !== "recorrido" && !sedeId) throw new Error("El cliente no tiene una sede activa.");

    let grupoId = payload.grupoId || null;
    if (!grupoId) {
      const { rows } = await client.query(
        `SELECT gm.grupo_id
           FROM public.grupo_miembros gm
          WHERE gm.usuario_id = $1 AND gm.fecha_inicio <= $2::date
            AND (gm.fecha_fin IS NULL OR gm.fecha_fin >= $2::date)
          ORDER BY gm.fecha_inicio DESC LIMIT 1`,
        [user.id, payload.fechaOperacion],
      );
      grupoId = rows[0]?.grupo_id || null;
    }
    if (!grupoId) throw new Error("La actividad requiere un grupo de trabajo.");

    // Recorridos y actividades grupales son permisos independientes. Un
    // técnico con recorridos habilitados debe poder registrar el recorrido
    // aunque no figure en grupo_reportadores_actividad; el grupo solo se
    // conserva como contexto para líder, liquidación y trazabilidad.
    const permissionQuery = type === "recorrido"
      ? `SELECT (u.estado = 'activo' AND (COALESCE(u.tiene_recorrido, false) OR COALESCE(u.routes_enabled, false))) AS permitido
           FROM public.usuarios u
          WHERE u.id = $1::uuid`
      : "SELECT public.usuario_puede_reportar_grupo($1::uuid, $2::uuid, $3::date) AS permitido";
    const permissionValues = type === "recorrido"
      ? [user.id]
      : [user.id, grupoId, dateOnly(payload.fechaOperacion) || bogotaClock().date];
    const { rows: permissionRows } = await client.query(permissionQuery, permissionValues);
    if (!permissionRows[0]?.permitido) {
      throw new Error("No tienes permiso para reportar actividades en este grupo.");
    }

    const { rows: groupRowsForLeader } = await client.query("SELECT lider_id FROM public.grupos_trabajo WHERE id = $1", [grupoId]);
    const leaderId = groupRowsForLeader[0]?.lider_id || user.id;

    const semanticFingerprint = await calculateSemanticFingerprint(client, payload, type, sedeId, grupoId);
    semanticFingerprintForRace = semanticFingerprint;
    const { rows: semanticExistingRows } = await client.query(
      `SELECT id, codigo
         FROM public.actividades_operativas
        WHERE huella_semantica = $1
          AND estado <> 'cancelada'
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE`,
      [semanticFingerprint],
    );
    if (semanticExistingRows[0]) {
      return {
        activityId: semanticExistingRows[0].id,
        codigo: semanticExistingRows[0].codigo,
        reused: true,
        semanticDuplicate: true,
      };
    }

    const { rows: activityRowsResult } = await client.query(
      `INSERT INTO public.actividades_operativas
        (codigo, clave_idempotencia, origen, tipo, estado, cliente_id, sede_id, grupo_id, creado_por_id,
         fecha_operacion, fecha_inicio, fecha_fin, descripcion, observaciones, valor_base, valor_sugerido,
         valor_aplicado, valor_cliente, motivo_modificacion_valor, costo_administrable, metadata,
         huella_semantica)
       VALUES (COALESCE($1, public.new_activity_code()),$2,$3,$4,'borrador',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id, codigo`,
      [
        payload.codigo || undefined,
        key,
        payload.origen || "app",
        type,
        payload.clienteId,
        sedeId,
        grupoId,
        user.id,
        payload.fechaOperacion,
        payload.fechaInicio || null,
        payload.fechaFin || null,
        payload.descripcion || "Actividad operativa",
        payload.observaciones || null,
        valorBase,
        valorSugerido,
        valorAplicado,
        payload.valorCliente == null ? null : number(payload.valorCliente),
        valorSugerido == null ? null : motivoModificacionValor,
        Boolean(payload.costoAdministrable),
        payload.metadata || {},
        semanticFingerprint,
      ],
    );
    const row = activityRowsResult[0];

    if (type === "actividad") {
      if (!payload.catalogoActividadId) throw new Error("La actividad requiere un elemento del catálogo.");
      await client.query("INSERT INTO public.actividades_operativas_catalogo (actividad_id, catalogo_actividad_id, especificacion) VALUES ($1,$2,$3)", [row.id, payload.catalogoActividadId, payload.especificacion || null]);
    } else if (type === "mantenimiento") {
      await client.query("INSERT INTO public.actividades_operativas_mantenimientos (actividad_id, mantenimiento_programado_id, titulo, prioridad, tipo_pendiente, descripcion_pendiente, receptor_nombre, firmado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [row.id, payload.mantenimientoProgramadoId || null, payload.titulo || payload.descripcion || null, payload.prioridad || null, payload.tipoPendiente || null, payload.descripcionPendiente || null, payload.receptorNombre || null, Boolean(payload.firmado)]);
    } else if (type === "visita_tecnica") {
      await client.query("INSERT INTO public.actividades_operativas_visitas (actividad_id, tipo_visita, receptor_nombre, receptor_cedula, receptor_cargo, firmado) VALUES ($1,$2,$3,$4,$5,$6)", [row.id, payload.tipoVisita || "imprevisto", payload.receptorNombre || null, payload.receptorCedula || null, payload.receptorCargo || null, Boolean(payload.firmado)]);
    } else {
      await client.query("INSERT INTO public.actividades_operativas_recorridos (actividad_id, punto_partida, punto_llegada, tipo_recorrido, inicio_recorrido, fin_recorrido) VALUES ($1,$2,$3,$4,$5,$6)", [row.id, payload.puntoPartida || "", payload.puntoLlegada || "", payload.tipoRecorrido || "normal", payload.fechaInicio || null, payload.fechaFin || null]);
    }

    for (let index = 0; index < participants.length; index += 1) {
      const item = participants[index];
      const percentage = number(item.porcentaje);
      const valueBase = Math.max(0, number(item.valorBase ?? valorBase));
      const valueEarned = type === "recorrido"
        ? Math.max(0, number(item.valorGanado ?? (valorAplicado * percentage / 100)))
        : calculateLiquidationAmount(valueBase, percentage);
      const { rows: participantRowsResult } = await client.query(
        `INSERT INTO public.actividades_operativas_participantes (actividad_id, tecnico_id, rol_participacion, porcentaje, valor_base, valor_ganado)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [row.id, item.tecnicoId || item.tecnico_id, item.rol || (index === 0 ? "principal" : "acompanante"), percentage, valueBase, valueEarned],
      );
      const participantId = participantRowsResult[0].id;
      await client.query(
        `INSERT INTO public.actividades_operativas_aprobaciones (actividad_id, participante_id, revisor_id, estado)
         VALUES ($1,$2,$3,'pendiente')`,
        [row.id, participantId, leaderId],
      );

      if (payload.periodoId) {
        await client.query(
          `INSERT INTO public.liquidacion_items
            (periodo_id, actividad_id, participante_id, tecnico_id, fecha_operacion, tipo, porcentaje,
             valor_base, valor_ganado, valor_ganado_original, estado, descripcion_snapshot, sede_snapshot)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'pendiente',$10,$11)
           ON CONFLICT (periodo_id, actividad_id, participante_id) DO NOTHING`,
          [payload.periodoId, row.id, participantId, item.tecnicoId || item.tecnico_id, payload.fechaOperacion, type, percentage, valueBase, valueEarned, payload.descripcion || "Actividad operativa", payload.sedeNombre || null],
        );
      }
    }

    if (jsonArray(payload.evidencias).length) {
      for (const evidence of jsonArray(payload.evidencias)) {
        await client.query(
          `INSERT INTO public.actividades_operativas_evidencias (actividad_id, tipo, storage_bucket, storage_key, url, orden, subido_por_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (storage_bucket, storage_key) DO UPDATE SET url = EXCLUDED.url, actividad_id = EXCLUDED.actividad_id`,
          [row.id, evidence.tipo || "general", evidence.bucket || "fotos-reportes", evidence.key || evidence.url, evidence.url || null, number(evidence.orden), user.id],
        );
      }
    }

    if (!payload.deferSubmission) await client.query("UPDATE public.actividades_operativas SET estado = 'pendiente_aprobacion' WHERE id = $1", [row.id]);
      return { activityId: row.id, codigo: row.codigo, reused: false };
    });
    activityId = createdActivity.activityId;
    if (createdActivity.reused) {
      await syncActivityAttendanceDiscounts(activityId);
      return createdActivity;
    }
  } catch (error: any) {
    // Two taps, a network retry, or a duplicated mobile request can race
    // between the initial idempotency lookup and the INSERT. In that case
    // the first transaction is the canonical report; reuse it instead of
    // exposing PostgreSQL's generic duplicate-key error to the app.
    if (error?.code !== "23505") throw error;
    const { rows: existingAfterRace } = await dbQuery(
      `SELECT a.id, a.codigo
         FROM public.actividades_operativas a
         LEFT JOIN public.actividades_operativas_mantenimientos am ON am.actividad_id = a.id
         WHERE a.clave_idempotencia = $1
           OR ($2::uuid IS NOT NULL AND am.mantenimiento_programado_id = $2::uuid)
           OR ($3::text IS NOT NULL AND a.huella_semantica = $3::text)
        ORDER BY a.created_at ASC
        LIMIT 1`,
      [key, payload.mantenimientoProgramadoId || null, semanticFingerprintForRace],
    );
    if (!existingAfterRace[0]) throw error;
    await syncActivityAttendanceDiscounts(existingAfterRace[0].id);
    return { activityId: existingAfterRace[0].id, codigo: existingAfterRace[0].codigo, reused: true };
  }

  await syncActivityAttendanceDiscounts(activityId);
  const { rows } = await dbQuery("SELECT id, codigo FROM public.actividades_operativas WHERE id = $1", [activityId]);
  return { activityId, codigo: rows[0]?.codigo, reused: false };
}

async function addOperationalParticipant(payload: Payload, user: UserContext) {
  const activityId = canonicalActivityId(payload.actividadOperativaId || payload.activityId || payload.id);
  if (!activityId || !payload.tecnicoId) throw new Error("Actividad y técnico son obligatorios.");
  const result = await withTransaction(async (client) => {
    const { rows: activityRowsResult } = await client.query("SELECT id, grupo_id, fecha_operacion, tipo, valor_base, valor_aplicado, descripcion, sede_id FROM public.actividades_operativas WHERE id = $1", [activityId]);
    const activity = activityRowsResult[0];
    if (!activity) throw new Error("No se encontró la actividad.");
    const { rows: existsRows } = await client.query("SELECT id FROM public.actividades_operativas_participantes WHERE actividad_id = $1 AND tecnico_id = $2", [activityId, payload.tecnicoId]);
    if (existsRows[0]) return { activityId, participantId: existsRows[0].id };
    const { rows: leaderRows } = await client.query("SELECT lider_id FROM public.grupos_trabajo WHERE id = $1", [activity.grupo_id]);
    const participantPercentage = number(payload.porcentaje);
    const participantBase = Math.max(0, number(payload.valorBase ?? activity.valor_base));
    const participantEarned = activity.tipo === "recorrido"
      ? Math.max(0, number(payload.valorGanado ?? (number(activity.valor_aplicado) * participantPercentage / 100)))
      : calculateLiquidationAmount(participantBase, participantPercentage);
    const { rows: participantRows } = await client.query("INSERT INTO public.actividades_operativas_participantes (actividad_id, tecnico_id, rol_participacion, porcentaje, valor_base, valor_ganado) VALUES ($1,$2,'acompanante',$3,$4,$5) RETURNING id", [activityId, payload.tecnicoId, participantPercentage, participantBase, participantEarned]);
    await client.query("INSERT INTO public.actividades_operativas_aprobaciones (actividad_id, participante_id, revisor_id, estado) VALUES ($1,$2,$3,'pendiente')", [activityId, participantRows[0].id, leaderRows[0]?.lider_id || user.id]);
    if (payload.periodoId) await client.query("INSERT INTO public.liquidacion_items (periodo_id, actividad_id, participante_id, tecnico_id, fecha_operacion, tipo, porcentaje, valor_base, valor_ganado, valor_ganado_original, estado, descripcion_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'pendiente',$10) ON CONFLICT DO NOTHING", [payload.periodoId, activityId, participantRows[0].id, payload.tecnicoId, activity.fecha_operacion, activity.tipo, participantPercentage, participantBase, participantEarned, activity.descripcion]);
    return { activityId, participantId: participantRows[0].id };
  });
  await syncActivityAttendanceDiscounts(result.activityId);
  return result;
}

async function updateOperationalActivity(payload: Payload, user: UserContext) {
  const id = canonicalActivityId(payload.id || payload.actividadOperativaId);
  const updates: Array<[string, unknown]> = [];
  if (payload.observaciones !== undefined) updates.push(["observaciones", payload.observaciones]);
  if (payload.descripcion !== undefined) updates.push(["descripcion", payload.descripcion]);
  if (payload.valorCliente !== undefined) updates.push(["valor_cliente", payload.valorCliente]);
  if (payload.valorSugerido !== undefined) updates.push(["valor_sugerido", payload.valorSugerido]);
  if (payload.motivoModificacionValor !== undefined) updates.push(["motivo_modificacion_valor", payload.motivoModificacionValor]);
  if (payload.metadata !== undefined) updates.push(["metadata", JSON.stringify(payload.metadata)]);
  if (payload.firmado !== undefined) {
    await dbQuery("UPDATE public.actividades_operativas_visitas SET firmado = $1 WHERE actividad_id = $2", [Boolean(payload.firmado), id]);
  }
  if (!updates.length) return true;
  const values: unknown[] = [];
  const sets = updates.map(([column, value]) => { values.push(value); return column === "metadata" ? `${column} = metadata || $${values.length}::jsonb` : `${column} = $${values.length}`; });
  values.push(id);
  const scope = ["admin", "supervisor"].includes(user.rol) ? `id = $${values.length}` : `id = $${values.length} AND creado_por_id = $${values.length + 1}`;
  await dbQuery(`UPDATE public.actividades_operativas SET ${sets.join(", ")}, updated_at = clock_timestamp(), version = version + 1 WHERE ${scope}`, [ ...values, ...(["admin", "supervisor"].includes(user.rol) ? [] : [user.id]) ]);
  return true;
}

async function finalizeOperationalActivity(payload: Payload) {
  const id = canonicalActivityId(payload.id || payload.actividadOperativaId || payload.activityId);
  await dbQuery("UPDATE public.actividades_operativas SET estado = 'pendiente_aprobacion', updated_at = clock_timestamp(), version = version + 1 WHERE id = $1", [id]);
  return true;
}

async function saveEvidence(payload: Payload, user: UserContext) {
  const activityId = canonicalActivityId(payload.actividadId || payload.id);
  const { rows: activityRowsResult } = await dbQuery(
    "SELECT id, tipo, grupo_id, fecha_operacion FROM public.actividades_operativas WHERE id = $1",
    [activityId],
  );
  if (!activityRowsResult[0]) throw new Error("No se encontró la actividad para guardar la evidencia.");
  let participantId = payload.participanteId || payload.participantId || null;
  if (!participantId && activityRowsResult[0].tipo === "mantenimiento") {
    const { rows: ownParticipants } = await dbQuery(
      `SELECT p.id
         FROM public.actividades_operativas_participantes p
        WHERE p.actividad_id = $1 AND p.tecnico_id = $2
        ORDER BY p.created_at
        LIMIT 1`,
      [activityId, user.id],
    );
    participantId = ownParticipants[0]?.id || null;
    if (!participantId) throw new Error("La evidencia de un mantenimiento requiere un participante asignado.");
  }
  if (participantId) {
    const { rows: participantRows } = await dbQuery(
      "SELECT id, tecnico_id FROM public.actividades_operativas_participantes WHERE id = $1 AND actividad_id = $2",
      [participantId, activityId],
    );
    if (!participantRows[0]) throw new Error("La evidencia no pertenece a un participante válido.");
    if (participantRows[0].tecnico_id !== user.id && !["admin", "supervisor"].includes(user.rol)) {
      throw new Error("Solo puedes cargar evidencias de tu propia entrega.");
    }
  }
  await dbQuery(
    `INSERT INTO public.actividades_operativas_evidencias
      (actividad_id, participante_id, tipo, storage_bucket, storage_key, url, orden, subido_por_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (storage_bucket,storage_key) DO UPDATE SET
       url=EXCLUDED.url, actividad_id=EXCLUDED.actividad_id,
       participante_id=COALESCE(EXCLUDED.participante_id, actividades_operativas_evidencias.participante_id),
       subido_por_id=EXCLUDED.subido_por_id`,
    [activityId, participantId, payload.tipo || "general", payload.bucket, payload.key, payload.url || null, number(payload.orden), user.id],
  );
}

function mapArrival(row: any): any {
  return {
    id: row.id,
    usuarioId: row.usuario_id,
    fecha: dateOnly(row.fecha) || "",
    horaEsperada: row.hora_esperada || "",
    horaLlegada: row.hora_llegada || "",
    horaSalidaProgramada: row.hora_salida_programada_text || undefined,
    horaSalidaReal: row.hora_salida_real_text || undefined,
    estadoEntrada: row.estado_entrada,
    estadoSalida: row.estado_salida,
    // Compatibility field for the UI; derived from the canonical V2 status.
    tarde: row.estado_entrada === "tarde",
    minutosRetraso: number(row.minutos_retraso),
    minutosAdeudados: number(row.minutos_adeudados ?? row.minutos_retraso),
    categoriaLlegada: row.categoria_llegada || (row.estado_entrada === "no_reportado" ? "no_reportado" : row.estado_entrada === "tarde" ? "tardanza_leve" : "a_tiempo"),
    reglaId: row.regla_id || undefined,
    reglaVersion: row.regla_version || undefined,
    porcentajeReglaAplicada: number(row.porcentaje_regla_aplicada ?? row.porcentaje_descuento),
    tipoDescuento: row.tipo_descuento || undefined,
    calculadoEn: row.calculado_en || undefined,
    motivoAjuste: row.motivo_ajuste || undefined,
    ajustadoPorId: row.ajustado_por_id || undefined,
    ajustadoEn: row.ajustado_en || undefined,
    razonTardanza: row.razon_tardanza || undefined,
    fotoLlegadaUrl: row.foto_llegada_url || undefined,
    ubicacionLlegadaPrecisionMetros: row.ubicacion_llegada_precision_metros == null ? undefined : number(row.ubicacion_llegada_precision_metros),
    ubicacionLlegadaTimestamp: row.ubicacion_llegada_timestamp || undefined,
    ubicacionLlegadaDireccion: row.ubicacion_llegada_direccion || undefined,
    mensajeEnviado: row.mensaje_enviado || undefined,
    tipoMensaje: row.tipo_mensaje || undefined,
    descuentoAplicado: Boolean(row.descuento_aplicado),
    porcentajeDescuento: number(row.porcentaje_descuento),
    fechaCreacion: dateOnly(row.created_at) || "",
  };
}

async function syncAttendanceDiscount(attendanceId: string, technicianId: string, fecha: string) {
  const { rows: periodRows } = await dbQuery(
    "SELECT id, estado FROM public.periodos_liquidacion WHERE fecha_inicio <= $1::date AND fecha_fin >= $1::date ORDER BY fecha_inicio DESC LIMIT 1",
    [fecha],
  );
  const periodId = periodRows[0]?.id;
  if (!periodId || periodRows[0]?.estado === "cerrado") return;

  // Recalcular desde todas las asistencias evita descuentos acumulativos por
  // reintentos y permite que la liquidación refleje el acumulado quincenal.
  const { rows: attendanceRows } = await dbQuery(
    `SELECT id, descuento_aplicado, porcentaje_descuento
       FROM public.registros_asistencia
      WHERE usuario_id = $1 AND fecha BETWEEN (
        SELECT fecha_inicio FROM public.periodos_liquidacion WHERE id = $2
      ) AND (
        SELECT fecha_fin FROM public.periodos_liquidacion WHERE id = $2
      )`,
    [technicianId, periodId],
  );
  const discountedAttendanceRows = attendanceRows.filter((row) => Boolean(row.descuento_aplicado));
  // Keep the period discount consistent with the canonical liquidation query:
  // use the highest configured attendance penalty, not the sum of repeated
  // daily events (e.g. five 30% no-shows must not become a 100% deduction).
  const rawPercentage = discountedAttendanceRows.reduce(
    (sum, row) => sum + percentage(row.porcentaje_descuento),
    0,
  );
  const normalizedPercentage = Math.min(100, Math.max(0, discountedAttendanceRows.reduce(
    (max, row) => Math.max(max, percentage(row.porcentaje_descuento)),
    0,
  )));
  await dbQuery(
    `UPDATE public.liquidacion_items li
        SET valor_ganado_original = ROUND(COALESCE(li.valor_base, p.valor_base, a.valor_base) * COALESCE(li.porcentaje, p.porcentaje, 0) / 100, 2),
            valor_ganado = ROUND(COALESCE(li.valor_base, p.valor_base, a.valor_base) * COALESCE(li.porcentaje, p.porcentaje, 0) / 100, 2),
            descuento_tardanza = 0, porcentaje_descuento_tardanza = 0, updated_at = clock_timestamp()
       FROM public.actividades_operativas a
       JOIN public.actividades_operativas_participantes p ON p.actividad_id = a.id
       JOIN public.periodos_liquidacion pl ON pl.estado = 'abierto'
      WHERE li.actividad_id = a.id AND li.participante_id = p.id
        AND li.periodo_id = pl.id AND li.tecnico_id = $1 AND li.periodo_id = $2
        AND li.tipo <> 'recorrido' AND li.estado <> 'anulado'
        AND COALESCE(li.valor_base, p.valor_base, a.valor_base) > 0
        AND ABS(COALESCE(li.valor_base, p.valor_base, a.valor_base) - COALESCE(a.valor_aplicado, 0)) > 0.01
        AND ABS(COALESCE(li.valor_ganado_original, p.valor_ganado, li.valor_ganado)
          - (COALESCE(a.valor_aplicado, 0) * COALESCE(li.porcentaje, p.porcentaje, 0) / 100)) <= 0.01`,
    [technicianId, periodId],
  );
  if (normalizedPercentage <= 0) {
    await dbQuery("DELETE FROM public.asistencia_descuentos WHERE periodo_id = $1 AND tecnico_id = $2", [periodId, technicianId]);
    await dbQuery(
      "UPDATE public.liquidacion_items SET valor_ganado = valor_ganado_original, descuento_tardanza = 0, porcentaje_descuento_tardanza = 0, updated_at = clock_timestamp() WHERE tecnico_id = $1 AND periodo_id = $2 AND tipo <> 'recorrido' AND porcentaje_descuento_tardanza > 0 AND periodo_id IN (SELECT id FROM public.periodos_liquidacion WHERE estado = 'abierto')",
      [technicianId, periodId],
    );
    await dbQuery(
      "UPDATE public.liquidacion_items SET valor_ganado = valor_ganado_original, descuento_tardanza = 0, porcentaje_descuento_tardanza = 0, updated_at = clock_timestamp() WHERE tecnico_id = $1 AND periodo_id = $2 AND tipo = 'recorrido' AND (descuento_tardanza > 0 OR porcentaje_descuento_tardanza > 0) AND periodo_id IN (SELECT id FROM public.periodos_liquidacion WHERE estado = 'abierto')",
      [technicianId, periodId],
    );
    return;
  }

  // Recalculate from the original value so repeated check-ins or admin edits
  // never compound the same discount.
  await dbQuery(
    `UPDATE public.liquidacion_items
        SET descuento_tardanza = ROUND(valor_ganado_original * $3 / 100, 2),
            valor_ganado = ROUND(valor_ganado_original * (1 - $3 / 100), 2),
            porcentaje_descuento_tardanza = $3,
            updated_at = clock_timestamp()
      WHERE tecnico_id = $1 AND periodo_id = $2 AND tipo <> 'recorrido' AND estado <> 'anulado'
        AND periodo_id IN (SELECT id FROM public.periodos_liquidacion WHERE estado = 'abierto')`,
    [technicianId, periodId, normalizedPercentage],
  );
  await dbQuery(
    "UPDATE public.liquidacion_items SET valor_ganado = valor_ganado_original, descuento_tardanza = 0, porcentaje_descuento_tardanza = 0, updated_at = clock_timestamp() WHERE tecnico_id = $1 AND periodo_id = $2 AND tipo = 'recorrido' AND estado <> 'anulado' AND periodo_id IN (SELECT id FROM public.periodos_liquidacion WHERE estado = 'abierto')",
    [technicianId, periodId],
  );
  const { rows: discountRows } = await dbQuery(
    "SELECT COALESCE(SUM(descuento_tardanza), 0) AS value FROM public.liquidacion_items WHERE tecnico_id = $1 AND periodo_id = $2 AND tipo <> 'recorrido' AND estado <> 'anulado' AND periodo_id IN (SELECT id FROM public.periodos_liquidacion WHERE estado = 'abierto')",
    [technicianId, periodId],
  );
  const totalDiscount = roundCurrency(number(discountRows[0]?.value));
  for (const row of attendanceRows) {
    if (!row.descuento_aplicado) continue;
    const eventPercentage = percentage(row.porcentaje_descuento);
    const eventValue = rawPercentage > 0 ? roundCurrency(totalDiscount * eventPercentage / rawPercentage) : 0;
    await dbQuery(
      `INSERT INTO public.asistencia_descuentos
        (asistencia_id, periodo_id, tecnico_id, porcentaje, porcentaje_acumulado, minutos_adeudados, valor, regla_version)
       VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT minutos_adeudados FROM public.registros_asistencia WHERE id = $1), 0), $6, COALESCE((SELECT regla_version FROM public.registros_asistencia WHERE id = $1), 'attendance-v3'))
       ON CONFLICT (asistencia_id, periodo_id) DO UPDATE SET
         porcentaje = EXCLUDED.porcentaje,
         porcentaje_acumulado = EXCLUDED.porcentaje_acumulado,
         minutos_adeudados = EXCLUDED.minutos_adeudados,
         valor = EXCLUDED.valor,
         regla_version = EXCLUDED.regla_version,
         aplicado_en = clock_timestamp()`,
      [row.id, periodId, technicianId, eventPercentage, normalizedPercentage, eventValue],
    );
  }
}

async function syncActivityAttendanceDiscounts(activityId: string) {
  const { rows } = await dbQuery(
    `SELECT a.fecha_operacion, p.tecnico_id, r.id AS asistencia_id,
            r.descuento_aplicado, r.porcentaje_descuento
       FROM public.actividades_operativas a
       JOIN public.actividades_operativas_participantes p ON p.actividad_id = a.id
       LEFT JOIN public.registros_asistencia r
         ON r.usuario_id = p.tecnico_id AND r.fecha = a.fecha_operacion
      WHERE a.id = $1`,
    [activityId],
  );
  for (const row of rows) {
    if (!row.asistencia_id) continue;
    await syncAttendanceDiscount(
      row.asistencia_id,
      row.tecnico_id,
      dateOnly(row.fecha_operacion) || "",
    );
  }
}

async function ensureArrivals(payload: Payload, configuredSettings?: any) {
  const users = jsonArray(payload.users).filter((item) => item.estado === "activo" && item.rol !== "admin");
  const fecha = payload.fecha || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  const currentDay = new Date(`${fecha}T12:00:00-05:00`).getUTCDay() || 7;
  const settings = configuredSettings || await getConfig();
  const clock = bogotaClock();
  const discountPercentage = percentage(
    payload.porcentajeNoReportado,
    percentage(settings.porcentajeDescuentoNoReportado, 30),
  );
  const automaticDays = jsonArray(payload.automaticDays)
    .map((item) => typeof item === "number" ? item : dayToNumber[String(item || "").toLowerCase()])
    .filter((item) => item >= 1 && item <= 7);
  if (automaticDays.length > 0 && !automaticDays.includes(currentDay)) return 0;
  const { noReportCutoffMinutes } = attendanceThresholds(settings);
  if (noReportCutoffMinutes == null || (fecha === clock.date && clock.minutes < noReportCutoffMinutes)) return 0;
  const cutoffLabel = `${String(Math.floor(noReportCutoffMinutes / 60)).padStart(2, "0")}:${String(noReportCutoffMinutes % 60).padStart(2, "0")}`;
  const targets = users.flatMap((item) => {
    const schedule = item.horarios?.find((entry: any) => {
      const scheduleDay = typeof entry.diaSemana === "number"
        ? entry.diaSemana
        : dayToNumber[String(entry.diaSemana || "").toLowerCase()];
      return entry.activo && scheduleDay === currentDay && entry.horaEntrada && entry.horaSalida;
    });
    return schedule ? [{ usuario_id: item.id, hora_entrada_programada: schedule.horaEntrada, hora_salida_programada: schedule.horaSalida }] : [];
  });
  if (!targets.length) return 0;

  const { rows: changedRows } = await dbQuery(
    `INSERT INTO public.registros_asistencia
       (usuario_id,fecha,hora_entrada_programada,hora_salida_programada,estado_entrada,estado_salida,
        minutos_retraso,minutos_adeudados,categoria_llegada,razon_tardanza,descuento_aplicado,
        porcentaje_descuento,porcentaje_regla_aplicada,tipo_descuento,regla_version,calculado_en)
     SELECT t.usuario_id,$2,t.hora_entrada_programada,t.hora_salida_programada,
            'no_reportado','no_reportado',0,$3,'no_reportado',$4,$5,$6,$6,
            'no_reportado','attendance-v4-clock',clock_timestamp()
       FROM jsonb_to_recordset($1::jsonb) AS t(usuario_id uuid,hora_entrada_programada time,hora_salida_programada time)
     ON CONFLICT (usuario_id,fecha) DO UPDATE SET
       hora_entrada_programada = EXCLUDED.hora_entrada_programada,
       hora_salida_programada = EXCLUDED.hora_salida_programada,
       razon_tardanza = EXCLUDED.razon_tardanza,
       minutos_adeudados = EXCLUDED.minutos_adeudados,
       categoria_llegada = EXCLUDED.categoria_llegada,
       descuento_aplicado = EXCLUDED.descuento_aplicado,
       porcentaje_descuento = EXCLUDED.porcentaje_descuento,
       porcentaje_regla_aplicada = EXCLUDED.porcentaje_regla_aplicada,
       tipo_descuento = EXCLUDED.tipo_descuento,
       regla_version = EXCLUDED.regla_version,
       calculado_en = clock_timestamp(),
       updated_at = clock_timestamp()
     WHERE registros_asistencia.estado_entrada = 'no_reportado'
       AND (registros_asistencia.hora_entrada_programada IS DISTINCT FROM EXCLUDED.hora_entrada_programada
         OR registros_asistencia.hora_salida_programada IS DISTINCT FROM EXCLUDED.hora_salida_programada
         OR registros_asistencia.razon_tardanza IS DISTINCT FROM EXCLUDED.razon_tardanza
         OR registros_asistencia.minutos_adeudados IS DISTINCT FROM EXCLUDED.minutos_adeudados
         OR registros_asistencia.categoria_llegada IS DISTINCT FROM EXCLUDED.categoria_llegada
         OR registros_asistencia.descuento_aplicado IS DISTINCT FROM EXCLUDED.descuento_aplicado
         OR registros_asistencia.porcentaje_descuento IS DISTINCT FROM EXCLUDED.porcentaje_descuento
         OR registros_asistencia.porcentaje_regla_aplicada IS DISTINCT FROM EXCLUDED.porcentaje_regla_aplicada
         OR registros_asistencia.regla_version IS DISTINCT FROM EXCLUDED.regla_version)
     RETURNING id,usuario_id,fecha`,
    [JSON.stringify(targets), fecha, Math.max(0, Math.floor(number(settings.minutosNoReportado, 30))), `[AUTO ${cutoffLabel}] No registró la entrada antes del corte configurado.`, discountPercentage > 0, discountPercentage],
  );
  for (const row of changedRows) await syncAttendanceDiscount(row.id, row.usuario_id, dateOnly(row.fecha) || fecha);
  return changedRows.length;
}

function mapNotification(row: any): any { return { id: row.id, usuarioId: row.usuario_id, titulo: row.titulo, mensaje: row.mensaje, tipo: row.tipo, leida: Boolean(row.leida_en), datos: row.metadata || undefined, fechaCreacion: dateOnly(row.created_at) || "" }; }

async function cleanupPreview(payload: Payload) {
  let startDate = payload.startDate || "1900-01-01";
  let endDate = payload.endDate || "2999-12-31";
  if (payload.mode === "period" && payload.periodId) {
    const { rows } = await dbQuery("SELECT fecha_inicio, fecha_fin FROM public.periodos_liquidacion WHERE id = $1", [payload.periodId]);
    if (rows[0]) { startDate = dateOnly(rows[0].fecha_inicio) || startDate; endDate = dateOnly(rows[0].fecha_fin) || endDate; }
  }
  const selected = jsonArray(payload.modules) as string[];
  const queries: Array<{ module: string; label: string; sql: string }> = [
    { module: "actividades_grupales", label: "Actividades operativas", sql: "SELECT COUNT(*)::int AS n FROM public.actividades_operativas WHERE fecha_operacion BETWEEN $1 AND $2 AND estado <> 'cancelada'" },
    { module: "mantenimientos_preventivos", label: "Mantenimientos programados", sql: "SELECT COUNT(*)::int AS n FROM public.mantenimientos_programados WHERE fecha_programada BETWEEN $1 AND $2 AND estado <> 'cancelado'" },
    { module: "visitas_tecnicas", label: "Visitas técnicas", sql: "SELECT COUNT(*)::int AS n FROM public.actividades_operativas WHERE tipo = 'visita_tecnica' AND fecha_operacion BETWEEN $1 AND $2 AND estado <> 'cancelada'" },
    { module: "recorridos", label: "Recorridos", sql: "SELECT COUNT(*)::int AS n FROM public.actividades_operativas WHERE tipo = 'recorrido' AND fecha_operacion BETWEEN $1 AND $2 AND estado <> 'cancelada'" },
    { module: "aprobaciones", label: "Aprobaciones", sql: "SELECT COUNT(*)::int AS n FROM public.actividades_operativas_aprobaciones WHERE created_at::date BETWEEN $1 AND $2" },
    { module: "liquidacion", label: "Liquidación", sql: "SELECT COUNT(*)::int AS n FROM public.liquidacion_items WHERE fecha_operacion BETWEEN $1 AND $2" },
    { module: "asistencia", label: "Asistencia", sql: "SELECT COUNT(*)::int AS n FROM public.registros_asistencia WHERE fecha BETWEEN $1 AND $2" },
    { module: "notificaciones", label: "Notificaciones", sql: "SELECT COUNT(*)::int AS n FROM public.notificaciones WHERE created_at::date BETWEEN $1 AND $2" },
  ];
  const items = [];
  for (const query of queries) {
    if (!selected.includes(query.module)) continue;
    const { rows } = await dbQuery(query.sql, [startDate, endDate]);
    const count = number(rows[0]?.n);
    items.push({ id: query.module, module: query.module, label: query.label, primaryCount: count, relatedCount: 0, details: [count ? `${count} registros en el rango seleccionado.` : "No hay registros en el rango seleccionado."] });
  }
  const { rows: matchedPeriods } = await dbQuery("SELECT id, fecha_inicio, fecha_fin, estado FROM public.periodos_liquidacion WHERE fecha_fin >= $1 AND fecha_inicio <= $2 ORDER BY fecha_inicio", [startDate, endDate]);
  const total = items.reduce((sum, item) => sum + item.primaryCount + item.relatedCount, 0);
  return { total, range: { startDate, endDate }, items, counts: Object.fromEntries(items.map((item) => [item.module, item.primaryCount])), matchedPeriods: matchedPeriods.map((period) => ({ id: period.id, fechaInicio: dateOnly(period.fecha_inicio) || "", fechaFin: dateOnly(period.fecha_fin) || "", estado: period.estado })), warnings: ["La depuración V2 conserva la actividad mediante estado cancelada; no elimina la entidad operativa canónica."] };
}

async function cleanupExecute(payload: Payload) {
  const preview = await cleanupPreview(payload);
  const deletedCounts: Record<string, number> = {};
  if (jsonArray(payload.modules).includes("actividades_grupales")) {
    const result = await dbQuery("UPDATE public.actividades_operativas SET estado = 'cancelada', updated_at = clock_timestamp() WHERE fecha_operacion BETWEEN $1 AND $2 AND estado <> 'cancelada'", [preview.range.startDate, preview.range.endDate]);
    deletedCounts.actividades = result.rowCount || 0;
  }
  if (jsonArray(payload.modules).includes("notificaciones")) {
    const result = await dbQuery("DELETE FROM public.notificaciones WHERE created_at::date BETWEEN $1 AND $2", [preview.range.startDate, preview.range.endDate]);
    deletedCounts.notificaciones = result.rowCount || 0;
  }
  return { success: true, range: preview.range, deletedCounts: { mantenimientos_preventivos: 0, visitas_tecnicas: 0, recorridos: 0, grouped: deletedCounts.actividades || 0, approvals: 0, liquidations: 0, asistencia: 0, notificaciones: deletedCounts.notificaciones || 0 }, deletedPeriods: 0, errors: [] };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ error: "Sesión no válida." }, {
      status: 401,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
    const body = await request.json();
    const data = await execute(String(body?.action || ""), (body?.payload || {}) as Payload, user);
    const response = NextResponse.json({ data }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
    try {
      await renewSession(request, response);
    } catch (renewError) {
      console.error("No se pudo renovar la sesión durante la operación de datos:", renewError);
    }
    return response;
  } catch (error: any) {
    console.error("Error en API de datos V2:", error);
    if (isDatabaseCapacityError(error)) {
      return NextResponse.json(
        { error: "La base de datos está ocupada temporalmente. La operación no se perdió; vuelve a intentarlo en unos segundos." },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store, max-age=0",
            "Retry-After": "3",
          },
        },
      );
    }
    const message = error?.code === "23505" ? "Ya existe un registro con esos datos." : error?.code === "23503" ? "La operación referencia datos inexistentes o protegidos." : error?.code === "23P01" ? "El rango de fechas se cruza con otro registro." : error?.message || "Error interno de datos.";
    return NextResponse.json({ error: message }, {
      status: 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}
