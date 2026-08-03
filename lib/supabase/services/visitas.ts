import { supabase } from "../client";
import { TechnicalVisit } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";
import { getConfiguracion } from "./configuracion";

const VISITAS_CACHE_KEY = "visitas:list";
const VISITAS_CACHE_TTL = 30_000;

function isKeyDeliveryVisit(tipoVisita?: string | null) {
  return String(tipoVisita || "").toLowerCase() === "entregas";
}

function normalizeVisitFinancials(params: {
  tipoVisita?: string | null;
  costoVisitaTecnicaDefault?: number | null;
  valorCobradoCliente?: number | null;
}) {
  if (isKeyDeliveryVisit(params.tipoVisita)) {
    return {
      costoVisitaTecnicaDefault: 0,
      valorCobradoCliente: 0,
      valorModificado: false,
    };
  }

  const costoVisitaTecnicaDefault = Number(params.costoVisitaTecnicaDefault ?? 0) || 0;
  const valorCobradoCliente = Number(params.valorCobradoCliente ?? costoVisitaTecnicaDefault) || 0;

  return {
    costoVisitaTecnicaDefault,
    valorCobradoCliente,
    valorModificado: valorCobradoCliente !== costoVisitaTecnicaDefault,
  };
}

function isMissingVisitRegistrationColumnError(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null | undefined;
  if (candidate?.code === "42703") return true;
  const message = String(candidate?.message || "");
  return message.includes("visita_tecnica_id")
    || message.includes("codigo_registro")
    || message.includes("tipo_visita")
    || message.includes("recorrido_id");
}

function stripVisitRegistrationFields(payload: Record<string, unknown>) {
  const nextPayload = { ...payload };
  delete nextPayload.tipo_visita;
  delete nextPayload.visita_tecnica_id;
  delete nextPayload.codigo_registro;
  return nextPayload;
}

function toDateOnly(value?: string | null): string {
  if (!value) return "";
  return value.split("T")[0] || "";
}

async function syncVisitLiquidationValues(params: {
  visitId: string;
  tecnicoId?: string | null;
  fecha: string;
  periodoId?: string | null;
  valorCobradoCliente: number;
}) {
  if (!params.tecnicoId || !params.fecha) return;

  let liquidationQuery = supabase
    .from("items_liquidacion")
    .select("id, porcentaje")
    .eq("tipo", "visita_tecnica")
    .eq("referencia_id", params.visitId);

  if (params.periodoId) {
    liquidationQuery = liquidationQuery.eq("periodo_id", params.periodoId);
  }

  const { data: liquidationItems, error: liquidationLookupError } = await liquidationQuery;
  if (liquidationLookupError) throw liquidationLookupError;

  await Promise.all(
    (liquidationItems || []).map(async (item: { id: string; porcentaje: number | string }) => {
      const porcentaje = Number(item.porcentaje ?? 0) || 0;
      const valorGanado = (params.valorCobradoCliente * porcentaje) / 100;

      const { error: liquidationUpdateError } = await supabase
        .from("items_liquidacion")
        .update({
          valor_base: params.valorCobradoCliente,
          valor_ganado: valorGanado,
        })
        .eq("id", item.id);

      if (liquidationUpdateError) throw liquidationUpdateError;
    })
  );

  invalidateCachedValue("liquidacion:entries");
}

async function resolveVisitContext(params: {
  tecnicoId?: string | null;
  liderId?: string | null;
  clienteId?: string | null;
  fecha?: string;
}) {
  let grupoId: string | null = null;
  let liderId = params.liderId || null;
  let edificio: string | null = null;
  let periodoId: string | null = null;

  if (params.tecnicoId) {
    const { data: tecnico } = await supabase
      .from("usuarios")
      .select("grupo_id")
      .eq("id", params.tecnicoId)
      .maybeSingle();
    grupoId = tecnico?.grupo_id || null;

    if (grupoId && !liderId) {
      const { data: grupo } = await supabase
        .from("grupos_trabajo")
        .select("lider_id")
        .eq("id", grupoId)
        .maybeSingle();
      liderId = grupo?.lider_id || null;
    }
  }

  if (params.clienteId) {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("edificio")
      .eq("id", params.clienteId)
      .maybeSingle();
    edificio = cliente?.edificio || null;
  }

  if (params.fecha) {
    const { data: periodo } = await supabase
      .from("periodos_liquidacion")
      .select("id")
      .eq("estado", "abierto")
      .lte("fecha_inicio", params.fecha)
      .gte("fecha_fin", params.fecha)
      .order("fecha_inicio", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (periodo?.id) {
      periodoId = periodo.id;
    } else {
      const { data: periodoReciente } = await supabase
        .from("periodos_liquidacion")
        .select("id")
        .eq("estado", "abierto")
        .order("fecha_inicio", { ascending: false })
        .limit(1)
        .maybeSingle();
      periodoId = periodoReciente?.id || null;
    }
  }

  return { grupoId, liderId, edificio, periodoId };
}

async function findMirrorReportId(params: {
  visitId?: string | null;
  tecnicoId?: string | null;
  clienteId?: string | null;
  fecha: string;
  descripcion?: string | null;
}) {
  if (!params.tecnicoId || !params.fecha) return null;

  if (params.visitId) {
    const byVisitId = await supabase
      .from("reportes_actividad")
      .select("id")
      .eq("tipo", "visita_tecnica")
      .eq("visita_tecnica_id", params.visitId)
      .order("fecha_creacion", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!byVisitId.error && byVisitId.data?.id) {
      return byVisitId.data;
    }

    if (byVisitId.error && !isMissingVisitRegistrationColumnError(byVisitId.error)) {
      throw byVisitId.error;
    }
  }

  let query = supabase
    .from("reportes_actividad")
    .select("id")
    .eq("tipo", "visita_tecnica")
    .eq("tecnico_id", params.tecnicoId)
    .eq("fecha", params.fecha)
    .order("fecha_creacion", { ascending: false })
    .limit(1);

  if (params.clienteId) {
    query = query.eq("cliente_id", params.clienteId);
  } else {
    query = query.is("cliente_id", null);
  }

  if (params.descripcion) {
    query = query.eq("descripcion", params.descripcion);
  }

  const { data, error } = await query;
  if (error) throw error;

  if (data && data.length > 0) {
    return data[0];
  }

  if (params.descripcion) {
    return findMirrorReportId({ ...params, descripcion: null });
  }

  return null;
}

async function upsertMirrorAndApprovalForVisit(params: {
  visitId: string;
  codigoRegistro?: string | null;
  tecnicoId?: string | null;
  clienteId?: string | null;
  descripcion?: string | null;
  observaciones?: string | null;
  fecha: string;
  tipoVisita?: string | null;
  costoVisitaTecnicaDefault?: number;
  valorCobradoCliente: number;
  valorModificado?: boolean;
  motivoModificacionValor?: string | null;
  liderId?: string | null;
  previousDescripcion?: string | null;
}) {
  if (!params.tecnicoId || !params.fecha) return;

  const { grupoId, liderId, edificio, periodoId } = await resolveVisitContext({
    tecnicoId: params.tecnicoId,
    liderId: params.liderId,
    clienteId: params.clienteId,
    fecha: params.fecha,
  });

  const reportMatch = await findMirrorReportId({
    visitId: params.visitId,
    tecnicoId: params.tecnicoId,
    clienteId: params.clienteId,
    fecha: params.fecha,
    descripcion: params.previousDescripcion || params.descripcion,
  });

  const reportPayload = {
    lider_grupo_id: liderId,
    grupo_id: grupoId,
    cliente_id: params.clienteId || null,
    fecha: params.fecha,
    descripcion: params.descripcion || "",
    observaciones: params.observaciones || null,
    tipo_visita: params.tipoVisita || null,
    visita_tecnica_id: params.visitId,
    codigo_registro: params.codigoRegistro || null,
    costo_actividad_default: Number(params.costoVisitaTecnicaDefault ?? 0) || 0,
    valor_modificado: params.valorModificado ?? false,
    motivo_modificacion_valor: params.motivoModificacionValor || null,
    costo_actividad: params.valorCobradoCliente,
    costo_administrable: true,
    periodo_id: periodoId,
  };

  const legacyReportPayload = stripVisitRegistrationFields(reportPayload);

  if (reportMatch?.id) {
    const reportUpdate = await supabase
      .from("reportes_actividad")
      .update(reportPayload)
      .eq("id", reportMatch.id);
    if (reportUpdate.error) {
      if (!isMissingVisitRegistrationColumnError(reportUpdate.error)) throw reportUpdate.error;

      const { error: legacyReportUpdateError } = await supabase
        .from("reportes_actividad")
        .update(legacyReportPayload)
        .eq("id", reportMatch.id);
      if (legacyReportUpdateError) throw legacyReportUpdateError;
    }
  } else if (periodoId) {
    const reportInsert = await supabase
      .from("reportes_actividad")
      .insert({
        tipo: "visita_tecnica",
        tecnico_id: params.tecnicoId,
        estado_aprobacion_lider: "pendiente",
        ...reportPayload,
      });
    if (reportInsert.error) {
      if (!isMissingVisitRegistrationColumnError(reportInsert.error)) throw reportInsert.error;

      const { error: legacyReportInsertError } = await supabase
        .from("reportes_actividad")
        .insert({
          tipo: "visita_tecnica",
          tecnico_id: params.tecnicoId,
          estado_aprobacion_lider: "pendiente",
          ...legacyReportPayload,
        });
      if (legacyReportInsertError) throw legacyReportInsertError;
    }
  }

  const { data: approvalItems, error: approvalLookupError } = await supabase
    .from("items_aprobacion")
    .select("id")
    .eq("tipo", "visita_tecnica")
    .eq("referencia_id", params.visitId)
    .order("fecha", { ascending: false });
  if (approvalLookupError) throw approvalLookupError;

  const approvalPayload = {
    tipo: "visita_tecnica",
    referencia_id: params.visitId,
    lider_id: liderId,
    tecnico_id: params.tecnicoId,
    descripcion: params.descripcion || "",
    edificio,
    fecha: params.fecha,
    valor: params.valorCobradoCliente,
  };

  const approvalItemIds = (approvalItems || []).map((item: { id: string }) => item.id);

  if (approvalItemIds.length > 0) {
    const { error: approvalUpdateError } = await supabase
      .from("items_aprobacion")
      .update(approvalPayload)
      .in("id", approvalItemIds);
    if (approvalUpdateError) throw approvalUpdateError;
  } else {
    const { error: approvalInsertError } = await supabase
      .from("items_aprobacion")
      .insert({
        ...approvalPayload,
        estado: "pendiente",
        fecha_aprobacion: null,
      });
    if (approvalInsertError) throw approvalInsertError;
  }

  await syncVisitLiquidationValues({
    visitId: params.visitId,
    tecnicoId: params.tecnicoId,
    fecha: params.fecha,
    periodoId,
    valorCobradoCliente: params.valorCobradoCliente,
  });
}

function mapRow(row: any, fotosAntes: string[] = [], fotosDespues: string[] = []): TechnicalVisit {
  const normalizedVisit = normalizeVisitFinancials({
    tipoVisita: row.tipo_visita,
    costoVisitaTecnicaDefault: Number(row.costo_visita_tecnica_default ?? 0) || 0,
    valorCobradoCliente: Number(row.valor_cobrado_cliente ?? 0) || 0,
  });
  return {
    id: row.id,
    codigoRegistro: row.codigo_registro || undefined,
    clienteId: row.cliente_id,
    tecnicoId: row.tecnico_id,
    liderId: row.lider_id,
    fecha: row.fecha_inicio?.split("T")[0] || "",
    descripcion: row.descripcion || "",
    tipoVisita: row.tipo_visita || "imprevisto",
    observaciones: row.observaciones || undefined,
    ubicacion: row.ubicacion || undefined,
    edificio: row.edificio || undefined,
    nombreReceptor: row.nombre_receptor || undefined,
    firmaReceptorUrl: row.firma_receptor_url || undefined,
    tieneBitacora: row.tiene_bitacora || false,
    fotoBitacoraUrl: row.foto_bitacora_url || undefined,
    costoVisitaTecnicaDefault: normalizedVisit.costoVisitaTecnicaDefault,
    costoCliente: isKeyDeliveryVisit(row.tipo_visita) ? 0 : (Number(row.costo_cliente ?? 0) || 0),
    valorModificado: isKeyDeliveryVisit(row.tipo_visita) ? false : (row.valor_modificado || false),
    motivoModificacionValor: row.motivo_modificacion_valor || undefined,
    valorCobradoCliente: normalizedVisit.valorCobradoCliente,
    estado: row.estado || "pendiente",
    fotosAntes: fotosAntes.length > 0 ? fotosAntes : undefined,
    fotosDespues: fotosDespues.length > 0 ? fotosDespues : undefined,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

async function getVisitPhotos(visitaId: string): Promise<{ fotosAntes: string[]; fotosDespues: string[] }> {
  if (!visitaId) {
    return { fotosAntes: [], fotosDespues: [] };
  }

  const { data, error } = await supabase
    .from("visita_tecnica_fotos")
    .select("tipo, url, orden")
    .eq("visita_tecnica_id", visitaId)
    .order("orden");
  if (error) throw error;

  const fotosAntes = (data || [])
    .filter((foto: any) => foto.tipo === "antes")
    .map((foto: any) => foto.url)
    .filter(Boolean);
  const fotosDespues = (data || [])
    .filter((foto: any) => foto.tipo === "despues")
    .map((foto: any) => foto.url)
    .filter(Boolean);

  return { fotosAntes, fotosDespues };
}

async function mapVisitWithMedia(row: any): Promise<TechnicalVisit> {
  const { fotosAntes, fotosDespues } = await getVisitPhotos(row.id);
  return mapRow(row, fotosAntes, fotosDespues);
}

export async function getVisitasTecnicas(): Promise<TechnicalVisit[]> {
  return getCachedValue(VISITAS_CACHE_KEY, VISITAS_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("visitas_tecnicas")
      .select("*")
      .order("fecha_inicio", { ascending: false });
    if (error) throw error;

    const visitIds = (data || []).map((row: any) => row.id).filter(Boolean);
    const { data: fotos, error: fotosError } = visitIds.length > 0
      ? await supabase
        .from("visita_tecnica_fotos")
        .select("visita_tecnica_id, tipo, url, orden")
        .in("visita_tecnica_id", visitIds)
        .order("orden")
      : { data: [], error: null };
    if (fotosError) throw fotosError;

    const fotosByVisita = new Map<string, { antes: string[]; despues: string[] }>();
    for (const foto of fotos || []) {
      const visitaId = foto.visita_tecnica_id;
      if (!visitaId) continue;
      const current = fotosByVisita.get(visitaId) || { antes: [], despues: [] };
      if (foto.tipo === "antes") current.antes.push(foto.url);
      if (foto.tipo === "despues") current.despues.push(foto.url);
      fotosByVisita.set(visitaId, current);
    }

    return (data || []).map((row: any) => {
      const fotosVisita = fotosByVisita.get(row.id);
      return mapRow(row, fotosVisita?.antes || [], fotosVisita?.despues || []);
    });
  });
}

export async function createVisitaTecnica(v: Partial<TechnicalVisit> & { liderId?: string; tipoVisita?: string; grupoId?: string; periodoId?: string; costoActividad?: number }): Promise<TechnicalVisit> {
  const fechaVisita = v.fecha || new Date().toISOString().split("T")[0];
  const configuracion = await getConfiguracion();
  const tipoVisita = v.tipoVisita || "imprevisto";
  const normalizedVisit = normalizeVisitFinancials({
    tipoVisita,
    costoVisitaTecnicaDefault: Number(v.costoVisitaTecnicaDefault ?? configuracion.costoVisitaTecnicaDefault ?? 0) || 0,
    valorCobradoCliente: Number(v.valorCobradoCliente ?? v.costoActividad ?? v.costoVisitaTecnicaDefault ?? configuracion.costoVisitaTecnicaDefault ?? 0) || 0,
  });
  const { data, error } = await supabase
    .from("visitas_tecnicas")
    .insert({
      codigo_registro: v.codigoRegistro || null,
      tecnico_id: v.tecnicoId,
      lider_id: v.liderId,
      cliente_id: v.clienteId,
      descripcion: v.descripcion,
      tipo_visita: tipoVisita,
      estado: v.estado || "pendiente",
      fecha_inicio: v.fecha ? new Date(v.fecha).toISOString() : new Date().toISOString(),
      costo_visita_tecnica_default: normalizedVisit.costoVisitaTecnicaDefault,
      valor_modificado: v.valorModificado ?? normalizedVisit.valorModificado,
      motivo_modificacion_valor: isKeyDeliveryVisit(tipoVisita) ? null : (v.motivoModificacionValor || null),
      valor_cobrado_cliente: normalizedVisit.valorCobradoCliente,
    })
    .select()
    .single();
  if (error) throw error;

  await upsertMirrorAndApprovalForVisit({
    visitId: data.id,
    codigoRegistro: data.codigo_registro,
    tecnicoId: data.tecnico_id,
    clienteId: data.cliente_id,
    descripcion: data.descripcion,
    observaciones: data.observaciones,
    fecha: fechaVisita,
    tipoVisita: data.tipo_visita || tipoVisita,
    costoVisitaTecnicaDefault: Number(data.costo_visita_tecnica_default ?? 0) || 0,
    valorCobradoCliente: Number(data.valor_cobrado_cliente ?? 0) || 0,
    valorModificado: data.valor_modificado ?? false,
    motivoModificacionValor: data.motivo_modificacion_valor || null,
    liderId: data.lider_id || v.liderId,
  });

  invalidateCachedValue(VISITAS_CACHE_KEY);
  invalidateCachedValue("reportes-actividad:list");
  return mapVisitWithMedia(data);
}

export async function updateVisitaTecnica(id: string, v: Partial<TechnicalVisit>): Promise<TechnicalVisit> {
  const { data: previousVisit, error: previousVisitError } = await supabase
    .from("visitas_tecnicas")
    .select("id, tecnico_id, lider_id, cliente_id, fecha_inicio, descripcion, observaciones, valor_cobrado_cliente, costo_visita_tecnica_default, tipo_visita")
    .eq("id", id)
    .single();
  if (previousVisitError) throw previousVisitError;

  const resolvedVisitType = v.tipoVisita ?? previousVisit.tipo_visita ?? "imprevisto";
  const normalizedVisit = normalizeVisitFinancials({
    tipoVisita: resolvedVisitType,
    costoVisitaTecnicaDefault: Number(v.costoVisitaTecnicaDefault ?? previousVisit.costo_visita_tecnica_default ?? 0) || 0,
    valorCobradoCliente: Number(v.valorCobradoCliente ?? previousVisit.valor_cobrado_cliente ?? 0) || 0,
  });

  const updateData: any = {};
  if (v.estado !== undefined) updateData.estado = v.estado;
  if (v.valorCobradoCliente !== undefined || isKeyDeliveryVisit(resolvedVisitType)) updateData.valor_cobrado_cliente = normalizedVisit.valorCobradoCliente;
  if (v.descripcion !== undefined) updateData.descripcion = v.descripcion;
  if (v.observaciones !== undefined) updateData.observaciones = v.observaciones;
  if (v.codigoRegistro !== undefined) updateData.codigo_registro = v.codigoRegistro || null;
  if (v.costoVisitaTecnicaDefault !== undefined || isKeyDeliveryVisit(resolvedVisitType)) updateData.costo_visita_tecnica_default = normalizedVisit.costoVisitaTecnicaDefault;
  if (v.tipoVisita !== undefined) updateData.tipo_visita = v.tipoVisita;
  if (v.valorModificado !== undefined || isKeyDeliveryVisit(resolvedVisitType)) updateData.valor_modificado = isKeyDeliveryVisit(resolvedVisitType) ? false : v.valorModificado;
  if (v.motivoModificacionValor !== undefined || isKeyDeliveryVisit(resolvedVisitType)) updateData.motivo_modificacion_valor = isKeyDeliveryVisit(resolvedVisitType) ? null : v.motivoModificacionValor;

  const { data, error } = await supabase
    .from("visitas_tecnicas")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  await upsertMirrorAndApprovalForVisit({
    visitId: data.id,
    codigoRegistro: data.codigo_registro,
    tecnicoId: data.tecnico_id,
    clienteId: data.cliente_id,
    descripcion: data.descripcion,
    observaciones: data.observaciones,
    fecha: toDateOnly(data.fecha_inicio),
    tipoVisita: data.tipo_visita || resolvedVisitType,
    costoVisitaTecnicaDefault: Number(data.costo_visita_tecnica_default ?? 0) || 0,
    valorCobradoCliente: Number(data.valor_cobrado_cliente ?? 0) || 0,
    valorModificado: data.valor_modificado ?? false,
    motivoModificacionValor: data.motivo_modificacion_valor || null,
    liderId: data.lider_id,
    previousDescripcion: previousVisit.descripcion,
  });

  invalidateCachedValue(VISITAS_CACHE_KEY);
  invalidateCachedValue("reportes-actividad:list");
  return mapVisitWithMedia(data);
}

export async function deleteVisitaTecnica(id: string): Promise<void> {
  const { error: fotosError } = await supabase
    .from("visita_tecnica_fotos")
    .delete()
    .eq("visita_tecnica_id", id);
  if (fotosError) throw fotosError;

  // Obtener datos antes de borrar para limpiar el espejo en reportes_actividad
  const { data: visitaData } = await supabase
    .from("visitas_tecnicas")
    .select("tecnico_id, fecha_inicio")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("visitas_tecnicas")
    .delete()
    .eq("id", id);
  if (error) throw error;

  // Limpiar espejo en reportes_actividad (por técnico, fecha y tipo)
  if (visitaData) {
    const fecha = visitaData.fecha_inicio?.split("T")[0];
    const deleteByVisitId = await supabase
      .from("reportes_actividad")
      .delete()
      .eq("tipo", "visita_tecnica")
      .eq("visita_tecnica_id", id);

    if (deleteByVisitId.error && !isMissingVisitRegistrationColumnError(deleteByVisitId.error)) {
      throw deleteByVisitId.error;
    }

    if (deleteByVisitId.error) {
      await supabase
        .from("reportes_actividad")
        .delete()
        .eq("tipo", "visita_tecnica")
        .eq("tecnico_id", visitaData.tecnico_id)
        .eq("fecha", fecha);
    }
  }

  invalidateCachedValue(VISITAS_CACHE_KEY);
  invalidateCachedValue("reportes-actividad:list");
}
