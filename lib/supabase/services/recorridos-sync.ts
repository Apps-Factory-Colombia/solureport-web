import { supabase } from "../client";
import { getConfiguracion } from "./configuracion";

type RouteRow = {
  id: string;
  codigo_registro?: string | null;
  tecnico_id: string;
  fecha: string;
  punto_partida?: string | null;
  punto_llegada?: string | null;
  tipo_recorrido?: "normal" | "con_herramienta" | null;
  valor?: number | string | null;
  foto_herramienta_url?: string | null;
};

type RouteReportRow = {
  id: string;
  codigo_registro?: string | null;
  tipo: string;
  tecnico_id: string;
  lider_grupo_id?: string | null;
  grupo_id?: string | null;
  recorrido_id?: string | null;
  fecha: string;
  punto_partida?: string | null;
  punto_llegada?: string | null;
  tipo_recorrido?: "normal" | "con_herramienta" | null;
  costo_actividad?: number | string | null;
  costo_actividad_default?: number | string | null;
  valor_modificado?: boolean | null;
  estado_aprobacion_lider?: "pendiente" | "aprobado" | "rechazado" | null;
  periodo_id?: string | null;
};

type LiquidationRow = {
  id: string;
  codigo_registro?: string | null;
  referencia_id?: string | null;
  tecnico_id: string;
  fecha: string;
  tipo: string;
  estado?: string | null;
  periodo_id?: string | null;
  porcentaje?: number | string | null;
  valor_base?: number | string | null;
  valor_ganado?: number | string | null;
  nombre_actividad?: string | null;
};

type UserRow = {
  id: string;
  grupo_id?: string | null;
};

type GroupRow = {
  id: string;
  lider_id?: string | null;
};

type PeriodRow = {
  id: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado?: string | null;
};

function normalizeText(value?: string | null) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCode(value?: string | null) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizedNumber(value?: number | string | null) {
  return Number(value ?? 0) || 0;
}

function routeStrictKey(route: Pick<RouteRow, "tecnico_id" | "fecha" | "punto_partida" | "punto_llegada" | "tipo_recorrido">) {
  return [
    route.tecnico_id,
    route.fecha,
    normalizeText(route.punto_partida),
    normalizeText(route.punto_llegada),
    route.tipo_recorrido || "",
  ].join("|");
}

function reportStrictKey(report: Pick<RouteReportRow, "tecnico_id" | "fecha" | "punto_partida" | "punto_llegada" | "tipo_recorrido">) {
  return routeStrictKey(report);
}

function resolvePeriodId(route: RouteRow, items: LiquidationRow[], periods: PeriodRow[]) {
  const itemPeriod = items.find((item) => item.periodo_id)?.periodo_id;
  if (itemPeriod) return itemPeriod;

  const coveringPeriod = periods
    .filter((period) => route.fecha >= period.fecha_inicio && route.fecha <= period.fecha_fin)
    .sort((left, right) => right.fecha_inicio.localeCompare(left.fecha_inicio))[0];
  if (coveringPeriod) return coveringPeriod.id;

  return periods
    .filter((period) => period.estado === "abierto")
    .sort((left, right) => right.fecha_inicio.localeCompare(left.fecha_inicio))[0]?.id;
}

function routeDescription(route: RouteRow) {
  return `Recorrido ${route.tipo_recorrido === "con_herramienta" ? "con herramienta" : "normal"}: ${route.punto_partida || ""} → ${route.punto_llegada || ""}`;
}

function routeDefaultValue(
  route: RouteRow,
  settings: { costoRecorridoNormal: number; costoRecorridoHerramienta: number },
) {
  return route.tipo_recorrido === "con_herramienta"
    ? settings.costoRecorridoHerramienta
    : settings.costoRecorridoNormal;
}

function hasDifferentValue<T extends Record<string, unknown>>(row: T, payload: Partial<T>) {
  return Object.entries(payload).some(([key, value]) => {
    const current = row[key];
    if (value === null || value === undefined) return current !== value;
    return String(current ?? "") !== String(value);
  });
}

function findRouteItems(route: RouteRow, report: RouteReportRow | null, items: LiquidationRow[]) {
  const references = new Set([route.id, report?.id].filter(Boolean));
  const routeCode = normalizeCode(route.codigo_registro);

  return items.filter((item) => {
    if (item.tecnico_id !== route.tecnico_id || item.tipo !== "recorrido") return false;
    if (item.referencia_id && references.has(item.referencia_id)) return true;
    if (routeCode && normalizeCode(item.codigo_registro) === routeCode) return true;
    return false;
  });
}

/**
 * Reconciles routes with their approval reports and liquidation mirrors.
 * It is safe to run repeatedly: it only creates a missing mirror or updates
 * fields that are part of the route identity and approval state.
 */
async function syncRecorridoMirrors(): Promise<boolean> {
  const [
    { data: routes, error: routesError },
    { data: reports, error: reportsError },
    { data: items, error: itemsError },
    { data: users, error: usersError },
    { data: groups, error: groupsError },
    { data: periods, error: periodsError },
    settings,
  ] = await Promise.all([
    supabase
      .from("recorridos")
      .select("id, codigo_registro, tecnico_id, fecha, punto_partida, punto_llegada, tipo_recorrido, valor, foto_herramienta_url"),
    supabase
      .from("reportes_actividad")
      .select("id, codigo_registro, tipo, tecnico_id, lider_grupo_id, grupo_id, recorrido_id, fecha, punto_partida, punto_llegada, tipo_recorrido, costo_actividad, costo_actividad_default, valor_modificado, estado_aprobacion_lider, periodo_id")
      .eq("tipo", "recorrido"),
    supabase
      .from("items_liquidacion")
      .select("id, codigo_registro, referencia_id, tecnico_id, fecha, tipo, estado, periodo_id, porcentaje, valor_base, valor_ganado, nombre_actividad")
      .eq("tipo", "recorrido"),
    supabase.from("usuarios").select("id, grupo_id"),
    supabase.from("grupos_trabajo").select("id, lider_id"),
    supabase.from("periodos_liquidacion").select("id, fecha_inicio, fecha_fin, estado"),
    getConfiguracion(),
  ]);

  if (routesError) throw routesError;
  if (reportsError) throw reportsError;
  if (itemsError) throw itemsError;
  if (usersError) throw usersError;
  if (groupsError) throw groupsError;
  if (periodsError) throw periodsError;

  const routeRows = (routes || []) as RouteRow[];
  const reportRows = (reports || []) as RouteReportRow[];
  const itemRows = (items || []) as LiquidationRow[];
  const userRows = (users || []) as UserRow[];
  const groupRows = (groups || []) as GroupRow[];
  const periodRows = (periods || []) as PeriodRow[];
  const reportsByStrictKey = new Map<string, RouteReportRow[]>();

  reportRows.forEach((report) => {
    const key = reportStrictKey(report);
    const current = reportsByStrictKey.get(key) || [];
    current.push(report);
    reportsByStrictKey.set(key, current);
  });

  let changed = false;

  for (const route of routeRows) {
    const routeCode = normalizeCode(route.codigo_registro);
    const directReport = reportRows.find((report) => report.recorrido_id === route.id);
    const codeReport = routeCode
      ? reportRows.find((report) => report.tecnico_id === route.tecnico_id && normalizeCode(report.codigo_registro) === routeCode)
      : undefined;
    const allStrictMatches = reportsByStrictKey.get(routeStrictKey(route)) || [];
    const legacyStrictReport = allStrictMatches.find((candidate) => !candidate.recorrido_id
      && routeCode
      && candidate.codigo_registro
      && normalizeCode(candidate.codigo_registro) !== routeCode) || null;
    const strictMatches = allStrictMatches
      .filter((candidate) => !routeCode || !candidate.codigo_registro || normalizeCode(candidate.codigo_registro) === routeCode);
    let report = directReport || codeReport || (strictMatches.length === 1 ? strictMatches[0] : undefined) || null;

    const matchingItems = findRouteItems(route, report || (legacyStrictReport ? legacyStrictReport : null), itemRows);
    const periodId = report?.periodo_id || resolvePeriodId(route, matchingItems, periodRows);

    if (report && legacyStrictReport?.estado_aprobacion_lider === "aprobado" && report.estado_aprobacion_lider !== "aprobado") {
      const { error } = await supabase
        .from("reportes_actividad")
        .update({
          estado_aprobacion_lider: "aprobado",
          fecha_aprobacion_lider: new Date().toISOString(),
        })
        .eq("id", report.id);
      if (error) throw error;
      report.estado_aprobacion_lider = "aprobado";
      changed = true;
    }

    if (report) {
      const reportPatch: Record<string, unknown> = {};
      if (report.recorrido_id !== route.id) reportPatch.recorrido_id = route.id;
      if (!report.periodo_id && periodId) reportPatch.periodo_id = periodId;

      if (Object.keys(reportPatch).length > 0) {
        const { error } = await supabase
          .from("reportes_actividad")
          .update(reportPatch)
          .eq("id", report.id);
        if (error) throw error;
        Object.assign(report, reportPatch);
        changed = true;
      }
    } else if (periodId) {
      const user = userRows.find((candidate) => candidate.id === route.tecnico_id);
      const group = user?.grupo_id ? groupRows.find((candidate) => candidate.id === user.grupo_id) : undefined;
      const defaultValue = routeDefaultValue(route, settings);
      const routeValue = normalizedNumber(route.valor) || defaultValue;
      const approvedFromExistingItem = matchingItems.some((item) => item.estado === "aprobado")
        || legacyStrictReport?.estado_aprobacion_lider === "aprobado";
      const reportPayload = {
        codigo_registro: routeCode || null,
        tipo: "recorrido",
        tecnico_id: route.tecnico_id,
        lider_grupo_id: group?.lider_id || route.tecnico_id,
        grupo_id: user?.grupo_id || null,
        recorrido_id: route.id,
        fecha: route.fecha,
        descripcion: routeDescription(route),
        punto_partida: route.punto_partida || null,
        punto_llegada: route.punto_llegada || null,
        tipo_recorrido: route.tipo_recorrido || "normal",
        foto_herramienta_url: route.foto_herramienta_url || null,
        estado_aprobacion_lider: approvedFromExistingItem ? "aprobado" : "pendiente",
        fecha_aprobacion_lider: approvedFromExistingItem ? new Date().toISOString() : null,
        costo_actividad_default: defaultValue,
        costo_actividad: routeValue,
        valor_modificado: routeValue !== defaultValue,
        motivo_modificacion_valor: routeValue !== defaultValue ? "Valor histórico del recorrido" : null,
        costo_administrable: false,
        periodo_id: periodId,
      };
      const { data: insertedReport, error } = await supabase
        .from("reportes_actividad")
        .insert(reportPayload)
        .select("id, codigo_registro, tipo, tecnico_id, lider_grupo_id, grupo_id, recorrido_id, fecha, punto_partida, punto_llegada, tipo_recorrido, costo_actividad, costo_actividad_default, valor_modificado, estado_aprobacion_lider, periodo_id")
        .single();
      if (error) {
        // A second dashboard/request may have inserted the same canonical
        // report between the snapshot and this insert. Reuse it instead of
        // surfacing a duplicate-key error to the user.
        const { data: existingReport, error: existingReportError } = await supabase
          .from("reportes_actividad")
          .select("id, codigo_registro, tipo, tecnico_id, lider_grupo_id, grupo_id, recorrido_id, fecha, punto_partida, punto_llegada, tipo_recorrido, costo_actividad, costo_actividad_default, valor_modificado, estado_aprobacion_lider, periodo_id")
          .eq("codigo_registro", routeCode)
          .eq("tecnico_id", route.tecnico_id)
          .eq("tipo", "recorrido")
          .maybeSingle();
        if (existingReportError) throw error;
        if (!existingReport) throw error;
        report = existingReport as RouteReportRow;
      } else {
        report = insertedReport as RouteReportRow;
        reportRows.push(report);
        changed = true;
      }
    }

    if (!report || !periodId) continue;

    const reportValue = normalizedNumber(report.costo_actividad) || normalizedNumber(route.valor) || routeDefaultValue(route, settings);
    const percentage = matchingItems[0]?.porcentaje && normalizedNumber(matchingItems[0].porcentaje) > 0
      ? normalizedNumber(matchingItems[0].porcentaje)
      : 100;
    const liquidationPayload = {
      codigo_registro: routeCode || null,
      referencia_id: report.id,
      nombre_actividad: routeDescription(route),
      fecha: route.fecha,
      periodo_id: matchingItems[0]?.periodo_id || report.periodo_id || periodId,
      porcentaje: percentage,
      valor_base: reportValue,
      valor_ganado: percentage > 0 ? (reportValue * percentage) / 100 : reportValue,
      estado: report.estado_aprobacion_lider === "aprobado" ? "aprobado" : "pendiente",
    };
    let currentItems = findRouteItems(route, report, itemRows);

    // The reference triple is the database's authoritative identity for a
    // liquidation item. Re-check it before inserting because the broad
    // snapshot above can be stale while another repair is running.
    if (currentItems.length === 0) {
      const { data: existingItem, error: existingItemError } = await supabase
        .from("items_liquidacion")
        .select("id, codigo_registro, referencia_id, tecnico_id, fecha, tipo, estado, periodo_id, porcentaje, valor_base, valor_ganado, nombre_actividad")
        .eq("tecnico_id", route.tecnico_id)
        .eq("periodo_id", liquidationPayload.periodo_id)
        .eq("referencia_id", report.id)
        .maybeSingle();
      if (existingItemError) throw existingItemError;
      if (existingItem) {
        currentItems = [existingItem as LiquidationRow];
        itemRows.push(existingItem as LiquidationRow);
      }
    }

    if (currentItems.length === 0) {
      const { data: insertedItem, error } = await supabase
        .from("items_liquidacion")
        .upsert({
          tecnico_id: route.tecnico_id,
          tipo: "recorrido",
          edificio: "",
          ...liquidationPayload,
        }, { onConflict: "tecnico_id,periodo_id,referencia_id" })
        .select("id, codigo_registro, referencia_id, tecnico_id, fecha, tipo, estado, periodo_id, porcentaje, valor_base, valor_ganado, nombre_actividad")
        .single();
      if (error) throw error;
      itemRows.push(insertedItem as LiquidationRow);
      changed = true;
      continue;
    }

    for (const item of currentItems) {
      if (!hasDifferentValue(item as unknown as Record<string, unknown>, liquidationPayload)) continue;
      const { error } = await supabase
        .from("items_liquidacion")
        .update(liquidationPayload)
        .eq("id", item.id);
      if (error) throw error;
      Object.assign(item, liquidationPayload);
      changed = true;
    }
  }

  return changed;
}

function describeSyncError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error, Object.getOwnPropertyNames(error));
    } catch {
      return String(error);
    }
  }
  return String(error);
}

let recorridoSyncInFlight: Promise<boolean> | null = null;

/**
 * Data repair is best-effort. A legacy row must never prevent the dashboard
 * or approvals screen from reading the reports that already exist.
 */
export async function ensureRecorridoMirrors(): Promise<boolean> {
  if (recorridoSyncInFlight) return recorridoSyncInFlight;

  recorridoSyncInFlight = syncRecorridoMirrors()
    .catch((error) => {
      console.error("Error sincronizando espejos de recorridos:", describeSyncError(error));
      return false;
    })
    .finally(() => {
      recorridoSyncInFlight = null;
    });

  try {
    return await recorridoSyncInFlight;
  } catch {
    return false;
  }
}
