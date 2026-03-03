import { supabase } from "../client";
import { ActivityReport, LeaderApprovalBatch, LeaderAccumulation } from "@/lib/types";

function mapReport(row: any, fotosAntes: string[], fotosDespues: string[]): ActivityReport {
  return {
    id: row.id,
    tipo: row.tipo,
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
    costoActividad: parseFloat(row.costo_actividad) || 0,
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

  const findPeriodo = (fecha: string) => {
    const p = (periodos || []).find(
      (per: any) => fecha >= per.fecha_inicio && fecha <= per.fecha_fin
    );
    return p?.id || "";
  };

  const reports: ActivityReport[] = [];
  for (const reg of registros || []) {
    const parts = (allParticipantes || []).filter(
      (p: any) => p.registro_actividad_id === reg.id
    );
    if (parts.length === 0) continue;

    const act = (actividades || []).find((a: any) => a.id === reg.actividad_id);
    const periodoId = reg.periodo_id || findPeriodo(reg.fecha);

    for (const part of parts) {
      const approval = (approvalItems || []).find(
        (ai: any) =>
          ai.tecnico_id === part.tecnico_id &&
          ai.fecha === reg.fecha &&
          ai.tipo === "actividad"
      );
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
        estadoAprobacionLider: estadoAprobacion,
        fechaAprobacionLider: approval?.fecha_aprobacion?.split("T")[0] || undefined,
        costoActividad: parseFloat(part.valor_calculado) || 0,
        costoAdministrable: false,
        periodoId,
        fechaCreacion: reg.fecha_creacion?.split("T")[0] || "",
      });
    }
  }
  return reports;
}

export async function getReportesActividad(): Promise<ActivityReport[]> {
  const { data, error } = await supabase
    .from("reportes_actividad")
    .select("*")
    .order("fecha", { ascending: false });
  if (error) throw error;

  const reports: ActivityReport[] = [];
  for (const row of data || []) {
    const { data: fotos } = await supabase
      .from("reporte_actividad_fotos")
      .select("*")
      .eq("reporte_actividad_id", row.id)
      .order("orden");
    const fotosAntes = (fotos || []).filter((f: any) => f.tipo === "antes").map((f: any) => f.url);
    const fotosDespues = (fotos || []).filter((f: any) => f.tipo === "despues").map((f: any) => f.url);
    reports.push(mapReport(row, fotosAntes, fotosDespues));
  }

  // Fusionar actividades grupales del líder (registros_actividades)
  try {
    const registroReports = await getRegistrosComoReports();
    // Evitar duplicados: no agregar si ya existe un reportes_actividad para mismo técnico+fecha+cliente
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

  // Re-ordenar por fecha descendente
  reports.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return reports;
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
}

function mapBatch(row: any): LeaderApprovalBatch {
  return {
    id: row.id,
    liderId: row.lider_id,
    grupoId: row.grupo_id,
    periodoId: row.periodo_id,
    reportesAprobados: row.reportes_aprobados || [],
    fechaCierre: row.fecha_cierre?.split("T")[0] || "",
    costoLiderPorRevision: parseFloat(row.costo_lider_por_revision) || 0,
    totalRevisiones: row.total_revisiones || 0,
    totalCostoLider: parseFloat(row.total_costo_lider) || 0,
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

function mapAccumulation(row: any): LeaderAccumulation {
  return {
    liderId: row.lider_id,
    periodoId: row.periodo_id,
    totalAprobadoPago: parseFloat(row.total_aprobado_pago) || 0,
    totalPendientePago: parseFloat(row.total_pendiente_pago) || 0,
    extraLider: parseFloat(row.extra_lider) || 0,
    totalRecorridos: parseFloat(row.total_recorridos) || 0,
    totalAcumulado: parseFloat(row.total_acumulado) || 0,
    porcentajeExtraLiderAplicado: parseFloat(row.porcentaje_extra_lider_aplicado) || 0,
    extraLiderActivo: row.extra_lider_activo ?? true,
  };
}

export async function getAcumulacionesLider(): Promise<LeaderAccumulation[]> {
  const { data, error } = await supabase
    .from("acumulacion_lideres")
    .select("*")
    .order("lider_id");
  if (error) throw error;
  return (data || []).map(mapAccumulation);
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
    const candidateRegistroIds = (registrosByDateGroup || []).map((row: any) => row.id);

    if (candidateRegistroIds.length > 0) {
      const { data: participantesRelacionados } = await supabase
        .from("actividad_participantes")
        .select("registro_actividad_id, tecnico_id")
        .in("registro_actividad_id", candidateRegistroIds);

      const registroIdsToDelete = Array.from(
        new Set(
          (participantesRelacionados || [])
            .filter((row: any) => row.tecnico_id === report.tecnico_id)
            .map((row: any) => row.registro_actividad_id)
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
}
