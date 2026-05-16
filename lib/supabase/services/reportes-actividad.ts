import { supabase } from "../client";
import { ActivityReport, LeaderApprovalBatch, LeaderAccumulation } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";
import { getConfiguracion } from "./configuracion";
import { syncReporteMantenimientoToActividad } from "./mantenimientos";

const REPORTES_ACTIVIDAD_CACHE_KEY = "reportes-actividad:list";
const REPORTES_ACTIVIDAD_CACHE_TTL = 60_000;
const LOTES_APROBACION_CACHE_KEY = "lotes-aprobacion:list";
const LOTES_APROBACION_CACHE_TTL = 20_000;
const ACUMULACIONES_LIDER_CACHE_KEY = "acumulaciones-lider:list";
const ACUMULACIONES_LIDER_CACHE_TTL = 20_000;
const ADMIN_VALUE_OVERRIDE_REASON = "Ajuste manual desde administracion";

interface ReporteActividadRow {
  id: string;
  tipo: string;
  tecnico_id: string;
  lider_grupo_id: string;
  grupo_id: string;
  mantenimiento_id?: string | null;
  mantenimiento_participante_id?: string | null;
  fecha: string;
  cliente_id?: string | null;
  descripcion?: string | null;
  observaciones?: string | null;
  firma_receptor_url?: string | null;
  nombre_receptor?: string | null;
  cedula_receptor?: string | null;
  cargo_receptor?: string | null;
  tiene_bitacora?: boolean | null;
  foto_bitacora_url?: string | null;
  punto_partida?: string | null;
  punto_llegada?: string | null;
  tipo_recorrido?: ActivityReport["tipoRecorrido"] | null;
  foto_herramienta_url?: string | null;
  estado_aprobacion_lider: ActivityReport["estadoAprobacionLider"];
  fecha_aprobacion_lider?: string | null;
  costo_actividad_default?: number | string | null;
  valor_sugerido?: number | string | null;
  motivo_sugerencia_valor?: string | null;
  valor_modificado?: boolean | null;
  motivo_modificacion_valor?: string | null;
  costo_actividad?: number | string | null;
  costo_administrable?: boolean | null;
  enviado_correo?: boolean | null;
  fecha_ultimo_envio_correo?: string | null;
  periodo_id: string;
  fecha_creacion?: string | null;
}

interface RegistroActividadRow {
  id: string;
  actividad_id?: string | null;
  lider_id: string;
  grupo_id: string;
  fecha: string;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  especificacion?: string | null;
  valor_actividad_base?: number | string | null;
  valor_actividad_aplicado?: number | string | null;
  valor_sugerido?: number | string | null;
  motivo_sugerencia_valor?: string | null;
  valor_modificado?: boolean | null;
  motivo_modificacion_valor?: string | null;
  enviado_correo?: boolean | null;
  fecha_ultimo_envio_correo?: string | null;
  periodo_id?: string | null;
  fecha_creacion?: string | null;
}

interface ActividadParticipanteRow {
  registro_actividad_id: string;
  tecnico_id: string;
  porcentaje?: number | string | null;
  valor_calculado?: number | string | null;
}

interface ActividadCatalogoRow {
  id: string;
  codigo: string;
  nombre: string;
}

interface PeriodoLiquidacionRow {
  id: string;
  fecha_inicio: string;
  fecha_fin: string;
}

interface ItemAprobacionRow {
  id?: string;
  tecnico_id: string;
  fecha: string;
  tipo: string;
  referencia_id?: string | null;
  estado?: string | null;
  fecha_aprobacion?: string | null;
}

interface ReporteActividadFotoRow {
  reporte_actividad_id: string;
  tipo: string;
  url: string;
}

interface MaintenanceParticipantRow {
  id: string;
  maintenance_id: string;
  usuario_id: string;
  porcentaje?: number | string | null;
  valor_calculado?: number | string | null;
}

interface LeaderApprovalBatchRow {
  id: string;
  lider_id: string;
  grupo_id: string;
  periodo_id: string;
  reportes_aprobados?: string[] | null;
  fecha_cierre?: string | null;
  costo_lider_por_revision?: number | string | null;
  total_revisiones?: number | null;
  total_costo_lider?: number | string | null;
}

interface LeaderAccumulationRow {
  lider_id: string;
  periodo_id: string;
  total_aprobado_pago?: number | string | null;
  total_pendiente_pago?: number | string | null;
  extra_lider?: number | string | null;
  total_recorridos?: number | string | null;
  total_acumulado?: number | string | null;
  porcentaje_extra_lider_aplicado?: number | string | null;
  extra_lider_activo?: boolean | null;
  tecnicos_excluidos_extra_ids?: string[] | null;
}

interface RegistroBaseRow {
  id: string;
}

interface ParticipanteRelacionRow {
  registro_actividad_id: string;
  tecnico_id: string;
}

interface LegacyActivityMirrorMaps {
  strict: Map<string, ActivityReport[]>;
  fallback: Map<string, ActivityReport[]>;
}

interface VisitMirrorRow {
  id: string;
  tecnico_id: string;
  cliente_id?: string | null;
  descripcion?: string | null;
  fecha_inicio: string;
  tipo_visita?: ActivityReport["tipoVisita"] | null;
  costo_visita_tecnica_default?: number | string | null;
  costo_cliente?: number | string | null;
  valor_sugerido?: number | string | null;
  motivo_sugerencia_valor?: string | null;
  valor_modificado?: boolean | null;
  motivo_modificacion_valor?: string | null;
  valor_cobrado_cliente?: number | string | null;
}

interface VisitMirrorMaps {
  strict: Map<string, VisitMirrorRow>;
  fallback: Map<string, VisitMirrorRow>;
}

interface VisitLiquidationRow {
  id: string;
  tecnico_id: string;
  fecha: string;
  periodo_id?: string | null;
  referencia_id?: string | null;
  porcentaje?: number | string | null;
  valor_base?: number | string | null;
  valor_ganado?: number | string | null;
}

interface VisitLiquidationMaps {
  byReferenceId: Map<string, VisitLiquidationRow[]>;
  byFallback: Map<string, VisitLiquidationRow[]>;
}

interface RecorridoMirrorRow {
  id: string;
  tecnico_id: string;
  fecha: string;
  punto_partida?: string | null;
  punto_llegada?: string | null;
  tipo_recorrido?: ActivityReport["tipoRecorrido"] | null;
  valor?: number | string | null;
  foto_herramienta_url?: string | null;
}

interface RecorridoMirrorMaps {
  strict: Map<string, RecorridoMirrorRow>;
  fallback: Map<string, RecorridoMirrorRow>;
}

interface SharedParticipantOverride {
  reportId?: string;
  tecnicoId: string;
  percentage: number;
  valorGanado?: number;
  periodoId?: string | null;
  visitId?: string;
  defaultCost?: number;
  maintenanceId?: string;
  maintenanceParticipantId?: string;
}

function mapReport(row: ReporteActividadRow, fotosAntes: string[], fotosDespues: string[]): ActivityReport {
  const normalizedTipo: ActivityReport["tipo"] =
    row.tipo === "actividad"
      ? "actividad_grupal"
      : row.tipo === "mantenimiento_preventivo" || row.tipo === "visita_tecnica" || row.tipo === "recorrido" || row.tipo === "actividad_grupal"
        ? row.tipo
        : "actividad_grupal";

  return {
    id: row.id,
    tipo: normalizedTipo,
    mantenimientoId: row.mantenimiento_id || undefined,
    mantenimientoParticipanteId: row.mantenimiento_participante_id || undefined,
    tecnicoId: row.tecnico_id,
    liderGrupoId: row.lider_grupo_id,
    grupoId: row.grupo_id,
    fecha: row.fecha,
    clienteId: row.cliente_id || undefined,
    descripcion: row.descripcion || "",
    observaciones: row.observaciones || undefined,
    fotosAntes: fotosAntes.length > 0 ? fotosAntes : undefined,
    fotosDespues: fotosDespues.length > 0 ? fotosDespues : undefined,
    firmaReceptor: row.firma_receptor_url || undefined,
    datosReceptor: row.nombre_receptor
      ? { nombre: row.nombre_receptor, cedula: row.cedula_receptor || "", cargo: row.cargo_receptor || "" }
      : undefined,
    bitacora: row.tiene_bitacora || false,
    fotoBitacora: row.foto_bitacora_url || undefined,
    puntoPartida: row.punto_partida || undefined,
    puntoLlegada: row.punto_llegada || undefined,
    tipoRecorrido: row.tipo_recorrido || undefined,
    fotoHerramienta: row.foto_herramienta_url || undefined,
    estadoAprobacionLider: row.estado_aprobacion_lider,
    fechaAprobacionLider: row.fecha_aprobacion_lider?.split("T")[0] || undefined,
    costoActividadDefault: Number(row.costo_actividad_default ?? 0) || 0,
    valorSugerido: row.valor_sugerido == null ? undefined : Number(row.valor_sugerido ?? 0) || 0,
    valorSugeridoGlobal: row.valor_sugerido == null ? undefined : Number(row.valor_sugerido ?? 0) || 0,
    motivoSugerenciaValor: row.motivo_sugerencia_valor || undefined,
    valorModificado: row.valor_modificado ?? false,
    motivoModificacionValor: row.motivo_modificacion_valor || undefined,
    costoActividad: Number(row.costo_actividad ?? 0) || 0,
    costoAdministrable: row.costo_administrable || false,
    correoEnviado: row.enviado_correo || false,
    fechaUltimoEnvioCorreo: row.fecha_ultimo_envio_correo || undefined,
    periodoId: row.periodo_id,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

function addOneDay(date: string): string {
  const nextDate = new Date(`${date}T00:00:00`);
  nextDate.setDate(nextDate.getDate() + 1);
  return nextDate.toISOString().split("T")[0];
}

function normalizeUnmodifiedActivityValue(
  currentValue?: number | string | null,
  fallbackValue?: number | string | null,
  isModified?: boolean | null
) {
  const normalizedCurrentValue = Number(currentValue ?? 0) || 0;
  const normalizedFallbackValue = Number(fallbackValue ?? 0) || 0;

  if (normalizedCurrentValue <= 0 && normalizedFallbackValue > 0 && !isModified) {
    return normalizedFallbackValue;
  }

  return normalizedCurrentValue;
}

function getMaintenanceMirrorDescription(observaciones?: string | null) {
  return (observaciones || "").trim() || "Mantenimiento preventivo realizado";
}

function buildMaintenanceMirrorKey(params: {
  tecnicoId?: string | null;
  clienteId?: string | null;
  fecha?: string | null;
  observaciones?: string | null;
}) {
  return [
    params.tecnicoId || "",
    params.clienteId || "",
    params.fecha || "",
    normalizeActivityMatchText(getMaintenanceMirrorDescription(params.observaciones)),
  ].join("|");
}

async function ensurePreventiveMaintenanceMirrors(): Promise<boolean> {
  const { data: maintenanceReports, error: maintenanceReportsError } = await supabase
    .from("reportes_mantenimiento")
    .select("id, mantenimiento_id, tecnico_id, cliente_id, observaciones, fecha_generacion");
  if (maintenanceReportsError) throw maintenanceReportsError;

  if (!maintenanceReports || maintenanceReports.length === 0) {
    return false;
  }

  const mantenimientoIds = Array.from(new Set(
    maintenanceReports
      .map((row: { mantenimiento_id?: string | null; id: string }) => row.mantenimiento_id || row.id)
      .filter(Boolean)
  ));

  const [{ data: maintenanceDates, error: maintenanceDatesError }, { data: mirroredReports, error: mirroredReportsError }] = await Promise.all([
    mantenimientoIds.length > 0
      ? supabase
        .from("mantenimientos")
        .select("id, fecha_programada")
        .in("id", mantenimientoIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("reportes_actividad")
      .select("tecnico_id, cliente_id, fecha, descripcion")
      .eq("tipo", "mantenimiento_preventivo"),
  ]);

  if (maintenanceDatesError) throw maintenanceDatesError;
  if (mirroredReportsError) throw mirroredReportsError;

  const fechaByMantenimientoId = new Map<string, string>();
  for (const row of maintenanceDates || []) {
    if (!row?.id) continue;
    const fecha = row.fecha_programada?.split("T")[0] || "";
    if (fecha) {
      fechaByMantenimientoId.set(row.id, fecha);
    }
  }

  const existingKeys = new Set(
    (mirroredReports || []).map((row: {
      tecnico_id?: string | null;
      cliente_id?: string | null;
      fecha?: string | null;
      descripcion?: string | null;
    }) => buildMaintenanceMirrorKey({
      tecnicoId: row.tecnico_id,
      clienteId: row.cliente_id,
      fecha: row.fecha,
      observaciones: row.descripcion,
    }))
  );

  const missingMirrorIds = (maintenanceReports || [])
    .filter((row: {
      id: string;
      mantenimiento_id?: string | null;
      tecnico_id?: string | null;
      cliente_id?: string | null;
      observaciones?: string | null;
      fecha_generacion?: string | null;
    }) => {
      const mantenimientoId = row.mantenimiento_id || row.id;
      const fecha = fechaByMantenimientoId.get(mantenimientoId) || row.fecha_generacion?.split("T")[0] || "";
      if (!row.tecnico_id || !fecha) return false;

      return !existingKeys.has(buildMaintenanceMirrorKey({
        tecnicoId: row.tecnico_id,
        clienteId: row.cliente_id,
        fecha,
        observaciones: row.observaciones,
      }));
    })
    .map((row: { id: string }) => row.id);

  if (missingMirrorIds.length === 0) {
    return false;
  }

  const syncResults = await Promise.allSettled(
    missingMirrorIds.map((reporteId) => syncReporteMantenimientoToActividad(reporteId))
  );

  syncResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("Error sincronizando reporte de mantenimiento preventivo:", missingMirrorIds[index], result.reason);
    }
  });

  return syncResults.some((result) => result.status === "fulfilled");
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function parseLegacyGroupActivityReportId(id: string) {
  if (!id.startsWith("reg-")) return null;

  const parts = id.split("-");
  if (parts.length < 3) return null;

  return {
    tecnicoId: parts[parts.length - 1],
    registroId: parts.slice(1, -1).join("-"),
  };
}

function calculateGroupParticipantValue(baseValue: number, porcentaje: number) {
  if (porcentaje > 0) {
    return Math.round((baseValue * porcentaje) / 100);
  }

  return Math.round(baseValue);
}

function resolveSharedParticipantOverride(
  overrides: SharedParticipantOverride[] | undefined,
  params: { reportId?: string; tecnicoId: string }
) {
  if (!overrides || overrides.length === 0) return undefined;

  return overrides.find((candidate) => {
    if (params.reportId && candidate.reportId && candidate.reportId === params.reportId) {
      return true;
    }

    return candidate.tecnicoId === params.tecnicoId;
  });
}

function dedupeSharedParticipantOverrides(overrides: SharedParticipantOverride[] | undefined) {
  if (!overrides || overrides.length === 0) return [];

  const overridesByTechnician = new Map<string, SharedParticipantOverride>();

  overrides.forEach((override) => {
    const current = overridesByTechnician.get(override.tecnicoId);

    if (!current) {
      overridesByTechnician.set(override.tecnicoId, override);
      return;
    }

    if (!(override.reportId || "").startsWith("reg-") && (current.reportId || "").startsWith("reg-")) {
      overridesByTechnician.set(override.tecnicoId, override);
    }
  });

  return Array.from(overridesByTechnician.values());
}

function buildMaintenanceSharedIdentity(report: Pick<ActivityReport, "tipo" | "mantenimientoId" | "fecha" | "periodoId" | "grupoId" | "clienteId" | "descripcion">) {
  if (report.tipo !== "mantenimiento_preventivo") return report.mantenimientoId || report.fecha;

  if (report.mantenimientoId) {
    return `shared-maintenance:${report.mantenimientoId}`;
  }

  return [
    "shared-maintenance-fallback",
    report.fecha,
    report.periodoId || "sin-periodo",
    report.grupoId,
    report.clienteId || "sin-cliente",
    normalizeActivityMatchText(report.descripcion),
  ].join("|");
}

function buildMaintenanceParticipantMaps(rows: MaintenanceParticipantRow[]) {
  const byMaintenanceId = new Map<string, MaintenanceParticipantRow[]>();
  const byParticipantId = new Map<string, MaintenanceParticipantRow>();

  for (const row of rows) {
    if (!row.maintenance_id) continue;
    const current = byMaintenanceId.get(row.maintenance_id) || [];
    current.push(row);
    byMaintenanceId.set(row.maintenance_id, current);

    if (row.id) {
      byParticipantId.set(row.id, row);
    }
  }

  return { byMaintenanceId, byParticipantId };
}

function enrichPreventiveMaintenanceReport(
  report: ActivityReport,
  row: ReporteActividadRow,
  participantMaps?: ReturnType<typeof buildMaintenanceParticipantMaps>
): ActivityReport {
  if (report.tipo !== "mantenimiento_preventivo") return report;

  const maintenanceId = row.mantenimiento_id || report.mantenimientoId;
  if (!maintenanceId || !participantMaps) return report;

  const maintenanceParticipants = participantMaps.byMaintenanceId.get(maintenanceId) || [];
  const participantRow = (row.mantenimiento_participante_id
    ? participantMaps.byParticipantId.get(row.mantenimiento_participante_id)
    : undefined)
    || maintenanceParticipants.find((participant) => participant.usuario_id === report.tecnicoId);
  const participantsCount = maintenanceParticipants.length;
  const derivedBaseValue = Number(report.costoActividadDefault ?? 0) || maintenanceParticipants.reduce(
    (sum, participant) => sum + (Number(participant.valor_calculado ?? 0) || 0),
    0
  ) || Number(report.costoActividad ?? 0) || 0;
  const explicitPercentage = Number(participantRow?.porcentaje ?? 0) || 0;
  const derivedPercentage = explicitPercentage > 0
    ? explicitPercentage
    : participantsCount > 1 && derivedBaseValue > 0
      ? Number((((Number(report.costoActividad ?? 0) || 0) / derivedBaseValue) * 100).toFixed(2))
      : participantsCount > 1
        ? Number((100 / participantsCount).toFixed(2))
        : 100;
  const participantValue = participantRow?.valor_calculado != null
    ? Number(participantRow.valor_calculado ?? 0) || 0
    : Number(report.costoActividad ?? 0) || 0;
  const shouldTreatAsShared = participantsCount > 1;

  return {
    ...report,
    mantenimientoId: maintenanceId,
    mantenimientoParticipanteId: row.mantenimiento_participante_id || participantRow?.id || report.mantenimientoParticipanteId,
    costoActividad: participantValue,
    costoActividadDefault: derivedBaseValue,
    porcentajeParticipacion: shouldTreatAsShared ? derivedPercentage : report.porcentajeParticipacion,
    valorActividadBaseGlobal: shouldTreatAsShared ? derivedBaseValue : report.valorActividadBaseGlobal,
    valorActividadAplicadoGlobal: shouldTreatAsShared ? derivedBaseValue : report.valorActividadAplicadoGlobal,
  };
}

function normalizeActivityMatchText(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractGroupActivityTitle(description?: string | null) {
  const normalized = (description || "").trim();
  if (!normalized) return "";

  const emDashParts = normalized.split(" — ").map((part) => part.trim()).filter(Boolean);
  if (emDashParts.length >= 2) {
    return emDashParts.slice(1).join(" — ");
  }

  const dashParts = normalized.split(" - ").map((part) => part.trim()).filter(Boolean);
  return dashParts[0] || normalized;
}

function extractGroupActivitySpecificationFromDescription(description?: string | null) {
  const normalized = (description || "").trim();
  if (!normalized || normalized.includes(" — ")) return undefined;

  const dashParts = normalized.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (dashParts.length < 3) return undefined;

  const specification = dashParts.slice(1, -1).join(" - ").trim();
  return specification || undefined;
}

function extractGroupActivitySpecificationFromObservations(observaciones?: string | null) {
  const normalized = observaciones?.trim();
  if (!normalized) return undefined;

  const match = normalized.match(/Especificaci[oó]n:\s*(.+?)(?:$|\n)/i);
  return match?.[1]?.trim() || undefined;
}

function getNormalizedGroupActivityTitle(params: { description?: string | null }) {
  return normalizeActivityMatchText(extractGroupActivityTitle(params.description));
}

function getNormalizedGroupActivitySpecification(params: {
  description?: string | null;
  especificacion?: string | null;
  observaciones?: string | null;
}) {
  return normalizeActivityMatchText(
    params.especificacion
      || extractGroupActivitySpecificationFromObservations(params.observaciones)
      || extractGroupActivitySpecificationFromDescription(params.description)
  );
}

function hasGroupActivitySpecification(params: {
  description?: string | null;
  especificacion?: string | null;
  observaciones?: string | null;
}) {
  return !!getNormalizedGroupActivitySpecification(params);
}

function buildLegacyActivityMirrorKey(params: {
  tecnicoId: string;
  fecha: string;
  grupoId?: string | null;
  clienteId?: string | null;
  descripcion?: string | null;
  especificacion?: string | null;
}) {
  return [
    params.tecnicoId,
    params.fecha,
    params.grupoId || "",
    params.clienteId || "",
    normalizeActivityMatchText(params.descripcion),
    normalizeActivityMatchText(params.especificacion),
  ].join("|");
}

function buildCanonicalLegacyGroupActivityIdentity(params: {
  actividadId?: string | null;
  leaderId?: string | null;
  grupoId?: string | null;
  clienteId?: string | null;
  fecha: string;
  description?: string | null;
  especificacion?: string | null;
  observaciones?: string | null;
}) {
  return [
    params.actividadId || "",
    params.leaderId || "",
    params.grupoId || "",
    params.clienteId || "",
    params.fecha,
    getNormalizedGroupActivityTitle({ description: params.description }),
    getNormalizedGroupActivitySpecification({
      description: params.description,
      especificacion: params.especificacion,
      observaciones: params.observaciones,
    }),
  ].join("|");
}

function buildCanonicalLegacyGroupActivityBaseIdentity(params: {
  actividadId?: string | null;
  leaderId?: string | null;
  grupoId?: string | null;
  clienteId?: string | null;
  fecha: string;
  description?: string | null;
}) {
  return [
    params.actividadId || "",
    params.leaderId || "",
    params.grupoId || "",
    params.clienteId || "",
    params.fecha,
    getNormalizedGroupActivityTitle({ description: params.description }),
  ].join("|");
}

function scoreLegacyActivityCompleteness(params: {
  description?: string | null;
  especificacion?: string | null;
  observaciones?: string | null;
  registroActividadId?: string | null;
}) {
  let score = 0;

  if (params.registroActividadId) score += 8;
  if (getNormalizedGroupActivityTitle({ description: params.description })) score += 4;
  if (hasGroupActivitySpecification(params)) score += 6;

  return score;
}

function isNewerActivityCandidate(currentDate?: string | null, nextDate?: string | null, currentId?: string | null, nextId?: string | null) {
  const normalizedCurrentDate = currentDate || "";
  const normalizedNextDate = nextDate || "";

  if (normalizedNextDate !== normalizedCurrentDate) {
    return normalizedNextDate > normalizedCurrentDate;
  }

  return (nextId || "") > (currentId || "");
}

function shouldReplaceLegacyCanonicalCandidate<T extends {
  id: string;
  descripcion?: string | null;
  especificacion?: string | null;
  observaciones?: string | null;
  fechaCreacion?: string | null;
  registroActividadId?: string | null;
}>(current: T | undefined, next: T) {
  if (!current) return true;

  const currentScore = scoreLegacyActivityCompleteness(current);
  const nextScore = scoreLegacyActivityCompleteness(next);
  if (nextScore !== currentScore) {
    return nextScore > currentScore;
  }

  return isNewerActivityCandidate(current.fechaCreacion, next.fechaCreacion, current.id, next.id);
}

function dedupeGroupActivityReports(reports: ActivityReport[]) {
  const directReports = reports.filter((report) => report.tipo !== "actividad_grupal");
  const groupedReports = reports.filter((report) => report.tipo === "actividad_grupal");
  const groupedByBaseIdentity = new Map<string, ActivityReport[]>();

  const canonicalDirectReports = new Map<string, ActivityReport>();

  directReports.forEach((report) => {
    const directKey = report.tipo === "visita_tecnica"
      ? [
        report.tipo,
        report.visitaTecnicaId || "sin-visita",
        report.tecnicoId,
        report.fecha,
        report.clienteId || "sin-cliente",
        normalizeActivityMatchText(report.descripcion),
      ].join("|")
      : report.id;

    const current = canonicalDirectReports.get(directKey);
    if (!current || shouldReplaceLegacyCanonicalCandidate(current, report)) {
      canonicalDirectReports.set(directKey, report);
    }
  });

  groupedReports.forEach((report) => {
    const baseKey = buildCanonicalLegacyGroupActivityBaseIdentity({
      leaderId: report.liderGrupoId,
      grupoId: report.grupoId,
      clienteId: report.clienteId,
      fecha: report.fecha,
      description: report.descripcion,
    });
    const current = groupedByBaseIdentity.get(baseKey) || [];
    current.push(report);
    groupedByBaseIdentity.set(baseKey, current);
  });

  const canonicalReports = Array.from(canonicalDirectReports.values());

  groupedByBaseIdentity.forEach((baseReports) => {
    const availableSpecKeys = Array.from(new Set(
      baseReports
        .map((report) => getNormalizedGroupActivitySpecification({
          description: report.descripcion,
          especificacion: report.especificacion,
          observaciones: report.observaciones,
        }))
        .filter(Boolean)
    ));

    const reportsToProcess = availableSpecKeys.length > 0
      ? baseReports.filter((report) => getNormalizedGroupActivitySpecification({
        description: report.descripcion,
        especificacion: report.especificacion,
        observaciones: report.observaciones,
      }))
      : baseReports;

    const canonicalByTechAndSpec = new Map<string, ActivityReport>();

    reportsToProcess.forEach((report) => {
      const key = [
        getNormalizedGroupActivitySpecification({
          description: report.descripcion,
          especificacion: report.especificacion,
          observaciones: report.observaciones,
        }),
        report.tecnicoId,
      ].join("|");
      const current = canonicalByTechAndSpec.get(key);

      if (shouldReplaceLegacyCanonicalCandidate(current, report)) {
        canonicalByTechAndSpec.set(key, report);
      }
    });

    canonicalReports.push(...Array.from(canonicalByTechAndSpec.values()));
  });

  return canonicalReports;
}

function selectCanonicalLegacyRegistroIds(reports: ActivityReport[]) {
  const reportsByRegistroId = new Map<string, ActivityReport[]>();

  reports.forEach((report) => {
    if (!report.registroActividadId) return;
    const current = reportsByRegistroId.get(report.registroActividadId) || [];
    current.push(report);
    reportsByRegistroId.set(report.registroActividadId, current);
  });

  const registrosByBaseIdentity = new Map<string, Array<{ registroId: string; reports: ActivityReport[] }>>();

  reportsByRegistroId.forEach((registroReports, registroId) => {
    const reference = registroReports[0];
    const baseKey = buildCanonicalLegacyGroupActivityBaseIdentity({
      leaderId: reference.liderGrupoId,
      grupoId: reference.grupoId,
      clienteId: reference.clienteId,
      fecha: reference.fecha,
      description: reference.descripcion,
    });
    const current = registrosByBaseIdentity.get(baseKey) || [];
    current.push({ registroId, reports: registroReports });
    registrosByBaseIdentity.set(baseKey, current);
  });

  const selectedRegistroIds = new Set<string>();

  registrosByBaseIdentity.forEach((registroCandidates) => {
    const candidatesBySpec = new Map<string, Array<{ registroId: string; reports: ActivityReport[] }>>();

    registroCandidates.forEach((candidate) => {
      const reference = candidate.reports[0];
      const specKey = getNormalizedGroupActivitySpecification({
        description: reference.descripcion,
        especificacion: reference.especificacion,
        observaciones: reference.observaciones,
      });
      const current = candidatesBySpec.get(specKey) || [];
      current.push(candidate);
      candidatesBySpec.set(specKey, current);
    });

    const nonEmptySpecKeys = Array.from(candidatesBySpec.keys()).filter(Boolean);
    const specKeysToKeep = nonEmptySpecKeys.length > 0 ? nonEmptySpecKeys : [""];

    specKeysToKeep.forEach((specKey) => {
      const candidates = candidatesBySpec.get(specKey) || [];
      const bestCandidate = candidates.reduce<{ registroId: string; reports: ActivityReport[] } | undefined>((best, candidate) => {
        const candidateReference = candidate.reports[0];
        if (!best) return candidate;

        const bestReference = best.reports[0];
        return shouldReplaceLegacyCanonicalCandidate(bestReference, candidateReference) ? candidate : best;
      }, undefined);

      if (bestCandidate) {
        selectedRegistroIds.add(bestCandidate.registroId);
      }
    });
  });

  return selectedRegistroIds;
}

function buildLegacyRegistroCandidateIdentity(params: {
  actividadId?: string | null;
  leaderId?: string | null;
  grupoId?: string | null;
  clienteId?: string | null;
  fecha: string;
  especificacion?: string | null;
  descripcion?: string | null;
  observaciones?: string | null;
}) {
  return buildCanonicalLegacyGroupActivityIdentity({
    actividadId: params.actividadId,
    leaderId: params.leaderId,
    grupoId: params.grupoId,
    clienteId: params.clienteId,
    fecha: params.fecha,
    description: params.descripcion,
    especificacion: params.especificacion,
    observaciones: params.observaciones,
  });
}

function buildLegacyActivityFallbackKey(params: {
  tecnicoId: string;
  fecha: string;
  grupoId?: string | null;
  clienteId?: string | null;
  descripcion?: string | null;
}) {
  return [
    params.tecnicoId,
    params.fecha,
    params.grupoId || "",
    params.clienteId || "",
    normalizeActivityMatchText(params.descripcion),
  ].join("|");
}

function buildLegacyActivityParticipantKey(params: {
  tecnicoId: string;
  fecha: string;
  grupoId?: string | null;
  clienteId?: string | null;
}) {
  return [
    params.tecnicoId,
    params.fecha,
    params.grupoId || "",
    params.clienteId || "",
  ].join("|");
}

function appendLegacyActivityCandidate(
  map: Map<string, ActivityReport[]>,
  key: string,
  report: ActivityReport
) {
  const current = map.get(key) || [];
  current.push(report);
  map.set(key, current);
}

function resolveLegacyActivityCandidate(
  candidates: ActivityReport[] | undefined,
  target: Pick<ActivityReport, "descripcion" | "especificacion">
) {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const normalizedDescription = normalizeActivityMatchText(target.descripcion);
  const normalizedSpecification = normalizeActivityMatchText(target.especificacion);

  let filtered = candidates;

  if (normalizedDescription) {
    const exactDescriptionMatches = filtered.filter(
      (candidate) => normalizeActivityMatchText(candidate.descripcion) === normalizedDescription
    );

    if (exactDescriptionMatches.length === 1) {
      return exactDescriptionMatches[0];
    }

    if (exactDescriptionMatches.length > 0) {
      filtered = exactDescriptionMatches;
    }
  }

  if (normalizedSpecification) {
    const exactSpecificationMatches = filtered.filter(
      (candidate) => normalizeActivityMatchText(candidate.especificacion) === normalizedSpecification
    );

    if (exactSpecificationMatches.length === 1) {
      return exactSpecificationMatches[0];
    }

    if (exactSpecificationMatches.length > 0) {
      filtered = exactSpecificationMatches;
    }
  }

  return filtered.length === 1 ? filtered[0] : undefined;
}

function resolveLegacyActivityByBaseIdentity(
  candidates: ActivityReport[] | undefined,
  target: Pick<ActivityReport, "fecha" | "grupoId" | "clienteId" | "tecnicoId">
) {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const exactMatches = candidates.filter((candidate) => (
    candidate.fecha === target.fecha
    && candidate.grupoId === target.grupoId
    && (candidate.clienteId || "") === (target.clienteId || "")
    && candidate.tecnicoId === target.tecnicoId
  ));

  return exactMatches.length === 1 ? exactMatches[0] : undefined;
}

function enrichLegacyActivityReport(
  report: ActivityReport,
  mirrors?: LegacyActivityMirrorMaps
): ActivityReport {
  if (!mirrors) return report;

  const strictKey = buildLegacyActivityMirrorKey({
    tecnicoId: report.tecnicoId,
    fecha: report.fecha,
    grupoId: report.grupoId,
    clienteId: report.clienteId,
    descripcion: report.descripcion,
    especificacion: report.especificacion,
  });
  const fallbackKey = buildLegacyActivityFallbackKey({
    tecnicoId: report.tecnicoId,
    fecha: report.fecha,
    grupoId: report.grupoId,
    clienteId: report.clienteId,
    descripcion: report.descripcion,
  });

  const mirror = resolveLegacyActivityCandidate(mirrors.strict.get(strictKey), report)
    || resolveLegacyActivityCandidate(mirrors.fallback.get(fallbackKey), report)
    || resolveLegacyActivityByBaseIdentity(mirrors.strict.get(strictKey), report)
    || resolveLegacyActivityByBaseIdentity(mirrors.fallback.get(fallbackKey), report);

  if (!mirror) return report;

  return {
    ...report,
    observaciones: mirror.observaciones || report.observaciones,
    fotosAntes: mirror.fotosAntes || report.fotosAntes,
    fotosDespues: mirror.fotosDespues || report.fotosDespues,
    firmaReceptor: mirror.firmaReceptor || report.firmaReceptor,
    datosReceptor: mirror.datosReceptor || report.datosReceptor,
    bitacora: mirror.bitacora ?? report.bitacora,
    fotoBitacora: mirror.fotoBitacora || report.fotoBitacora,
    correoEnviado: mirror.correoEnviado || report.correoEnviado,
    fechaUltimoEnvioCorreo: mirror.fechaUltimoEnvioCorreo || report.fechaUltimoEnvioCorreo,
    fechaCreacion: mirror.fechaCreacion || report.fechaCreacion,
  };
}

function mergeGroupActivityMetadata(report: ActivityReport, relatedReport: ActivityReport): ActivityReport {
  if (report.tipo !== "actividad_grupal" || relatedReport.tipo !== "actividad_grupal") {
    return report;
  }

  return {
    ...report,
    registroActividadId: relatedReport.registroActividadId || report.registroActividadId,
    porcentajeParticipacion: relatedReport.porcentajeParticipacion ?? report.porcentajeParticipacion,
    costoActividadDefault: report.costoActividadDefault || relatedReport.costoActividadDefault,
    costoActividad: report.costoActividad,
    valorActividadBaseGlobal: relatedReport.valorActividadBaseGlobal ?? report.valorActividadBaseGlobal,
    valorActividadAplicadoGlobal: relatedReport.valorActividadAplicadoGlobal ?? report.valorActividadAplicadoGlobal,
    valorSugerido: report.valorSugerido ?? relatedReport.valorSugerido,
    valorSugeridoGlobal: relatedReport.valorSugeridoGlobal ?? report.valorSugeridoGlobal,
    motivoSugerenciaValor: relatedReport.motivoSugerenciaValor || report.motivoSugerenciaValor,
    valorModificado: report.valorModificado || relatedReport.valorModificado,
    motivoModificacionValor: report.motivoModificacionValor || relatedReport.motivoModificacionValor,
  };
}

async function resolveRegistrosPeriodoIds(rows: RegistroActividadRow[]): Promise<Map<string, string>> {
  const missingPeriodoRows = rows.filter((row) => !row.periodo_id && row.fecha);
  if (missingPeriodoRows.length === 0) {
    return new Map();
  }

  const fechas = Array.from(new Set(missingPeriodoRows.map((row) => row.fecha)));
  const minFecha = [...fechas].sort()[0];
  const maxFecha = [...fechas].sort().at(-1);

  if (!minFecha || !maxFecha) {
    return new Map();
  }

  const { data: periodos, error } = await supabase
    .from("periodos_liquidacion")
    .select("id, fecha_inicio, fecha_fin")
    .lte("fecha_inicio", maxFecha)
    .gte("fecha_fin", minFecha)
    .order("fecha_inicio", { ascending: false });

  if (error) throw error;

  const periodosList = periodos || [];
  const resolved = new Map<string, string>();

  missingPeriodoRows.forEach((row) => {
    const periodo = periodosList.find((item: { id: string; fecha_inicio: string; fecha_fin: string }) => row.fecha >= item.fecha_inicio && row.fecha <= item.fecha_fin);
    if (periodo?.id) {
      resolved.set(row.id, periodo.id);
    }
  });

  return resolved;
}

function buildVisitMirrorStrictKey(params: {
  tecnicoId: string;
  fecha: string;
  clienteId?: string | null;
  descripcion?: string | null;
}) {
  return [params.tecnicoId, params.fecha, params.clienteId || "", params.descripcion || ""].join("|");
}

function buildVisitMirrorFallbackKey(params: {
  tecnicoId: string;
  fecha: string;
  clienteId?: string | null;
}) {
  return [params.tecnicoId, params.fecha, params.clienteId || ""].join("|");
}

function buildVisitLiquidationFallbackKey(params: {
  tecnicoId: string;
  fecha: string;
  periodoId?: string | null;
}) {
  return [params.tecnicoId, params.fecha, params.periodoId || ""].join("|");
}

function appendVisitLiquidationCandidate(
  map: Map<string, VisitLiquidationRow[]>,
  key: string,
  row: VisitLiquidationRow
) {
  const current = map.get(key) || [];
  current.push(row);
  map.set(key, current);
}

function resolveVisitLiquidationRow(params: {
  reportId: string;
  visitId?: string;
  tecnicoId: string;
  fecha: string;
  periodoId?: string | null;
  maps?: VisitLiquidationMaps;
}) {
  if (!params.maps) return undefined;

  const directCandidates = [
    ...(params.maps.byReferenceId.get(params.reportId) || []),
    ...(params.visitId ? params.maps.byReferenceId.get(params.visitId) || [] : []),
  ].filter(
    (row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index
  );

  if (directCandidates.length === 1) {
    return directCandidates[0];
  }

  if (directCandidates.length > 1) {
    return undefined;
  }

  return undefined;
}

function enrichVisitLiquidationReport(
  report: ActivityReport,
  liquidationRow?: VisitLiquidationRow
): ActivityReport {
  if (report.tipo !== "visita_tecnica" || !liquidationRow) return report;

  const porcentajeParticipacion = Number(liquidationRow.porcentaje ?? 0) || 0;
  const defaultParticipantValue = Number(report.costoActividadDefault ?? 0) || 0;
  const normalizedReportValue = normalizeUnmodifiedActivityValue(
    report.costoActividad,
    report.costoActividadDefault,
    report.valorModificado
  );
  const fallbackAppliedBase = (() => {
    const explicitAppliedBase = Number(report.valorActividadAplicadoGlobal ?? 0) || 0;

    if (explicitAppliedBase > 0) {
      return explicitAppliedBase;
    }

    if (porcentajeParticipacion > 0 && normalizedReportValue > 0) {
      return Number(((normalizedReportValue * 100) / porcentajeParticipacion).toFixed(2));
    }

    return normalizedReportValue;
  })();
  const valorBase = normalizeUnmodifiedActivityValue(
    liquidationRow.valor_base,
    fallbackAppliedBase,
    report.valorModificado
  );
  const valorGanadoFallback = porcentajeParticipacion > 0
    ? calculateGroupParticipantValue(valorBase, porcentajeParticipacion)
    : normalizedReportValue;
  const valorGanado = normalizeUnmodifiedActivityValue(
    liquidationRow.valor_ganado,
    valorGanadoFallback,
    report.valorModificado
  );
  const valorBaseDefaultGlobal = report.valorActividadBaseGlobal != null
    ? Number(report.valorActividadBaseGlobal ?? 0) || 0
    : porcentajeParticipacion > 0 && defaultParticipantValue > 0
      ? Number(((defaultParticipantValue * 100) / porcentajeParticipacion).toFixed(2))
      : defaultParticipantValue;

  return {
    ...report,
    porcentajeParticipacion,
    costoActividad: valorGanado,
    valorActividadBaseGlobal: valorBaseDefaultGlobal,
    valorActividadAplicadoGlobal: valorBase,
  };
}

function buildRecorridoMirrorStrictKey(params: {
  tecnicoId: string;
  fecha: string;
  puntoPartida?: string | null;
  puntoLlegada?: string | null;
  tipoRecorrido?: ActivityReport["tipoRecorrido"] | null;
}) {
  return [params.tecnicoId, params.fecha, params.puntoPartida || "", params.puntoLlegada || "", params.tipoRecorrido || ""].join("|");
}

function buildRecorridoMirrorFallbackKey(params: {
  tecnicoId: string;
  fecha: string;
  tipoRecorrido?: ActivityReport["tipoRecorrido"] | null;
}) {
  return [params.tecnicoId, params.fecha, params.tipoRecorrido || ""].join("|");
}

function enrichVisitReport(
  report: ActivityReport,
  mirrors?: VisitMirrorMaps
): ActivityReport {
  if (!mirrors || report.tipo !== "visita_tecnica") return report;

  const strictKey = buildVisitMirrorStrictKey({
    tecnicoId: report.tecnicoId,
    fecha: report.fecha,
    clienteId: report.clienteId,
    descripcion: report.descripcion,
  });
  const fallbackKey = buildVisitMirrorFallbackKey({
    tecnicoId: report.tecnicoId,
    fecha: report.fecha,
    clienteId: report.clienteId,
  });

  const mirror = mirrors.strict.get(strictKey) || mirrors.fallback.get(fallbackKey);

  if (!mirror) return report;

  const mirrorDefaultCost = Number(mirror.costo_visita_tecnica_default ?? 0) || 0;
  const reportCurrentValue = Number(report.costoActividad ?? 0) || 0;
  const normalizedVisitValue = normalizeUnmodifiedActivityValue(
    reportCurrentValue,
    mirrorDefaultCost,
    report.valorModificado
  );
  const hasMirrorVisitId = !report.visitaTecnicaId && !!mirror.id;
  const shouldUseMirrorClientCost = mirror.costo_cliente != null && report.costoCliente !== (Number(mirror.costo_cliente) || 0);
  const shouldUseMirrorDefault = !report.costoActividadDefault && mirrorDefaultCost > 0;
  const shouldUseSuggestedValue = report.valorSugerido == null && mirror.valor_sugerido != null;
  const shouldUseSuggestionReason = !report.motivoSugerenciaValor && !!mirror.motivo_sugerencia_valor;

  if (!hasMirrorVisitId && !shouldUseMirrorClientCost && !shouldUseMirrorDefault && !shouldUseSuggestedValue && !shouldUseSuggestionReason && normalizedVisitValue === reportCurrentValue) {
    return report;
  }

  return {
    ...report,
    visitaTecnicaId: report.visitaTecnicaId || mirror.id,
    tipoVisita: report.tipoVisita || mirror.tipo_visita || undefined,
    costoActividad: normalizedVisitValue,
    costoCliente: mirror.costo_cliente == null ? (report.costoCliente ?? 0) : Number(mirror.costo_cliente) || 0,
    costoActividadDefault: shouldUseMirrorDefault ? mirrorDefaultCost : report.costoActividadDefault,
    valorSugerido: shouldUseSuggestedValue ? (Number(mirror.valor_sugerido ?? 0) || 0) : report.valorSugerido,
    valorSugeridoGlobal: shouldUseSuggestedValue ? (Number(mirror.valor_sugerido ?? 0) || 0) : report.valorSugeridoGlobal,
    motivoSugerenciaValor: shouldUseSuggestionReason ? mirror.motivo_sugerencia_valor || undefined : report.motivoSugerenciaValor,
  };
}

function enrichRecorridoReport(
  report: ActivityReport,
  mirrors: RecorridoMirrorMaps | undefined,
  config: { costoRecorridoNormal: number; costoRecorridoHerramienta: number }
): ActivityReport {
  if (report.tipo !== "recorrido") return report;

  const strictKey = buildRecorridoMirrorStrictKey({
    tecnicoId: report.tecnicoId,
    fecha: report.fecha,
    puntoPartida: report.puntoPartida,
    puntoLlegada: report.puntoLlegada,
    tipoRecorrido: report.tipoRecorrido,
  });
  const fallbackKey = buildRecorridoMirrorFallbackKey({
    tecnicoId: report.tecnicoId,
    fecha: report.fecha,
    tipoRecorrido: report.tipoRecorrido,
  });

  const mirror = mirrors?.strict.get(strictKey) || mirrors?.fallback.get(fallbackKey);
  const configuredCost = report.tipoRecorrido === "con_herramienta"
    ? config.costoRecorridoHerramienta
    : config.costoRecorridoNormal;
  const rawMirroredValue = mirror?.valor ?? report.costoActividad;
  const mirroredValue = rawMirroredValue == null ? null : Number(rawMirroredValue) || 0;
  const effectiveCost = report.valorModificado
    ? (mirroredValue ?? configuredCost)
    : configuredCost;

  return {
    ...report,
    costoActividadDefault: configuredCost,
    costoActividad: effectiveCost,
    fotoHerramienta: mirror?.foto_herramienta_url || report.fotoHerramienta,
  };
}

export async function updateCostoClienteVisitaAdmin(
  reporteId: string,
  costoCliente: number | null,
  visitaTecnicaId?: string
): Promise<void> {
  const normalizedCostoCliente = costoCliente ?? 0;

  if (visitaTecnicaId) {
    const { error: directUpdateError } = await supabase
      .from("visitas_tecnicas")
      .update({ costo_cliente: normalizedCostoCliente })
      .eq("id", visitaTecnicaId);
    if (directUpdateError) throw directUpdateError;

    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    invalidateCachedValue("visitas:list");
    return;
  }

  const { data: report, error: reportError } = await supabase
    .from("reportes_actividad")
    .select("id, tipo, tecnico_id, cliente_id, fecha, descripcion")
    .eq("id", reporteId)
    .single();
  if (reportError) throw reportError;

  if (report?.tipo !== "visita_tecnica") {
    throw new Error("El costo cliente solo aplica a visitas técnicas.");
  }

  const startDate = report.fecha;
  const endDate = addOneDay(report.fecha);

  let visitQuery = supabase
    .from("visitas_tecnicas")
    .select("id, descripcion")
    .eq("tecnico_id", report.tecnico_id)
    .gte("fecha_inicio", startDate)
    .lt("fecha_inicio", endDate);

  if (report.cliente_id) {
    visitQuery = visitQuery.eq("cliente_id", report.cliente_id);
  } else {
    visitQuery = visitQuery.is("cliente_id", null);
  }

  const { data: candidateVisits, error: visitsLookupError } = await visitQuery;
  if (visitsLookupError) throw visitsLookupError;

  let visitIds = (candidateVisits || []).map((visit: { id: string }) => visit.id);

  if (visitIds.length > 1 && report.descripcion) {
    const exactMatches = (candidateVisits || [])
      .filter((visit: { id: string; descripcion?: string | null }) => visit.descripcion === report.descripcion)
      .map((visit: { id: string }) => visit.id);

    if (exactMatches.length > 0) {
      visitIds = exactMatches;
    }
  }

  if (visitIds.length === 0) {
    throw new Error("No se encontró la visita técnica asociada al reporte.");
  }

  if (visitIds.length > 1) {
    throw new Error("Se encontraron varias visitas técnicas para este reporte. Usa la visita exacta antes de actualizar.");
  }

  const { error: updateError } = await supabase
    .from("visitas_tecnicas")
    .update({ costo_cliente: normalizedCostoCliente })
    .eq("id", visitIds[0]);
  if (updateError) throw updateError;

  invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
  invalidateCachedValue("visitas:list");
}

async function syncVisitLiquidationFromReport(params: {
  reportId: string;
  tecnicoId: string;
  fecha: string;
  periodoId?: string | null;
  costoActividad: number;
  visitIds?: string[];
}) {
  const referenceIds = Array.from(new Set([params.reportId, ...(params.visitIds || [])].filter(Boolean)));

  if (referenceIds.length === 0) {
    return;
  }

  let liquidationLookupQuery = supabase
    .from("items_liquidacion")
    .select("id, porcentaje")
    .eq("tipo", "visita_tecnica")
    .in("referencia_id", referenceIds);

  if (params.periodoId) {
    liquidationLookupQuery = liquidationLookupQuery.eq("periodo_id", params.periodoId);
  }

  const { data: liquidationItems, error: liquidationLookupError } = await liquidationLookupQuery;
  if (liquidationLookupError) throw liquidationLookupError;

  await Promise.all(
    (liquidationItems || []).map(async (item: { id: string; porcentaje: number | string }) => {
      const porcentaje = Number(item.porcentaje ?? 0) || 0;
      const valorGanado = (params.costoActividad * porcentaje) / 100;

      const { error: liquidationUpdateError } = await supabase
        .from("items_liquidacion")
        .update({
          valor_base: params.costoActividad,
          valor_ganado: valorGanado,
        })
        .eq("id", item.id);
      if (liquidationUpdateError) throw liquidationUpdateError;
    })
  );

  invalidateCachedValue("liquidacion:entries");
}

async function syncVisitApprovalValue(params: {
  tecnicoId: string;
  fecha: string;
  valor: number;
  referenceIds?: string[];
}) {
  const uniqueReferenceIds = Array.from(new Set((params.referenceIds || []).filter(Boolean)));

  if (uniqueReferenceIds.length === 0) {
    return;
  }

  const { data: matchingItems, error: lookupError } = await supabase
    .from("items_aprobacion")
    .select("id")
    .eq("tipo", "visita_tecnica")
    .eq("tecnico_id", params.tecnicoId)
    .in("referencia_id", uniqueReferenceIds);
  if (lookupError) throw lookupError;

  const matchingIds = (matchingItems || []).map((item: { id: string }) => item.id);
  if (matchingIds.length === 0) {
    return;
  }

  const { error: updateError } = await supabase
    .from("items_aprobacion")
    .update({ valor: params.valor })
    .in("id", matchingIds);
  if (updateError) throw updateError;
}

async function syncVisitLiquidationValue(params: {
  tecnicoId: string;
  fecha: string;
  valorBase: number;
  valorGanado: number;
  porcentaje?: number;
  periodoId?: string | null;
  referenceIds?: string[];
}) {
  const uniqueReferenceIds = Array.from(new Set((params.referenceIds || []).filter(Boolean)));
  const updateData = {
    valor_base: params.valorBase,
    valor_ganado: params.valorGanado,
    ...(params.porcentaje != null ? { porcentaje: params.porcentaje } : {}),
  };

  if (uniqueReferenceIds.length === 0) {
    return;
  }

  let lookupQuery = supabase
    .from("items_liquidacion")
    .select("id")
    .eq("tipo", "visita_tecnica")
    .eq("tecnico_id", params.tecnicoId)
    .in("referencia_id", uniqueReferenceIds);

  if (params.periodoId) {
    lookupQuery = lookupQuery.eq("periodo_id", params.periodoId);
  }

  const { data: matchingItems, error: lookupError } = await lookupQuery;
  if (lookupError) throw lookupError;

  const matchingIds = (matchingItems || []).map((item: { id: string }) => item.id);
  if (matchingIds.length === 0) {
    return;
  }

  const { error: updateError } = await supabase
    .from("items_liquidacion")
    .update(updateData)
    .in("id", matchingIds);
  if (updateError) throw updateError;
}

async function resolveSharedVisitParticipants(params: {
  reportId: string;
  fecha: string;
  grupoId: string;
  clienteId?: string | null;
  descripcion?: string | null;
  periodoId?: string | null;
}) {
  let relatedReportsQuery = supabase
    .from("reportes_actividad")
    .select("id, tecnico_id, periodo_id, costo_actividad, costo_actividad_default, valor_modificado")
    .eq("tipo", "visita_tecnica")
    .eq("fecha", params.fecha)
    .eq("grupo_id", params.grupoId);

  if (params.clienteId) {
    relatedReportsQuery = relatedReportsQuery.eq("cliente_id", params.clienteId);
  } else {
    relatedReportsQuery = relatedReportsQuery.is("cliente_id", null);
  }

  if (params.descripcion) {
    relatedReportsQuery = relatedReportsQuery.eq("descripcion", params.descripcion);
  } else {
    relatedReportsQuery = relatedReportsQuery.is("descripcion", null);
  }

  const { data: relatedReports, error: relatedReportsError } = await relatedReportsQuery;
  if (relatedReportsError) throw relatedReportsError;

  const participants = relatedReports || [];
  if (participants.length <= 1) {
    return [];
  }

  const technicalIds = participants.map((participant: { tecnico_id: string }) => participant.tecnico_id).filter(Boolean);
  const startDate = params.fecha;
  const endDate = addOneDay(params.fecha);

  let visitQuery = supabase
    .from("visitas_tecnicas")
    .select("id, tecnico_id, descripcion, costo_visita_tecnica_default")
    .in("tecnico_id", technicalIds)
    .gte("fecha_inicio", startDate)
    .lt("fecha_inicio", endDate);

  if (params.clienteId) {
    visitQuery = visitQuery.eq("cliente_id", params.clienteId);
  } else {
    visitQuery = visitQuery.is("cliente_id", null);
  }

  const { data: visitRows, error: visitRowsError } = await visitQuery;
  if (visitRowsError) throw visitRowsError;

  const { data: liquidationRows, error: liquidationRowsError } = await supabase
    .from("items_liquidacion")
    .select("id, tecnico_id, fecha, periodo_id, referencia_id, porcentaje, valor_base, valor_ganado")
    .eq("tipo", "visita_tecnica")
    .in("tecnico_id", technicalIds)
    .eq("fecha", params.fecha);
  if (liquidationRowsError) throw liquidationRowsError;

  const liquidationMaps: VisitLiquidationMaps = {
    byReferenceId: new Map<string, VisitLiquidationRow[]>(),
    byFallback: new Map<string, VisitLiquidationRow[]>(),
  };

  for (const row of (liquidationRows || []) as VisitLiquidationRow[]) {
    if (row.referencia_id) {
      appendVisitLiquidationCandidate(liquidationMaps.byReferenceId, row.referencia_id, row);
    }

    const fallbackKey = buildVisitLiquidationFallbackKey({
      tecnicoId: row.tecnico_id,
      fecha: row.fecha,
      periodoId: row.periodo_id,
    });
    appendVisitLiquidationCandidate(liquidationMaps.byFallback, fallbackKey, row);
  }

  const participantSnapshots = participants.map((participant: {
    id: string;
    tecnico_id: string;
    periodo_id?: string | null;
    costo_actividad?: number | string | null;
    costo_actividad_default?: number | string | null;
    valor_modificado?: boolean | null;
  }) => {
    const participantVisits = (visitRows || []).filter((visit: { tecnico_id: string; descripcion?: string | null }) => {
      if (visit.tecnico_id !== participant.tecnico_id) return false;
      if (!params.descripcion) return !visit.descripcion;
      return visit.descripcion === params.descripcion;
    });

    const selectedVisit = participantVisits[0]
      || (visitRows || []).find((visit: { tecnico_id: string }) => visit.tecnico_id === participant.tecnico_id)
      || null;

    const liquidationRow = resolveVisitLiquidationRow({
      reportId: participant.id,
      visitId: selectedVisit?.id,
      tecnicoId: participant.tecnico_id,
      fecha: params.fecha,
      periodoId: participant.periodo_id || params.periodoId,
      maps: liquidationMaps,
    });

    const participantDefaultValue = Number(
      selectedVisit?.costo_visita_tecnica_default ?? participant.costo_actividad_default ?? 0
    ) || 0;
    const percentage = Number(liquidationRow?.porcentaje ?? 0) || 0;
    const liquidatedValueFallback = percentage > 0 && participantDefaultValue > 0
      ? calculateGroupParticipantValue(
        Number(((participantDefaultValue * 100) / percentage).toFixed(2)),
        percentage
      )
      : participantDefaultValue;
    const currentValue = normalizeUnmodifiedActivityValue(
      liquidationRow?.valor_ganado ?? participant.costo_actividad,
      liquidatedValueFallback,
      participant.valor_modificado
    );

    return {
      participant,
      selectedVisit,
      participantDefaultValue,
      percentage,
      currentValue,
    };
  });

  const currentTotal = participantSnapshots.reduce((sum, snapshot) => sum + snapshot.currentValue, 0);
  const participantsCount = participantSnapshots.length || 1;

  return participantSnapshots.map(({ participant, selectedVisit, participantDefaultValue, percentage, currentValue }) => {
    const derivedPercentage = percentage > 0
      ? percentage
      : currentTotal > 0
        ? Number(((currentValue / currentTotal) * 100).toFixed(2))
        : Number((100 / participantsCount).toFixed(2));

    return {
      reportId: participant.id,
      tecnicoId: participant.tecnico_id,
      periodoId: participant.periodo_id || params.periodoId,
      visitId: selectedVisit?.id,
      visitDefaultCost: participantDefaultValue,
      percentage: derivedPercentage,
    };
  });
}

async function updateSharedVisitCostFromReport(params: {
  reportId: string;
  fecha: string;
  grupoId: string;
  clienteId?: string | null;
  descripcion?: string | null;
  periodoId?: string | null;
  defaultCost?: number | string | null;
  costoActividad: number;
  participantOverrides?: SharedParticipantOverride[];
}) {
  const participants: Array<{
    reportId: string;
    tecnicoId: string;
    periodoId?: string | null;
    visitId?: string;
    visitDefaultCost: number;
    percentage: number;
    valorGanado?: number;
  }> = params.participantOverrides?.length
    ? params.participantOverrides.map((participant) => ({
      reportId: participant.reportId || params.reportId,
      tecnicoId: participant.tecnicoId,
      periodoId: participant.periodoId || params.periodoId,
      visitId: participant.visitId,
      visitDefaultCost: Number(participant.defaultCost ?? 0) || 0,
      percentage: Number(participant.percentage ?? 0) || 0,
      valorGanado: participant.valorGanado,
    }))
    : await resolveSharedVisitParticipants(params);

  if (participants.length <= 1) {
    return false;
  }

  const normalizedBaseValue = Math.max(0, Number(params.costoActividad) || 0);

  await Promise.all(
    participants.map(async (participant) => {
      const nextTechnicalValue = participant.valorGanado
        ?? calculateGroupParticipantValue(normalizedBaseValue, participant.percentage);

        const { error: reportUpdateError } = await supabase
          .from("reportes_actividad")
          .update({
            costo_actividad: nextTechnicalValue,
            valor_modificado: nextTechnicalValue !== participant.visitDefaultCost,
            motivo_modificacion_valor: nextTechnicalValue !== participant.visitDefaultCost ? ADMIN_VALUE_OVERRIDE_REASON : null,
          })
          .eq("id", participant.reportId);
      if (reportUpdateError) throw reportUpdateError;

        if (participant.visitId) {
          const { error: visitUpdateError } = await supabase
            .from("visitas_tecnicas")
            .update({
              valor_cobrado_cliente: nextTechnicalValue,
              valor_modificado: nextTechnicalValue !== participant.visitDefaultCost,
              motivo_modificacion_valor: nextTechnicalValue !== participant.visitDefaultCost ? ADMIN_VALUE_OVERRIDE_REASON : null,
            })
            .eq("id", participant.visitId);
        if (visitUpdateError) throw visitUpdateError;
      }

      await syncVisitApprovalValue({
        tecnicoId: participant.tecnicoId,
        fecha: params.fecha,
        valor: nextTechnicalValue,
        referenceIds: [participant.reportId, participant.visitId].filter(Boolean) as string[],
      });

      await syncVisitLiquidationValue({
        tecnicoId: participant.tecnicoId,
        fecha: params.fecha,
        valorBase: normalizedBaseValue,
        valorGanado: nextTechnicalValue,
        porcentaje: participant.percentage,
        periodoId: participant.periodoId,
        referenceIds: [participant.reportId, participant.visitId].filter(Boolean) as string[],
      });
    })
  );

  invalidateCachedValue("visitas:list");
  invalidateCachedValue("liquidacion:entries");
  return true;
}

async function syncVisitCostFromApprovalReport(
  reportId: string,
  costoActividad: number,
  visitId?: string
): Promise<void> {
  const { data: report, error: reportError } = await supabase
    .from("reportes_actividad")
    .select("id, tipo, tecnico_id, cliente_id, fecha, descripcion, periodo_id, costo_actividad_default")
    .eq("id", reportId)
    .single();
  if (reportError) throw reportError;

  if (report?.tipo !== "visita_tecnica") return;

  if (visitId) {
    const { data: visit, error: visitLookupError } = await supabase
      .from("visitas_tecnicas")
      .select("id, costo_visita_tecnica_default")
      .eq("id", visitId)
      .maybeSingle();
    if (visitLookupError) throw visitLookupError;

    if (visit?.id) {
      const defaultCost = Number(visit.costo_visita_tecnica_default ?? 0) || 0;
      const { error: visitUpdateError } = await supabase
        .from("visitas_tecnicas")
        .update({
          valor_cobrado_cliente: costoActividad,
          valor_modificado: costoActividad !== defaultCost,
          motivo_modificacion_valor: costoActividad !== defaultCost ? ADMIN_VALUE_OVERRIDE_REASON : null,
        })
        .eq("id", visit.id);
      if (visitUpdateError) throw visitUpdateError;

      const { error: approvalUpdateError } = await supabase
        .from("items_aprobacion")
        .update({ valor: costoActividad })
        .eq("tipo", "visita_tecnica")
        .eq("referencia_id", visit.id);
      if (approvalUpdateError) throw approvalUpdateError;

      await syncVisitLiquidationFromReport({
        reportId,
        tecnicoId: report.tecnico_id,
        fecha: report.fecha,
        periodoId: report.periodo_id,
        costoActividad,
        visitIds: [visit.id],
      });

      invalidateCachedValue("visitas:list");
      return;
    }
  }

  const startDate = report.fecha;
  const endDate = addOneDay(report.fecha);

  let visitQuery = supabase
    .from("visitas_tecnicas")
    .select("id, descripcion, costo_visita_tecnica_default")
    .eq("tecnico_id", report.tecnico_id)
    .gte("fecha_inicio", startDate)
    .lt("fecha_inicio", endDate);

  if (report.cliente_id) {
    visitQuery = visitQuery.eq("cliente_id", report.cliente_id);
  } else {
    visitQuery = visitQuery.is("cliente_id", null);
  }

  const { data: candidateVisits, error: visitsLookupError } = await visitQuery;
  if (visitsLookupError) throw visitsLookupError;

  let visitIds = (candidateVisits || []).map((visit: { id: string }) => visit.id);
  let selectedVisits = candidateVisits || [];

  if (visitIds.length > 1 && report.descripcion) {
    const exactMatches = (candidateVisits || [])
      .filter((visit: { id: string; descripcion?: string | null }) => visit.descripcion === report.descripcion)
      .map((visit) => visit);

    if (exactMatches.length > 0) {
      selectedVisits = exactMatches;
      visitIds = exactMatches.map((visit: { id: string }) => visit.id);
    }
  }

  if (visitIds.length === 0) {
    throw new Error("No se encontró la visita técnica asociada al reporte.");
  }

  if (visitIds.length > 1) {
    throw new Error("Se encontraron varias visitas técnicas para este reporte. La actualización se canceló para evitar afectar varios registros.");
  }

  const selectedVisit = selectedVisits[0];
  if (!selectedVisit) {
    throw new Error("No se pudo resolver la visita técnica exacta asociada al reporte.");
  }

  const defaultCost = Number(selectedVisit.costo_visita_tecnica_default ?? 0) || 0;
  const { error: visitsUpdateError } = await supabase
    .from("visitas_tecnicas")
    .update({
      valor_cobrado_cliente: costoActividad,
      valor_modificado: costoActividad !== defaultCost,
      motivo_modificacion_valor: costoActividad !== defaultCost ? ADMIN_VALUE_OVERRIDE_REASON : null,
    })
    .eq("id", selectedVisit.id);
  if (visitsUpdateError) throw visitsUpdateError;

  const { error: approvalUpdateError } = await supabase
    .from("items_aprobacion")
    .update({ valor: costoActividad })
    .eq("tipo", "visita_tecnica")
    .eq("referencia_id", selectedVisit.id);
  if (approvalUpdateError) throw approvalUpdateError;

  await syncVisitLiquidationFromReport({
    reportId,
    tecnicoId: report.tecnico_id,
    fecha: report.fecha,
    periodoId: report.periodo_id,
    costoActividad,
    visitIds: [selectedVisit.id],
  });

  invalidateCachedValue("visitas:list");
}

async function syncGroupedActivityApprovalValue(params: {
  tecnicoId: string;
  fecha: string;
  valor: number;
  referenceIds?: string[];
}) {
  const uniqueReferenceIds = Array.from(new Set((params.referenceIds || []).filter(Boolean)));

  if (uniqueReferenceIds.length > 0) {
    const { data: matchingItems, error: lookupError } = await supabase
      .from("items_aprobacion")
      .select("id")
      .eq("tipo", "actividad")
      .eq("tecnico_id", params.tecnicoId)
      .in("referencia_id", uniqueReferenceIds);
    if (lookupError) throw lookupError;

    const matchingIds = (matchingItems || []).map((item: { id: string }) => item.id);
    if (matchingIds.length > 0) {
      const { error: updateError } = await supabase
        .from("items_aprobacion")
        .update({ valor: params.valor })
        .in("id", matchingIds);
      if (updateError) throw updateError;
      return;
    }
  }

  const { error: fallbackError } = await supabase
    .from("items_aprobacion")
    .update({ valor: params.valor })
    .eq("tipo", "actividad")
    .eq("tecnico_id", params.tecnicoId)
    .eq("fecha", params.fecha);
  if (fallbackError) throw fallbackError;
}

async function syncGroupedActivityLiquidationValue(params: {
  tecnicoId: string;
  fecha: string;
  valorBase: number;
  valorGanado: number;
  porcentaje?: number;
  periodoId?: string | null;
  referenceIds?: string[];
}) {
  const uniqueReferenceIds = Array.from(new Set((params.referenceIds || []).filter(Boolean)));
  const updateData = {
    valor_base: params.valorBase,
    valor_ganado: params.valorGanado,
    ...(params.porcentaje != null ? { porcentaje: params.porcentaje } : {}),
  };

  if (uniqueReferenceIds.length > 0) {
    let lookupQuery = supabase
      .from("items_liquidacion")
      .select("id")
      .eq("tipo", "actividad")
      .eq("tecnico_id", params.tecnicoId)
      .in("referencia_id", uniqueReferenceIds);

    if (params.periodoId) {
      lookupQuery = lookupQuery.eq("periodo_id", params.periodoId);
    }

    const { data: matchingItems, error: lookupError } = await lookupQuery;
    if (lookupError) throw lookupError;

    const matchingIds = (matchingItems || []).map((item: { id: string }) => item.id);
    if (matchingIds.length > 0) {
      const { error: updateError } = await supabase
        .from("items_liquidacion")
        .update(updateData)
        .in("id", matchingIds);
      if (updateError) throw updateError;
      return;
    }
  }

  let fallbackQuery = supabase
    .from("items_liquidacion")
    .update(updateData)
    .eq("tipo", "actividad")
    .eq("tecnico_id", params.tecnicoId)
    .eq("fecha", params.fecha);

  if (params.periodoId) {
    fallbackQuery = fallbackQuery.eq("periodo_id", params.periodoId);
  }

  const { error: fallbackError } = await fallbackQuery;
  if (fallbackError) throw fallbackError;
}

async function getRegistrosComoReports(mirrors?: LegacyActivityMirrorMaps): Promise<ActivityReport[]> {
    const [{ data: registros }, { data: allParticipantes }, { data: actividades }, { data: periodos }, { data: approvalItems }] = await Promise.all([
    supabase.from("registros_actividades").select("id, actividad_id, lider_id, grupo_id, fecha, cliente_id, cliente_nombre, especificacion, valor_actividad_base, valor_actividad_aplicado, valor_sugerido, motivo_sugerencia_valor, valor_modificado, motivo_modificacion_valor, enviado_correo, fecha_ultimo_envio_correo, periodo_id, fecha_creacion").order("fecha", { ascending: false }),
    supabase.from("actividad_participantes").select("registro_actividad_id, tecnico_id, porcentaje, valor_calculado"),
    supabase.from("actividades").select("id, codigo, nombre"),
    supabase.from("periodos_liquidacion").select("id, fecha_inicio, fecha_fin").order("fecha_inicio", { ascending: false }),
    supabase.from("items_aprobacion").select("tecnico_id, fecha, tipo, estado, fecha_aprobacion").eq("tipo", "actividad"),
  ]);

  const participantesByRegistro = new Map<string, ActividadParticipanteRow[]>();
  for (const participante of allParticipantes || []) {
    const registroId = participante.registro_actividad_id;
    if (!registroId) continue;
    const current = participantesByRegistro.get(registroId) || [];
    current.push(participante);
    participantesByRegistro.set(registroId, current);
  }

  const actividadesById = new Map(
    (actividades || []).map((actividad: ActividadCatalogoRow) => [actividad.id, actividad])
  );

  const approvalByTecnicoFecha = new Map<string, ItemAprobacionRow>(
    (approvalItems || []).map((item: ItemAprobacionRow) => [`${item.tecnico_id}|${item.fecha}`, item])
  );

  const findPeriodo = (fecha: string) => {
    const p = (periodos || []).find(
      (per: PeriodoLiquidacionRow) => fecha >= per.fecha_inicio && fecha <= per.fecha_fin
    );
    return p?.id || "";
  };

  const registroPeriodoIds = await resolveRegistrosPeriodoIds((registros || []) as RegistroActividadRow[]);
  const reports: ActivityReport[] = [];
  for (const reg of (registros || []) as RegistroActividadRow[]) {
    const parts = participantesByRegistro.get(reg.id) || [];
    if (parts.length === 0) continue;

    const act = reg.actividad_id ? actividadesById.get(reg.actividad_id) : undefined;
    const periodoId = reg.periodo_id || registroPeriodoIds.get(reg.id) || findPeriodo(reg.fecha);

    for (const part of parts) {
      const approval = approvalByTecnicoFecha.get(`${part.tecnico_id}|${reg.fecha}`);
      const estadoAprobacion: "pendiente" | "aprobado" | "rechazado" =
        approval?.estado === "aprobada" ? "aprobado"
          : approval?.estado === "rechazada" ? "rechazado"
            : "pendiente";
      const porcentajeParticipacion = Number(part.porcentaje ?? 0) || 0;
      const valorActividadBase = Number(reg.valor_actividad_base ?? 0) || 0;
      const valorActividadAplicado = Number(reg.valor_actividad_aplicado ?? 0) || 0;
      const valorBaseParticipante = porcentajeParticipacion > 0
        ? (valorActividadBase * porcentajeParticipacion) / 100
        : valorActividadBase;
      const valorAplicadoParticipante = porcentajeParticipacion > 0
        ? (valorActividadAplicado * porcentajeParticipacion) / 100
        : valorActividadAplicado;
      const valorCalculadoParticipante = Number(part.valor_calculado ?? 0) || 0;
      const valorSugeridoGlobal = Number(reg.valor_sugerido ?? 0) || 0;
      const valorSugeridoParticipante = valorSugeridoGlobal > 0
        ? (porcentajeParticipacion > 0 ? (valorSugeridoGlobal * porcentajeParticipacion) / 100 : valorSugeridoGlobal)
        : 0;

      reports.push(enrichLegacyActivityReport({
        id: `reg-${reg.id}-${part.tecnico_id}`,
        tipo: "actividad_grupal",
        registroActividadId: reg.id,
        tecnicoId: part.tecnico_id,
        liderGrupoId: reg.lider_id,
        grupoId: reg.grupo_id,
        porcentajeParticipacion: porcentajeParticipacion,
        fecha: reg.fecha,
        clienteId: reg.cliente_id || undefined,
        descripcion: act ? `${act.codigo} — ${act.nombre}` : reg.cliente_nombre || "Actividad grupal",
        especificacion: reg.especificacion || undefined,
        estadoAprobacionLider: estadoAprobacion,
        fechaAprobacionLider: approval?.fecha_aprobacion?.split("T")[0] || undefined,
        costoActividadDefault: valorBaseParticipante,
        valorSugerido: valorSugeridoParticipante > 0 ? valorSugeridoParticipante : undefined,
        valorSugeridoGlobal: valorSugeridoGlobal > 0 ? valorSugeridoGlobal : undefined,
        motivoSugerenciaValor: reg.motivo_sugerencia_valor || undefined,
        valorModificado: reg.valor_modificado ?? valorActividadBase !== valorActividadAplicado,
        motivoModificacionValor: reg.motivo_modificacion_valor || undefined,
        costoActividad: valorCalculadoParticipante || valorAplicadoParticipante,
        costoAdministrable: false,
        correoEnviado: reg.enviado_correo || false,
        fechaUltimoEnvioCorreo: reg.fecha_ultimo_envio_correo || undefined,
        periodoId,
        fechaCreacion: reg.fecha_creacion?.split("T")[0] || "",
        valorActividadBaseGlobal: valorActividadBase,
        valorActividadAplicadoGlobal: valorActividadAplicado,
      }, mirrors));
    }
  }

  const canonicalRegistroIds = selectCanonicalLegacyRegistroIds(reports);

  return reports.filter((report) => {
    if (!report.registroActividadId) return true;
    return canonicalRegistroIds.has(report.registroActividadId);
  });
}

export async function getReportesActividad(): Promise<ActivityReport[]> {
  const createdMaintenanceMirrors = await ensurePreventiveMaintenanceMirrors();
  if (createdMaintenanceMirrors) {
    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
  }

  return getCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY, REPORTES_ACTIVIDAD_CACHE_TTL, async () => {
    const companySettingsPromise = getConfiguracion();
    const { data, error } = await supabase
      .from("reportes_actividad")
      .select("*")
      .order("fecha", { ascending: false });
    if (error) throw error;

    const reportIds = (data || []).map((row: ReporteActividadRow) => row.id);
    const preventiveMaintenanceIds = Array.from(new Set(
      (data || [])
        .filter((row: ReporteActividadRow) => row.tipo === "mantenimiento_preventivo")
        .map((row: ReporteActividadRow) => row.mantenimiento_id)
        .filter(Boolean)
    ));
    let fotosData: ReporteActividadFotoRow[] = [];

    if (reportIds.length > 0) {
      const fotoChunks = chunkArray(reportIds, 120);
      const fotoResults = await Promise.all(
        fotoChunks.map(async (chunk) => {
          const { data: chunkData, error: chunkError } = await supabase
            .from("reporte_actividad_fotos")
            .select("reporte_actividad_id, tipo, url, orden")
            .in("reporte_actividad_id", chunk)
            .order("orden");

          if (chunkError) throw chunkError;
          return (chunkData || []) as ReporteActividadFotoRow[];
        })
      );

      fotosData = fotoResults.flat();
    }

    const visitReportRows = (data || []).filter((row: ReporteActividadRow) => row.tipo === "visita_tecnica");
    const recorridoReportRows = (data || []).filter((row: ReporteActividadRow) => row.tipo === "recorrido");
    const uniqueVisitTechIds = Array.from(new Set(visitReportRows.map((row) => row.tecnico_id).filter(Boolean)));
    const uniqueRecorridoTechIds = Array.from(new Set(recorridoReportRows.map((row) => row.tecnico_id).filter(Boolean)));
    const visitDates = visitReportRows.map((row) => row.fecha).filter(Boolean);
    const minVisitDate = visitDates.length > 0 ? [...visitDates].sort()[0] : null;
    const maxVisitDate = visitDates.length > 0 ? [...visitDates].sort().at(-1) || null : null;
    const recorridoDates = recorridoReportRows.map((row) => row.fecha).filter(Boolean);
    const minRecorridoDate = recorridoDates.length > 0 ? [...recorridoDates].sort()[0] : null;
    const maxRecorridoDate = recorridoDates.length > 0 ? [...recorridoDates].sort().at(-1) || null : null;

    const { data: visitMirrorData, error: visitMirrorError } = uniqueVisitTechIds.length > 0 && minVisitDate && maxVisitDate
      ? await supabase
        .from("visitas_tecnicas")
        .select("*")
        .in("tecnico_id", uniqueVisitTechIds)
        .gte("fecha_inicio", `${minVisitDate}T00:00:00`)
        .lt("fecha_inicio", `${addOneDay(maxVisitDate)}T00:00:00`)
      : { data: [], error: null };

    if (visitMirrorError) throw visitMirrorError;

    const { data: recorridoMirrorData, error: recorridoMirrorError } = uniqueRecorridoTechIds.length > 0 && minRecorridoDate && maxRecorridoDate
      ? await supabase
        .from("recorridos")
        .select("id, tecnico_id, fecha, punto_partida, punto_llegada, tipo_recorrido, valor, foto_herramienta_url")
        .in("tecnico_id", uniqueRecorridoTechIds)
        .gte("fecha", minRecorridoDate)
        .lte("fecha", maxRecorridoDate)
      : { data: [], error: null };

    if (recorridoMirrorError) throw recorridoMirrorError;

    const { data: visitLiquidationData, error: visitLiquidationError } = uniqueVisitTechIds.length > 0 && minVisitDate && maxVisitDate
      ? await supabase
        .from("items_liquidacion")
        .select("id, tecnico_id, fecha, periodo_id, referencia_id, porcentaje, valor_base, valor_ganado")
        .eq("tipo", "visita_tecnica")
        .in("tecnico_id", uniqueVisitTechIds)
        .gte("fecha", minVisitDate)
        .lte("fecha", maxVisitDate)
      : { data: [], error: null };

    if (visitLiquidationError) throw visitLiquidationError;

    const { data: maintenanceParticipantRows, error: maintenanceParticipantRowsError } = preventiveMaintenanceIds.length > 0
      ? await supabase
        .from("mantenimiento_participantes")
        .select("id, maintenance_id, usuario_id, porcentaje, valor_calculado")
        .in("maintenance_id", preventiveMaintenanceIds)
      : { data: [], error: null };

    if (maintenanceParticipantRowsError) throw maintenanceParticipantRowsError;

    const companySettings = await companySettingsPromise;

    const visitMirrors: VisitMirrorMaps = {
      strict: new Map<string, VisitMirrorRow>(),
      fallback: new Map<string, VisitMirrorRow>(),
    };

    const visitLiquidationMaps: VisitLiquidationMaps = {
      byReferenceId: new Map<string, VisitLiquidationRow[]>(),
      byFallback: new Map<string, VisitLiquidationRow[]>(),
    };

    const recorridoMirrors: RecorridoMirrorMaps = {
      strict: new Map<string, RecorridoMirrorRow>(),
      fallback: new Map<string, RecorridoMirrorRow>(),
    };
    const maintenanceParticipantMaps = buildMaintenanceParticipantMaps((maintenanceParticipantRows || []) as MaintenanceParticipantRow[]);

    for (const row of (visitMirrorData || []) as VisitMirrorRow[]) {
      const fecha = row.fecha_inicio?.split("T")[0] || "";
      if (!row.tecnico_id || !fecha) continue;

      const strictKey = buildVisitMirrorStrictKey({
        tecnicoId: row.tecnico_id,
        fecha,
        clienteId: row.cliente_id,
        descripcion: row.descripcion,
      });
      const fallbackKey = buildVisitMirrorFallbackKey({
        tecnicoId: row.tecnico_id,
        fecha,
        clienteId: row.cliente_id,
      });

      if (!visitMirrors.strict.has(strictKey)) {
        visitMirrors.strict.set(strictKey, row);
      }

      if (!visitMirrors.fallback.has(fallbackKey)) {
        visitMirrors.fallback.set(fallbackKey, row);
      }
    }

    for (const row of (visitLiquidationData || []) as VisitLiquidationRow[]) {
      if (row.referencia_id) {
        appendVisitLiquidationCandidate(visitLiquidationMaps.byReferenceId, row.referencia_id, row);
      }

      if (!row.tecnico_id || !row.fecha) continue;

      const fallbackKey = buildVisitLiquidationFallbackKey({
        tecnicoId: row.tecnico_id,
        fecha: row.fecha,
        periodoId: row.periodo_id,
      });

      appendVisitLiquidationCandidate(visitLiquidationMaps.byFallback, fallbackKey, row);
    }

    for (const row of (recorridoMirrorData || []) as RecorridoMirrorRow[]) {
      const strictKey = buildRecorridoMirrorStrictKey({
        tecnicoId: row.tecnico_id,
        fecha: row.fecha,
        puntoPartida: row.punto_partida,
        puntoLlegada: row.punto_llegada,
        tipoRecorrido: row.tipo_recorrido,
      });
      const fallbackKey = buildRecorridoMirrorFallbackKey({
        tecnicoId: row.tecnico_id,
        fecha: row.fecha,
        tipoRecorrido: row.tipo_recorrido,
      });

      if (!recorridoMirrors.strict.has(strictKey)) {
        recorridoMirrors.strict.set(strictKey, row);
      }

      if (!recorridoMirrors.fallback.has(fallbackKey)) {
        recorridoMirrors.fallback.set(fallbackKey, row);
      }
    }

    const fotosByReporte = new Map<string, Array<{ tipo: string; url: string }>>();
    for (const foto of (fotosData || []) as ReporteActividadFotoRow[]) {
      const reporteId = foto.reporte_actividad_id;
      if (!reporteId) continue;
      const current = fotosByReporte.get(reporteId) || [];
      current.push({ tipo: foto.tipo, url: foto.url });
      fotosByReporte.set(reporteId, current);
    }

    const reports: ActivityReport[] = [];
    const legacyActivityMirrors: LegacyActivityMirrorMaps = {
      strict: new Map<string, ActivityReport[]>(),
      fallback: new Map<string, ActivityReport[]>(),
    };

    for (const row of data || []) {
      const fotos = fotosByReporte.get(row.id) || [];
      const fotosAntes = fotos.filter((f) => f.tipo === "antes").map((f) => f.url);
      const fotosDespues = fotos.filter((f) => f.tipo === "despues").map((f) => f.url);
      const visitEnrichedReport = enrichVisitReport(mapReport(row, fotosAntes, fotosDespues), visitMirrors);
      const mappedReport = enrichRecorridoReport(
        enrichVisitLiquidationReport(
          enrichPreventiveMaintenanceReport(visitEnrichedReport, row, maintenanceParticipantMaps),
          visitEnrichedReport.tipo === "visita_tecnica"
            ? resolveVisitLiquidationRow({
              reportId: visitEnrichedReport.id,
              visitId: visitEnrichedReport.visitaTecnicaId,
              tecnicoId: visitEnrichedReport.tecnicoId,
              fecha: visitEnrichedReport.fecha,
              periodoId: visitEnrichedReport.periodoId,
              maps: visitLiquidationMaps,
            })
            : undefined
        ),
        recorridoMirrors,
        {
          costoRecorridoNormal: companySettings.costoRecorridoNormal,
          costoRecorridoHerramienta: companySettings.costoRecorridoHerramienta,
        }
      );

      if (mappedReport.tipo === "actividad_grupal") {
        const strictKey = buildLegacyActivityMirrorKey({
          tecnicoId: mappedReport.tecnicoId,
          fecha: mappedReport.fecha,
          grupoId: mappedReport.grupoId,
          clienteId: mappedReport.clienteId,
          descripcion: mappedReport.descripcion,
          especificacion: mappedReport.especificacion,
        });
        const fallbackKey = buildLegacyActivityFallbackKey({
          tecnicoId: mappedReport.tecnicoId,
          fecha: mappedReport.fecha,
          grupoId: mappedReport.grupoId,
          clienteId: mappedReport.clienteId,
          descripcion: mappedReport.descripcion,
        });

        appendLegacyActivityCandidate(legacyActivityMirrors.strict, strictKey, mappedReport);
        appendLegacyActivityCandidate(legacyActivityMirrors.fallback, fallbackKey, mappedReport);
      }

      reports.push(mappedReport);
    }

    try {
      const registroReports = await getRegistrosComoReports(legacyActivityMirrors);
      const registroReportsByStrictKey = new Map<string, ActivityReport[]>();
      const registroReportsByFallbackKey = new Map<string, ActivityReport[]>();
      const registroReportsByParticipantKey = new Map<string, ActivityReport[]>();
      const matchedRegistroReportIds = new Set<string>();

      for (const registroReport of registroReports) {
        const strictKey = buildLegacyActivityMirrorKey({
          tecnicoId: registroReport.tecnicoId,
          fecha: registroReport.fecha,
          grupoId: registroReport.grupoId,
          clienteId: registroReport.clienteId,
          descripcion: registroReport.descripcion,
          especificacion: registroReport.especificacion,
        });
        const fallbackKey = buildLegacyActivityFallbackKey({
          tecnicoId: registroReport.tecnicoId,
          fecha: registroReport.fecha,
          grupoId: registroReport.grupoId,
          clienteId: registroReport.clienteId,
          descripcion: registroReport.descripcion,
        });
        const participantKey = buildLegacyActivityParticipantKey({
          tecnicoId: registroReport.tecnicoId,
          fecha: registroReport.fecha,
          grupoId: registroReport.grupoId,
          clienteId: registroReport.clienteId,
        });

        appendLegacyActivityCandidate(registroReportsByStrictKey, strictKey, registroReport);
        appendLegacyActivityCandidate(registroReportsByFallbackKey, fallbackKey, registroReport);
        appendLegacyActivityCandidate(registroReportsByParticipantKey, participantKey, registroReport);
      }

      for (let index = 0; index < reports.length; index += 1) {
        const report = reports[index];
        if (report.tipo !== "actividad_grupal") continue;

        const strictKey = buildLegacyActivityMirrorKey({
          tecnicoId: report.tecnicoId,
          fecha: report.fecha,
          grupoId: report.grupoId,
          clienteId: report.clienteId,
          descripcion: report.descripcion,
          especificacion: report.especificacion,
        });
        const fallbackKey = buildLegacyActivityFallbackKey({
          tecnicoId: report.tecnicoId,
          fecha: report.fecha,
          grupoId: report.grupoId,
          clienteId: report.clienteId,
          descripcion: report.descripcion,
        });
        const participantKey = buildLegacyActivityParticipantKey({
          tecnicoId: report.tecnicoId,
          fecha: report.fecha,
          grupoId: report.grupoId,
          clienteId: report.clienteId,
        });
        const relatedReport = resolveLegacyActivityCandidate(registroReportsByStrictKey.get(strictKey), report)
          || resolveLegacyActivityCandidate(registroReportsByFallbackKey.get(fallbackKey), report)
          || resolveLegacyActivityCandidate(registroReportsByParticipantKey.get(participantKey), report)
          || resolveLegacyActivityByBaseIdentity(registroReportsByStrictKey.get(strictKey), report)
          || resolveLegacyActivityByBaseIdentity(registroReportsByFallbackKey.get(fallbackKey), report)
          || resolveLegacyActivityByBaseIdentity(registroReportsByParticipantKey.get(participantKey), report);

        if (relatedReport) {
          reports[index] = mergeGroupActivityMetadata(report, relatedReport);
          matchedRegistroReportIds.add(relatedReport.id);
        }
      }

      for (const rr of registroReports) {
        if (!matchedRegistroReportIds.has(rr.id)) {
          reports.push(rr);
        }
      }
    } catch (err) {
      console.error("Error cargando registros_actividades como reportes:", err);
    }

    const dedupedReports = dedupeGroupActivityReports(reports);
    dedupedReports.sort((a, b) => {
      const dateCompare = b.fecha.localeCompare(a.fecha);
      if (dateCompare !== 0) return dateCompare;

      const creationCompare = (b.fechaCreacion || "").localeCompare(a.fechaCreacion || "");
      if (creationCompare !== 0) return creationCompare;

      return b.id.localeCompare(a.id);
    });
    return dedupedReports;
  });
}

export async function updateCostoActividadAdmin(
  id: string,
  costoActividad: number,
  options?: { sharedVisitParticipants?: SharedParticipantOverride[] }
): Promise<void> {
  const normalizedSharedParticipants = dedupeSharedParticipantOverrides(options?.sharedVisitParticipants);

  const legacyGroupActivity = parseLegacyGroupActivityReportId(id);
  if (legacyGroupActivity) {
    const { tecnicoId, registroId } = legacyGroupActivity;

    const { error } = await supabase
      .from("actividad_participantes")
      .update({ valor_calculado: costoActividad })
      .eq("registro_actividad_id", registroId)
      .eq("tecnico_id", tecnicoId);
    if (error) throw error;
    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    return;
  }

  const { data: report, error: reportLookupError } = await supabase
    .from("reportes_actividad")
    .select("id, tipo, tecnico_id, grupo_id, cliente_id, descripcion, fecha, punto_partida, punto_llegada, tipo_recorrido, periodo_id, costo_actividad_default, mantenimiento_id")
    .eq("id", id)
    .single();
  if (reportLookupError) throw reportLookupError;

  if (report?.tipo === "visita_tecnica") {
    const wasSharedVisitUpdated = await updateSharedVisitCostFromReport({
      reportId: report.id,
      fecha: report.fecha,
      grupoId: report.grupo_id,
      clienteId: report.cliente_id,
      descripcion: report.descripcion,
      periodoId: report.periodo_id,
      defaultCost: report.costo_actividad_default,
      costoActividad,
      participantOverrides: normalizedSharedParticipants,
    });

    if (wasSharedVisitUpdated) {
      invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
      return;
    }
  }

  const normalizedDefaultCost = Number(report?.costo_actividad_default ?? 0) || 0;
  const isAdminValueModified = report?.tipo === "visita_tecnica" || report?.tipo === "mantenimiento_preventivo"
    ? costoActividad !== normalizedDefaultCost
    : undefined;

  const { error } = await supabase
    .from("reportes_actividad")
    .update({
      costo_actividad: costoActividad,
      valor_modificado: report?.tipo === "recorrido"
        ? true
        : isAdminValueModified,
      motivo_modificacion_valor: report?.tipo === "recorrido"
        ? ADMIN_VALUE_OVERRIDE_REASON
        : isAdminValueModified
          ? ADMIN_VALUE_OVERRIDE_REASON
          : null,
    })
    .eq("id", id);
  if (error) throw error;

  if (report?.tipo === "mantenimiento_preventivo") {
    const maintenanceIdentity = buildMaintenanceSharedIdentity({
      tipo: "mantenimiento_preventivo",
      mantenimientoId: report.mantenimiento_id || undefined,
      fecha: report.fecha,
      periodoId: report.periodo_id,
      grupoId: report.grupo_id,
      clienteId: report.cliente_id,
      descripcion: report.descripcion,
    });

    const { data: maintenanceReports, error: maintenanceReportsError } = await supabase
      .from("reportes_actividad")
      .select("id, tecnico_id, periodo_id, mantenimiento_id, mantenimiento_participante_id")
      .eq("tipo", "mantenimiento_preventivo")
      .eq("fecha", report.fecha)
      .eq("grupo_id", report.grupo_id)
      .eq("periodo_id", report.periodo_id);
    if (maintenanceReportsError) throw maintenanceReportsError;

    const relatedReports = (maintenanceReports || []).filter((candidate: {
      id: string;
      tecnico_id: string;
      periodo_id?: string | null;
      mantenimiento_id?: string | null;
    }) => buildMaintenanceSharedIdentity({
      tipo: "mantenimiento_preventivo",
      mantenimientoId: candidate.mantenimiento_id || undefined,
      fecha: report.fecha,
      periodoId: candidate.periodo_id || report.periodo_id,
      grupoId: report.grupo_id,
      clienteId: report.cliente_id,
      descripcion: report.descripcion,
    }) === maintenanceIdentity);

    const shouldUseSharedMaintenanceFlow = relatedReports.length > 1 || normalizedSharedParticipants.length > 0;

    if (shouldUseSharedMaintenanceFlow) {
      const participantOverrides = normalizedSharedParticipants.length > 0
        ? normalizedSharedParticipants
        : relatedReports.map((candidate: {
          id: string;
          tecnico_id: string;
          periodo_id?: string | null;
          mantenimiento_participante_id?: string | null;
        }) => ({
          reportId: candidate.id,
          tecnicoId: candidate.tecnico_id,
          percentage: relatedReports.length > 0 ? Number((100 / relatedReports.length).toFixed(2)) : 100,
          valorGanado: relatedReports.length > 0 ? Math.round(costoActividad / relatedReports.length) : costoActividad,
          periodoId: candidate.periodo_id || report.periodo_id,
          maintenanceId: report.mantenimiento_id || undefined,
          maintenanceParticipantId: candidate.mantenimiento_participante_id || undefined,
          defaultCost: normalizedDefaultCost,
        }));

      const maintenanceId = report.mantenimiento_id || participantOverrides.find((participant) => participant.maintenanceId)?.maintenanceId;

      await Promise.all(participantOverrides.map(async (participant, index) => {
        const fallbackParticipantValue = Math.max(0, Math.round(((costoActividad * (Number(participant.percentage ?? 0) || 0)) / 100) || 0));
        const assignedBeforeLast = participantOverrides.slice(0, index).reduce((sum, current) => {
          const currentValue = current.valorGanado != null
            ? Math.max(0, Math.round(Number(current.valorGanado ?? 0) || 0))
            : Math.max(0, Math.round(((costoActividad * (Number(current.percentage ?? 0) || 0)) / 100) || 0));
          return sum + currentValue;
        }, 0);
        const participantValue = participant.valorGanado
          ?? (index === participantOverrides.length - 1
            ? Math.max(0, Math.round(costoActividad - assignedBeforeLast))
            : fallbackParticipantValue);

        const { error: participantReportUpdateError } = await supabase
          .from("reportes_actividad")
          .update({
            costo_actividad: participantValue,
            costo_actividad_default: costoActividad,
            valor_modificado: participantValue !== costoActividad,
            motivo_modificacion_valor: participantValue !== costoActividad ? ADMIN_VALUE_OVERRIDE_REASON : null,
          })
          .eq("id", participant.reportId || report.id);
        if (participantReportUpdateError) throw participantReportUpdateError;

        if (participant.maintenanceParticipantId) {
          const { error: participantUpdateError } = await supabase
            .from("mantenimiento_participantes")
            .update({
              porcentaje: participant.percentage,
              valor_calculado: participantValue,
            })
            .eq("id", participant.maintenanceParticipantId);
          if (participantUpdateError) throw participantUpdateError;
        }

        await syncGroupedActivityApprovalValue({
          tecnicoId: participant.tecnicoId,
          fecha: report.fecha,
          valor: participantValue,
          referenceIds: [participant.reportId || report.id],
        });

        await syncGroupedActivityLiquidationValue({
          tecnicoId: participant.tecnicoId,
          fecha: report.fecha,
          valorBase: costoActividad,
          valorGanado: participantValue,
          porcentaje: participant.percentage,
          periodoId: participant.periodoId || report.periodo_id,
          referenceIds: [participant.reportId || report.id],
        });
      }));

      if (maintenanceId) {
        const { error: maintenanceUpdateError } = await supabase
          .from("mantenimientos")
          .update({ costo_tecnico_total: costoActividad })
          .eq("id", maintenanceId);
        if (maintenanceUpdateError) throw maintenanceUpdateError;
      }

      invalidateCachedValue("liquidacion:entries");
      invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
      return;
    }

    await syncGroupedActivityApprovalValue({
      tecnicoId: report.tecnico_id,
      fecha: report.fecha,
      valor: costoActividad,
      referenceIds: [report.id],
    });

    await syncGroupedActivityLiquidationValue({
      tecnicoId: report.tecnico_id,
      fecha: report.fecha,
      valorBase: costoActividad,
      valorGanado: costoActividad,
      porcentaje: 100,
      periodoId: report.periodo_id,
      referenceIds: [report.id],
    });

    invalidateCachedValue("liquidacion:entries");
    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    return;
  }

  if (report?.tipo === "recorrido") {
    let recorridoUpdate = supabase
      .from("recorridos")
      .update({ valor: costoActividad })
      .eq("tecnico_id", report.tecnico_id)
      .eq("fecha", report.fecha);

    if (report.punto_partida) {
      recorridoUpdate = recorridoUpdate.eq("punto_partida", report.punto_partida);
    }

    if (report.punto_llegada) {
      recorridoUpdate = recorridoUpdate.eq("punto_llegada", report.punto_llegada);
    }

    if (report.tipo_recorrido) {
      recorridoUpdate = recorridoUpdate.eq("tipo_recorrido", report.tipo_recorrido);
    }

    const { error: recorridoUpdateError } = await recorridoUpdate;
    if (recorridoUpdateError) throw recorridoUpdateError;

    const { error: approvalUpdateError } = await supabase
      .from("items_aprobacion")
      .update({ valor: costoActividad })
      .eq("tipo", "recorrido")
      .eq("tecnico_id", report.tecnico_id)
      .eq("fecha", report.fecha);
    if (approvalUpdateError) throw approvalUpdateError;

    const { data: liquidationItems, error: liquidationLookupError } = await supabase
      .from("items_liquidacion")
      .select("id, porcentaje")
      .eq("tipo", "recorrido")
      .eq("tecnico_id", report.tecnico_id)
      .eq("fecha", report.fecha);
    if (liquidationLookupError) throw liquidationLookupError;

    await Promise.all(
      (liquidationItems || []).map(async (item: { id: string; porcentaje?: number | string | null }) => {
        const porcentaje = Number(item.porcentaje ?? 0) || 0;
        const valorGanado = porcentaje > 0 ? (costoActividad * porcentaje) / 100 : costoActividad;

        const { error: liquidationUpdateError } = await supabase
          .from("items_liquidacion")
          .update({
            valor_base: costoActividad,
            valor_ganado: valorGanado,
          })
          .eq("id", item.id);
        if (liquidationUpdateError) throw liquidationUpdateError;
      })
    );

    invalidateCachedValue("liquidacion:entries");
    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    return;
  }

  await syncVisitCostFromApprovalReport(id, costoActividad);

  invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
}

export async function updateActividadGrupalBaseAdmin(
  id: string,
  valorBase: number,
  options?: { sourceReportId?: string; participantOverrides?: SharedParticipantOverride[] }
): Promise<void> {
  const normalizedParticipantOverrides = dedupeSharedParticipantOverrides(options?.participantOverrides);
  const legacyGroupActivity = parseLegacyGroupActivityReportId(id);
  const sourceReportLookupId = options?.sourceReportId && !options.sourceReportId.startsWith("reg-")
    ? options.sourceReportId
    : (!id.startsWith("reg-") ? id : undefined);
  const shouldUseReportFlow = !!sourceReportLookupId || normalizedParticipantOverrides.some((override) => {
    const reportId = override.reportId || "";
    return !!reportId && !reportId.startsWith("reg-");
  });
  const registroId = legacyGroupActivity?.registroId || id;

  const normalizedBaseValue = Math.max(0, Number(valorBase) || 0);

  if (shouldUseReportFlow) {
    if (!sourceReportLookupId) {
      throw new Error(`No se encontró una fuente válida para la actividad grupal: ${id}`);
    }
    const { data: sourceReport, error: sourceReportError } = await supabase
      .from("reportes_actividad")
      .select("id, fecha, grupo_id, cliente_id, descripcion, periodo_id, lider_grupo_id")
      .eq("id", sourceReportLookupId)
      .maybeSingle();
    if (sourceReportError) throw sourceReportError;
    if (!sourceReport) {
      throw new Error(`No se encontró el reporte fuente para la actividad grupal: ${sourceReportLookupId}`);
    }

    let relatedReportsQuery = supabase
      .from("reportes_actividad")
      .select("id, tecnico_id, costo_actividad, periodo_id")
      .in("tipo", ["actividad", "actividad_grupal"])
      .eq("fecha", sourceReport.fecha)
      .eq("grupo_id", sourceReport.grupo_id);

    if (sourceReport.cliente_id) {
      relatedReportsQuery = relatedReportsQuery.eq("cliente_id", sourceReport.cliente_id);
    } else {
      relatedReportsQuery = relatedReportsQuery.is("cliente_id", null);
    }

    if (sourceReport.descripcion) {
      relatedReportsQuery = relatedReportsQuery.eq("descripcion", sourceReport.descripcion);
    } else {
      relatedReportsQuery = relatedReportsQuery.is("descripcion", null);
    }

    const { data: relatedReports, error: relatedReportsError } = await relatedReportsQuery;
    if (relatedReportsError) throw relatedReportsError;

    const participants = relatedReports || [];
    const participantsCount = participants.length || 1;
    const currentTotal = participants.reduce(
      (sum, participant: { costo_actividad?: number | string | null }) => sum + (Number(participant.costo_actividad) || 0),
      0
    );

    let legacyRegistroQuery = supabase
      .from("registros_actividades")
      .select("id, actividad_id, lider_id, grupo_id, cliente_id, fecha, especificacion, valor_actividad_base, fecha_creacion")
      .eq("fecha", sourceReport.fecha)
      .eq("grupo_id", sourceReport.grupo_id);

    if (sourceReport.cliente_id) {
      legacyRegistroQuery = legacyRegistroQuery.eq("cliente_id", sourceReport.cliente_id);
    } else {
      legacyRegistroQuery = legacyRegistroQuery.is("cliente_id", null);
    }

    const { data: legacyRegistroCandidates, error: legacyRegistroCandidatesError } = await legacyRegistroQuery;
    if (legacyRegistroCandidatesError) throw legacyRegistroCandidatesError;

    let legacyRegistro = (legacyRegistroCandidates || [])[0] as {
      id: string;
      actividad_id?: string | null;
      lider_id?: string | null;
      grupo_id?: string | null;
      cliente_id?: string | null;
      fecha: string;
      especificacion?: string | null;
      valor_actividad_base?: number | string | null;
      fecha_creacion?: string | null;
    } | undefined;

    const canonicalIdentity = buildLegacyRegistroCandidateIdentity({
      leaderId: sourceReport.lider_grupo_id,
      grupoId: sourceReport.grupo_id,
      clienteId: sourceReport.cliente_id,
      fecha: sourceReport.fecha,
      descripcion: sourceReport.descripcion,
    });

    if ((legacyRegistroCandidates || []).length > 1) {
      const candidateRegistroIds = (legacyRegistroCandidates || []).map((item: { id: string }) => item.id);
      const { data: candidateParticipants, error: candidateParticipantsError } = await supabase
        .from("actividad_participantes")
        .select("registro_actividad_id, tecnico_id")
        .in("registro_actividad_id", candidateRegistroIds);
      if (candidateParticipantsError) throw candidateParticipantsError;

      const expectedTechnicianIds = Array.from(new Set(participants.map((participant: { tecnico_id: string }) => participant.tecnico_id))).sort();
      const participantsByRegistro = new Map<string, string[]>();

      (candidateParticipants || []).forEach((row: { registro_actividad_id: string; tecnico_id: string }) => {
        const current = participantsByRegistro.get(row.registro_actividad_id) || [];
        current.push(row.tecnico_id);
        participantsByRegistro.set(row.registro_actividad_id, current);
      });

      const participantMatchedRegistro = (legacyRegistroCandidates || []).find((candidate: { id: string }) => {
        const registroParticipantIds = Array.from(new Set(participantsByRegistro.get(candidate.id) || [])).sort();
        return registroParticipantIds.length === expectedTechnicianIds.length
          && registroParticipantIds.every((value, index) => value === expectedTechnicianIds[index]);
      });

      const identityMatchedRegistro = (legacyRegistroCandidates || []).find((candidate: {
        actividad_id?: string | null;
        lider_id?: string | null;
        grupo_id?: string | null;
        cliente_id?: string | null;
        fecha: string;
        especificacion?: string | null;
      }) => buildLegacyRegistroCandidateIdentity({
        actividadId: candidate.actividad_id,
        leaderId: candidate.lider_id,
        grupoId: candidate.grupo_id,
        clienteId: candidate.cliente_id,
        fecha: candidate.fecha,
        especificacion: candidate.especificacion,
        descripcion: sourceReport.descripcion,
      }) === canonicalIdentity);

      legacyRegistro = identityMatchedRegistro || participantMatchedRegistro || legacyRegistro;

      if ((legacyRegistroCandidates || []).length > 1) {
        legacyRegistro = (legacyRegistroCandidates || []).reduce<typeof legacyRegistro>((best, candidate) => {
          if (!best) return candidate;

          const candidateScore = scoreLegacyActivityCompleteness({
            description: sourceReport.descripcion,
            especificacion: candidate.especificacion,
            registroActividadId: candidate.id,
          });
          const bestScore = scoreLegacyActivityCompleteness({
            description: sourceReport.descripcion,
            especificacion: best.especificacion,
            registroActividadId: best.id,
          });

          if (candidateScore !== bestScore) {
            return candidateScore > bestScore ? candidate : best;
          }

          return isNewerActivityCandidate(best.fecha_creacion, candidate.fecha_creacion, best.id, candidate.id)
            ? candidate
            : best;
        }, legacyRegistro);
      }
    }

    const participantResults = participants.map((participant: { id: string; tecnico_id: string; costo_actividad?: number | string | null; periodo_id?: string | null }) => {
      const currentValue = Number(participant.costo_actividad) || 0;
      const participantOverride = resolveSharedParticipantOverride(normalizedParticipantOverrides, {
        reportId: participant.id,
        tecnicoId: participant.tecnico_id,
      });
      const percentage = participantOverride
        ? Number(participantOverride.percentage ?? 0) || 0
        : currentTotal > 0
          ? Number(((currentValue / currentTotal) * 100).toFixed(2))
          : Number((100 / participantsCount).toFixed(2));
      const nextTechnicalValue = participantOverride?.valorGanado
        ?? calculateGroupParticipantValue(normalizedBaseValue, percentage);

      return {
        participant,
        participantOverride,
        percentage,
        nextTechnicalValue,
      };
    });

    await Promise.all(
      participantResults.map(async ({ participant, participantOverride, percentage, nextTechnicalValue }) => {

        const { error: reportUpdateError } = await supabase
          .from("reportes_actividad")
          .update({
            costo_actividad: nextTechnicalValue,
            valor_modificado: true,
            motivo_modificacion_valor: ADMIN_VALUE_OVERRIDE_REASON,
          })
          .eq("id", participant.id);
        if (reportUpdateError) throw reportUpdateError;

        await syncGroupedActivityApprovalValue({
          tecnicoId: participant.tecnico_id,
          fecha: sourceReport.fecha,
          valor: nextTechnicalValue,
          referenceIds: [participant.id],
        });

        await syncGroupedActivityLiquidationValue({
          tecnicoId: participant.tecnico_id,
          fecha: sourceReport.fecha,
          valorBase: normalizedBaseValue,
          valorGanado: nextTechnicalValue,
          porcentaje: percentage,
          periodoId: participantOverride?.periodoId || participant.periodo_id || sourceReport.periodo_id,
          referenceIds: [participant.id],
        });
      })
    );

    if (legacyRegistro) {
      const normalizedOriginalBase = Number(legacyRegistro.valor_actividad_base ?? 0) || 0;

      const { error: registroUpdateError } = await supabase
        .from("registros_actividades")
        .update({
          valor_actividad_aplicado: normalizedBaseValue,
          valor_modificado: normalizedBaseValue !== normalizedOriginalBase,
          motivo_modificacion_valor: normalizedBaseValue !== normalizedOriginalBase ? ADMIN_VALUE_OVERRIDE_REASON : null,
        })
        .eq("id", legacyRegistro.id);
      if (registroUpdateError) throw registroUpdateError;

      await Promise.all(
        participantResults.map(async ({ participant, percentage, nextTechnicalValue }) => {
          const { error: participantUpdateError } = await supabase
            .from("actividad_participantes")
            .update({
              porcentaje: percentage,
              valor_calculado: nextTechnicalValue,
            })
            .eq("registro_actividad_id", legacyRegistro.id)
            .eq("tecnico_id", participant.tecnico_id);
          if (participantUpdateError) throw participantUpdateError;
        })
      );
    }

    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    invalidateCachedValue("liquidacion:entries");
    return;
  }

  const { data: registro, error: registroError } = await supabase
    .from("registros_actividades")
    .select("id, fecha, grupo_id, cliente_id, periodo_id, valor_actividad_base")
    .eq("id", registroId)
    .maybeSingle();
  if (registroError || !registro) throw registroError || new Error(`No se encontró el registro de actividad grupal: ${registroId}`);

  let sourceReportDescription: string | null = null;

  if (options?.sourceReportId && !options.sourceReportId.startsWith("reg-")) {
    const { data: sourceReport, error: sourceReportError } = await supabase
      .from("reportes_actividad")
      .select("descripcion")
      .eq("id", options.sourceReportId)
      .maybeSingle();
    if (sourceReportError) throw sourceReportError;

    sourceReportDescription = sourceReport?.descripcion || null;
  }

  const { data: participantes, error: participantesError } = await supabase
    .from("actividad_participantes")
    .select("tecnico_id, porcentaje")
    .eq("registro_actividad_id", registroId);
  if (participantesError) throw participantesError;

  const participantIds = (participantes || []).map((participante: { tecnico_id: string }) => participante.tecnico_id).filter(Boolean);

  let mirroredReportsQuery = supabase
    .from("reportes_actividad")
    .select("id, tecnico_id, periodo_id")
    .in("tipo", ["actividad", "actividad_grupal"])
    .eq("fecha", registro.fecha)
    .eq("grupo_id", registro.grupo_id);

  if (registro.cliente_id) {
    mirroredReportsQuery = mirroredReportsQuery.eq("cliente_id", registro.cliente_id);
  } else {
    mirroredReportsQuery = mirroredReportsQuery.is("cliente_id", null);
  }

  if (participantIds.length > 0) {
    mirroredReportsQuery = mirroredReportsQuery.in("tecnico_id", participantIds);
  }

  if (sourceReportDescription) {
    mirroredReportsQuery = mirroredReportsQuery.eq("descripcion", sourceReportDescription);
  }

  const { data: mirroredReports, error: mirroredReportsError } = await mirroredReportsQuery;
  if (mirroredReportsError) throw mirroredReportsError;

  const normalizedOriginalBase = Number(registro?.valor_actividad_base ?? 0) || 0;

  const { error: registroUpdateError } = await supabase
    .from("registros_actividades")
    .update({
      valor_actividad_aplicado: normalizedBaseValue,
      valor_modificado: normalizedBaseValue !== normalizedOriginalBase,
      motivo_modificacion_valor: normalizedBaseValue !== normalizedOriginalBase ? ADMIN_VALUE_OVERRIDE_REASON : null,
    })
    .eq("id", registroId);
  if (registroUpdateError) throw registroUpdateError;

  await Promise.all(
    (participantes || []).map(async (participante: { tecnico_id: string; porcentaje?: number | string | null }) => {
      const participantOverride = resolveSharedParticipantOverride(normalizedParticipantOverrides, {
        tecnicoId: participante.tecnico_id,
      });
      const porcentaje = participantOverride
        ? Number(participantOverride.percentage ?? 0) || 0
        : Number(participante.porcentaje ?? 0) || 0;
      const valorCalculado = participantOverride?.valorGanado
        ?? calculateGroupParticipantValue(normalizedBaseValue, porcentaje);

      const { error } = await supabase
        .from("actividad_participantes")
        .update({ porcentaje, valor_calculado: valorCalculado })
        .eq("registro_actividad_id", registroId)
        .eq("tecnico_id", participante.tecnico_id);
      if (error) throw error;

      const mirroredReportsForParticipant = (mirroredReports || [])
        .filter((report: { id: string; tecnico_id: string; periodo_id?: string | null }) => report.tecnico_id === participante.tecnico_id);
      const mirroredReportIds = mirroredReportsForParticipant.map((report: { id: string }) => report.id);
      const participantPeriodoId = participantOverride?.periodoId || mirroredReportsForParticipant[0]?.periodo_id || registro.periodo_id;

      if (mirroredReportIds.length > 0) {
        const { error: mirroredUpdateError } = await supabase
          .from("reportes_actividad")
          .update({
            costo_actividad: valorCalculado,
            valor_modificado: normalizedBaseValue !== normalizedOriginalBase,
            motivo_modificacion_valor: normalizedBaseValue !== normalizedOriginalBase ? ADMIN_VALUE_OVERRIDE_REASON : null,
          })
          .in("id", mirroredReportIds);
        if (mirroredUpdateError) throw mirroredUpdateError;
      }

      await syncGroupedActivityApprovalValue({
        tecnicoId: participante.tecnico_id,
        fecha: registro.fecha,
        valor: valorCalculado,
        referenceIds: [registroId, ...mirroredReportIds],
      });

      await syncGroupedActivityLiquidationValue({
        tecnicoId: participante.tecnico_id,
        fecha: registro.fecha,
        valorBase: normalizedBaseValue,
        valorGanado: valorCalculado,
        porcentaje,
        periodoId: participantPeriodoId,
        referenceIds: [registroId, ...mirroredReportIds],
      });
    })
  );

  invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
  invalidateCachedValue("liquidacion:entries");
}

export async function updateEstadoAprobacion(id: string, estado: "pendiente" | "aprobado" | "rechazado"): Promise<void> {
  // IDs que empiezan con "reg-" son actividades grupales del líder (registros_actividades)
  const legacyGroupActivity = parseLegacyGroupActivityReportId(id);
  if (legacyGroupActivity) {
    // Formato: reg-{registroId}-{tecnicoId}
    const { tecnicoId, registroId } = legacyGroupActivity;

    // Buscar fecha del registro para filtrar items_aprobacion
    const { data: registro } = await supabase
      .from("registros_actividades")
      .select("fecha")
      .eq("id", registroId)
      .single();

    if (registro) {
      const estadoDB = estado === "aprobado"
        ? "aprobada"
        : estado === "rechazado"
          ? "rechazada"
          : "pendiente";
      const { data: approvalItemsByReference, error: approvalLookupError } = await supabase
        .from("items_aprobacion")
        .select("id")
        .eq("tecnico_id", tecnicoId)
        .eq("tipo", "actividad")
        .eq("referencia_id", registroId);
      if (approvalLookupError) throw approvalLookupError;

      const approvalPayload = {
        estado: estadoDB,
        fecha_aprobacion: estado === "aprobado" ? new Date().toISOString() : null,
      };
      const approvalItemIds = (approvalItemsByReference || []).map((item: { id: string }) => item.id);
      const approvalUpdate = approvalItemIds.length > 0
        ? supabase
          .from("items_aprobacion")
          .update(approvalPayload)
          .in("id", approvalItemIds)
        : supabase
          .from("items_aprobacion")
          .update(approvalPayload)
          .eq("tecnico_id", tecnicoId)
          .eq("fecha", registro.fecha)
          .eq("tipo", "actividad");

      const { error: approvalError } = await approvalUpdate;
      if (approvalError) throw approvalError;

      // También actualizar items_liquidacion
      const estadoLiq = estado === "aprobado" ? "aprobado" : "pendiente";
      const { data: liquidationItemsByReference, error: liquidationLookupError } = await supabase
        .from("items_liquidacion")
        .select("id")
        .eq("tecnico_id", tecnicoId)
        .eq("tipo", "actividad")
        .eq("referencia_id", registroId);
      if (liquidationLookupError) throw liquidationLookupError;

      const liquidationItemIds = (liquidationItemsByReference || []).map((item: { id: string }) => item.id);
      const liquidationUpdate = liquidationItemIds.length > 0
        ? supabase
          .from("items_liquidacion")
          .update({ estado: estadoLiq })
          .in("id", liquidationItemIds)
        : supabase
          .from("items_liquidacion")
          .update({ estado: estadoLiq })
          .eq("tecnico_id", tecnicoId)
          .eq("fecha", registro.fecha)
          .eq("tipo", "actividad");

      const { error: liquidationError } = await liquidationUpdate;
      if (liquidationError) throw liquidationError;
    }
    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    return;
  }

  const { data: report, error: reportLookupError } = await supabase
    .from("reportes_actividad")
    .select("id, tipo, tecnico_id, fecha, periodo_id")
    .eq("id", id)
    .maybeSingle();
  if (reportLookupError) throw reportLookupError;
  if (!report) throw new Error(`No se encontró el reporte de actividad: ${id}`);

  const { error } = await supabase
    .from("reportes_actividad")
    .update({
      estado_aprobacion_lider: estado,
      fecha_aprobacion_lider: estado === "aprobado" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw error;

  if (report.tipo === "actividad_grupal" || report.tipo === "actividad" || report.tipo === "mantenimiento_preventivo") {
    const estadoDB = estado === "aprobado"
      ? "aprobada"
      : estado === "rechazado"
        ? "rechazada"
        : "pendiente";
    const estadoLiq = estado === "aprobado" ? "aprobado" : "pendiente";

    const { data: approvalItemsByReference, error: approvalLookupError } = await supabase
      .from("items_aprobacion")
      .select("id")
      .eq("tecnico_id", report.tecnico_id)
      .eq("tipo", "actividad")
      .eq("referencia_id", report.id);
    if (approvalLookupError) throw approvalLookupError;

    const approvalPayload = {
      estado: estadoDB,
      fecha_aprobacion: estado === "aprobado" ? new Date().toISOString() : null,
    };
    const approvalItemIds = (approvalItemsByReference || []).map((item: { id: string }) => item.id);
    const approvalUpdate = approvalItemIds.length > 0
      ? supabase
        .from("items_aprobacion")
        .update(approvalPayload)
        .in("id", approvalItemIds)
      : supabase
        .from("items_aprobacion")
        .update(approvalPayload)
        .eq("tecnico_id", report.tecnico_id)
        .eq("fecha", report.fecha)
        .eq("tipo", "actividad");

    const { error: approvalError } = await approvalUpdate;
    if (approvalError) throw approvalError;

    const { data: liquidationItemsByReference, error: liquidationLookupError } = await supabase
      .from("items_liquidacion")
      .select("id")
      .eq("tecnico_id", report.tecnico_id)
      .eq("tipo", "actividad")
      .eq("referencia_id", report.id);
    if (liquidationLookupError) throw liquidationLookupError;

    const liquidationItemIds = (liquidationItemsByReference || []).map((item: { id: string }) => item.id);
    let liquidationUpdate = liquidationItemIds.length > 0
      ? supabase
        .from("items_liquidacion")
        .update({ estado: estadoLiq })
        .in("id", liquidationItemIds)
      : supabase
        .from("items_liquidacion")
        .update({ estado: estadoLiq })
        .eq("tecnico_id", report.tecnico_id)
        .eq("fecha", report.fecha)
        .eq("tipo", "actividad");

    if (report.periodo_id) {
      liquidationUpdate = liquidationUpdate.eq("periodo_id", report.periodo_id);
    }

    const { error: liquidationError } = await liquidationUpdate;
    if (liquidationError) throw liquidationError;
  }

  invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
}

export async function markReporteActividadEmailSent(id: string, sentAt: string = new Date().toISOString()): Promise<void> {
  if (id.startsWith("reg-")) {
    const parts = id.split("-");
    const registroId = parts.slice(1, -1).join("-");

    const { error } = await supabase
      .from("registros_actividades")
      .update({
        enviado_correo: true,
        fecha_ultimo_envio_correo: sentAt,
      })
      .eq("id", registroId);
    if (error) throw error;

    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    return;
  }

  const { error } = await supabase
    .from("reportes_actividad")
    .update({
      enviado_correo: true,
      fecha_ultimo_envio_correo: sentAt,
    })
    .eq("id", id);
  if (error) throw error;

  invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
}

function mapBatch(row: LeaderApprovalBatchRow): LeaderApprovalBatch {
  return {
    id: row.id,
    liderId: row.lider_id,
    grupoId: row.grupo_id,
    periodoId: row.periodo_id,
    reportesAprobados: row.reportes_aprobados || [],
    fechaCierre: row.fecha_cierre?.split("T")[0] || "",
    costoLiderPorRevision: Number(row.costo_lider_por_revision ?? 0) || 0,
    totalRevisiones: row.total_revisiones || 0,
    totalCostoLider: Number(row.total_costo_lider ?? 0) || 0,
  };
}

export async function getLotesAprobacion(): Promise<LeaderApprovalBatch[]> {
  return getCachedValue(LOTES_APROBACION_CACHE_KEY, LOTES_APROBACION_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("lotes_aprobacion_lider")
      .select("*")
      .order("fecha_cierre", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapBatch);
  });
}

function mapAccumulation(row: LeaderAccumulationRow): LeaderAccumulation {
  return {
    liderId: row.lider_id,
    periodoId: row.periodo_id,
    totalAprobadoPago: Number(row.total_aprobado_pago ?? 0) || 0,
    totalPendientePago: Number(row.total_pendiente_pago ?? 0) || 0,
    extraLider: Number(row.extra_lider ?? 0) || 0,
    totalRecorridos: Number(row.total_recorridos ?? 0) || 0,
    totalAcumulado: Number(row.total_acumulado ?? 0) || 0,
    porcentajeExtraLiderAplicado: Number(row.porcentaje_extra_lider_aplicado ?? 0) || 0,
    extraLiderActivo: row.extra_lider_activo ?? true,
    tecnicosExcluidosExtraIds: row.tecnicos_excluidos_extra_ids || undefined,
  };
}

export async function getAcumulacionesLider(): Promise<LeaderAccumulation[]> {
  return getCachedValue(ACUMULACIONES_LIDER_CACHE_KEY, ACUMULACIONES_LIDER_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("acumulacion_lideres")
      .select("*")
      .order("lider_id");
    if (error) throw error;
    return (data || []).map(mapAccumulation);
  });
}

export async function upsertConfiguracionExtraLider(
  liderId: string,
  periodoId: string,
  settings: {
    porcentajeExtraLiderAplicado: number;
    extraLiderActivo: boolean;
    tecnicosExcluidosExtraIds?: string[];
  }
): Promise<LeaderAccumulation> {
  const { data: existing, error: existingError } = await supabase
    .from("acumulacion_lideres")
    .select("*")
    .eq("lider_id", liderId)
    .eq("periodo_id", periodoId)
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  const payload = {
    porcentaje_extra_lider_aplicado: settings.porcentajeExtraLiderAplicado,
    extra_lider_activo: settings.extraLiderActivo,
    fecha_actualizacion: new Date().toISOString(),
    ...(settings.tecnicosExcluidosExtraIds !== undefined
      ? {
        tecnicos_excluidos_extra_ids: settings.tecnicosExcluidosExtraIds.length
          ? settings.tecnicosExcluidosExtraIds
          : null,
      }
      : {}),
  };

  const isMissingExcludedTechniciansColumnError = (candidate: unknown) => {
    const code = typeof candidate === "object" && candidate !== null && "code" in candidate
      ? String((candidate as { code?: unknown }).code || "")
      : "";
    const message = typeof candidate === "object" && candidate !== null && "message" in candidate
      ? String((candidate as { message?: unknown }).message || "")
      : "";

    return code === "PGRST204" && message.includes("tecnicos_excluidos_extra_ids");
  };

  const missingColumnError = new Error(
    "La base de datos no tiene la columna tecnicos_excluidos_extra_ids en acumulacion_lideres. Ejecuta la migracion supabase/migration_acumulacion_lider_tecnico_excluido.sql y vuelve a intentar."
  );

  if (existing) {
    const { data, error } = await supabase
      .from("acumulacion_lideres")
      .update(payload)
      .eq("lider_id", liderId)
      .eq("periodo_id", periodoId)
      .select("*")
      .limit(1)
      .single();
    if (error) {
      if (settings.tecnicosExcluidosExtraIds !== undefined && isMissingExcludedTechniciansColumnError(error)) {
        throw missingColumnError;
      }
      throw error;
    }
    invalidateCachedValue(ACUMULACIONES_LIDER_CACHE_KEY);
    return mapAccumulation(data);
  }

  const { data, error } = await supabase
    .from("acumulacion_lideres")
    .insert({
      lider_id: liderId,
      periodo_id: periodoId,
      total_aprobado_pago: 0,
      total_pendiente_pago: 0,
      extra_lider: 0,
      total_recorridos: 0,
      total_acumulado: 0,
      ...payload,
    })
    .select("*")
    .single();
  if (error) {
    if (settings.tecnicosExcluidosExtraIds !== undefined && isMissingExcludedTechniciansColumnError(error)) {
      throw missingColumnError;
    }
    throw error;
  }
  invalidateCachedValue(ACUMULACIONES_LIDER_CACHE_KEY);
  return mapAccumulation(data);
}

export async function deleteReporteActividadAdmin(id: string): Promise<void> {
  // Actividades grupales del líder tienen IDs con formato reg-{registroId}-{tecnicoId}
  if (id.startsWith("reg-")) {
    const parts = id.split("-");
    const tecnicoId = parts[parts.length - 1];
    const registroId = parts.slice(1, -1).join("-");

    const { data: registro } = await supabase
      .from("registros_actividades")
      .select("id, fecha, grupo_id, cliente_id")
      .eq("id", registroId)
      .single();

    if (registro) {
      // Eliminar items_liquidacion del técnico para esta fecha
      await supabase
        .from("items_liquidacion")
        .delete()
        .eq("tecnico_id", tecnicoId)
        .eq("fecha", registro.fecha)
        .eq("tipo", "actividad");

      // Eliminar items_aprobacion del técnico para esta fecha
      await supabase
        .from("items_aprobacion")
        .delete()
        .eq("tecnico_id", tecnicoId)
        .eq("fecha", registro.fecha)
        .eq("tipo", "actividad");

      // Eliminar participante específico
      const { error: deletePartError } = await supabase
        .from("actividad_participantes")
        .delete()
        .eq("registro_actividad_id", registroId)
        .eq("tecnico_id", tecnicoId);
      if (deletePartError) throw deletePartError;

      // Si no quedan más participantes, eliminar el registro completo
      const { data: remaining } = await supabase
        .from("actividad_participantes")
        .select("id")
        .eq("registro_actividad_id", registroId);

      if (!remaining || remaining.length === 0) {
        await supabase
          .from("registros_actividades")
          .delete()
          .eq("id", registroId);
      }
    }
    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    return;
  }

  const { data: report, error: reportError } = await supabase
    .from("reportes_actividad")
    .select("id, tipo, tecnico_id, grupo_id, cliente_id, periodo_id, fecha, punto_partida, punto_llegada, mantenimiento_id")
    .eq("id", id)
    .single();

  if (reportError) throw reportError;

  const { error: fotosError } = await supabase
    .from("reporte_actividad_fotos")
    .delete()
    .eq("reporte_actividad_id", id);
  if (fotosError) throw fotosError;

  const legacyTipo = report?.tipo === "visita_tecnica"
    ? "visita_tecnica"
    : report?.tipo === "recorrido"
      ? "recorrido"
      : "actividad";

  const approvalTipo = report?.tipo === "visita_tecnica"
    ? "visita_tecnica"
    : report?.tipo === "mantenimiento_preventivo"
      ? "actividad"
      : null;

  if (report) {
    const maintenanceRelatedReports = report.tipo === "mantenimiento_preventivo" && report.mantenimiento_id
      ? await supabase
        .from("reportes_actividad")
        .select("id")
        .eq("tipo", "mantenimiento_preventivo")
        .eq("mantenimiento_id", report.mantenimiento_id)
      : { data: [], error: null };
    if (maintenanceRelatedReports.error) throw maintenanceRelatedReports.error;
    const maintenanceReportIds = report.tipo === "mantenimiento_preventivo"
      ? Array.from(new Set(([report.id, ...((maintenanceRelatedReports.data || []).map((item: { id: string }) => item.id))]).filter(Boolean)))
      : [id];

    // Limpieza de tabla usada por la app para liquidación individual
    await supabase
      .from("items_liquidacion")
      .delete()
      .or(maintenanceReportIds.map((reportId) => `referencia_id.eq.${reportId}`).concat(`and(tecnico_id.eq.${report.tecnico_id},periodo_id.eq.${report.periodo_id},fecha.eq.${report.fecha},tipo.eq.${legacyTipo})`).join(","));

    // Limpieza de cola/aprobación para evitar que la actividad siga apareciendo en app
    let approvalDelete = supabase
      .from("items_aprobacion")
      .delete()
      .or(maintenanceReportIds.map((reportId) => `referencia_id.eq.${reportId}`).concat(`and(tecnico_id.eq.${report.tecnico_id},fecha.eq.${report.fecha})`).join(","));

    if (approvalTipo) {
      approvalDelete = approvalDelete.eq("tipo", approvalTipo);
    }

    await approvalDelete;

    // Limpieza legacy de registros_actividades y actividad_participantes
    let registrosBaseQuery = supabase
      .from("registros_actividades")
      .select("id")
      .eq("fecha", report.fecha)
      .eq("grupo_id", report.grupo_id);

    if (report.cliente_id) {
      registrosBaseQuery = registrosBaseQuery.eq("cliente_id", report.cliente_id);
    }

    const { data: registrosByDateGroup } = await registrosBaseQuery;
    const candidateRegistroIds = (registrosByDateGroup || []).map((row: RegistroBaseRow) => row.id);

    if (candidateRegistroIds.length > 0) {
      const { data: participantesRelacionados } = await supabase
        .from("actividad_participantes")
        .select("registro_actividad_id, tecnico_id")
        .in("registro_actividad_id", candidateRegistroIds);

      const registroIdsToDelete = Array.from(
        new Set(
          (participantesRelacionados || [])
            .filter((row: ParticipanteRelacionRow) => row.tecnico_id === report.tecnico_id)
            .map((row: ParticipanteRelacionRow) => row.registro_actividad_id)
            .filter(Boolean)
        )
      );

      if (registroIdsToDelete.length > 0) {
        const { error: deleteParticipantesError } = await supabase
          .from("actividad_participantes")
          .delete()
          .in("registro_actividad_id", registroIdsToDelete);
        if (deleteParticipantesError) throw deleteParticipantesError;

        const { error: deleteRegistrosError } = await supabase
          .from("registros_actividades")
          .delete()
          .in("id", registroIdsToDelete);
        if (deleteRegistrosError) throw deleteRegistrosError;
      }
    }
  }

  if (report?.tipo === "recorrido") {
    const recorridoDelete = supabase
      .from("recorridos")
      .delete()
      .eq("tecnico_id", report.tecnico_id)
      .eq("fecha", report.fecha);

    await recorridoDelete;
  }

  if (report?.tipo === "mantenimiento_preventivo") {
    if (report.mantenimiento_id) {
      const { error: deleteMirrorReportsError } = await supabase
        .from("reportes_actividad")
        .delete()
        .eq("tipo", "mantenimiento_preventivo")
        .eq("mantenimiento_id", report.mantenimiento_id);
      if (deleteMirrorReportsError) throw deleteMirrorReportsError;
      invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
      invalidateCachedValue(ACUMULACIONES_LIDER_CACHE_KEY);
      invalidateCachedValue("mantenimientos:reportes");
      return;
    }
  }

  const { error: deleteError } = await supabase
    .from("reportes_actividad")
    .delete()
    .eq("id", id);
  if (deleteError) throw deleteError;

  invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
  invalidateCachedValue(ACUMULACIONES_LIDER_CACHE_KEY);
  invalidateCachedValue("mantenimientos:reportes");
}
