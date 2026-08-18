import { Maintenance, MaintenanceReport } from "@/lib/types";
import { dataRequest } from "../client";

export function invalidateMantenimientosCache() {}
export function invalidateReportesMantenimientoCache() {}
export async function getMantenimientos(): Promise<Maintenance[]> { return dataRequest<Maintenance[]>("maintenances.list"); }
export async function createMantenimiento(maintenance: Partial<Maintenance>): Promise<Maintenance> { return dataRequest<Maintenance>("maintenances.create", maintenance); }
export async function updateMantenimiento(id: string, maintenance: Partial<Maintenance>): Promise<Maintenance> { return dataRequest<Maintenance>("maintenances.update", { id, ...maintenance }); }
export async function deleteMantenimiento(id: string): Promise<void> { await dataRequest("maintenances.delete", { id }); }
export async function getReportesMantenimiento(): Promise<MaintenanceReport[]> { return dataRequest<MaintenanceReport[]>("maintenances.reports"); }
export async function syncReporteMantenimientoToActividad(id: string): Promise<void> { void id; }
export async function updateReporteEnvio(id: string): Promise<void> { await dataRequest("reports.emailSent", { id }); }
export async function deleteReporteMantenimiento(id: string): Promise<void> { await dataRequest("reports.delete", { id }); }
