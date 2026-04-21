import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://glnihgjgzygdfnleicqb.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_YZMbuQo0VqdWKlAHIxsLfA_uPr0eh21";

process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = supabaseAnonKey;

export const testSupabase = createClient(supabaseUrl, supabaseAnonKey);

export const REAL_GROUP_ACTIVITY = {
  leaderId: "3f4ae540-9d3c-4390-a80f-b44359715719",
  groupId: "586f885e-99e5-4884-89d4-965b307e9fa0",
  periodId: "d6fff765-8788-4b34-bfa0-1febaeada02c",
  clientId: "37a86012-080f-41f1-96c2-418b651fc519",
  date: "2026-04-05",
  description: "Actividad Demo Revisión - Prueba - Prueba Cliente",
  registroId: "d926a99e-2ceb-40e0-93eb-4eee046c0962",
  sourceReportId: "0e527881-c9d7-484c-aba5-dd133e867dea",
};

export const OPEN_SHARED_ACTIVITY = {
  leaderId: "2dc94aad-8eb9-446e-9087-21c19fec7ad5",
  groupId: "22210ae8-cb78-49f6-a00f-83196d1a6db7",
  periodId: "1dde3fed-ec85-431b-b444-268f6927b3cb",
  clientId: "baa7623c-f3e8-4779-b807-f5eab02b3360",
  date: "2026-04-19",
  description: "INSTALACION DE 2 BRAZOS Y CERRADURA - Instalación de brazo de puerta principal - EDIFICIO CENTRO EJECUTIVO 96",
  registroId: "5b8962bc-4289-4f3f-9b14-3f5bb9748793",
  sourceReportId: "2412e5a5-8ee0-45f1-becd-f7d5962fd86a",
  memberReportId: "3baa02ae-71c0-4dac-9da9-e44d8b863dc4",
};

export interface GroupActivitySnapshot {
  registroId: string;
  baseValue: number;
  appliedValue: number;
  modified: boolean;
  reports: Array<{
    id: string;
    tecnicoId: string;
    costoActividad: number;
    valorModificado: boolean;
    estado: "pendiente" | "aprobado" | "rechazado";
    fechaAprobacionLider: string | null;
  }>;
  participants: Array<{
    tecnicoId: string;
    percentage: number;
    amount: number;
  }>;
  approvalItems: Array<{
    id: string;
    tecnicoId: string;
    estado: string | null;
    valor: number;
    fechaAprobacion: string | null;
    referenciaId: string | null;
  }>;
  liquidationItems: Array<{
    id: string;
    tecnicoId: string;
    estado: string | null;
    valorBase: number;
    valorGanado: number;
    porcentaje: number;
    referenciaId: string | null;
  }>;
  notificationIds: string[];
}

export async function getGroupActivitySnapshot(target = REAL_GROUP_ACTIVITY): Promise<GroupActivitySnapshot> {
  const { data: registro, error: registroError } = await testSupabase
    .from("registros_actividades")
    .select("id, valor_actividad_base, valor_actividad_aplicado, valor_modificado")
    .eq("id", target.registroId)
    .single();
  if (registroError) throw registroError;

  const { data: reports, error: reportsError } = await testSupabase
    .from("reportes_actividad")
    .select("id, tecnico_id, costo_actividad, valor_modificado, estado_aprobacion_lider, fecha_aprobacion_lider")
    .eq("grupo_id", target.groupId)
    .eq("periodo_id", target.periodId)
    .eq("fecha", target.date)
    .eq("descripcion", target.description)
    .in("tipo", ["actividad", "actividad_grupal"])
    .order("tecnico_id", { ascending: true });
  if (reportsError) throw reportsError;

  const reportIds = (reports || []).map((report) => report.id);
  const techIds = (reports || []).map((report) => report.tecnico_id);

  const { data: participants, error: participantsError } = await testSupabase
    .from("actividad_participantes")
    .select("tecnico_id, porcentaje, valor_calculado")
    .eq("registro_actividad_id", target.registroId)
    .order("tecnico_id", { ascending: true });
  if (participantsError) throw participantsError;

  const { data: approvalItems, error: approvalItemsError } = await testSupabase
    .from("items_aprobacion")
    .select("id, tecnico_id, estado, valor, fecha_aprobacion, referencia_id")
    .eq("tipo", "actividad")
    .in("referencia_id", reportIds)
    .order("tecnico_id", { ascending: true });
  if (approvalItemsError) throw approvalItemsError;

  const { data: liquidationItems, error: liquidationItemsError } = await testSupabase
    .from("items_liquidacion")
    .select("id, tecnico_id, estado, valor_base, valor_ganado, porcentaje, referencia_id")
    .eq("tipo", "actividad")
    .in("referencia_id", reportIds)
    .order("tecnico_id", { ascending: true });
  if (liquidationItemsError) throw liquidationItemsError;

  const { data: notifications, error: notificationsError } = await testSupabase
    .from("notificaciones")
    .select("id, metadata")
    .eq("tipo", "approval")
    .in("usuario_id", techIds)
    .order("fecha_creacion", { ascending: false });
  if (notificationsError) throw notificationsError;

  return {
    registroId: registro.id,
    baseValue: Number(registro.valor_actividad_base ?? 0) || 0,
    appliedValue: Number(registro.valor_actividad_aplicado ?? 0) || 0,
    modified: registro.valor_modificado ?? false,
    reports: (reports || []).map((report) => ({
      id: report.id,
      tecnicoId: report.tecnico_id,
      costoActividad: Number(report.costo_actividad ?? 0) || 0,
      valorModificado: report.valor_modificado ?? false,
      estado: report.estado_aprobacion_lider,
      fechaAprobacionLider: report.fecha_aprobacion_lider,
    })),
    participants: (participants || []).map((participant) => ({
      tecnicoId: participant.tecnico_id,
      percentage: Number(participant.porcentaje ?? 0) || 0,
      amount: Number(participant.valor_calculado ?? 0) || 0,
    })),
    approvalItems: (approvalItems || []).map((item) => ({
      id: item.id,
      tecnicoId: item.tecnico_id,
      estado: item.estado,
      valor: Number(item.valor ?? 0) || 0,
      fechaAprobacion: item.fecha_aprobacion,
      referenciaId: item.referencia_id,
    })),
    liquidationItems: (liquidationItems || []).map((item) => ({
      id: item.id,
      tecnicoId: item.tecnico_id,
      estado: item.estado,
      valorBase: Number(item.valor_base ?? 0) || 0,
      valorGanado: Number(item.valor_ganado ?? 0) || 0,
      porcentaje: Number(item.porcentaje ?? 0) || 0,
      referenciaId: item.referencia_id,
    })),
    notificationIds: (notifications || [])
      .filter((item) => reportIds.includes(String((item as { metadata?: { reporteId?: string } }).metadata?.reporteId || "")))
      .map((item) => item.id),
  };
}

export async function restoreGroupActivitySnapshot(snapshot: GroupActivitySnapshot, target = REAL_GROUP_ACTIVITY): Promise<void> {
  const { error: registroError } = await testSupabase
    .from("registros_actividades")
    .update({
      valor_actividad_aplicado: snapshot.appliedValue,
      valor_modificado: snapshot.modified,
    })
    .eq("id", snapshot.registroId);
  if (registroError) throw registroError;

  for (const participant of snapshot.participants) {
    const { error } = await testSupabase
      .from("actividad_participantes")
      .update({
        porcentaje: participant.percentage,
        valor_calculado: participant.amount,
      })
      .eq("registro_actividad_id", snapshot.registroId)
      .eq("tecnico_id", participant.tecnicoId);
    if (error) throw error;
  }

  for (const report of snapshot.reports) {
    const { error } = await testSupabase
      .from("reportes_actividad")
      .update({
        costo_actividad: report.costoActividad,
        valor_modificado: report.valorModificado,
        estado_aprobacion_lider: report.estado,
        fecha_aprobacion_lider: report.fechaAprobacionLider,
      })
      .eq("id", report.id);
    if (error) throw error;
  }

  for (const item of snapshot.approvalItems) {
    const { error } = await testSupabase
      .from("items_aprobacion")
      .update({
        estado: item.estado,
        valor: item.valor,
        fecha_aprobacion: item.fechaAprobacion,
      })
      .eq("id", item.id);
    if (error) throw error;
  }

  for (const item of snapshot.liquidationItems) {
    const { error } = await testSupabase
      .from("items_liquidacion")
      .update({
        estado: item.estado,
        valor_base: item.valorBase,
        valor_ganado: item.valorGanado,
        porcentaje: item.porcentaje,
      })
      .eq("id", item.id);
    if (error) throw error;
  }

  const { data: currentNotifications, error: currentNotificationsError } = await testSupabase
    .from("notificaciones")
    .select("id, metadata")
    .eq("tipo", "approval")
    .in("usuario_id", snapshot.reports.map((report) => report.tecnicoId));
  if (currentNotificationsError) throw currentNotificationsError;

  const notificationIdsToDelete = (currentNotifications || [])
    .filter((item) => snapshot.reports.map((report) => report.id).includes(String((item as { metadata?: { reporteId?: string } }).metadata?.reporteId || "")))
    .map((item) => item.id)
    .filter((id) => !snapshot.notificationIds.includes(id));

  if (notificationIdsToDelete.length > 0) {
    const { error } = await testSupabase
      .from("notificaciones")
      .delete()
      .in("id", notificationIdsToDelete);
    if (error) throw error;
  }
}

export async function resetOpenSharedActivityBaseline(): Promise<void> {
  const reportIds = [OPEN_SHARED_ACTIVITY.sourceReportId, OPEN_SHARED_ACTIVITY.memberReportId];
  const techIds = [OPEN_SHARED_ACTIVITY.leaderId, "ad411607-b5bf-4081-ab10-626d90d219cc"];

  let result = await testSupabase
    .from("registros_actividades")
    .update({
      valor_actividad_aplicado: 50000,
      valor_modificado: false,
    })
    .eq("id", OPEN_SHARED_ACTIVITY.registroId);
  if (result.error) throw result.error;

  result = await testSupabase
    .from("actividad_participantes")
    .update({ porcentaje: 50, valor_calculado: 25000 })
    .eq("registro_actividad_id", OPEN_SHARED_ACTIVITY.registroId)
    .in("tecnico_id", techIds);
  if (result.error) throw result.error;

  result = await testSupabase
    .from("reportes_actividad")
    .update({
      costo_actividad: 25000,
      valor_modificado: false,
      estado_aprobacion_lider: "pendiente",
      fecha_aprobacion_lider: null,
    })
    .in("id", reportIds);
  if (result.error) throw result.error;

  result = await testSupabase
    .from("items_aprobacion")
    .update({
      estado: "pendiente",
      valor: 25000,
      fecha_aprobacion: null,
    })
    .in("referencia_id", reportIds);
  if (result.error) throw result.error;

  result = await testSupabase
    .from("items_liquidacion")
    .update({
      estado: "pendiente",
      valor_base: 50000,
      valor_ganado: 25000,
      porcentaje: 50,
    })
    .in("referencia_id", reportIds);
  if (result.error) throw result.error;

  const { data: notifications, error: notificationsError } = await testSupabase
    .from("notificaciones")
    .select("id, metadata")
    .eq("tipo", "approval")
    .in("usuario_id", techIds);
  if (notificationsError) throw notificationsError;

  const notificationIdsToDelete = (notifications || [])
    .filter((item) => reportIds.includes(String((item as { metadata?: { reporteId?: string } }).metadata?.reporteId || "")))
    .map((item) => item.id);

  if (notificationIdsToDelete.length > 0) {
    result = await testSupabase.from("notificaciones").delete().in("id", notificationIdsToDelete);
    if (result.error) throw result.error;
  }
}
