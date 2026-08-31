import { Maintenance, MaintenanceReport } from "@/lib/types";
import { dataRequest } from "../client";

export type MaintenanceAdminView = "todos" | "programados" | "proximos" | "vencidos" | "realizados" | "calendario";

export interface MaintenanceAdminPage {
  items: Maintenance[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  today?: string;
  generatedAt?: string;
  view?: MaintenanceAdminView;
}

export function invalidateMantenimientosCache() {}
export function invalidateReportesMantenimientoCache() {}
export async function getMantenimientos(): Promise<Maintenance[]> { return dataRequest<Maintenance[]>("maintenances.list"); }
export async function getMantenimientosAdminPage(options: {
  view: MaintenanceAdminView;
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  month?: string;
  periodoId?: string;
}): Promise<MaintenanceAdminPage> {
  return dataRequest<MaintenanceAdminPage>("maintenances.adminPage", options);
}
export async function getMantenimientosVencidos(): Promise<{ today: string; generatedAt: string; total: number; items: Maintenance[] }> {
  return dataRequest<{ today: string; generatedAt: string; total: number; items: Maintenance[] }>("maintenances.overdue");
}
export async function createMantenimiento(maintenance: Partial<Maintenance>): Promise<Maintenance> { return dataRequest<Maintenance>("maintenances.create", maintenance); }
export async function updateMantenimiento(id: string, maintenance: Partial<Maintenance>): Promise<Maintenance> { return dataRequest<Maintenance>("maintenances.update", { id, ...maintenance }); }
export async function deleteMantenimiento(id: string): Promise<void> { await dataRequest("maintenances.delete", { id }); }
export async function getReportesMantenimiento(): Promise<MaintenanceReport[]> { return dataRequest<MaintenanceReport[]>("maintenances.reports"); }
export async function syncReporteMantenimientoToActividad(id: string): Promise<void> { void id; }
export async function updateReporteEnvio(id: string): Promise<void> { await dataRequest("reports.emailSent", { id }); }
export async function deleteReporteMantenimiento(id: string): Promise<void> { await dataRequest("reports.delete", { id }); }
