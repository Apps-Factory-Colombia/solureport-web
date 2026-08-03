import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://glnihgjgzygdfnleicqb.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_YZMbuQo0VqdWKlAHIxsLfA_uPr0eh21"
);

function normalizeText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function buildGroupKey(row) {
  return [
    row.fecha || "",
    row.grupo_id || "",
    row.cliente_id || "",
    normalizeText(row.descripcion || ""),
  ].join("|");
}

function buildVisitKey(row) {
  return [
    row.tecnico_id || "",
    row.fecha || "",
    row.cliente_id || "",
    normalizeText(row.descripcion || ""),
  ].join("|");
}

function buildVisitTableKey(row) {
  return [
    row.tecnico_id || "",
    String(row.fecha_inicio || "").split("T")[0] || "",
    row.cliente_id || "",
    normalizeText(row.descripcion || ""),
  ].join("|");
}

function reportScore(row) {
  return (row.codigo_registro ? 4 : 0)
    + (row.tipo_visita ? 2 : 0)
    + (row.visita_tecnica_id ? 2 : 0)
    + ((Number(row.costo_actividad_default ?? 0) || 0) > 0 ? 1 : 0);
}

function visitScore(row) {
  return (row.codigo_registro ? 4 : 0)
    + (row.tipo_visita ? 2 : 0)
    + ((Number(row.costo_visita_tecnica_default ?? 0) || 0) > 0 ? 1 : 0);
}

function compareByCompleteness(a, b, scorer) {
  const scoreDiff = scorer(b) - scorer(a);
  if (scoreDiff !== 0) return scoreDiff;

  const creationCompare = String(b.fecha_creacion || "").localeCompare(String(a.fecha_creacion || ""));
  if (creationCompare !== 0) return creationCompare;

  return String(b.id || "").localeCompare(String(a.id || ""));
}

function dedupeRows(rows, keyBuilder) {
  const byKey = new Map();
  for (const row of rows) {
    const key = keyBuilder(row);
    const current = byKey.get(key) || [];
    current.push(row);
    byKey.set(key, current);
  }
  return byKey;
}

async function fetchAllData() {
  const [reportsResult, visitsResult] = await Promise.all([
    supabase
      .from("reportes_actividad")
      .select("id, codigo_registro, visita_tecnica_id, tipo_visita, tecnico_id, lider_grupo_id, grupo_id, cliente_id, descripcion, fecha, costo_actividad_default, costo_actividad, periodo_id, fecha_creacion")
      .eq("tipo", "visita_tecnica")
      .order("fecha", { ascending: false }),
    supabase
      .from("visitas_tecnicas")
      .select("id, codigo_registro, tipo_visita, tecnico_id, lider_id, cliente_id, descripcion, fecha_inicio, costo_visita_tecnica_default, valor_cobrado_cliente, fecha_creacion")
      .order("fecha_inicio", { ascending: false }),
  ]);

  if (reportsResult.error) throw reportsResult.error;
  if (visitsResult.error) throw visitsResult.error;

  return {
    reports: reportsResult.data || [],
    visits: visitsResult.data || [],
  };
}

async function updateNotificationReportReferences(fromReportId, toReportId) {
  const { data, error } = await supabase
    .from("notificaciones")
    .select("id, metadata")
    .eq("tipo", "approval")
    .contains("metadata", { reporteId: fromReportId });
  if (error) throw error;

  for (const row of data || []) {
    const metadata = typeof row.metadata === "object" && row.metadata !== null
      ? { ...row.metadata, reporteId: toReportId }
      : { reporteId: toReportId };

    const { error: updateError } = await supabase
      .from("notificaciones")
      .update({ metadata })
      .eq("id", row.id);
    if (updateError) throw updateError;
  }

  return (data || []).length;
}

async function reassignReportReferences(fromReportId, toReportId) {
  const updates = [
    supabase.from("reporte_actividad_fotos").update({ reporte_actividad_id: toReportId }).eq("reporte_actividad_id", fromReportId),
    supabase.from("items_aprobacion").update({ referencia_id: toReportId }).eq("tipo", "visita_tecnica").eq("referencia_id", fromReportId),
    supabase.from("items_liquidacion").update({ referencia_id: toReportId }).eq("tipo", "visita_tecnica").eq("referencia_id", fromReportId),
  ];

  const results = await Promise.all(updates);
  for (const result of results) {
    if (result.error) throw result.error;
  }

  return updateNotificationReportReferences(fromReportId, toReportId);
}

async function reassignVisitReferences(fromVisitId, toVisitId) {
  const updates = [
    supabase.from("visita_tecnica_fotos").update({ visita_tecnica_id: toVisitId }).eq("visita_tecnica_id", fromVisitId),
    supabase.from("items_aprobacion").update({ referencia_id: toVisitId }).eq("tipo", "visita_tecnica").eq("referencia_id", fromVisitId),
    supabase.from("items_liquidacion").update({ referencia_id: toVisitId }).eq("tipo", "visita_tecnica").eq("referencia_id", fromVisitId),
  ];

  const results = await Promise.all(updates);
  for (const result of results) {
    if (result.error) throw result.error;
  }
}

async function dedupeApprovalRows(referenceId) {
  const { data, error } = await supabase
    .from("items_aprobacion")
    .select("id, tecnico_id, fecha, referencia_id")
    .eq("tipo", "visita_tecnica")
    .eq("referencia_id", referenceId)
    .order("id", { ascending: false });
  if (error) throw error;

  const grouped = dedupeRows(data || [], (row) => [row.tecnico_id || "", row.fecha || "", row.referencia_id || ""].join("|"));
  const deleteIds = [];
  grouped.forEach((rows) => deleteIds.push(...rows.slice(1).map((row) => row.id)));

  if (deleteIds.length > 0) {
    const { error: deleteError } = await supabase.from("items_aprobacion").delete().in("id", deleteIds);
    if (deleteError) throw deleteError;
  }

  return deleteIds.length;
}

async function dedupeLiquidationRows(referenceId) {
  const { data, error } = await supabase
    .from("items_liquidacion")
    .select("id, tecnico_id, fecha, periodo_id, referencia_id")
    .eq("tipo", "visita_tecnica")
    .eq("referencia_id", referenceId)
    .order("id", { ascending: false });
  if (error) throw error;

  const grouped = dedupeRows(data || [], (row) => [row.tecnico_id || "", row.fecha || "", row.periodo_id || "", row.referencia_id || ""].join("|"));
  const deleteIds = [];
  grouped.forEach((rows) => deleteIds.push(...rows.slice(1).map((row) => row.id)));

  if (deleteIds.length > 0) {
    const { error: deleteError } = await supabase.from("items_liquidacion").delete().in("id", deleteIds);
    if (deleteError) throw deleteError;
  }

  return deleteIds.length;
}

async function dedupeTechnicalVisitReports() {
  const { reports, visits } = await fetchAllData();
  const visitsByKey = dedupeRows(visits, buildVisitTableKey);
  const reportsByGroup = dedupeRows(reports, buildGroupKey);

  const summary = {
    groupsTouched: 0,
    reportsUpdated: 0,
    reportsDeleted: 0,
    visitsDeleted: 0,
    approvalRowsDeleted: 0,
    liquidationRowsDeleted: 0,
    notificationRowsUpdated: 0,
  };

  for (const rows of reportsByGroup.values()) {
    if (rows.length <= 1) continue;

    const techCount = new Set(rows.map((row) => row.tecnico_id)).size;
    const duplicateTech = techCount !== rows.length;
    const needsMetadata = rows.some((row) => !row.codigo_registro || !row.tipo_visita);
    if (!duplicateTech && !needsMetadata) continue;

    const candidateVisits = rows.flatMap((row) => visitsByKey.get(buildVisitKey(row)) || []);
    const canonicalReport = [...rows].sort((a, b) => compareByCompleteness(a, b, reportScore))[0];
    const canonicalVisit = [...candidateVisits].sort((a, b) => compareByCompleteness(a, b, visitScore))[0];
    const sharedCode = canonicalReport.codigo_registro || canonicalVisit?.codigo_registro || null;
    const sharedType = canonicalReport.tipo_visita || canonicalVisit?.tipo_visita || null;

    const rowsByTech = dedupeRows(rows, (row) => row.tecnico_id || "");
    const survivorByTech = new Map();
    rowsByTech.forEach((techRows, tecnicoId) => {
      survivorByTech.set(tecnicoId, [...techRows].sort((a, b) => compareByCompleteness(a, b, reportScore))[0]);
    });

    let touchedGroup = false;

    for (const [tecnicoId, survivor] of survivorByTech.entries()) {
      const matchingVisits = [...(visitsByKey.get(buildVisitKey(survivor)) || [])].sort((a, b) => compareByCompleteness(a, b, visitScore));
      const preferredVisit = matchingVisits[0];
      const nextPayload = {};

      if ((!survivor.codigo_registro || survivor.codigo_registro !== sharedCode) && sharedCode) {
        nextPayload.codigo_registro = sharedCode;
      }

      if ((!survivor.tipo_visita || survivor.tipo_visita !== sharedType) && sharedType) {
        nextPayload.tipo_visita = sharedType;
      }

      if (!survivor.visita_tecnica_id && preferredVisit?.id) {
        nextPayload.visita_tecnica_id = preferredVisit.id;
      }

      if (Object.keys(nextPayload).length > 0) {
        const { error } = await supabase.from("reportes_actividad").update(nextPayload).eq("id", survivor.id);
        if (error) throw error;
        summary.reportsUpdated += 1;
        touchedGroup = true;
      }

      const duplicateRows = rowsByTech.get(tecnicoId).filter((row) => row.id !== survivor.id);
      for (const duplicateRow of duplicateRows) {
        summary.notificationRowsUpdated += await reassignReportReferences(duplicateRow.id, survivor.id);

        const { error: deleteError } = await supabase.from("reportes_actividad").delete().eq("id", duplicateRow.id);
        if (deleteError) throw deleteError;
        summary.reportsDeleted += 1;
        touchedGroup = true;
      }

      summary.approvalRowsDeleted += await dedupeApprovalRows(survivor.id);
      summary.liquidationRowsDeleted += await dedupeLiquidationRows(survivor.id);

      if (duplicateTech === false && matchingVisits.length > 1 && preferredVisit?.id) {
        for (const duplicateVisit of matchingVisits.slice(1)) {
          await reassignVisitReferences(duplicateVisit.id, preferredVisit.id);
          const { error: deleteVisitError } = await supabase.from("visitas_tecnicas").delete().eq("id", duplicateVisit.id);
          if (deleteVisitError) throw deleteVisitError;
          summary.visitsDeleted += 1;
          touchedGroup = true;
        }

        summary.approvalRowsDeleted += await dedupeApprovalRows(preferredVisit.id);
        summary.liquidationRowsDeleted += await dedupeLiquidationRows(preferredVisit.id);
      }
    }

    if (touchedGroup) {
      summary.groupsTouched += 1;
    }
  }

  return summary;
}

async function main() {
  const summary = await dedupeTechnicalVisitReports();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
