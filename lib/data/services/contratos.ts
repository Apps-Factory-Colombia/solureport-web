import { MaintenanceContract, MantenimientoContrato } from "@/lib/types";
import { dataRequest } from "../client";

export type ContractPayload = Omit<Partial<MaintenanceContract>, "mantenimientosRealizados"> & {
  claveIdempotencia?: string | null;
  mantenimientosRealizados?: Array<Partial<MantenimientoContrato> & Record<string, unknown>>;
};

export async function getContratos(): Promise<MaintenanceContract[]> { return dataRequest<MaintenanceContract[]>("contracts.list"); }
export async function createContrato(contract: ContractPayload): Promise<MaintenanceContract> { return dataRequest<MaintenanceContract>("contracts.create", contract); }
export async function updateContrato(id: string, contract: Partial<MaintenanceContract> & { regenerarMantenimientos?: boolean }): Promise<MaintenanceContract> { return dataRequest<MaintenanceContract>("contracts.update", { id, ...contract }); }
export async function updateMantenimientoContrato(id: string, maintenance: Partial<Pick<MantenimientoContrato, "estado" | "fechaProgramada" | "fechaRealizado" | "valorRecaudado" | "tecnicoId">>): Promise<MantenimientoContrato> { return dataRequest<MantenimientoContrato>("contracts.updateMaintenance", { id, ...maintenance }); }
export type ContractDeleteResult = { id: string; deleted: boolean; archived: boolean; message: string };
export async function deleteContrato(id: string): Promise<ContractDeleteResult> { return dataRequest<ContractDeleteResult>("contracts.delete", { id }); }
