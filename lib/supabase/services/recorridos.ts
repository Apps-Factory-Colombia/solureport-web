import { supabase } from "../client";
import { getConfiguracion } from "./configuracion";

export interface Recorrido {
  id: string;
  tecnicoId: string;
  fecha: string;
  puntoPartida: string;
  puntoLlegada: string;
  tipoRecorrido: "normal" | "con_herramienta";
  estado: string;
  valor: number;
  fotoHerramientaUrl?: string;
  liderGrupoId?: string;
  grupoId?: string;
  periodoId?: string;
  fechaCreacion: string;
}

function mapRow(row: any): Recorrido {
  return {
    id: row.id,
    tecnicoId: row.tecnico_id,
    fecha: row.fecha?.split("T")[0] || "",
    puntoPartida: row.punto_partida || "",
    puntoLlegada: row.punto_llegada || "",
    tipoRecorrido: row.tipo_recorrido || "normal",
    estado: row.estado || "pendiente",
    valor: parseFloat(row.valor) || 0,
    fotoHerramientaUrl: row.foto_herramienta_url || undefined,
    liderGrupoId: row.lider_grupo_id || undefined,
    grupoId: row.grupo_id || undefined,
    periodoId: row.periodo_id || undefined,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

export async function getRecorridos(): Promise<Recorrido[]> {
  const { data, error } = await supabase
    .from("recorridos")
    .select("*")
    .order("fecha", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function createRecorrido(r: Partial<Recorrido>): Promise<Recorrido> {
  const configuracion = await getConfiguracion();
  const configuredValue = (r.tipoRecorrido || "normal") === "con_herramienta"
    ? configuracion.costoRecorridoHerramienta
    : configuracion.costoRecorridoNormal;
  const normalizedValue = r.valor != null ? Number(r.valor) || 0 : configuredValue;

  const { data, error } = await supabase
    .from("recorridos")
    .insert({
      tecnico_id: r.tecnicoId,
      fecha: r.fecha || new Date().toISOString().split("T")[0],
      punto_partida: r.puntoPartida,
      punto_llegada: r.puntoLlegada,
      tipo_recorrido: r.tipoRecorrido || "normal",
      estado: r.estado || "completado",
      valor: normalizedValue,
      foto_herramienta_url: r.fotoHerramientaUrl || null,
    })
    .select()
    .single();
  if (error) throw error;

  // Buscar grupo y líder del técnico
  let grupoId = r.grupoId;
  let liderGrupoId = r.liderGrupoId;

  if (r.tecnicoId && (!grupoId || !liderGrupoId)) {
    const { data: tecnico } = await supabase
      .from("usuarios")
      .select("grupo_id")
      .eq("id", r.tecnicoId)
      .single();
    grupoId = grupoId || tecnico?.grupo_id || undefined;

    if (grupoId && !liderGrupoId) {
      const { data: grupo } = await supabase
        .from("grupos_trabajo")
        .select("lider_id")
        .eq("id", grupoId)
        .single();
      liderGrupoId = grupo?.lider_id || undefined;
    }
  }

  // Buscar período activo
  let periodoId = r.periodoId;
  if (!periodoId) {
    const fechaRecorrido = r.fecha || new Date().toISOString().split("T")[0];
    const { data: periodo } = await supabase
      .from("periodos_liquidacion")
      .select("id")
      .eq("estado", "abierto")
      .lte("fecha_inicio", fechaRecorrido)
      .gte("fecha_fin", fechaRecorrido)
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

  // Crear espejo en reportes_actividad
  if (periodoId) {
    await supabase.from("reportes_actividad").insert({
      tipo: "recorrido",
      tecnico_id: r.tecnicoId,
      lider_grupo_id: liderGrupoId || null,
      grupo_id: grupoId || null,
      fecha: r.fecha || new Date().toISOString().split("T")[0],
      descripcion: `Recorrido ${r.tipoRecorrido === "con_herramienta" ? "con herramienta" : "normal"}: ${r.puntoPartida} → ${r.puntoLlegada}`,
      punto_partida: r.puntoPartida,
      punto_llegada: r.puntoLlegada,
      tipo_recorrido: r.tipoRecorrido || "normal",
      foto_herramienta_url: r.fotoHerramientaUrl || null,
      estado_aprobacion_lider: "pendiente",
      costo_actividad_default: configuredValue,
      costo_actividad: normalizedValue,
      valor_modificado: normalizedValue !== configuredValue,
      costo_administrable: false,
      periodo_id: periodoId,
    });
  }

  return mapRow(data);
}

export async function deleteRecorrido(id: string): Promise<void> {
  const { data: recorridoData } = await supabase
    .from("recorridos")
    .select("tecnico_id, fecha")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("recorridos").delete().eq("id", id);
  if (error) throw error;

  if (recorridoData) {
    const fecha = recorridoData.fecha?.split("T")[0];
    await supabase
      .from("reportes_actividad")
      .delete()
      .eq("tipo", "recorrido")
      .eq("tecnico_id", recorridoData.tecnico_id)
      .eq("fecha", fecha);
  }
}
