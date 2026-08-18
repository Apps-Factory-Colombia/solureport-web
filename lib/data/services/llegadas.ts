import { ArrivalRecord, ScheduleDay } from "@/lib/types";
import { dataRequest } from "../client";

export async function ensureNoRegistradosForToday(users: unknown[], discountPercentage: number, automaticDays?: ScheduleDay[], automaticTime?: string): Promise<number> { return dataRequest<number>("arrivals.ensure", { users, porcentajeDescuento: discountPercentage, automaticDays, horaCorte: automaticTime || undefined }); }
export async function getLlegadas(): Promise<ArrivalRecord[]> { return dataRequest<ArrivalRecord[]>("arrivals.list"); }
export async function updateLlegada(id: string, updates: Partial<{
  mensajeEnviado: string;
  tipoMensaje: string;
  descuentoAplicado: boolean;
  porcentajeDescuento: number;
  estadoEntrada: ArrivalRecord["estadoEntrada"];
  estadoSalida: ArrivalRecord["estadoSalida"];
  tarde: boolean;
  minutosRetraso: number;
  razonTardanza: string | null;
  horaLlegada: string | null;
}>): Promise<ArrivalRecord> { return dataRequest<ArrivalRecord>("arrivals.update", { id, updates }); }
