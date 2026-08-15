const supabaseUrl = process.env.SOLUREPORT_REPAIR_URL;
const supabaseKey = process.env.SOLUREPORT_REPAIR_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltan SOLUREPORT_REPAIR_URL y SOLUREPORT_REPAIR_KEY.");
}

const headers = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
};

async function request(path, method = "GET", body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Prefer: method === "GET" ? "return=minimal" : "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

function query(table, select, filters = "") {
  return request(`${table}?select=${encodeURIComponent(select)}${filters ? `&${filters}` : ""}`);
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function routeDescription(route) {
  return `Recorrido ${route.tipo_recorrido === "con_herramienta" ? "con herramienta" : "normal"}: ${route.punto_partida || ""} → ${route.punto_llegada || ""}`;
}

function resolvePeriodId(route, routeItems, report, periods) {
  const itemPeriod = routeItems.find((item) => item.periodo_id)?.periodo_id;
  if (itemPeriod) return itemPeriod;
  if (report?.periodo_id) return report.periodo_id;

  const periodByDate = periods
    .filter((period) => route.fecha >= period.fecha_inicio && route.fecha <= period.fecha_fin)
    .sort((left, right) => right.fecha_inicio.localeCompare(left.fecha_inicio))[0];
  if (periodByDate) return periodByDate.id;

  return periods
    .filter((period) => period.estado === "abierto")
    .sort((left, right) => right.fecha_inicio.localeCompare(left.fecha_inicio))[0]?.id;
}

function findRouteItems(route, report, items) {
  const references = new Set([route.id, report?.id].filter(Boolean));
  const routeCode = normalizeCode(route.codigo_registro);

  return items.filter((item) => {
    if (item.tecnico_id !== route.tecnico_id || item.tipo !== "recorrido") return false;
    if (item.referencia_id && references.has(item.referencia_id)) return true;
    return Boolean(routeCode) && normalizeCode(item.codigo_registro) === routeCode;
  });
}

function reportMatchesRoute(report, route) {
  return report.tecnico_id === route.tecnico_id
    && report.fecha === route.fecha
    && normalizeText(report.punto_partida) === normalizeText(route.punto_partida)
    && normalizeText(report.punto_llegada) === normalizeText(route.punto_llegada)
    && report.tipo_recorrido === route.tipo_recorrido;
}

async function main() {
  const targetTechnicianIds = [
    "9dc847a9-7645-4e97-88de-2840c689f093",
    "57da6802-0f16-4ed8-93f6-6e68e07b1215",
  ];
  const technicianFilter = `in.(${targetTechnicianIds.join(",")})`;

  const [routes, reports, items, users, groups, periods, settingsRows] = await Promise.all([
    query(
      "recorridos",
      "id,codigo_registro,tecnico_id,fecha,punto_partida,punto_llegada,tipo_recorrido,valor,foto_herramienta_url",
      `tecnico_id=${technicianFilter}`,
    ),
    query(
      "reportes_actividad",
      "id,codigo_registro,tipo,tecnico_id,lider_grupo_id,grupo_id,recorrido_id,fecha,punto_partida,punto_llegada,tipo_recorrido,costo_actividad,costo_actividad_default,valor_modificado,estado_aprobacion_lider,periodo_id",
      `tipo=eq.recorrido&tecnico_id=${technicianFilter}`,
    ),
    query(
      "items_liquidacion",
      "id,codigo_registro,referencia_id,tecnico_id,fecha,tipo,estado,periodo_id,porcentaje,valor_base,valor_ganado,nombre_actividad",
      `tipo=eq.recorrido&tecnico_id=${technicianFilter}`,
    ),
    query("usuarios", "id,grupo_id", `id=${technicianFilter}`),
    query("grupos_trabajo", "id,lider_id", "id=not.is.null"),
    query("periodos_liquidacion", "id,fecha_inicio,fecha_fin,estado"),
    query("configuracion_empresa", "porcentaje_descuento_tardanza,hora_descuento_automatico,costo_recorrido_normal,costo_recorrido_herramienta"),
  ]);

  const settings = settingsRows[0] || {};
  const counters = {
    createdReports: 0,
    updatedReports: 0,
    createdItems: 0,
    updatedItems: 0,
    attendanceFixed: 0,
  };

  for (const technicianId of targetTechnicianIds) {
    const technicianRoutes = routes.filter((route) => route.tecnico_id === technicianId);
    const technicianReports = reports.filter((report) => report.tecnico_id === technicianId);

    for (const route of technicianRoutes) {
      const routeCode = normalizeCode(route.codigo_registro);
      const directReport = technicianReports.find((report) => report.recorrido_id === route.id);
      const codeReport = routeCode
        ? technicianReports.find((report) => normalizeCode(report.codigo_registro) === routeCode)
        : null;
      const allStrictMatches = technicianReports.filter((report) => reportMatchesRoute(report, route));
      const legacyStrictReport = allStrictMatches.find((report) => !report.recorrido_id
        && routeCode
        && report.codigo_registro
        && normalizeCode(report.codigo_registro) !== routeCode) || null;
      const strictMatches = allStrictMatches.filter((report) => report
        && (!routeCode || !report.codigo_registro || normalizeCode(report.codigo_registro) === routeCode));
      let report = directReport || codeReport || (strictMatches.length === 1 ? strictMatches[0] : null);
      let routeItems = findRouteItems(route, report || legacyStrictReport, items);
      const periodId = resolvePeriodId(route, routeItems, report, periods);

      if (report && legacyStrictReport?.estado_aprobacion_lider === "aprobado" && report.estado_aprobacion_lider !== "aprobado") {
        await request(`reportes_actividad?id=eq.${report.id}`, "PATCH", {
          estado_aprobacion_lider: "aprobado",
          fecha_aprobacion_lider: new Date().toISOString(),
        });
        report.estado_aprobacion_lider = "aprobado";
        counters.updatedReports += 1;
      }

      if (report) {
        const reportPatch = {};
        if (report.recorrido_id !== route.id) reportPatch.recorrido_id = route.id;
        if (!report.periodo_id && periodId) reportPatch.periodo_id = periodId;

        if (Object.keys(reportPatch).length > 0) {
          await request(`reportes_actividad?id=eq.${report.id}`, "PATCH", reportPatch);
          Object.assign(report, reportPatch);
          counters.updatedReports += 1;
        }
      } else if (periodId) {
        const user = users.find((candidate) => candidate.id === technicianId);
        const group = groups.find((candidate) => candidate.id === user?.grupo_id);
        const defaultValue = route.tipo_recorrido === "con_herramienta"
          ? Number(settings.costo_recorrido_herramienta || 8000)
          : Number(settings.costo_recorrido_normal || 5000);
        const routeValue = Number(route.valor) || defaultValue;
        const shouldRestoreApproval = routeItems.some((item) => item.estado === "aprobado")
          || legacyStrictReport?.estado_aprobacion_lider === "aprobado";

        const insertedReports = await request("reportes_actividad", "POST", {
          codigo_registro: routeCode || null,
          tipo: "recorrido",
          tecnico_id: technicianId,
          lider_grupo_id: group?.lider_id || technicianId,
          grupo_id: user?.grupo_id || null,
          recorrido_id: route.id,
          fecha: route.fecha,
          descripcion: routeDescription(route),
          punto_partida: route.punto_partida || null,
          punto_llegada: route.punto_llegada || null,
          tipo_recorrido: route.tipo_recorrido || "normal",
          foto_herramienta_url: route.foto_herramienta_url || null,
          estado_aprobacion_lider: shouldRestoreApproval ? "aprobado" : "pendiente",
          fecha_aprobacion_lider: shouldRestoreApproval ? new Date().toISOString() : null,
          costo_actividad_default: defaultValue,
          costo_actividad: routeValue,
          valor_modificado: routeValue !== defaultValue,
          motivo_modificacion_valor: routeValue !== defaultValue ? "Valor histórico del recorrido" : null,
          costo_administrable: false,
          periodo_id: periodId,
        });
        report = insertedReports[0];
        reports.push(report);
        technicianReports.push(report);
        counters.createdReports += 1;
      }

      if (!report || !periodId) continue;

      routeItems = findRouteItems(route, report, items);
      const routeValue = Number(report.costo_actividad) || Number(route.valor) || 0;
      const percentage = Number(routeItems[0]?.porcentaje) || 100;
      const liquidationPayload = {
        codigo_registro: routeCode || null,
        referencia_id: report.id,
        nombre_actividad: routeDescription(route),
        fecha: route.fecha,
        periodo_id: routeItems[0]?.periodo_id || report.periodo_id || periodId,
        porcentaje: percentage,
        valor_base: routeValue,
        valor_ganado: percentage > 0 ? routeValue * percentage / 100 : routeValue,
        estado: report.estado_aprobacion_lider === "aprobado" ? "aprobado" : "pendiente",
      };

      if (routeItems.length === 0) {
        const insertedItems = await request("items_liquidacion", "POST", {
          tecnico_id: technicianId,
          tipo: "recorrido",
          edificio: "",
          ...liquidationPayload,
        });
        items.push(insertedItems[0]);
        counters.createdItems += 1;
      } else {
        for (const item of routeItems) {
          const needsUpdate = normalizeCode(item.codigo_registro) !== routeCode
            || item.referencia_id !== report.id
            || item.nombre_actividad !== liquidationPayload.nombre_actividad
            || item.periodo_id !== liquidationPayload.periodo_id
            || Number(item.porcentaje) !== percentage
            || Number(item.valor_base) !== Number(liquidationPayload.valor_base)
            || Number(item.valor_ganado) !== Number(liquidationPayload.valor_ganado)
            || item.estado !== liquidationPayload.estado;

          if (!needsUpdate) continue;
          await request(`items_liquidacion?id=eq.${item.id}`, "PATCH", liquidationPayload);
          Object.assign(item, liquidationPayload);
          counters.updatedItems += 1;
        }
      }
    }
  }

  const openPeriod = periods
    .filter((period) => period.estado === "abierto")
    .sort((left, right) => right.fecha_inicio.localeCompare(left.fecha_inicio))[0];
  if (openPeriod) {
    const cutoff = String(settings.hora_descuento_automatico || "08:30").slice(0, 5);
    const discountPercentage = Math.max(0, Math.min(100, Number(settings.porcentaje_descuento_tardanza) || 0));
    const attendanceRows = await query(
      "registros_asistencia",
      "id,fecha,hora_entrada_real,tarde,descuento_aplicado,porcentaje_descuento,razon_tardanza",
      `fecha=gte.${openPeriod.fecha_inicio}&fecha=lte.${openPeriod.fecha_fin}`,
    );

    for (const row of attendanceRows) {
      const realTime = row.hora_entrada_real ? String(row.hora_entrada_real).slice(0, 5) : "";
      const automaticNoReport = !realTime && String(row.razon_tardanza || "").startsWith("[AUTO ");
      let patch = null;

      if (realTime && realTime < cutoff && (row.descuento_aplicado || Number(row.porcentaje_descuento || 0) > 0)) {
        patch = { descuento_aplicado: false, porcentaje_descuento: 0 };
      } else if (realTime && realTime >= cutoff && row.tarde && row.descuento_aplicado && Number(row.porcentaje_descuento || 0) !== discountPercentage) {
        patch = { descuento_aplicado: discountPercentage > 0, porcentaje_descuento: discountPercentage };
      } else if (automaticNoReport && (Boolean(row.descuento_aplicado) !== (discountPercentage > 0) || Number(row.porcentaje_descuento || 0) !== discountPercentage)) {
        patch = { descuento_aplicado: discountPercentage > 0, porcentaje_descuento: discountPercentage };
      }

      if (patch) {
        await request(`registros_asistencia?id=eq.${row.id}`, "PATCH", patch);
        counters.attendanceFixed += 1;
      }
    }
  }

  console.log(JSON.stringify({
    ...counters,
    cutoff: settings.hora_descuento_automatico || "08:30",
    discountPercentage: settings.porcentaje_descuento_tardanza || 0,
  }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
