import { ActivityReport } from "@/lib/types";

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
