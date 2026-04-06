import { supabase } from "../client";
import { ActivityReport, LeaderApprovalBatch, LeaderAccumulation } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";
import { getConfiguracion } from "./configuracion";

const REPORTES_ACTIVIDAD_CACHE_KEY = "reportes-actividad:list";
const REPORTES_ACTIVIDAD_CACHE_TTL = 60_000;
const LOTES_APROBACION_CACHE_KEY = "lotes-aprobacion:list";
const LOTES_APROBACION_CACHE_TTL = 20_000;
const ACUMULACIONES_LIDER_CACHE_KEY = "acumulaciones-lider:list";
const ACUMULACIONES_LIDER_CACHE_TTL = 20_000;

interface ReporteActividadRow {
  id: string;
  tipo: string;
  tecnico_id: string;
  lider_grupo_id: string;
  grupo_id: string;
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
  tecnico_id: string;
  fecha: string;
  tipo: string;
  estado?: string | null;
  fecha_aprobacion?: string | null;
}

interface ReporteActividadFotoRow {
  reporte_actividad_id: string;
  tipo: string;
  url: string;
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
  strict: Map<string, ActivityReport>;
  fallback: Map<string, ActivityReport>;
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
  valor_modificado?: boolean | null;
  motivo_modificacion_valor?: string | null;
  valor_cobrado_cliente?: number | string | null;
}

interface VisitMirrorMaps {
  strict: Map<string, VisitMirrorRow>;
  fallback: Map<string, VisitMirrorRow>;
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

function buildLegacyActivityMirrorKey(params: {
  tecnicoId: string;
  fecha: string;
  grupoId?: string | null;
  clienteId?: string | null;
}) {
  return [params.tecnicoId, params.fecha, params.grupoId || "", params.clienteId || ""].join("|");
}

function buildLegacyActivityFallbackKey(params: {
  tecnicoId: string;
  fecha: string;
  grupoId?: string | null;
}) {
  return [params.tecnicoId, params.fecha, params.grupoId || ""].join("|");
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
  });
  const fallbackKey = buildLegacyActivityFallbackKey({
    tecnicoId: report.tecnicoId,
    fecha: report.fecha,
    grupoId: report.grupoId,
  });

  const mirror = mirrors.strict.get(strictKey) || mirrors.fallback.get(fallbackKey);

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
    costoActividadDefault: relatedReport.costoActividadDefault || report.costoActividadDefault,
    costoActividad: relatedReport.costoActividad || report.costoActividad,
    valorActividadBaseGlobal: relatedReport.valorActividadBaseGlobal ?? report.valorActividadBaseGlobal,
    valorActividadAplicadoGlobal: relatedReport.valorActividadAplicadoGlobal ?? report.valorActividadAplicadoGlobal,
    valorModificado: report.valorModificado || relatedReport.valorModificado,
    motivoModificacionValor: report.motivoModificacionValor || relatedReport.motivoModificacionValor,
  };
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
  const mirrorReportedCost = Number(mirror.valor_cobrado_cliente ?? 0) || 0;
  const hasMirrorVisitId = !report.visitaTecnicaId && !!mirror.id;
  const shouldUseMirrorClientCost = mirror.costo_cliente != null && report.costoCliente !== (Number(mirror.costo_cliente) || 0);
  const shouldUseMirrorDefault = !report.costoActividadDefault && mirrorDefaultCost > 0;
  const shouldUseMirrorReason = !report.motivoModificacionValor && !!mirror.motivo_modificacion_valor;
  const shouldUseMirrorModifiedFlag = !report.valorModificado && !!mirror.valor_modificado;
  const shouldUseMirrorReportedCost = report.costoActividad <= 0 && mirrorReportedCost > 0;

  if (!hasMirrorVisitId && !shouldUseMirrorClientCost && !shouldUseMirrorDefault && !shouldUseMirrorReason && !shouldUseMirrorModifiedFlag && !shouldUseMirrorReportedCost) {
    return report;
  }

  return {
    ...report,
    visitaTecnicaId: report.visitaTecnicaId || mirror.id,
    tipoVisita: report.tipoVisita || mirror.tipo_visita || undefined,
    costoCliente: mirror.costo_cliente == null ? (report.costoCliente ?? 0) : Number(mirror.costo_cliente) || 0,
    costoActividadDefault: shouldUseMirrorDefault ? mirrorDefaultCost : report.costoActividadDefault,
    valorModificado: shouldUseMirrorModifiedFlag ? true : report.valorModificado,
    motivoModificacionValor: shouldUseMirrorReason ? mirror.motivo_modificacion_valor || undefined : report.motivoModificacionValor,
    costoActividad: shouldUseMirrorReportedCost ? mirrorReportedCost : report.costoActividad,
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

  const { error: updateError } = await supabase
    .from("visitas_tecnicas")
    .update({ costo_cliente: normalizedCostoCliente })
    .in("id", visitIds);
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
  const orFilters = [
    `referencia_id.eq.${params.reportId}`,
    ...(params.visitIds || []).map((visitId) => `referencia_id.eq.${visitId}`),
    params.periodoId
      ? `and(tecnico_id.eq.${params.tecnicoId},periodo_id.eq.${params.periodoId},fecha.eq.${params.fecha},tipo.eq.visita_tecnica)`
      : `and(tecnico_id.eq.${params.tecnicoId},fecha.eq.${params.fecha},tipo.eq.visita_tecnica)`,
  ];

  const { data: liquidationItems, error: liquidationLookupError } = await supabase
    .from("items_liquidacion")
    .select("id, porcentaje")
    .or(orFilters.join(","));
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

async function syncVisitCostFromApprovalReport(reportId: string, costoActividad: number): Promise<void> {
  const { data: report, error: reportError } = await supabase
    .from("reportes_actividad")
    .select("id, tipo, tecnico_id, cliente_id, fecha, descripcion, periodo_id")
    .eq("id", reportId)
    .single();
  if (reportError) throw reportError;

  if (report?.tipo !== "visita_tecnica") return;

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

  if (visitIds.length > 0) {
    const { error: visitsUpdateError } = await supabase
      .from("visitas_tecnicas")
      .update({ valor_cobrado_cliente: costoActividad })
      .in("id", visitIds);
    if (visitsUpdateError) throw visitsUpdateError;

    const { error: approvalUpdateError } = await supabase
      .from("items_aprobacion")
      .update({ valor: costoActividad })
      .eq("tipo", "visita_tecnica")
      .in("referencia_id", visitIds);
    if (approvalUpdateError) throw approvalUpdateError;

    await syncVisitLiquidationFromReport({
      reportId,
      tecnicoId: report.tecnico_id,
      fecha: report.fecha,
      periodoId: report.periodo_id,
      costoActividad,
      visitIds,
    });
  } else {
    const { error: approvalUpdateError } = await supabase
      .from("items_aprobacion")
      .update({ valor: costoActividad })
      .eq("tipo", "visita_tecnica")
      .eq("tecnico_id", report.tecnico_id)
      .eq("fecha", report.fecha);
    if (approvalUpdateError) throw approvalUpdateError;

    await syncVisitLiquidationFromReport({
      reportId,
      tecnicoId: report.tecnico_id,
      fecha: report.fecha,
      periodoId: report.periodo_id,
      costoActividad,
      visitIds: [],
    });
  }

  invalidateCachedValue("visitas:list");
}

async function getRegistrosComoReports(mirrors?: LegacyActivityMirrorMaps): Promise<ActivityReport[]> {
  const [{ data: registros }, { data: allParticipantes }, { data: actividades }, { data: periodos }, { data: approvalItems }] = await Promise.all([
    supabase.from("registros_actividades").select("id, actividad_id, lider_id, grupo_id, fecha, cliente_id, cliente_nombre, especificacion, valor_actividad_base, valor_actividad_aplicado, valor_modificado, motivo_modificacion_valor, enviado_correo, fecha_ultimo_envio_correo, fecha_creacion").order("fecha", { ascending: false }),
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

  const reports: ActivityReport[] = [];
  for (const reg of (registros || []) as RegistroActividadRow[]) {
    const parts = participantesByRegistro.get(reg.id) || [];
    if (parts.length === 0) continue;

    const act = reg.actividad_id ? actividadesById.get(reg.actividad_id) : undefined;
    const periodoId = reg.periodo_id || findPeriodo(reg.fecha);

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
  return reports;
}

export async function getReportesActividad(): Promise<ActivityReport[]> {
  return getCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY, REPORTES_ACTIVIDAD_CACHE_TTL, async () => {
    const companySettingsPromise = getConfiguracion();
    const { data, error } = await supabase
      .from("reportes_actividad")
      .select("*")
      .order("fecha", { ascending: false });
    if (error) throw error;

    const reportIds = (data || []).map((row: ReporteActividadRow) => row.id);
    const { data: fotosData, error: fotosError } = reportIds.length > 0
      ? await supabase
        .from("reporte_actividad_fotos")
        .select("reporte_actividad_id, tipo, url, orden")
        .in("reporte_actividad_id", reportIds)
        .order("orden")
      : { data: [], error: null };

    if (fotosError) throw fotosError;

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

    const companySettings = await companySettingsPromise;

    const visitMirrors: VisitMirrorMaps = {
      strict: new Map<string, VisitMirrorRow>(),
      fallback: new Map<string, VisitMirrorRow>(),
    };

    const recorridoMirrors: RecorridoMirrorMaps = {
      strict: new Map<string, RecorridoMirrorRow>(),
      fallback: new Map<string, RecorridoMirrorRow>(),
    };

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
      strict: new Map<string, ActivityReport>(),
      fallback: new Map<string, ActivityReport>(),
    };

    for (const row of data || []) {
      const fotos = fotosByReporte.get(row.id) || [];
      const fotosAntes = fotos.filter((f) => f.tipo === "antes").map((f) => f.url);
      const fotosDespues = fotos.filter((f) => f.tipo === "despues").map((f) => f.url);
      const mappedReport = enrichRecorridoReport(
        enrichVisitReport(mapReport(row, fotosAntes, fotosDespues), visitMirrors),
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
        });
        const fallbackKey = buildLegacyActivityFallbackKey({
          tecnicoId: mappedReport.tecnicoId,
          fecha: mappedReport.fecha,
          grupoId: mappedReport.grupoId,
        });

        if (!legacyActivityMirrors.strict.has(strictKey)) {
          legacyActivityMirrors.strict.set(strictKey, mappedReport);
        }

        if (!legacyActivityMirrors.fallback.has(fallbackKey)) {
          legacyActivityMirrors.fallback.set(fallbackKey, mappedReport);
        }
      }

      reports.push(mappedReport);
    }

    try {
      const registroReports = await getRegistrosComoReports(legacyActivityMirrors);
      const registroReportsByStrictKey = new Map<string, ActivityReport>();
      const registroReportsByFallbackKey = new Map<string, ActivityReport>();

      for (const registroReport of registroReports) {
        const strictKey = buildLegacyActivityMirrorKey({
          tecnicoId: registroReport.tecnicoId,
          fecha: registroReport.fecha,
          grupoId: registroReport.grupoId,
          clienteId: registroReport.clienteId,
        });
        const fallbackKey = buildLegacyActivityFallbackKey({
          tecnicoId: registroReport.tecnicoId,
          fecha: registroReport.fecha,
          grupoId: registroReport.grupoId,
        });

        if (!registroReportsByStrictKey.has(strictKey)) {
          registroReportsByStrictKey.set(strictKey, registroReport);
        }

        if (!registroReportsByFallbackKey.has(fallbackKey)) {
          registroReportsByFallbackKey.set(fallbackKey, registroReport);
        }
      }

      for (let index = 0; index < reports.length; index += 1) {
        const report = reports[index];
        if (report.tipo !== "actividad_grupal") continue;

        const strictKey = buildLegacyActivityMirrorKey({
          tecnicoId: report.tecnicoId,
          fecha: report.fecha,
          grupoId: report.grupoId,
          clienteId: report.clienteId,
        });
        const fallbackKey = buildLegacyActivityFallbackKey({
          tecnicoId: report.tecnicoId,
          fecha: report.fecha,
          grupoId: report.grupoId,
        });
        const relatedReport = registroReportsByStrictKey.get(strictKey) || registroReportsByFallbackKey.get(fallbackKey);

        if (relatedReport) {
          reports[index] = mergeGroupActivityMetadata(report, relatedReport);
        }
      }

      const existingKeys = new Set(
        reports.map((r) => `${r.tecnicoId}|${r.fecha}|${r.clienteId || ""}`)
      );
      for (const rr of registroReports) {
        const key = `${rr.tecnicoId}|${rr.fecha}|${rr.clienteId || ""}`;
        if (!existingKeys.has(key)) {
          reports.push(rr);
          existingKeys.add(key);
        }
      }
    } catch (err) {
      console.error("Error cargando registros_actividades como reportes:", err);
    }

    reports.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return reports;
  });
}

export async function updateCostoActividadAdmin(id: string, costoActividad: number): Promise<void> {
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
    .select("id, tipo, tecnico_id, fecha, punto_partida, punto_llegada, tipo_recorrido, periodo_id")
    .eq("id", id)
    .single();
  if (reportLookupError) throw reportLookupError;

  const { error } = await supabase
    .from("reportes_actividad")
    .update({
      costo_actividad: costoActividad,
      valor_modificado: report?.tipo === "recorrido" ? true : undefined,
    })
    .eq("id", id);
  if (error) throw error;

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

export async function updateActividadGrupalBaseAdmin(id: string, valorBase: number): Promise<void> {
  const legacyGroupActivity = parseLegacyGroupActivityReportId(id);
  const registroId = legacyGroupActivity?.registroId || id;

  const normalizedBaseValue = Math.max(0, Number(valorBase) || 0);

  const { data: registro, error: registroError } = await supabase
    .from("registros_actividades")
    .select("id, fecha, grupo_id, cliente_id, valor_actividad_base")
    .eq("id", registroId)
    .maybeSingle();

  if (registroError || !registro) {
    const { data: sourceReport, error: sourceReportError } = await supabase
      .from("reportes_actividad")
      .select("id, fecha, grupo_id, cliente_id, descripcion")
      .eq("id", id)
      .single();
    if (sourceReportError) throw sourceReportError;

    let relatedReportsQuery = supabase
      .from("reportes_actividad")
      .select("id, tecnico_id, costo_actividad")
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

    await Promise.all(
      participants.map(async (participant: { id: string; tecnico_id: string; costo_actividad?: number | string | null }) => {
        const currentValue = Number(participant.costo_actividad) || 0;
        const percentage = currentTotal > 0 ? currentValue / currentTotal : 1 / participantsCount;
        const nextTechnicalValue = Math.round(normalizedBaseValue * percentage);

        const { error: reportUpdateError } = await supabase
          .from("reportes_actividad")
          .update({
            costo_actividad: nextTechnicalValue,
            valor_modificado: true,
          })
          .eq("id", participant.id);
        if (reportUpdateError) throw reportUpdateError;

        const { error: approvalSyncError } = await supabase
          .from("items_aprobacion")
          .update({ valor: nextTechnicalValue })
          .eq("tecnico_id", participant.tecnico_id)
          .eq("fecha", sourceReport.fecha)
          .eq("tipo", "actividad");
        if (approvalSyncError) throw approvalSyncError;

        const { error: liquidationSyncError } = await supabase
          .from("items_liquidacion")
          .update({
            valor_base: normalizedBaseValue,
            valor_ganado: nextTechnicalValue,
          })
          .eq("tecnico_id", participant.tecnico_id)
          .eq("fecha", sourceReport.fecha)
          .eq("tipo", "actividad");
        if (liquidationSyncError) throw liquidationSyncError;
      })
    );

    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    invalidateCachedValue("liquidacion:entries");
    return;
  }

  const { data: participantes, error: participantesError } = await supabase
    .from("actividad_participantes")
    .select("tecnico_id, porcentaje")
    .eq("registro_actividad_id", registroId);
  if (participantesError) throw participantesError;

  const participantIds = (participantes || []).map((participante: { tecnico_id: string }) => participante.tecnico_id).filter(Boolean);

  let mirroredReportsQuery = supabase
    .from("reportes_actividad")
    .select("id, tecnico_id")
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

  const { data: mirroredReports, error: mirroredReportsError } = await mirroredReportsQuery;
  if (mirroredReportsError) throw mirroredReportsError;

  const normalizedOriginalBase = Number(registro?.valor_actividad_base ?? 0) || 0;

  const { error: registroUpdateError } = await supabase
    .from("registros_actividades")
    .update({
      valor_actividad_aplicado: normalizedBaseValue,
      valor_modificado: normalizedBaseValue !== normalizedOriginalBase,
    })
    .eq("id", registroId);
  if (registroUpdateError) throw registroUpdateError;

  await Promise.all(
    (participantes || []).map(async (participante: { tecnico_id: string; porcentaje?: number | string | null }) => {
      const porcentaje = Number(participante.porcentaje ?? 0) || 0;
      const valorCalculado = calculateGroupParticipantValue(normalizedBaseValue, porcentaje);

      const { error } = await supabase
        .from("actividad_participantes")
        .update({ valor_calculado: valorCalculado })
        .eq("registro_actividad_id", registroId)
        .eq("tecnico_id", participante.tecnico_id);
      if (error) throw error;

      const mirroredReportIds = (mirroredReports || [])
        .filter((report: { id: string; tecnico_id: string }) => report.tecnico_id === participante.tecnico_id)
        .map((report: { id: string }) => report.id);

      if (mirroredReportIds.length > 0) {
        const { error: mirroredUpdateError } = await supabase
          .from("reportes_actividad")
          .update({
            costo_actividad: valorCalculado,
            valor_modificado: normalizedBaseValue !== normalizedOriginalBase,
          })
          .in("id", mirroredReportIds);
        if (mirroredUpdateError) throw mirroredUpdateError;
      }

      const { error: approvalSyncError } = await supabase
        .from("items_aprobacion")
        .update({ valor: valorCalculado })
        .eq("tecnico_id", participante.tecnico_id)
        .eq("fecha", registro.fecha)
        .eq("tipo", "actividad");
      if (approvalSyncError) throw approvalSyncError;

      const { error: liquidationSyncError } = await supabase
        .from("items_liquidacion")
        .update({
          valor_base: normalizedBaseValue,
          valor_ganado: valorCalculado,
        })
        .eq("tecnico_id", participante.tecnico_id)
        .eq("fecha", registro.fecha)
        .eq("tipo", "actividad");
      if (liquidationSyncError) throw liquidationSyncError;
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
      const { error: approvalError } = await supabase
        .from("items_aprobacion")
        .update({
          estado: estadoDB,
          fecha_aprobacion: estado === "aprobado" ? new Date().toISOString() : null,
        })
        .eq("tecnico_id", tecnicoId)
        .eq("fecha", registro.fecha)
        .eq("tipo", "actividad");
      if (approvalError) throw approvalError;

      // También actualizar items_liquidacion
      const estadoLiq = estado === "aprobado" ? "aprobado" : "pendiente";
      await supabase
        .from("items_liquidacion")
        .update({ estado: estadoLiq })
        .eq("tecnico_id", tecnicoId)
        .eq("fecha", registro.fecha)
        .eq("tipo", "actividad");
    }
    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    return;
  }

  const { error } = await supabase
    .from("reportes_actividad")
    .update({
      estado_aprobacion_lider: estado,
      fecha_aprobacion_lider: estado === "aprobado" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw error;
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
    .select("id, tipo, tecnico_id, grupo_id, cliente_id, periodo_id, fecha, punto_partida, punto_llegada")
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
    // Limpieza de tabla usada por la app para liquidación individual
    await supabase
      .from("items_liquidacion")
      .delete()
      .or(`referencia_id.eq.${id},and(tecnico_id.eq.${report.tecnico_id},periodo_id.eq.${report.periodo_id},fecha.eq.${report.fecha},tipo.eq.${legacyTipo})`);

    // Limpieza de cola/aprobación para evitar que la actividad siga apareciendo en app
    let approvalDelete = supabase
      .from("items_aprobacion")
      .delete()
      .or(`referencia_id.eq.${id},and(tecnico_id.eq.${report.tecnico_id},fecha.eq.${report.fecha})`);

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
    const startDate = `${report.fecha}T00:00:00`;
    const endDate = `${report.fecha}T23:59:59`;
    let query = supabase
      .from("reportes_mantenimiento")
      .delete()
      .eq("tecnico_id", report.tecnico_id)
      .gte("fecha_generacion", startDate)
      .lte("fecha_generacion", endDate);

    if (report.cliente_id) {
      query = query.eq("cliente_id", report.cliente_id);
    }

    await query;
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
