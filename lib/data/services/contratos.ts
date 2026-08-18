import { MaintenanceContract, MantenimientoContrato } from "@/lib/types";
import { dataRequest } from "../client";

export async function getContratos(): Promise<MaintenanceContract[]> { return dataRequest<MaintenanceContract[]>("contracts.list"); }
export async function createContrato(contract: Partial<MaintenanceContract>): Promise<MaintenanceContract> { return dataRequest<MaintenanceContract>("contracts.create", contract); }
export async function updateContrato(id: string, contract: Partial<MaintenanceContract> & { regenerarMantenimientos?: boolean }): Promise<MaintenanceContract> { return dataRequest<MaintenanceContract>("contracts.update", { id, ...contract }); }
export async function updateMantenimientoContrato(id: string, maintenance: Partial<Pick<MantenimientoContrato, "estado" | "fechaProgramada" | "fechaRealizado" | "valorRecaudado" | "tecnicoId">>): Promise<MantenimientoContrato> { return dataRequest<MantenimientoContrato>("contracts.updateMaintenance", { id, ...maintenance }); }
export async function deleteContrato(id: string): Promise<void> { await dataRequest("contracts.delete", { id }); }
