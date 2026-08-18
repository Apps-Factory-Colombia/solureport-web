import { LiquidationEntry, LiquidationPeriod } from "@/lib/types";
import { dataRequest } from "../client";

function dateOnly(value?: Date | string): string {
  if (!value) return new Date().toISOString().split("T")[0] || "";
  return typeof value === "string" ? value.split("T")[0] || value : value.toISOString().split("T")[0] || "";
}

export function getCurrentOrLatestPeriodo(periods: LiquidationPeriod[], referenceDate?: Date | string): LiquidationPeriod | undefined {
  if (!periods.length) return undefined;
  const date = dateOnly(referenceDate);
  return periods.find((period) => date >= period.fechaInicio && date <= period.fechaFin) || periods[0];
}
export async function getPeriodos(): Promise<LiquidationPeriod[]> { return dataRequest<LiquidationPeriod[]>("periods.list"); }
export async function createPeriodo(period: Partial<LiquidationPeriod>): Promise<LiquidationPeriod> { return dataRequest<LiquidationPeriod>("periods.create", period); }
export async function updatePeriodo(id: string, period: Partial<LiquidationPeriod>): Promise<LiquidationPeriod> { return dataRequest<LiquidationPeriod>("periods.update", { id, ...period }); }
export async function closePeriodo(id: string): Promise<LiquidationPeriod> { return dataRequest<LiquidationPeriod>("periods.close", { id }); }
export async function deletePeriodo(id: string): Promise<void> { await dataRequest("periods.delete", { id }); }
export async function getLiquidationEntries(): Promise<LiquidationEntry[]> { return dataRequest<LiquidationEntry[]>("liquidation.periodEntries"); }
export async function createLiquidationEntry(entry: Partial<LiquidationEntry> & { periodoId: string }): Promise<LiquidationEntry> { return dataRequest<LiquidationEntry>("liquidation.create", entry); }
