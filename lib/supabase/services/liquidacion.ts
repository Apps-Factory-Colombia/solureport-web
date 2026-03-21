import { supabase } from "../client";
import { LiquidationEntry, LiquidationParticipant, LiquidationPeriod } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const PERIODOS_CACHE_KEY = "liquidacion:periodos";
const PERIODOS_CACHE_TTL = 30_000;
const LIQUIDATION_ENTRIES_CACHE_KEY = "liquidacion:entries";
const LIQUIDATION_ENTRIES_CACHE_TTL = 30_000;

function mapPeriod(row: any): LiquidationPeriod {
  return {
    id: row.id,
    fechaInicio: row.fecha_inicio,
    fechaFin: row.fecha_fin,
    estado: row.estado,
    fechaCierre: row.fecha_cierre?.split("T")[0] || undefined,
  };
}

export async function getPeriodos(): Promise<LiquidationPeriod[]> {
  return getCachedValue(PERIODOS_CACHE_KEY, PERIODOS_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("periodos_liquidacion")
      .select("*")
      .order("fecha_inicio", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapPeriod);
  });
}

export async function createPeriodo(p: Partial<LiquidationPeriod>): Promise<LiquidationPeriod> {
  const { data, error } = await supabase
    .from("periodos_liquidacion")
    .insert({
      fecha_inicio: p.fechaInicio,
      fecha_fin: p.fechaFin,
      estado: p.estado || "abierto",
    })
    .select()
    .single();
  if (error) throw error;
  invalidateCachedValue(PERIODOS_CACHE_KEY);
  return mapPeriod(data);
}

export async function updatePeriodo(id: string, p: Partial<LiquidationPeriod>): Promise<LiquidationPeriod> {
  const updateData: any = {};
  if (p.fechaInicio !== undefined) updateData.fecha_inicio = p.fechaInicio;
  if (p.fechaFin !== undefined) updateData.fecha_fin = p.fechaFin;
  if (p.estado !== undefined) updateData.estado = p.estado;

  const { data, error } = await supabase
    .from("periodos_liquidacion")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  invalidateCachedValue(PERIODOS_CACHE_KEY);
  return mapPeriod(data);
}

export async function closePeriodo(id: string): Promise<LiquidationPeriod> {
  const { data, error } = await supabase
    .from("periodos_liquidacion")
    .update({ estado: "cerrado", fecha_cierre: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  invalidateCachedValue(PERIODOS_CACHE_KEY);
  return mapPeriod(data);
}

export async function deletePeriodo(id: string): Promise<void> {
  const { error } = await supabase
    .from("periodos_liquidacion")
    .delete()
    .eq("id", id);
  if (error) throw error;
  invalidateCachedValue(PERIODOS_CACHE_KEY);
}

function mapEntry(row: any, participantes: LiquidationParticipant[]): LiquidationEntry {
  return {
    id: row.id,
    actividadId: row.actividad_id,
    grupoId: row.grupo_id,
    lugar: row.lugar || row.edificio || "",
    fecha: row.fecha,
    participantes,
    periodoId: row.periodo_id || "",
  };
}

export async function getLiquidationEntries(): Promise<LiquidationEntry[]> {
  return getCachedValue(LIQUIDATION_ENTRIES_CACHE_KEY, LIQUIDATION_ENTRIES_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("registros_actividades")
      .select("*")
      .order("fecha", { ascending: false });
    if (error) throw error;

    const registroIds = (data || []).map((row: any) => row.id).filter(Boolean);
    const { data: parts, error: partsError } = registroIds.length > 0
      ? await supabase
        .from("actividad_participantes")
        .select("registro_actividad_id, tecnico_id, porcentaje, valor_calculado")
        .in("registro_actividad_id", registroIds)
      : { data: [], error: null };
    if (partsError) throw partsError;

    const participantesByRegistro = new Map<string, LiquidationParticipant[]>();
    for (const part of parts || []) {
      const registroId = part.registro_actividad_id;
      if (!registroId) continue;
      const current = participantesByRegistro.get(registroId) || [];
      current.push({
        tecnicoId: part.tecnico_id,
        porcentaje: parseFloat(part.porcentaje) || 0,
        valorCalculado: parseFloat(part.valor_calculado) || 0,
      });
      participantesByRegistro.set(registroId, current);
    }

    return (data || []).map((row: any) => mapEntry(row, participantesByRegistro.get(row.id) || []));
  });
}

export async function createLiquidationEntry(entry: Partial<LiquidationEntry> & { periodoId: string }): Promise<LiquidationEntry> {
  const { data, error } = await supabase
    .from("registros_actividades")
    .insert({
      actividad_id: entry.actividadId,
      lider_id: entry.participantes?.[0]?.tecnicoId || null,
      grupo_id: entry.grupoId,
      periodo_id: entry.periodoId,
      lugar: entry.lugar,
      edificio: entry.lugar,
      fecha: entry.fecha,
    })
    .select()
    .single();
  if (error) throw error;

  const participantes: LiquidationParticipant[] = [];
  if (entry.participantes) {
    for (const p of entry.participantes) {
      const { data: pData } = await supabase
        .from("actividad_participantes")
        .insert({
          registro_actividad_id: data.id,
          tecnico_id: p.tecnicoId,
          porcentaje: p.porcentaje,
          valor_calculado: p.valorCalculado,
        })
        .select()
        .single();
      if (pData) {
        participantes.push({
          tecnicoId: pData.tecnico_id,
          porcentaje: parseFloat(pData.porcentaje),
          valorCalculado: parseFloat(pData.valor_calculado),
        });
      }
    }
  }

  invalidateCachedValue(LIQUIDATION_ENTRIES_CACHE_KEY);
  return mapEntry(data, participantes);
}
