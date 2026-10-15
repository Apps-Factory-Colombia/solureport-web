import {
  ArrivalRecord,
  AttendanceDaySummary,
  AttendanceFortnightlyReport,
  AttendanceMemo,
} from "@/lib/types";
import { dataRequest } from "../client";

export interface AttendanceDayResponse {
  fecha: string;
  records: Array<ArrivalRecord & {
    usuarioNombre?: string;
    usuarioAvatar?: string;
    periodoId?: string;
    periodoEstado?: string;
    periodoFechaInicio?: string;
    periodoFechaFin?: string;
    liquidacionPorcentaje?: number;
    liquidacionValor?: number;
    memorandoEstado?: string;
  }>;
  summary: AttendanceDaySummary;
  period?: { id: string; fechaInicio?: string; fechaFin?: string; estado?: string } | null;
}

export interface AttendanceHistoryResponse {
  fechaInicio: string;
  fechaFin: string;
  total: number;
  page: number;
  pageSize: number;
  records: AttendanceDayResponse["records"];
}

export interface AttendanceMemosResponse {
  items: AttendanceMemo[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getAttendanceDay(fecha: string, filters: Record<string, unknown> = {}) {
  return dataRequest<AttendanceDayResponse>("attendance.day", { fecha, ...filters });
}

export async function getAttendanceHistory(
  fechaInicio: string,
  fechaFin: string,
  filters: Record<string, unknown> = {},
) {
  return dataRequest<AttendanceHistoryResponse>("attendance.history", { fechaInicio, fechaFin, ...filters });
}

export async function getAttendanceFortnightly(mes: string, quincena: "primera" | "segunda", filters: Record<string, unknown> = {}) {
  return dataRequest<AttendanceFortnightlyReport>("attendance.fortnightly", { mes, quincena, ...filters });
}

export async function getAttendanceMemos(filters: Record<string, unknown> = {}) {
  return dataRequest<AttendanceMemosResponse>("attendance.memos", filters);
}

export async function createAttendanceMemo(payload: {
  asistenciaIds: string[];
  usuarioId?: string;
  periodoId?: string;
  tipo?: string;
  titulo?: string;
  narrativa?: string;
}) {
  return dataRequest<AttendanceMemo>("attendance.memo.create", payload);
}

export async function updateAttendanceMemo(payload: {
  id: string;
  action: "firmar" | "anular";
  nombre?: string;
  documento?: string;
  motivo?: string;
}) {
  return dataRequest<AttendanceMemo>("attendance.memo.update", payload);
}
