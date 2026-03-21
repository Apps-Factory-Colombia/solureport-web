import { supabase } from "../client";
import { TechnicalVisit } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const VISITAS_CACHE_KEY = "visitas:list";
const VISITAS_CACHE_TTL = 30_000;

function mapRow(row: any, fotosAntes: string[] = [], fotosDespues: string[] = []): TechnicalVisit {
  return {
    id: row.id,
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
    valorCobradoCliente: parseFloat(row.valor_cobrado_cliente) || 0,
    estado: row.estado || "pendiente",
    fotosAntes: fotosAntes.length > 0 ? fotosAntes : undefined,
    fotosDespues: fotosDespues.length > 0 ? fotosDespues : undefined,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
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
  const { data, error } = await supabase
    .from("visitas_tecnicas")
    .insert({
      tecnico_id: v.tecnicoId,
      lider_id: v.liderId,
      cliente_id: v.clienteId,
      descripcion: v.descripcion,
      tipo_visita: v.tipoVisita || "imprevisto",
      estado: v.estado || "pendiente",
      fecha_inicio: v.fecha ? new Date(v.fecha).toISOString() : new Date().toISOString(),
      valor_cobrado_cliente: v.valorCobradoCliente || 0,
    })
    .select()
    .single();
  if (error) throw error;

  // Buscar grupo y período activo del técnico si no se proporcionan
  let grupoId = v.grupoId;
  let periodoId = v.periodoId;

  if (!grupoId && v.tecnicoId) {
    const { data: tecnico } = await supabase
      .from("usuarios")
      .select("grupo_id")
      .eq("id", v.tecnicoId)
      .single();
    grupoId = tecnico?.grupo_id || undefined;
  }

  if (!periodoId) {
    const fechaVisita = v.fecha || new Date().toISOString().split("T")[0];
    const { data: periodo } = await supabase
      .from("periodos_liquidacion")
      .select("id")
      .eq("estado", "abierto")
      .lte("fecha_inicio", fechaVisita)
      .gte("fecha_fin", fechaVisita)
      .maybeSingle();
    periodoId = periodo?.id || undefined;

    if (!periodoId) {
      const { data: periodoReciente } = await supabase
        .from("periodos_liquidacion")
        .select("id")
        .eq("estado", "abierto")
        .order("fecha_inicio", { ascending: false })
        .limit(1)
        .maybeSingle();
      periodoId = periodoReciente?.id || undefined;
    }
  }

  // Crear espejo en reportes_actividad para que aparezca en Aprobaciones
  if (periodoId) {
    await supabase.from("reportes_actividad").insert({
      tipo: "visita_tecnica",
      tecnico_id: v.tecnicoId,
      lider_grupo_id: v.liderId || null,
      grupo_id: grupoId || null,
      cliente_id: v.clienteId || null,
      fecha: v.fecha || new Date().toISOString().split("T")[0],
      descripcion: v.descripcion || "",
      observaciones: v.observaciones || null,
      estado_aprobacion_lider: "pendiente",
      costo_actividad: v.costoActividad || 0,
      costo_administrable: true,
      periodo_id: periodoId,
    });
  }

  invalidateCachedValue(VISITAS_CACHE_KEY);
  invalidateCachedValue("reportes-actividad:list");
  return mapRow(data);
}

export async function updateVisitaTecnica(id: string, v: Partial<TechnicalVisit>): Promise<TechnicalVisit> {
  const updateData: any = {};
  if (v.estado !== undefined) updateData.estado = v.estado;
  if (v.valorCobradoCliente !== undefined) updateData.valor_cobrado_cliente = v.valorCobradoCliente;
  if (v.descripcion !== undefined) updateData.descripcion = v.descripcion;

  const { data, error } = await supabase
    .from("visitas_tecnicas")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  if (v.descripcion !== undefined) {
    const fecha = data.fecha_inicio?.split("T")[0];

    await supabase
      .from("reportes_actividad")
      .update({ descripcion: v.descripcion })
      .eq("tipo", "visita_tecnica")
      .eq("tecnico_id", data.tecnico_id)
      .eq("fecha", fecha);
  }

  invalidateCachedValue(VISITAS_CACHE_KEY);
  invalidateCachedValue("reportes-actividad:list");
  return mapRow(data);
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
    await supabase
      .from("reportes_actividad")
      .delete()
      .eq("tipo", "visita_tecnica")
      .eq("tecnico_id", visitaData.tecnico_id)
      .eq("fecha", fecha);
  }

  invalidateCachedValue(VISITAS_CACHE_KEY);
  invalidateCachedValue("reportes-actividad:list");
}
