import type { ActivityReport } from "@/lib/types";

// Un técnico cuenta como "reportado" solo si su entrega fue enviada (o aprobada).
// Una entrega heredada sin fecha de envío no cuenta; el servidor la trata igual.
export function hasSubmittedMaintenanceDelivery(report: { estadoEntrega?: string }) {
  return ["enviada", "aprobada"].includes(report.estadoEntrega || "");
}

// Reporte principal de un grupo (un mantenimiento o una actividad compartida).
// Prioriza al técnico que sí envió, para que un compañero sin reporte no reemplace
// en pantalla las fotos y el costo de quien sí reportó.
export function pickGroupLeadReport<T extends ActivityReport>(items: T[]): T {
  return [...items].sort((a, b) => {
    const aSent = hasSubmittedMaintenanceDelivery(a);
    const bSent = hasSubmittedMaintenanceDelivery(b);
    if (aSent !== bSent) return aSent ? -1 : 1;

    if (a.id.startsWith("reg-") !== b.id.startsWith("reg-")) {
      return a.id.startsWith("reg-") ? 1 : -1;
    }

    if (!!a.registroActividadId !== !!b.registroActividadId) {
      return a.registroActividadId ? -1 : 1;
    }

    const creationCompare = (b.fechaCreacion || "").localeCompare(a.fechaCreacion || "");
    if (creationCompare !== 0) return creationCompare;
    return b.id.localeCompare(a.id);
  })[0];
}

export function extractMaintenanceIdFromMediaUrl(url?: string) {
  if (!url) return undefined;

  const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/([0-9a-f-]{36})\//i);
  return match?.[1];
}

export function filterPreventiveMirrorReports(reports: ActivityReport[]) {
  const maintenanceIdsWithParticipantReports = new Set(
    reports
      .filter((report) => report.tipo === "mantenimiento_preventivo" && report.mantenimientoId && report.mantenimientoParticipanteId)
      .map((report) => report.mantenimientoId as string)
  );

  return reports.filter((report) => {
    if (report.tipo !== "mantenimiento_preventivo") return true;

    const mirroredMaintenanceId = extractMaintenanceIdFromMediaUrl(report.fotoBitacora || report.firmaReceptor);
    if (!mirroredMaintenanceId) return true;

    if (report.mantenimientoParticipanteId) return true;

    return !maintenanceIdsWithParticipantReports.has(mirroredMaintenanceId);
  });
}
