const AUTO_GROUP_ACTIVITY_OBSERVATION_PATTERN = /Registro de actividad grupal por l[ií]der\.?\s*(?:Participaci[oó]n:\s*\d+(?:[.,]\d+)?%\.?)?/gi;
const PARTICIPATION_ONLY_PATTERN = /^Participaci[oó]n:\s*\d+(?:[.,]\d+)?%\.?$/i;
const TECHNICAL_VISIT_METADATA_PATTERN = /\s*(?:Modalidad de visita|Cantidad de personas|Participantes):.*$/i;

type ReportObservationSource = {
    tipo?: string | null;
    descripcion?: string | null;
    actividadesRealizadas?: string | null;
    observaciones?: string | null;
};

type DoorBreakdownSource = {
    puertasPeatonales?: number | null;
    puertasVehiculares?: number | null;
};

export function formatClientDoorBreakdown(client?: DoorBreakdownSource | null) {
    if (!client) return undefined;

    const peatonales = Number(client.puertasPeatonales ?? 0) || 0;
    const vehiculares = Number(client.puertasVehiculares ?? 0) || 0;
    const total = peatonales + vehiculares;

    if (total === 0) {
        return "0 puertas";
    }

    const details = [
        peatonales > 0 ? `${peatonales} ${peatonales === 1 ? "peatonal" : "peatonales"}` : null,
        vehiculares > 0 ? `${vehiculares} ${vehiculares === 1 ? "vehicular" : "vehiculares"}` : null,
    ].filter(Boolean);

    return `${total} ${total === 1 ? "puerta" : "puertas"}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

export function sanitizeGroupActivityObservations(observaciones?: string | null) {
    const normalized = observaciones?.trim();
    if (!normalized) return undefined;

    const cleaned = normalized
        .split(/\n+/)
        .map((segment) => segment.replace(AUTO_GROUP_ACTIVITY_OBSERVATION_PATTERN, "").trim())
        .filter((segment) => segment && !PARTICIPATION_ONLY_PATTERN.test(segment))
        .join("\n\n")
        .trim();

    return cleaned || undefined;
}

export function sanitizeTechnicalVisitObservations(observaciones?: string | null) {
    const normalized = observaciones?.trim();
    if (!normalized) return undefined;

    const cleaned = normalized
        .split(/\n+/)
        .map((segment) => segment.replace(TECHNICAL_VISIT_METADATA_PATTERN, "").trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();

    return cleaned || undefined;
}

function normalizeReportTextSegment(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

export function buildReportMultilineText(parts: Array<string | undefined | null>) {
    const seen = new Set<string>();

    return parts
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
        .filter((part) => {
            const normalized = normalizeReportTextSegment(part);
            if (!normalized || seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        })
        .join("\n\n");
}

export function getDisplayReportObservations(report?: ReportObservationSource | null) {
    if (!report) return undefined;

    if (report.tipo === "actividad_grupal") {
        return sanitizeGroupActivityObservations(report.observaciones);
    }

    if (report.tipo === "visita_tecnica") {
        return sanitizeTechnicalVisitObservations(report.observaciones);
    }

    const normalizedObservaciones = report.observaciones?.trim();
    if (normalizedObservaciones) return normalizedObservaciones;

    if (report.tipo === "mantenimiento_preventivo") {
        return report.descripcion?.trim() || undefined;
    }

    return undefined;
}

export function getReportServiceDetail(report?: ReportObservationSource | null) {
    if (!report || report.tipo !== "mantenimiento_preventivo") return undefined;
    return report.actividadesRealizadas?.trim() || undefined;
}
