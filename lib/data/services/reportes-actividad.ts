import { ActivityReport, LeaderAccumulation, LeaderApprovalBatch } from "@/lib/types";
import { dataRequest } from "../client";
import { BUCKETS, uploadFile } from "@/lib/storage/supabase";

export async function getReportesActividad(filters?: Record<string, unknown>): Promise<ActivityReport[]> { return dataRequest<ActivityReport[]>("reports.list", filters || {}); }
export async function deleteReporteActividadAdmin(id: string): Promise<void> { await dataRequest("reports.delete", { id }); }
export async function markReporteActividadEmailSent(id: string, sentAt?: string): Promise<void> { await dataRequest("reports.emailSent", { id, sentAt }); }
export async function updateCostoActividadAdmin(id: string, value: number, options?: Record<string, unknown>): Promise<void> { await dataRequest("reports.cost", { id, value, ...(options || {}) }); }
export async function updateCostoClienteVisitaAdmin(id: string, value: number | null, visitaTecnicaId?: string): Promise<void> { await dataRequest("reports.clientCost", { id, value, visitaTecnicaId }); }
export async function updateActividadGrupalBaseAdmin(id: string, value: number, options?: Record<string, unknown>): Promise<void> { await dataRequest("reports.activityBase", { id, value, ...(options || {}) }); }
export async function updateEstadoAprobacion(id: string, estado: "pendiente" | "aprobado" | "rechazado"): Promise<void> { await dataRequest("reports.approval", { id, estado }); }
export async function getLotesAprobacion(): Promise<LeaderApprovalBatch[]> { return dataRequest<LeaderApprovalBatch[]>("reports.batches"); }
export async function getAcumulacionesLider(): Promise<LeaderAccumulation[]> { return dataRequest<LeaderAccumulation[]>("reports.accumulations"); }
export async function upsertConfiguracionExtraLider(liderId: string, periodoId: string, settings: { porcentajeExtraLiderAplicado: number; extraLiderActivo: boolean; tecnicosExcluidosExtraIds?: string[] }): Promise<LeaderAccumulation> {
  await dataRequest("reports.leaderConfig", { liderId, periodoId, porcentaje: settings.porcentajeExtraLiderAplicado, activo: settings.extraLiderActivo, tecnicosExcluidosExtraIds: settings.tecnicosExcluidosExtraIds || [] });
  return { liderId, periodoId, totalAprobadoPago: 0, totalPendientePago: 0, extraLider: 0, totalRecorridos: 0, totalAcumulado: 0, porcentajeExtraLiderAplicado: settings.porcentajeExtraLiderAplicado, extraLiderActivo: settings.extraLiderActivo, tecnicosExcluidosExtraIds: settings.tecnicosExcluidosExtraIds || [] };
}

export async function uploadActividadGrupalEvidenciaAdmin(activityId: string, file: File | Blob, options?: { sourceReportId?: string }) {
  const ext = file instanceof File ? file.name.split(".").pop() || "jpg" : "jpg";
  const key = `group-activities/${activityId}/evidencia_${Date.now()}.${ext}`;
  const url = await uploadFile(BUCKETS.FOTOS_REPORTES, key, file);
  await dataRequest("reports.saveEvidence", { actividadId: activityId, bucket: BUCKETS.FOTOS_REPORTES, key, url, tipo: "general", sourceReportId: options?.sourceReportId });
  return url;
}
