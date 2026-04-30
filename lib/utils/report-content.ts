const AUTO_GROUP_ACTIVITY_OBSERVATION_PATTERN = /Registro de actividad grupal por l[ií]der\.?\s*(?:Participaci[oó]n:\s*\d+(?:[.,]\d+)?%\.?)?/gi;
const PARTICIPATION_ONLY_PATTERN = /^Participaci[oó]n:\s*\d+(?:[.,]\d+)?%\.?$/i;
const TECHNICAL_VISIT_METADATA_PATTERN = /\s*(?:Modalidad de visita|Cantidad de personas|Participantes):.*$/i;

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
