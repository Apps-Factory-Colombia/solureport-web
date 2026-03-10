import { supabase } from "../client";
import { Maintenance, MaintenanceReport } from "@/lib/types";
import { deleteAllFotosMantenimiento } from "./storage";

function toDateOnly(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.split("T")[0] || "";
}

function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (!match) return null;
  const bucket = match[1];
  const path = decodeURIComponent(match[2]);
  return { bucket, path };
}

async function resolveStorageUrl(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  const parsed = parseStorageUrl(url);
  if (!parsed) return url;

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, 60 * 60 * 24 * 7);

  if (error || !data?.signedUrl) return url;
  return data.signedUrl;
}

function mapRow(row: any): Maintenance {
  return {
    id: row.id,
    clienteId: row.cliente_id,
    tecnicoId: row.tecnico_id,
    origen: "mantenimiento",
    fechaProgramada: toDateOnly(row.fecha_programada),
    horaProgramada: row.hora_programada || undefined,
    proximaFecha: toDateOnly(row.proxima_fecha) || undefined,
    estado: row.estado,
    observaciones: row.observaciones || undefined,
    tipoPendiente: row.tipo_pendiente || undefined,
    descripcionPendiente: row.descripcion_pendiente || undefined,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
    fechaCierre: row.fecha_cierre?.split("T")[0] || undefined,
  };
}

function mapContratoRow(row: any, contrato: any): Maintenance {
  return {
    id: row.id,
    clienteId: contrato?.cliente_id || "",
    tecnicoId: row.tecnico_id || "",
    origen: "contrato",
    contratoId: row.contrato_id,
    contratoMantenimientoId: row.id,
    fechaProgramada: toDateOnly(row.fecha_programada),
    estado: row.estado,
    valorRecaudado: parseFloat(row.valor_recaudado) || 0,
    fechaCreacion: contrato?.fecha_creacion?.split("T")[0] || "",
    fechaCierre: row.fecha_realizado?.split("T")[0] || undefined,
  };
}

export async function getMantenimientos(): Promise<Maintenance[]> {
  const { data, error } = await supabase
    .from("mantenimientos")
    .select("*")
    .order("fecha_programada", { ascending: false });
  if (error) throw error;

  const { data: contratos, error: contratosError } = await supabase
    .from("contratos_mantenimiento")
    .select("id, cliente_id, fecha_creacion");
  if (contratosError) throw contratosError;

  const contratoIds = (contratos || []).map((contrato) => contrato.id);
  let mantenimientosContrato: any[] = [];
  if (contratoIds.length > 0) {
    const { data: contratoMants, error: contratoMantsError } = await supabase
      .from("contrato_mantenimientos")
      .select("*")
      .in("contrato_id", contratoIds);
    if (contratoMantsError) throw contratoMantsError;
    mantenimientosContrato = contratoMants || [];
  }

  const contratosById = new Map((contratos || []).map((contrato) => [contrato.id, contrato]));
  return [...(data || []).map(mapRow), ...mantenimientosContrato.map((mant) => mapContratoRow(mant, contratosById.get(mant.contrato_id)))]
    .sort((a, b) => b.fechaProgramada.localeCompare(a.fechaProgramada));
}

export async function createMantenimiento(m: Partial<Maintenance>): Promise<Maintenance> {
  const { data, error } = await supabase
    .from("mantenimientos")
    .insert({
      cliente_id: m.clienteId,
      tecnico_id: m.tecnicoId,
      titulo: "Mantenimiento programado",
      fecha_programada: m.fechaProgramada,
      hora_programada: m.horaProgramada || null,
      proxima_fecha: m.proximaFecha || null,
      estado: m.estado || "programado",
      observaciones: m.observaciones || null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateMantenimiento(id: string, m: Partial<Maintenance>): Promise<Maintenance> {
  const { data: mantenimientoExistente, error: mantenimientoExistenteError } = await supabase
    .from("mantenimientos")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (mantenimientoExistenteError) throw mantenimientoExistenteError;

  if (!mantenimientoExistente) {
    const contractUpdateData: any = {};
    if (m.tecnicoId !== undefined) contractUpdateData.tecnico_id = m.tecnicoId || null;
    if (m.fechaProgramada !== undefined) contractUpdateData.fecha_programada = m.fechaProgramada;
    if (m.estado !== undefined) contractUpdateData.estado = m.estado;
    if (m.valorRecaudado !== undefined) contractUpdateData.valor_recaudado = m.valorRecaudado;

    const contratoMantQuery = supabase
      .from("contrato_mantenimientos")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    const { data: contratoMant, error: contratoMantError } = Object.keys(contractUpdateData).length > 0
      ? await supabase
        .from("contrato_mantenimientos")
        .update(contractUpdateData)
        .eq("id", id)
        .select("*")
        .maybeSingle()
      : await contratoMantQuery;
    if (contratoMantError) throw contratoMantError;
    if (!contratoMant) throw new Error("Mantenimiento no encontrado.");

    const { data: contrato, error: contratoError } = await supabase
      .from("contratos_mantenimiento")
      .select("id, cliente_id, fecha_creacion")
      .eq("id", contratoMant.contrato_id)
      .maybeSingle();
    if (contratoError) throw contratoError;

    return mapContratoRow(contratoMant, contrato);
  }

  const updateData: any = {};
  if (m.clienteId !== undefined) updateData.cliente_id = m.clienteId;
  if (m.tecnicoId !== undefined) updateData.tecnico_id = m.tecnicoId;
  if (m.fechaProgramada !== undefined) updateData.fecha_programada = m.fechaProgramada;
  if (m.horaProgramada !== undefined) updateData.hora_programada = m.horaProgramada;
  if (m.proximaFecha !== undefined) updateData.proxima_fecha = m.proximaFecha;
  if (m.estado !== undefined) updateData.estado = m.estado;
  if (m.observaciones !== undefined) updateData.observaciones = m.observaciones;

  const { data, error } = await supabase
    .from("mantenimientos")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function deleteMantenimiento(id: string): Promise<void> {
  const { data: mantenimientoExistente, error: mantenimientoExistenteError } = await supabase
    .from("mantenimientos")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (mantenimientoExistenteError) throw mantenimientoExistenteError;

  if (mantenimientoExistente) {
    const { error } = await supabase.from("mantenimientos").delete().eq("id", id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("contrato_mantenimientos").delete().eq("id", id);
  if (error) throw error;
}

function mapReport(
  row: any,
  fotosAntes: string[],
  fotosDespues: string[],
  fotoBitacoraUrl?: string,
  tipoPendiente?: string,
  descripcionPendiente?: string
): MaintenanceReport {
  const mantenimientoRefId = row.mantenimiento_id || row.id;
  return {
    id: row.id,
    mantenimientoId: mantenimientoRefId,
    tecnicoId: row.tecnico_id,
    clienteId: row.cliente_id,
    fotosAntes,
    fotosDespues,
    observaciones: row.observaciones || "",
    fechaGeneracion: row.fecha_generacion?.split("T")[0] || "",
    enviado: row.enviado || false,
    fechaEnvio: row.fecha_envio?.split("T")[0] || undefined,
    firmaReceptor: row.firma_receptor_url || undefined,
    datosReceptor: row.nombre_receptor
      ? { nombre: row.nombre_receptor, cedula: row.cedula_receptor || "", cargo: row.cargo_receptor || "" }
      : undefined,
    fotoBitacora:
      fotoBitacoraUrl ||
      row.foto_bitacora_url ||
      row.foto_bitacora ||
      undefined,
    tipoPendiente: tipoPendiente || row.tipo_pendiente || undefined,
    descripcionPendiente: descripcionPendiente || row.descripcion_pendiente || undefined,
  };
}

export async function getReportesMantenimiento(): Promise<MaintenanceReport[]> {
  const { data, error } = await supabase
    .from("reportes_mantenimiento")
    .select("*")
    .order("fecha_generacion", { ascending: false });
  if (error) throw error;

  const mantenimientoIds = Array.from(
    new Set(
      (data || [])
        .map((row: any) => row.mantenimiento_id || row.id)
        .filter(Boolean)
    )
  );

  const bitacoraByMantenimientoId = new Map<string, string>();
  const tipoPendienteByMantenimientoId = new Map<string, string>();
  const descripcionPendienteByMantenimientoId = new Map<string, string>();
  if (mantenimientoIds.length > 0) {
    const { data: mantenimientosData } = await supabase
      .from("mantenimientos")
      .select("id, foto_bitacora_url, tipo_pendiente, descripcion_pendiente")
      .in("id", mantenimientoIds);

    for (const mantenimiento of mantenimientosData || []) {
      if (mantenimiento?.id && mantenimiento?.foto_bitacora_url) {
        bitacoraByMantenimientoId.set(mantenimiento.id, mantenimiento.foto_bitacora_url);
      }
      if (mantenimiento?.id && mantenimiento?.tipo_pendiente) {
        tipoPendienteByMantenimientoId.set(mantenimiento.id, mantenimiento.tipo_pendiente);
      }
      if (mantenimiento?.id && mantenimiento?.descripcion_pendiente) {
        descripcionPendienteByMantenimientoId.set(mantenimiento.id, mantenimiento.descripcion_pendiente);
      }
    }
  }

  const reports: MaintenanceReport[] = [];
  for (const row of data || []) {
    const mantenimientoRefId = row.mantenimiento_id || row.id;
    const { data: fotos } = await supabase
      .from("mantenimiento_fotos")
      .select("*")
      .eq("mantenimiento_id", mantenimientoRefId)
      .order("orden");
    const fotosAntes = (fotos || []).filter((f: any) => f.tipo === "antes").map((f: any) => f.url);
    const fotosDespues = (fotos || []).filter((f: any) => f.tipo === "despues").map((f: any) => f.url);
    const rawBitacoraUrl =
      bitacoraByMantenimientoId.get(mantenimientoRefId) ||
      row.foto_bitacora_url ||
      row.foto_bitacora ||
      undefined;
    const fotoBitacoraUrl = await resolveStorageUrl(rawBitacoraUrl);
    const tipoPendiente =
      tipoPendienteByMantenimientoId.get(mantenimientoRefId) ||
      row.tipo_pendiente ||
      undefined;
    const descripcionPendiente =
      descripcionPendienteByMantenimientoId.get(mantenimientoRefId) ||
      row.descripcion_pendiente ||
      undefined;
    reports.push(
      mapReport(
        row,
        fotosAntes,
        fotosDespues,
        fotoBitacoraUrl,
        tipoPendiente,
        descripcionPendiente
      )
    );
  }
  return reports;
}

export async function syncReporteMantenimientoToActividad(reporteId: string): Promise<void> {
  const { data: reporte } = await supabase
    .from("reportes_mantenimiento")
    .select("id, mantenimiento_id, tecnico_id, cliente_id, observaciones, fecha_generacion")
    .eq("id", reporteId)
    .single();

  if (!reporte) return;

  const mantenimientoId = reporte.mantenimiento_id || reporte.id;
  const { data: mantenimiento } = await supabase
    .from("mantenimientos")
    .select("fecha_programada")
    .eq("id", mantenimientoId)
    .single();

  const fecha = mantenimiento?.fecha_programada?.split("T")[0] || reporte.fecha_generacion?.split("T")[0] || new Date().toISOString().split("T")[0];

  // Buscar grupo y líder del técnico
  let grupoId: string | undefined;
  let liderGrupoId: string | undefined;
  if (reporte.tecnico_id) {
    const { data: tecnico } = await supabase
      .from("usuarios")
      .select("grupo_id")
      .eq("id", reporte.tecnico_id)
      .single();
    grupoId = tecnico?.grupo_id || undefined;

    if (grupoId) {
      const { data: grupo } = await supabase
        .from("grupos_trabajo")
        .select("lider_id")
        .eq("id", grupoId)
        .single();
      liderGrupoId = grupo?.lider_id || undefined;
    }
  }

  // Buscar período activo
  const { data: periodo } = await supabase
    .from("periodos_liquidacion")
    .select("id")
    .eq("estado", "abierto")
    .lte("fecha_inicio", fecha)
    .gte("fecha_fin", fecha)
    .maybeSingle();

  let periodoId = periodo?.id;
  if (!periodoId) {
    const { data: periodoReciente } = await supabase
      .from("periodos_liquidacion")
      .select("id")
      .eq("estado", "abierto")
      .order("fecha_inicio", { ascending: false })
      .limit(1)
      .maybeSingle();
    periodoId = periodoReciente?.id;
  }

  if (!periodoId) return;

  // Evitar duplicados
  const { data: existing } = await supabase
    .from("reportes_actividad")
    .select("id")
    .eq("tipo", "mantenimiento_preventivo")
    .eq("tecnico_id", reporte.tecnico_id)
    .eq("fecha", fecha)
    .eq("cliente_id", reporte.cliente_id)
    .maybeSingle();

  if (existing) return;

  await supabase.from("reportes_actividad").insert({
    tipo: "mantenimiento_preventivo",
    tecnico_id: reporte.tecnico_id,
    lider_grupo_id: liderGrupoId || null,
    grupo_id: grupoId || null,
    cliente_id: reporte.cliente_id || null,
    fecha,
    descripcion: reporte.observaciones || "Mantenimiento preventivo realizado",
    estado_aprobacion_lider: "pendiente",
    costo_actividad: 0,
    costo_administrable: true,
    periodo_id: periodoId,
  });
}

export async function updateReporteEnvio(id: string): Promise<void> {
  await supabase
    .from("reportes_mantenimiento")
    .update({ enviado: true, fecha_envio: new Date().toISOString() })
    .eq("id", id);
}

export async function deleteReporteMantenimiento(id: string): Promise<void> {
  const { data: reportRow, error: reportError } = await supabase
    .from("reportes_mantenimiento")
    .select("id, mantenimiento_id")
    .eq("id", id)
    .single();

  if (reportError) throw reportError;

  const mantenimientoRefId = reportRow?.mantenimiento_id || reportRow?.id;

  if (mantenimientoRefId) {
    await deleteAllFotosMantenimiento(mantenimientoRefId);

    const { error: mantenimientoUpdateError } = await supabase
      .from("mantenimientos")
      .update({
        foto_bitacora_url: null,
        firma_receptor_url: null,
        tiene_bitacora: false,
        firmado: false,
      })
      .eq("id", mantenimientoRefId);

    if (mantenimientoUpdateError) throw mantenimientoUpdateError;
  }

  const { error: deleteReportError } = await supabase
    .from("reportes_mantenimiento")
    .delete()
    .eq("id", id);

  if (deleteReportError) throw deleteReportError;
}
