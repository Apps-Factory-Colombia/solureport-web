import { supabase } from "../client";
import { Activity, PriceHistory } from "@/lib/types";

interface ActivityRow {
  id: string;
  codigo: string;
  nombre?: string | null;
  descripcion?: string | null;
  valor_economico?: number | string | null;
  estado: "activo" | "inactivo";
  fecha_creacion?: string | null;
}

interface ActivityHistoryRow {
  actividad_id: string;
  fecha: string;
  valor_anterior?: number | string | null;
  valor_nuevo?: number | string | null;
}

function mapRow(row: ActivityRow, historial: PriceHistory[] = []): Activity {
  return {
    id: row.id,
    codigo: row.codigo,
    descripcion: row.nombre || row.descripcion || "",
    valorEconomico: Number(row.valor_economico ?? 0) || 0,
    estado: row.estado,
    historialPrecios: historial,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

function mapHistorial(row: ActivityHistoryRow): PriceHistory {
  return {
    fecha: row.fecha,
    valorAnterior: Number(row.valor_anterior ?? 0) || 0,
    valorNuevo: Number(row.valor_nuevo ?? 0) || 0,
  };
}

export async function getActividades(): Promise<Activity[]> {
  const { data, error } = await supabase
    .from("actividades")
    .select("*")
    .order("codigo", { ascending: true });
  if (error) throw error;

  const activityRows = (data || []) as ActivityRow[];
  const activityIds = activityRows.map((row) => row.id);

  const { data: historyData, error: historyError } = activityIds.length > 0
    ? await supabase
      .from("actividades_historial_precios")
      .select("actividad_id, fecha, valor_anterior, valor_nuevo")
      .in("actividad_id", activityIds)
      .order("fecha", { ascending: false })
    : { data: [], error: null };

  if (historyError) throw historyError;

  const historyByActivityId = new Map<string, PriceHistory[]>();
  for (const historyRow of (historyData || []) as ActivityHistoryRow[]) {
    const current = historyByActivityId.get(historyRow.actividad_id) || [];
    current.push(mapHistorial(historyRow));
    historyByActivityId.set(historyRow.actividad_id, current);
  }

  return activityRows.map((row) => mapRow(row, historyByActivityId.get(row.id) || []));
}

export async function createActividad(activity: Partial<Activity>): Promise<Activity> {
  const { data, error } = await supabase
    .from("actividades")
    .insert({
      codigo: activity.codigo,
      nombre: activity.descripcion,
      descripcion: activity.descripcion,
      valor_economico: activity.valorEconomico || 0,
      estado: activity.estado || "activo",
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateActividad(id: string, activity: Partial<Activity>): Promise<Activity> {
  const current = await supabase.from("actividades").select("valor_economico").eq("id", id).single();

  const updateData: Record<string, unknown> = {};
  if (activity.codigo !== undefined) updateData.codigo = activity.codigo;
  if (activity.descripcion !== undefined) { updateData.nombre = activity.descripcion; updateData.descripcion = activity.descripcion; }
  if (activity.valorEconomico !== undefined) updateData.valor_economico = activity.valorEconomico;
  if (activity.estado !== undefined) updateData.estado = activity.estado;

  const { data, error } = await supabase
    .from("actividades")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  const currentValue = Number(current.data?.valor_economico ?? 0) || 0;
  if (activity.valorEconomico !== undefined && current.data && currentValue !== activity.valorEconomico) {
    await supabase.from("actividades_historial_precios").insert({
      actividad_id: id,
      fecha: new Date().toISOString().split("T")[0],
      valor_anterior: currentValue,
      valor_nuevo: activity.valorEconomico,
    });
  }

  const { data: hist } = await supabase
    .from("actividades_historial_precios")
    .select("*")
    .eq("actividad_id", id)
    .order("fecha", { ascending: false });
  return mapRow(data, (hist || []).map(mapHistorial));
}

export async function deleteActividad(id: string): Promise<void> {
  const { error } = await supabase.from("actividades").delete().eq("id", id);
  if (error) throw error;
}
