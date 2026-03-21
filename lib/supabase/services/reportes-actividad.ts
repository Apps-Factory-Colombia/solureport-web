import { supabase } from "../client";
import { ActivityReport, LeaderApprovalBatch, LeaderAccumulation } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const REPORTES_ACTIVIDAD_CACHE_KEY = "reportes-actividad:list";
const REPORTES_ACTIVIDAD_CACHE_TTL = 20_000;
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
  costo_actividad?: number | string | null;
  costo_administrable?: boolean | null;
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
  periodo_id?: string | null;
  fecha_creacion?: string | null;
}

interface ActividadParticipanteRow {
  registro_actividad_id: string;
  tecnico_id: string;
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
    costoActividad: Number(row.costo_actividad ?? 0) || 0,
    costoAdministrable: row.costo_administrable || false,
    periodoId: row.periodo_id,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

async function getRegistrosComoReports(): Promise<ActivityReport[]> {
  const [{ data: registros }, { data: allParticipantes }, { data: actividades }, { data: periodos }, { data: approvalItems }] = await Promise.all([
    supabase.from("registros_actividades").select("*").order("fecha", { ascending: false }),
    supabase.from("actividad_participantes").select("*"),
    supabase.from("actividades").select("id, codigo, nombre, valor_economico"),
    supabase.from("periodos_liquidacion").select("*").order("fecha_inicio", { ascending: false }),
    supabase.from("items_aprobacion").select("*"),
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
    (approvalItems || [])
      .filter((item: ItemAprobacionRow) => item.tipo === "actividad")
      .map((item: ItemAprobacionRow) => [`${item.tecnico_id}|${item.fecha}`, item])
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

      reports.push({
        id: `reg-${reg.id}-${part.tecnico_id}`,
        tipo: "actividad_grupal",
        tecnicoId: part.tecnico_id,
        liderGrupoId: reg.lider_id,
        grupoId: reg.grupo_id,
        fecha: reg.fecha,
        clienteId: reg.cliente_id || undefined,
        descripcion: act ? `${act.codigo} — ${act.nombre}` : reg.cliente_nombre || "Actividad grupal",
        especificacion: reg.especificacion || undefined,
        estadoAprobacionLider: estadoAprobacion,
        fechaAprobacionLider: approval?.fecha_aprobacion?.split("T")[0] || undefined,
        costoActividad: Number(part.valor_calculado ?? 0) || 0,
        costoAdministrable: false,
        periodoId,
        fechaCreacion: reg.fecha_creacion?.split("T")[0] || "",
      });
    }
  }
  return reports;
}

export async function getReportesActividad(): Promise<ActivityReport[]> {
  return getCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY, REPORTES_ACTIVIDAD_CACHE_TTL, async () => {
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

    const fotosByReporte = new Map<string, Array<{ tipo: string; url: string }>>();
    for (const foto of (fotosData || []) as ReporteActividadFotoRow[]) {
      const reporteId = foto.reporte_actividad_id;
      if (!reporteId) continue;
      const current = fotosByReporte.get(reporteId) || [];
      current.push({ tipo: foto.tipo, url: foto.url });
      fotosByReporte.set(reporteId, current);
    }

    const reports: ActivityReport[] = [];
    for (const row of data || []) {
      const fotos = fotosByReporte.get(row.id) || [];
      const fotosAntes = fotos.filter((f) => f.tipo === "antes").map((f) => f.url);
      const fotosDespues = fotos.filter((f) => f.tipo === "despues").map((f) => f.url);
      reports.push(mapReport(row, fotosAntes, fotosDespues));
    }

    try {
      const registroReports = await getRegistrosComoReports();
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
  if (id.startsWith("reg-")) {
    const parts = id.split("-");
    const tecnicoId = parts[parts.length - 1];
    const registroId = parts.slice(1, -1).join("-");

    const { error } = await supabase
      .from("actividad_participantes")
      .update({ valor_calculado: costoActividad })
      .eq("registro_actividad_id", registroId)
      .eq("tecnico_id", tecnicoId);
    if (error) throw error;
    invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
    return;
  }

  const { error } = await supabase
    .from("reportes_actividad")
    .update({ costo_actividad: costoActividad })
    .eq("id", id);
  if (error) throw error;
  invalidateCachedValue(REPORTES_ACTIVIDAD_CACHE_KEY);
}

export async function updateEstadoAprobacion(id: string, estado: "aprobado" | "rechazado"): Promise<void> {
  // IDs que empiezan con "reg-" son actividades grupales del líder (registros_actividades)
  if (id.startsWith("reg-")) {
    // Formato: reg-{registroId}-{tecnicoId}
    const parts = id.split("-");
    const tecnicoId = parts[parts.length - 1];
    const registroId = parts.slice(1, -1).join("-");

    // Buscar fecha del registro para filtrar items_aprobacion
    const { data: registro } = await supabase
      .from("registros_actividades")
      .select("fecha")
      .eq("id", registroId)
      .single();

    if (registro) {
      const estadoDB = estado === "aprobado" ? "aprobada" : "rechazada";
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
  const { data, error } = await supabase
    .from("lotes_aprobacion_lider")
    .select("*")
    .order("fecha_cierre", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapBatch);
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
