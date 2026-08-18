export type CleanupMode = "date_range" | "period";
export type CleanupModule = "mantenimientos_preventivos" | "visitas_tecnicas" | "recorridos" | "actividades_grupales" | "aprobaciones" | "liquidacion" | "liquidaciones" | "asistencia" | "notificaciones";
export interface CleanupFilters { mode: CleanupMode; startDate?: string; endDate?: string; periodId?: string; modules: CleanupModule[]; deleteFiles?: boolean; }
export interface CleanupPreviewItem { id: string; module: CleanupModule; label: string; primaryCount: number; relatedCount: number; details: string[]; }
export interface CleanupPreview { total: number; range: { startDate: string; endDate: string }; items: CleanupPreviewItem[]; counts: Record<string, number>; matchedPeriods: Array<{ id: string; fechaInicio: string; fechaFin: string; estado: "abierto" | "cerrado" }>; warnings: string[]; }
export interface CleanupExecutionResult { success: boolean; range: { startDate: string; endDate: string }; deletedCounts: Record<string, number>; deletedPeriods: number; errors: string[]; }
import { dataRequest } from "../client";
export async function previewManualCleanup(filters: CleanupFilters): Promise<CleanupPreview> { return dataRequest<CleanupPreview>("cleanup.preview", filters); }
export async function executeManualCleanup(filters: CleanupFilters): Promise<CleanupExecutionResult> { return dataRequest<CleanupExecutionResult>("cleanup.execute", filters); }
