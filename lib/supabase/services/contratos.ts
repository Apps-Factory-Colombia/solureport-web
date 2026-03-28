import { supabase } from "../client";
import { MaintenanceContract, MantenimientoContrato } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";
import { invalidateMantenimientosCache } from "./mantenimientos";

const CONTRATOS_CACHE_KEY = "contratos:list";
const CONTRATOS_CACHE_TTL = 60_000;

function invalidateContratosCache() {
  invalidateCachedValue(CONTRATOS_CACHE_KEY);
  invalidateMantenimientosCache();
}

function mapMantenimiento(row: any): MantenimientoContrato {
  return {
    id: row.id,
    mes: row.mes,
    fechaProgramada: row.fecha_programada,
    fechaRealizado: row.fecha_realizado || undefined,
    tecnicoId: row.tecnico_id || undefined,
    estado: row.estado,
    valorRecaudado: parseFloat(row.valor_recaudado) || 0,
  };
}

function mapRow(row: any, mantenimientos: MantenimientoContrato[]): MaintenanceContract {
  return {
    id: row.id,
    clienteId: row.cliente_id,
    anio: row.anio,
    mesInicio: row.mes_inicio || 1,
    diaInicio: row.dia_inicio || 1,
    costoTotalAnual: parseFloat(row.costo_total_anual) || 0,
    cantidadMantenimientos: row.cantidad_mantenimientos,
    costoPorMantenimiento: parseFloat(row.costo_por_mantenimiento) || 0,
    mantenimientosRealizados: mantenimientos,
    estado: row.estado,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

export async function getContratos(): Promise<MaintenanceContract[]> {
  return getCachedValue(CONTRATOS_CACHE_KEY, CONTRATOS_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("contratos_mantenimiento")
      .select("*")
      .order("anio", { ascending: false });
    if (error) throw error;

    const contractRows = data || [];
    const contractIds = contractRows.map((row: any) => row.id).filter(Boolean);

    const { data: maintenances, error: maintenancesError } = contractIds.length > 0
      ? await supabase
        .from("contrato_mantenimientos")
        .select("*")
        .in("contrato_id", contractIds)
        .order("mes")
      : { data: [], error: null };

    if (maintenancesError) throw maintenancesError;

    const maintenancesByContractId = (maintenances || []).reduce<Map<string, MantenimientoContrato[]>>((acc, row: any) => {
      const current = acc.get(row.contrato_id) || [];
      current.push(mapMantenimiento(row));
      acc.set(row.contrato_id, current);
      return acc;
    }, new Map());

    return contractRows.map((row: any) => mapRow(row, maintenancesByContractId.get(row.id) || []));
  });
}

export async function createContrato(c: Partial<MaintenanceContract>): Promise<MaintenanceContract> {
  const { data, error } = await supabase
    .from("contratos_mantenimiento")
    .insert({
      cliente_id: c.clienteId,
      anio: c.anio,
      mes_inicio: c.mesInicio || 1,
      dia_inicio: c.diaInicio || 1,
      costo_total_anual: c.costoTotalAnual,
      cantidad_mantenimientos: c.cantidadMantenimientos,
      costo_por_mantenimiento: c.costoPorMantenimiento,
      estado: c.estado || "activo",
    })
    .select()
    .single();
  if (error) throw error;

  let mantenimientos: MantenimientoContrato[] = [];
  if (c.mantenimientosRealizados && c.mantenimientosRealizados.length > 0) {
    const { data: insertedMaintenances, error: insertMaintenancesError } = await supabase
      .from("contrato_mantenimientos")
      .insert(
        c.mantenimientosRealizados.map((m) => ({
          contrato_id: data.id,
          mes: m.mes,
          fecha_programada: m.fechaProgramada,
          fecha_realizado: m.fechaRealizado || null,
          tecnico_id: m.tecnicoId || null,
          estado: m.estado || "pendiente",
          valor_recaudado: m.valorRecaudado || 0,
        }))
      )
      .select();

    if (insertMaintenancesError) throw insertMaintenancesError;
    mantenimientos = (insertedMaintenances || []).map(mapMantenimiento);
  }

  invalidateContratosCache();
  return mapRow(data, mantenimientos);
}

export async function updateContrato(id: string, c: Partial<MaintenanceContract> & { regenerarMantenimientos?: boolean }): Promise<MaintenanceContract> {
  const updateData: any = {};
  if (c.clienteId !== undefined) updateData.cliente_id = c.clienteId;
  if (c.anio !== undefined) updateData.anio = c.anio;
  if (c.mesInicio !== undefined) updateData.mes_inicio = c.mesInicio;
  if (c.diaInicio !== undefined) updateData.dia_inicio = c.diaInicio;
  if (c.costoTotalAnual !== undefined) updateData.costo_total_anual = c.costoTotalAnual;
  if (c.cantidadMantenimientos !== undefined) updateData.cantidad_mantenimientos = c.cantidadMantenimientos;
  if (c.costoPorMantenimiento !== undefined) updateData.costo_por_mantenimiento = c.costoPorMantenimiento;
  if (c.estado !== undefined) updateData.estado = c.estado;

  const { data, error } = await supabase
    .from("contratos_mantenimiento")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  // Si se pide regenerar mantenimientos (solo los pendientes)
  if (c.regenerarMantenimientos && c.cantidadMantenimientos && c.anio && c.mesInicio) {
    // Eliminar solo los mantenimientos pendientes
    await supabase
      .from("contrato_mantenimientos")
      .delete()
      .eq("contrato_id", id)
      .eq("estado", "pendiente");

    // Recalcular distribución desde el mes de inicio
    const cantidad = c.cantidadMantenimientos;
    const anio = c.anio;
    const mesInicio = c.mesInicio;
    const dia = c.diaInicio || 1;
    const intervaloMeses = Math.floor(12 / cantidad);

    const nuevosMantenimientos = [];
    for (let i = 0; i < cantidad; i++) {
      const mesNum = ((mesInicio - 1 + i * intervaloMeses) % 12) + 1;
      const anioMant = anio + Math.floor((mesInicio - 1 + i * intervaloMeses) / 12);
      const diaStr = String(Math.min(dia, 28)).padStart(2, "0");
      const mesStr = String(mesNum).padStart(2, "0");
      nuevosMantenimientos.push({
        contrato_id: id,
        mes: mesNum,
        fecha_programada: `${anioMant}-${mesStr}-${diaStr}`,
        estado: "pendiente",
        valor_recaudado: 0,
      });
    }

    if (nuevosMantenimientos.length > 0) {
      await supabase.from("contrato_mantenimientos").insert(nuevosMantenimientos);
    }
  }

  const { data: mants } = await supabase
    .from("contrato_mantenimientos")
    .select("*")
    .eq("contrato_id", id)
    .order("mes");
  invalidateContratosCache();
  return mapRow(data, (mants || []).map(mapMantenimiento));
}

export async function updateMantenimientoContrato(
  id: string,
  m: Partial<Pick<MantenimientoContrato, "estado" | "fechaProgramada" | "fechaRealizado" | "valorRecaudado" | "tecnicoId">>
): Promise<MantenimientoContrato> {
  const updateData: any = {};
  if (m.estado !== undefined) updateData.estado = m.estado;
  if (m.fechaProgramada !== undefined) updateData.fecha_programada = m.fechaProgramada;
  if (m.fechaRealizado !== undefined) updateData.fecha_realizado = m.fechaRealizado || null;
  if (m.valorRecaudado !== undefined) updateData.valor_recaudado = m.valorRecaudado;
  if (m.tecnicoId !== undefined) updateData.tecnico_id = m.tecnicoId || null;

  const { data, error } = await supabase
    .from("contrato_mantenimientos")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  invalidateContratosCache();
  return mapMantenimiento(data);
}

export async function deleteContrato(id: string): Promise<void> {
  await supabase.from("contrato_mantenimientos").delete().eq("contrato_id", id);
  const { error } = await supabase.from("contratos_mantenimiento").delete().eq("id", id);
  if (error) throw error;
  invalidateContratosCache();
}
