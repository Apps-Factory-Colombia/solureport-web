import { supabase } from "../client";
import { LiquidationEntry, LiquidationParticipant, LiquidationPeriod } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const PERIODOS_CACHE_KEY = "liquidacion:periodos";
const PERIODOS_CACHE_TTL = 30_000;
const LIQUIDATION_ENTRIES_CACHE_KEY = "liquidacion:entries";
const LIQUIDATION_ENTRIES_CACHE_TTL = 30_000;

interface LiquidationPeriodRow {
  id: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado: LiquidationPeriod["estado"];
  fecha_cierre?: string | null;
}

interface LiquidationEntryRow {
  id: string;
  codigo_registro?: string | null;
  actividad_id: string;
  grupo_id: string;
  lugar?: string | null;
  edificio?: string | null;
  fecha: string;
  foto_evidencia_url?: string | null;
  periodo_id?: string | null;
}

interface LiquidationParticipantRow {
  registro_actividad_id: string;
  tecnico_id: string;
  porcentaje: string | number | null;
  valor_calculado: string | number | null;
}

type PeriodUpdatePayload = Partial<Pick<LiquidationPeriodRow, "fecha_inicio" | "fecha_fin" | "estado">>;

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function mapPeriod(row: LiquidationPeriodRow): LiquidationPeriod {
  return {
    id: row.id,
    fechaInicio: row.fecha_inicio,
    fechaFin: row.fecha_fin,
    estado: row.estado,
    fechaCierre: row.fecha_cierre?.split("T")[0] || undefined,
  };
}

function toDateOnly(value?: Date | string): string {
  if (!value) {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offset).toISOString().split("T")[0] || "";
  }

  if (typeof value === "string") {
    return value.includes("T") ? value.split("T")[0] : value;
  }

  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().split("T")[0] || "";
}

export function getCurrentOrLatestPeriodo(periods: LiquidationPeriod[], referenceDate?: Date | string): LiquidationPeriod | undefined {
  if (periods.length === 0) return undefined;

  const currentDate = toDateOnly(referenceDate);
  return periods.find((period) => currentDate >= period.fechaInicio && currentDate <= period.fechaFin) || periods[0];
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
  const updateData: PeriodUpdatePayload = {};
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

function mapEntry(row: LiquidationEntryRow, participantes: LiquidationParticipant[]): LiquidationEntry {
  return {
    id: row.id,
    codigoRegistro: row.codigo_registro || undefined,
    actividadId: row.actividad_id,
    grupoId: row.grupo_id,
    lugar: row.lugar || row.edificio || "",
    fecha: row.fecha,
    fotoEvidencia: row.foto_evidencia_url || undefined,
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

    const registroIds = ((data || []) as LiquidationEntryRow[]).map((row) => row.id).filter(Boolean);
    const { data: parts, error: partsError } = registroIds.length > 0
      ? await supabase
        .from("actividad_participantes")
        .select("registro_actividad_id, tecnico_id, porcentaje, valor_calculado")
        .in("registro_actividad_id", registroIds)
      : { data: [], error: null };
    if (partsError) throw partsError;

    const participantesByRegistro = new Map<string, LiquidationParticipant[]>();
    for (const part of (parts || []) as LiquidationParticipantRow[]) {
      const registroId = part.registro_actividad_id;
      if (!registroId) continue;
      const current = participantesByRegistro.get(registroId) || [];
      current.push({
        tecnicoId: part.tecnico_id,
        porcentaje: toNumber(part.porcentaje),
        valorCalculado: toNumber(part.valor_calculado),
      });
      participantesByRegistro.set(registroId, current);
    }

    return ((data || []) as LiquidationEntryRow[]).map((row) => mapEntry(row, participantesByRegistro.get(row.id) || []));
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
          porcentaje: toNumber(pData.porcentaje),
          valorCalculado: toNumber(pData.valor_calculado),
        });
      }
    }
  }

  invalidateCachedValue(LIQUIDATION_ENTRIES_CACHE_KEY);
  return mapEntry(data, participantes);
}
