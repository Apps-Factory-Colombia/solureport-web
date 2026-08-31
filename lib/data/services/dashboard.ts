import { dataRequest } from "../client";

export type DashboardMetrics = {
  startDate: string;
  endDate: string;
  today: string;
  generatedAt: string;
  programados: number;
  enEjecucion: number;
  realizados: number;
  mantenimientosAgendaRealizados: number;
  pendientes: number;
  vencidos: number;
  reportesGenerados: number;
  tecnicosActivos: number;
};

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  return dataRequest<DashboardMetrics>("dashboard.metrics");
}
