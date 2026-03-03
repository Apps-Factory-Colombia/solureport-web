import { supabase } from "../client";
import { ArrivalRecord } from "@/lib/types";

function mapRow(row: any): ArrivalRecord {
  return {
    id: row.id,
    usuarioId: row.usuario_id,
    fecha: row.fecha,
    horaEsperada: row.hora_entrada_programada || "",
    horaLlegada: row.hora_entrada_real || "",
    horaSalidaProgramada: row.hora_salida_programada || undefined,
    horaSalidaReal: row.hora_salida_real || undefined,
    estadoEntrada: row.estado_entrada || "no_reportado",
    estadoSalida: row.estado_salida || "no_reportado",
    tarde: row.tarde || false,
    minutosRetraso: row.minutos_retraso || 0,
    mensajeEnviado: row.mensaje_enviado || undefined,
    tipoMensaje: row.tipo_mensaje || undefined,
    descuentoAplicado: row.descuento_aplicado || false,
    porcentajeDescuento: parseFloat(row.porcentaje_descuento) || 0,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

export async function getLlegadas(): Promise<ArrivalRecord[]> {
  const { data, error } = await supabase
    .from("registros_asistencia")
    .select("*")
    .order("fecha", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function updateLlegada(id: string, updates: Partial<{
  mensajeEnviado: string;
  tipoMensaje: string;
  descuentoAplicado: boolean;
  porcentajeDescuento: number;
}>): Promise<ArrivalRecord> {
  const updateData: any = {};
  if (updates.mensajeEnviado !== undefined) updateData.mensaje_enviado = updates.mensajeEnviado;
  if (updates.tipoMensaje !== undefined) updateData.tipo_mensaje = updates.tipoMensaje;
  if (updates.descuentoAplicado !== undefined) updateData.descuento_aplicado = updates.descuentoAplicado;
  if (updates.porcentajeDescuento !== undefined) updateData.porcentaje_descuento = updates.porcentajeDescuento;

  const { data, error } = await supabase
    .from("registros_asistencia")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}
