import { LiquidationPeriod } from "@/lib/types";
import { invalidateCachedValue } from "@/lib/utils/request-cache";
import { supabase } from "../client";
import {
    deleteAllFotosMantenimiento,
    deleteAllFotosRecorrido,
    deleteAllFotosReporteActividad,
    deleteAllFotosVisita,
} from "./storage";

export type CleanupMode = "date_range" | "period";

export type CleanupModule =
    | "mantenimientos_preventivos"
    | "visitas_tecnicas"
    | "recorridos"
    | "actividades_grupales"
    | "aprobaciones"
    | "liquidacion"
    | "asistencia"
    | "notificaciones";

export interface CleanupFilters {
    mode: CleanupMode;
    startDate?: string;
    endDate?: string;
    periodId?: string;
    modules: CleanupModule[];
    deleteFiles?: boolean;
    deletePeriods?: boolean;
}

export interface CleanupPreviewItem {
    module: CleanupModule;
    label: string;
    primaryCount: number;
    relatedCount: number;
    details: string[];
}

export interface CleanupPreview {
    range: {
        startDate: string;
        endDate: string;
    };
    matchedPeriods: LiquidationPeriod[];
    items: CleanupPreviewItem[];
    warnings: string[];
}

export interface CleanupExecutionResult {
    range: {
        startDate: string;
        endDate: string;
    };
    deletedCounts: Record<CleanupModule, number>;
    deletedPeriods: number;
}

interface CleanupWindow {
    startDate: string;
    endDate: string;
    startTimestamp: string;
    endExclusiveTimestamp: string;
    matchedPeriods: LiquidationPeriod[];
}

interface CleanupTargets {
    maintenanceIds: string[];
    maintenanceReportIds: string[];
    maintenanceActivityReportIds: string[];
    visitIds: string[];
    visitActivityReportIds: string[];
    recorridoIds: string[];
    recorridoActivityReportIds: string[];
    groupedRecordIds: string[];
    groupedActivityReportIds: string[];
    approvalIds: string[];
    approvalBatchIds: string[];
    liquidationIds: string[];
    accumulationIds: string[];
    attendanceIds: string[];
    notificationIds: string[];
    periodIds: string[];
}

interface IdRow {
    id: string;
}

interface PeriodRow {
    id: string;
    fecha_inicio: string;
    fecha_fin: string;
    estado: LiquidationPeriod["estado"];
    fecha_cierre?: string | null;
}

const MODULE_LABELS: Record<CleanupModule, string> = {
    mantenimientos_preventivos: "Mantenimientos preventivos",
    visitas_tecnicas: "Visitas técnicas",
    recorridos: "Recorridos",
    actividades_grupales: "Actividades grupales",
    aprobaciones: "Aprobaciones",
    liquidacion: "Liquidación",
    asistencia: "Asistencia",
    notificaciones: "Notificaciones",
};

function normalizeRange(startDate?: string, endDate?: string) {
    const normalizedStart = startDate || endDate || "";
    const normalizedEnd = endDate || startDate || "";

    if (!normalizedStart || !normalizedEnd) {
        throw new Error("Debes seleccionar un rango válido para ejecutar la depuración.");
    }

    return normalizedStart <= normalizedEnd
        ? { startDate: normalizedStart, endDate: normalizedEnd }
        : { startDate: normalizedEnd, endDate: normalizedStart };
}

function addOneDay(date: string) {
    const nextDate = new Date(`${date}T00:00:00`);
    nextDate.setDate(nextDate.getDate() + 1);
    return nextDate.toISOString().slice(0, 10);
}

function mapPeriod(row: PeriodRow): LiquidationPeriod {
    return {
        id: row.id,
        fechaInicio: row.fecha_inicio,
        fechaFin: row.fecha_fin,
        estado: row.estado,
        fechaCierre: row.fecha_cierre?.split("T")[0] || undefined,
    };
}

async function getAllPeriods(): Promise<LiquidationPeriod[]> {
    const { data, error } = await supabase
        .from("periodos_liquidacion")
        .select("id, fecha_inicio, fecha_fin, estado, fecha_cierre")
        .order("fecha_inicio", { ascending: false });
    if (error) throw error;
    return ((data || []) as PeriodRow[]).map(mapPeriod);
}

async function resolveCleanupWindow(filters: CleanupFilters): Promise<CleanupWindow> {
    if (filters.mode === "period") {
        if (!filters.periodId) {
            throw new Error("Debes seleccionar un cierre o período para la depuración.");
        }

        const { data, error } = await supabase
            .from("periodos_liquidacion")
            .select("id, fecha_inicio, fecha_fin, estado, fecha_cierre")
            .eq("id", filters.periodId)
            .single();
        if (error) throw error;

        const period = mapPeriod(data as PeriodRow);
        return {
            startDate: period.fechaInicio,
            endDate: period.fechaFin,
            startTimestamp: `${period.fechaInicio}T00:00:00`,
            endExclusiveTimestamp: `${addOneDay(period.fechaFin)}T00:00:00`,
            matchedPeriods: [period],
        };
    }

    const { startDate, endDate } = normalizeRange(filters.startDate, filters.endDate);
    const allPeriods = await getAllPeriods();
    const matchedPeriods = allPeriods.filter((period) => period.fechaInicio <= endDate && period.fechaFin >= startDate);

    return {
        startDate,
        endDate,
        startTimestamp: `${startDate}T00:00:00`,
        endExclusiveTimestamp: `${addOneDay(endDate)}T00:00:00`,
        matchedPeriods,
    };
}

async function selectIdsByDate(table: string, column: string, startDate: string, endDate: string) {
    const { data, error } = await supabase
        .from(table)
        .select("id")
        .gte(column, startDate)
        .lte(column, endDate);
    if (error) throw error;
    return ((data || []) as IdRow[]).map((row) => row.id);
}

async function selectIdsByTimestamp(table: string, column: string, startTimestamp: string, endExclusiveTimestamp: string) {
    const { data, error } = await supabase
        .from(table)
        .select("id")
        .gte(column, startTimestamp)
        .lt(column, endExclusiveTimestamp);
    if (error) throw error;
    return ((data || []) as IdRow[]).map((row) => row.id);
}

async function collectTargets(window: CleanupWindow, modules: CleanupModule[]): Promise<CleanupTargets> {
    const periodIds = window.matchedPeriods.map((period) => period.id);
    const needsMaintenances = modules.includes("mantenimientos_preventivos");
    const needsVisits = modules.includes("visitas_tecnicas");
    const needsRecorridos = modules.includes("recorridos");
    const needsGrouped = modules.includes("actividades_grupales");
    const needsApprovals = modules.includes("aprobaciones");
    const needsLiquidation = modules.includes("liquidacion");
    const needsAttendance = modules.includes("asistencia");
    const needsNotifications = modules.includes("notificaciones");

    const [
        maintenanceIds,
        maintenanceReportIds,
        maintenanceActivityReportIds,
        visitIds,
        visitActivityReportIds,
        recorridoIds,
        recorridoActivityReportIds,
        groupedRecordIds,
        groupedActivityReportIds,
        approvalIds,
        approvalBatchIds,
        liquidationIds,
        accumulationIds,
        attendanceIds,
        notificationIds,
    ] = await Promise.all([
        needsMaintenances ? selectIdsByDate("mantenimientos", "fecha_programada", window.startDate, window.endDate) : Promise.resolve([]),
        needsMaintenances ? (async () => {
            const maintenanceIdsInRange = await selectIdsByDate("mantenimientos", "fecha_programada", window.startDate, window.endDate);
            if (maintenanceIdsInRange.length === 0) return [];
            const { data, error } = await supabase
                .from("reportes_mantenimiento")
                .select("id")
                .in("mantenimiento_id", maintenanceIdsInRange);
            if (error) throw error;
            return ((data || []) as IdRow[]).map((row) => row.id);
        })() : Promise.resolve([]),
        needsMaintenances ? (async () => {
            const { data, error } = await supabase
                .from("reportes_actividad")
                .select("id")
                .eq("tipo", "mantenimiento_preventivo")
                .gte("fecha", window.startDate)
                .lte("fecha", window.endDate);
            if (error) throw error;
            return ((data || []) as IdRow[]).map((row) => row.id);
        })() : Promise.resolve([]),
        needsVisits ? selectIdsByTimestamp("visitas_tecnicas", "fecha_inicio", window.startTimestamp, window.endExclusiveTimestamp) : Promise.resolve([]),
        needsVisits ? (async () => {
            const { data, error } = await supabase
                .from("reportes_actividad")
                .select("id")
                .eq("tipo", "visita_tecnica")
                .gte("fecha", window.startDate)
                .lte("fecha", window.endDate);
            if (error) throw error;
            return ((data || []) as IdRow[]).map((row) => row.id);
        })() : Promise.resolve([]),
        needsRecorridos ? selectIdsByDate("recorridos", "fecha", window.startDate, window.endDate) : Promise.resolve([]),
        needsRecorridos ? (async () => {
            const { data, error } = await supabase
                .from("reportes_actividad")
                .select("id")
                .eq("tipo", "recorrido")
                .gte("fecha", window.startDate)
                .lte("fecha", window.endDate);
            if (error) throw error;
            return ((data || []) as IdRow[]).map((row) => row.id);
        })() : Promise.resolve([]),
        needsGrouped ? selectIdsByDate("registros_actividades", "fecha", window.startDate, window.endDate) : Promise.resolve([]),
        needsGrouped ? (async () => {
            const { data, error } = await supabase
                .from("reportes_actividad")
                .select("id")
                .in("tipo", ["actividad", "actividad_grupal"])
                .gte("fecha", window.startDate)
                .lte("fecha", window.endDate);
            if (error) throw error;
            return ((data || []) as IdRow[]).map((row) => row.id);
        })() : Promise.resolve([]),
        needsApprovals ? selectIdsByDate("items_aprobacion", "fecha", window.startDate, window.endDate) : Promise.resolve([]),
        needsApprovals ? (async () => {
            if (periodIds.length > 0) {
                const { data, error } = await supabase
                    .from("lotes_aprobacion_lider")
                    .select("id")
                    .in("periodo_id", periodIds);
                if (error) throw error;
                return ((data || []) as IdRow[]).map((row) => row.id);
            }

            return selectIdsByTimestamp("lotes_aprobacion_lider", "fecha_cierre", window.startTimestamp, window.endExclusiveTimestamp);
        })() : Promise.resolve([]),
        needsLiquidation ? (async () => {
            if (periodIds.length > 0) {
                const { data, error } = await supabase
                    .from("items_liquidacion")
                    .select("id")
                    .in("periodo_id", periodIds);
                if (error) throw error;
                return ((data || []) as IdRow[]).map((row) => row.id);
            }

            return selectIdsByDate("items_liquidacion", "fecha", window.startDate, window.endDate);
        })() : Promise.resolve([]),
        needsLiquidation ? (async () => {
            if (periodIds.length === 0) return [];
            const { data, error } = await supabase
                .from("acumulacion_lideres")
                .select("id")
                .in("periodo_id", periodIds);
            if (error) throw error;
            return ((data || []) as IdRow[]).map((row) => row.id);
        })() : Promise.resolve([]),
        needsAttendance ? selectIdsByDate("registros_asistencia", "fecha", window.startDate, window.endDate) : Promise.resolve([]),
        needsNotifications ? selectIdsByTimestamp("notificaciones", "fecha", window.startTimestamp, window.endExclusiveTimestamp) : Promise.resolve([]),
    ]);

    return {
        maintenanceIds,
        maintenanceReportIds,
        maintenanceActivityReportIds,
        visitIds,
        visitActivityReportIds,
        recorridoIds,
        recorridoActivityReportIds,
        groupedRecordIds,
        groupedActivityReportIds,
        approvalIds,
        approvalBatchIds,
        liquidationIds,
        accumulationIds,
        attendanceIds,
        notificationIds,
        periodIds,
    };
}

function buildPreviewItem(module: CleanupModule, primaryCount: number, relatedCount: number, details: string[]): CleanupPreviewItem {
    return {
        module,
        label: MODULE_LABELS[module],
        primaryCount,
        relatedCount,
        details,
    };
}

export async function previewManualCleanup(filters: CleanupFilters): Promise<CleanupPreview> {
    if (filters.modules.length === 0) {
        throw new Error("Debes seleccionar al menos un bloque de datos para la depuración.");
    }

    const window = await resolveCleanupWindow(filters);
    const targets = await collectTargets(window, filters.modules);
    const warnings: string[] = [];

    if (filters.deletePeriods && window.matchedPeriods.length === 0) {
        warnings.push("No hay cierres/períodos asociados al filtro actual para eliminar.");
    }

    if (filters.deleteFiles === false) {
        warnings.push("Se eliminarán los registros de base de datos, pero los archivos, documentos e imágenes asociados quedarán intactos.");
    }

    const items = filters.modules.map((module) => {
        switch (module) {
            case "mantenimientos_preventivos":
                return buildPreviewItem(module, targets.maintenanceIds.length, targets.maintenanceReportIds.length + targets.maintenanceActivityReportIds.length, [
                    `${targets.maintenanceIds.length} mantenimientos base`,
                    `${targets.maintenanceReportIds.length} reportes preventivos`,
                    `${targets.maintenanceActivityReportIds.length} espejos en informes técnicos`,
                ]);
            case "visitas_tecnicas":
                return buildPreviewItem(module, targets.visitIds.length, targets.visitActivityReportIds.length, [
                    `${targets.visitIds.length} visitas técnicas`,
                    `${targets.visitActivityReportIds.length} espejos en informes técnicos`,
                ]);
            case "recorridos":
                return buildPreviewItem(module, targets.recorridoIds.length, targets.recorridoActivityReportIds.length, [
                    `${targets.recorridoIds.length} recorridos`,
                    `${targets.recorridoActivityReportIds.length} espejos en informes técnicos`,
                ]);
            case "actividades_grupales":
                return buildPreviewItem(module, targets.groupedRecordIds.length, targets.groupedActivityReportIds.length, [
                    `${targets.groupedRecordIds.length} registros base`,
                    `${targets.groupedActivityReportIds.length} espejos en informes técnicos`,
                ]);
            case "aprobaciones":
                return buildPreviewItem(module, targets.approvalIds.length, targets.approvalBatchIds.length, [
                    `${targets.approvalIds.length} items de aprobación`,
                    `${targets.approvalBatchIds.length} lotes cerrados`,
                ]);
            case "liquidacion":
                return buildPreviewItem(module, targets.liquidationIds.length, targets.accumulationIds.length, [
                    `${targets.liquidationIds.length} items de liquidación`,
                    `${targets.accumulationIds.length} acumulados de líder`,
                ]);
            case "asistencia":
                return buildPreviewItem(module, targets.attendanceIds.length, 0, [`${targets.attendanceIds.length} registros de asistencia`]);
            case "notificaciones":
                return buildPreviewItem(module, targets.notificationIds.length, 0, [`${targets.notificationIds.length} notificaciones`]);
            default:
                return buildPreviewItem(module, 0, 0, []);
        }
    });

    return {
        range: {
            startDate: window.startDate,
            endDate: window.endDate,
        },
        matchedPeriods: window.matchedPeriods,
        items,
        warnings,
    };
}

async function deleteRowsByIds(table: string, ids: string[]) {
    if (ids.length === 0) return;
    const { error } = await supabase.from(table).delete().in("id", ids);
    if (error) throw error;
}

async function deleteRowsByReferenceId(table: string, referenceIds: string[]) {
    if (referenceIds.length === 0) return;
    const { error } = await supabase.from(table).delete().in("referencia_id", referenceIds);
    if (error) throw error;
}

async function deleteActivityReportArtifacts(reportIds: string[], deleteFiles: boolean) {
    if (reportIds.length === 0) return;

    if (deleteFiles) {
        for (const reportId of reportIds) {
            await deleteAllFotosReporteActividad(reportId);
        }
    } else {
        const { error } = await supabase
            .from("reporte_actividad_fotos")
            .delete()
            .in("reporte_actividad_id", reportIds);
        if (error) throw error;
    }
}

async function deleteMaintenanceArtifacts(maintenanceIds: string[], deleteFiles: boolean) {
    if (maintenanceIds.length === 0) return;

    if (deleteFiles) {
        for (const maintenanceId of maintenanceIds) {
            await deleteAllFotosMantenimiento(maintenanceId);
        }
    } else {
        const { error } = await supabase
            .from("mantenimiento_fotos")
            .delete()
            .in("mantenimiento_id", maintenanceIds);
        if (error) throw error;
    }
}

async function deleteVisitArtifacts(visitIds: string[], deleteFiles: boolean) {
    if (visitIds.length === 0) return;

    if (deleteFiles) {
        for (const visitId of visitIds) {
            await deleteAllFotosVisita(visitId);
        }
    } else {
        const { error } = await supabase
            .from("visita_tecnica_fotos")
            .delete()
            .in("visita_tecnica_id", visitIds);
        if (error) throw error;
    }
}

async function deleteRecorridoArtifacts(recorridoIds: string[], deleteFiles: boolean) {
    if (recorridoIds.length === 0 || !deleteFiles) return;

    for (const recorridoId of recorridoIds) {
        await deleteAllFotosRecorrido(recorridoId);
    }
}

function buildEmptyDeletedCounts(): Record<CleanupModule, number> {
    return {
        mantenimientos_preventivos: 0,
        visitas_tecnicas: 0,
        recorridos: 0,
        actividades_grupales: 0,
        aprobaciones: 0,
        liquidacion: 0,
        asistencia: 0,
        notificaciones: 0,
    };
}

export async function executeManualCleanup(filters: CleanupFilters): Promise<CleanupExecutionResult> {
    if (filters.modules.length === 0) {
        throw new Error("Debes seleccionar al menos un bloque de datos para eliminar.");
    }

    const deleteFiles = filters.deleteFiles !== false;
    const window = await resolveCleanupWindow(filters);
    const targets = await collectTargets(window, filters.modules);
    const deletedCounts = buildEmptyDeletedCounts();

    if (filters.modules.includes("mantenimientos_preventivos")) {
        await deleteActivityReportArtifacts(targets.maintenanceActivityReportIds, deleteFiles);
        await deleteMaintenanceArtifacts(targets.maintenanceIds, deleteFiles);
        await deleteRowsByReferenceId("items_aprobacion", targets.maintenanceActivityReportIds);
        await deleteRowsByReferenceId("items_liquidacion", targets.maintenanceActivityReportIds);
        await deleteRowsByIds("reportes_actividad", targets.maintenanceActivityReportIds);
        await deleteRowsByIds("reportes_mantenimiento", targets.maintenanceReportIds);
        await deleteRowsByIds("mantenimientos", targets.maintenanceIds);
        deletedCounts.mantenimientos_preventivos = targets.maintenanceIds.length + targets.maintenanceReportIds.length + targets.maintenanceActivityReportIds.length;
    }

    if (filters.modules.includes("visitas_tecnicas")) {
        await deleteActivityReportArtifacts(targets.visitActivityReportIds, deleteFiles);
        await deleteVisitArtifacts(targets.visitIds, deleteFiles);
        await deleteRowsByReferenceId("items_aprobacion", targets.visitActivityReportIds);
        await deleteRowsByReferenceId("items_liquidacion", targets.visitActivityReportIds);
        await deleteRowsByIds("reportes_actividad", targets.visitActivityReportIds);
        await deleteRowsByIds("visitas_tecnicas", targets.visitIds);
        deletedCounts.visitas_tecnicas = targets.visitIds.length + targets.visitActivityReportIds.length;
    }

    if (filters.modules.includes("recorridos")) {
        await deleteActivityReportArtifacts(targets.recorridoActivityReportIds, deleteFiles);
        await deleteRecorridoArtifacts(targets.recorridoIds, deleteFiles);
        await deleteRowsByReferenceId("items_liquidacion", targets.recorridoActivityReportIds);
        await deleteRowsByIds("reportes_actividad", targets.recorridoActivityReportIds);
        await deleteRowsByIds("recorridos", targets.recorridoIds);
        deletedCounts.recorridos = targets.recorridoIds.length + targets.recorridoActivityReportIds.length;
    }

    if (filters.modules.includes("actividades_grupales")) {
        await deleteActivityReportArtifacts(targets.groupedActivityReportIds, deleteFiles);
        if (targets.groupedRecordIds.length > 0) {
            const { error: participantesError } = await supabase
                .from("actividad_participantes")
                .delete()
                .in("registro_actividad_id", targets.groupedRecordIds);
            if (participantesError) throw participantesError;
        }
        await deleteRowsByReferenceId("items_aprobacion", targets.groupedActivityReportIds);
        await deleteRowsByReferenceId("items_liquidacion", targets.groupedActivityReportIds);
        await deleteRowsByIds("reportes_actividad", targets.groupedActivityReportIds);
        await deleteRowsByIds("registros_actividades", targets.groupedRecordIds);
        deletedCounts.actividades_grupales = targets.groupedRecordIds.length + targets.groupedActivityReportIds.length;
    }

    if (filters.modules.includes("aprobaciones")) {
        await deleteRowsByIds("items_aprobacion", targets.approvalIds);
        await deleteRowsByIds("lotes_aprobacion_lider", targets.approvalBatchIds);
        deletedCounts.aprobaciones = targets.approvalIds.length + targets.approvalBatchIds.length;
    }

    if (filters.modules.includes("liquidacion")) {
        await deleteRowsByIds("items_liquidacion", targets.liquidationIds);
        await deleteRowsByIds("acumulacion_lideres", targets.accumulationIds);
        deletedCounts.liquidacion = targets.liquidationIds.length + targets.accumulationIds.length;
    }

    if (filters.modules.includes("asistencia")) {
        await deleteRowsByIds("registros_asistencia", targets.attendanceIds);
        deletedCounts.asistencia = targets.attendanceIds.length;
    }

    if (filters.modules.includes("notificaciones")) {
        await deleteRowsByIds("notificaciones", targets.notificationIds);
        deletedCounts.notificaciones = targets.notificationIds.length;
    }

    let deletedPeriods = 0;
    if (filters.deletePeriods && targets.periodIds.length > 0) {
        const { data: periodActivityReports, error: periodActivityReportsError } = await supabase
            .from("reportes_actividad")
            .select("id")
            .in("periodo_id", targets.periodIds);
        if (periodActivityReportsError) throw periodActivityReportsError;

        const periodActivityReportIds = ((periodActivityReports || []) as IdRow[]).map((row) => row.id);
        await deleteActivityReportArtifacts(periodActivityReportIds, deleteFiles);

        const { error: cleanupApprovalBatchesError } = await supabase
            .from("lotes_aprobacion_lider")
            .delete()
            .in("periodo_id", targets.periodIds);
        if (cleanupApprovalBatchesError) throw cleanupApprovalBatchesError;

        const { error: cleanupLiquidationItemsError } = await supabase
            .from("items_liquidacion")
            .delete()
            .in("periodo_id", targets.periodIds);
        if (cleanupLiquidationItemsError) throw cleanupLiquidationItemsError;

        const { error: cleanupAccumulationsError } = await supabase
            .from("acumulacion_lideres")
            .delete()
            .in("periodo_id", targets.periodIds);
        if (cleanupAccumulationsError) throw cleanupAccumulationsError;

        const { error: cleanupActivityReportsError } = await supabase
            .from("reportes_actividad")
            .delete()
            .in("periodo_id", targets.periodIds);
        if (cleanupActivityReportsError) throw cleanupActivityReportsError;

        const { error: deletePeriodsError } = await supabase
            .from("periodos_liquidacion")
            .delete()
            .in("id", targets.periodIds);
        if (deletePeriodsError) throw deletePeriodsError;

        deletedPeriods = targets.periodIds.length;
    }

    [
        "reportes-actividad:list",
        "mantenimientos:list",
        "mantenimientos:reportes",
        "visitas:list",
        "liquidacion:periodos",
        "liquidacion:entries",
        "lotes-aprobacion:list",
        "acumulaciones-lider:list",
        "llegadas:list",
    ].forEach((cacheKey) => invalidateCachedValue(cacheKey));

    return {
        range: {
            startDate: window.startDate,
            endDate: window.endDate,
        },
        deletedCounts,
        deletedPeriods,
    };
}
