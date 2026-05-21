import { supabase } from "../client";
import { Maintenance, MaintenanceParticipant, MaintenanceReport } from "@/lib/types";
import { deleteAllFotosMantenimiento } from "./storage";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const MANTENIMIENTOS_CACHE_KEY = "mantenimientos:list";
const MANTENIMIENTOS_CACHE_TTL = 30_000;
const REPORTES_MANTENIMIENTO_CACHE_KEY = "mantenimientos:reportes";
const REPORTES_MANTENIMIENTO_CACHE_TTL = 30_000;

export function invalidateMantenimientosCache() {
  invalidateCachedValue(MANTENIMIENTOS_CACHE_KEY);
}

export function invalidateReportesMantenimientoCache() {
  invalidateCachedValue(REPORTES_MANTENIMIENTO_CACHE_KEY);
}

function toDateOnly(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.split("T")[0] || "";
}

function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (!match) return null;
  const bucket = match[1];
  const path = decodeURIComponent(match[2]);
  return { bucket, path };
}

async function resolveStorageUrl(url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  const parsed = parseStorageUrl(url);
  if (!parsed) return url;

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, 60 * 60 * 24 * 7);

  if (error || !data?.signedUrl) return url;
  return data.signedUrl;
}

function mapRow(row: any): Maintenance {
  return {
    id: row.id,
    clienteId: row.cliente_id,
    tecnicoId: row.tecnico_id,
    origen: "mantenimiento",
    contratoMantenimientoId: row.contrato_mantenimiento_id || undefined,
    fechaProgramada: toDateOnly(row.fecha_programada),
    horaProgramada: row.hora_programada || undefined,
    proximaFecha: toDateOnly(row.proxima_fecha) || undefined,
    estado: row.estado,
    observaciones: row.observaciones || undefined,
    tipoPendiente: row.tipo_pendiente || undefined,
    descripcionPendiente: row.descripcion_pendiente || undefined,
    costoTecnicoTotal: Number(row.costo_tecnico_total ?? 0) || 0,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
    fechaCierre: row.fecha_cierre?.split("T")[0] || undefined,
  };
}

async function resolveMaintenanceLeaderId(tecnicoId?: string | null): Promise<string | null> {
  if (!tecnicoId) return null;

  const { data: tecnico, error: tecnicoError } = await supabase
    .from("usuarios")
    .select("grupo_id")
    .eq("id", tecnicoId)
    .maybeSingle();
  if (tecnicoError) throw tecnicoError;

  if (!tecnico?.grupo_id) return null;

  const { data: grupo, error: grupoError } = await supabase
    .from("grupos_trabajo")
    .select("lider_id")
    .eq("id", tecnico.grupo_id)
    .maybeSingle();
  if (grupoError) throw grupoError;

  return grupo?.lider_id || null;
}

async function syncContractMaintenanceFromExecutable(row: any) {
  if (!row) return;

  const estado = String(row.estado || "").toLowerCase();
  const updateData: any = {
    tecnico_id: row.tecnico_id,
    fecha_programada: row.fecha_programada,
    costo_tecnico_total: Math.max(0, Math.round(Number(row.costo_tecnico_total ?? 0) || 0)),
  };

  if (estado === "realizado" || estado === "completado") {
    updateData.estado = "realizado";
    updateData.fecha_realizado = toDateOnly(row.fecha_cierre) || toDateOnly(row.fecha_completado) || new Date().toISOString().split("T")[0];
  } else if (estado === "programado" || estado === "en_ejecucion" || estado === "en_progreso") {
    updateData.estado = "programado";
  }

  let contractMaintenanceId = row.contrato_mantenimiento_id;
  if (!contractMaintenanceId && row.cliente_id && row.tecnico_id && row.fecha_programada) {
    const { data: contratos, error: contratosError } = await supabase
      .from("contratos_mantenimiento")
      .select("id")
      .eq("cliente_id", row.cliente_id);
    if (contratosError) throw contratosError;

    const contratoIds = (contratos || []).map((contrato: { id: string }) => contrato.id).filter(Boolean);
    if (contratoIds.length === 0) return;

    const { data: contratoMant, error: contratoMantError } = await supabase
      .from("contrato_mantenimientos")
      .select("id")
      .in("contrato_id", contratoIds)
      .eq("tecnico_id", row.tecnico_id)
      .eq("fecha_programada", toDateOnly(row.fecha_programada))
      .order("fecha_creacion", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (contratoMantError) throw contratoMantError;
    contractMaintenanceId = contratoMant?.id;
  }

  if (!contractMaintenanceId) return;

  const { error } = await supabase
    .from("contrato_mantenimientos")
    .update(updateData)
    .eq("id", contractMaintenanceId);
  if (error && !isMissingContractLinkColumnError(error)) throw error;
}

function isMissingContractLinkColumnError(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null | undefined;
  return candidate?.code === "42703" || Boolean(candidate?.message?.includes("contrato_mantenimiento_id"));
}

async function findExecutableMaintenanceForContract(contratoMant: any, contrato: any) {
  const byContractLink = await supabase
    .from("mantenimientos")
    .select("*")
    .eq("contrato_mantenimiento_id", contratoMant.id)
    .limit(1)
    .maybeSingle();

  if (!byContractLink.error) return byContractLink.data || null;
  if (!isMissingContractLinkColumnError(byContractLink.error)) throw byContractLink.error;

  if (!contrato?.cliente_id || !contratoMant.tecnico_id || !contratoMant.fecha_programada) {
    return null;
  }

  const byCurrentShape = await supabase
    .from("mantenimientos")
    .select("*")
    .eq("cliente_id", contrato.cliente_id)
    .eq("tecnico_id", contratoMant.tecnico_id)
    .eq("fecha_programada", toDateOnly(contratoMant.fecha_programada))
    .in("estado", ["programado", "en_ejecucion", "en_progreso"])
    .order("fecha_creacion", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byCurrentShape.error) throw byCurrentShape.error;
  return byCurrentShape.data || null;
}

async function persistExecutableMaintenance(existingId: string | undefined, payload: Record<string, unknown>) {
  const save = (nextPayload: Record<string, unknown>) => existingId
    ? supabase
      .from("mantenimientos")
      .update(nextPayload)
      .eq("id", existingId)
      .select()
      .single()
    : supabase
      .from("mantenimientos")
      .insert(nextPayload)
      .select()
      .single();

  const result = await save(payload);
  if (!result.error) return result.data;
  if (!isMissingContractLinkColumnError(result.error)) throw result.error;

  const { contrato_mantenimiento_id: _contractMaintenanceId, ...fallbackPayload } = payload;
  const fallbackResult = await save(fallbackPayload);
  if (fallbackResult.error) throw fallbackResult.error;
  return fallbackResult.data;
}

async function upsertExecutableMaintenanceFromContract(
  contratoMant: any,
  contrato: any,
  m: Partial<Maintenance>
) {
  const tecnicoId = m.tecnicoId ?? contratoMant.tecnico_id;
  const clienteId = contrato?.cliente_id;

  if (!tecnicoId || !clienteId) {
    return null;
  }

  const [existing, { data: client, error: clientError }] = await Promise.all([
    findExecutableMaintenanceForContract(contratoMant, contrato),
    supabase
      .from("clientes")
      .select("nombre, edificio, direccion")
      .eq("id", clienteId)
      .maybeSingle(),
  ]);
  if (clientError) throw clientError;

  const liderId = await resolveMaintenanceLeaderId(tecnicoId);
  const costoTecnicoTotal = Math.max(0, Math.round(Number(m.costoTecnicoTotal ?? contratoMant.costo_tecnico_total ?? 0) || 0));
  const estadoContrato = String((m.estado ?? contratoMant.estado) || "programado").toLowerCase();
  const estadoEjecutable = estadoContrato === "realizado" || estadoContrato === "completado"
    ? "realizado"
    : estadoContrato === "pendiente"
      ? "pendiente"
      : "programado";
  const clientLabel = client?.edificio || client?.nombre || "cliente";

  const payload: Record<string, unknown> = {
    cliente_id: clienteId,
    tecnico_id: tecnicoId,
    lider_id: liderId,
    titulo: "Mantenimiento programado",
    descripcion: `Mantenimiento preventivo contractual para ${clientLabel}`,
    fecha_programada: toDateOnly(contratoMant.fecha_programada) || m.fechaProgramada,
    estado: estadoEjecutable,
    prioridad: "media",
    ubicacion: client?.direccion || null,
    edificio: client?.edificio || null,
    tipo_reporte: "preventivo",
    costo_tecnico_total: costoTecnicoTotal,
    contrato_mantenimiento_id: contratoMant.id,
  };

  if (m.horaProgramada !== undefined || !existing) {
    payload.hora_programada = m.horaProgramada || null;
  }

  if (m.observaciones !== undefined) {
    payload.observaciones = m.observaciones || null;
  }

  return persistExecutableMaintenance(existing?.id, payload);
}

function mapContratoRow(row: any, contrato: any): Maintenance {
  return {
    id: row.id,
    clienteId: contrato?.cliente_id || "",
    tecnicoId: row.tecnico_id || "",
    origen: "contrato",
    contratoId: row.contrato_id,
    contratoMantenimientoId: row.id,
    fechaProgramada: toDateOnly(row.fecha_programada),
    estado: row.estado,
    valorRecaudado: parseFloat(row.valor_recaudado) || 0,
    costoTecnicoTotal: parseFloat(row.costo_tecnico_total) || 0,
    fechaCreacion: contrato?.fecha_creacion?.split("T")[0] || "",
    fechaCierre: row.fecha_realizado?.split("T")[0] || undefined,
  };
}

function buildPreventiveMaintenanceCanonicalKey(maintenance: Maintenance) {
  return [
    maintenance.clienteId,
    maintenance.fechaProgramada,
    maintenance.tecnicoId,
    maintenance.contratoMantenimientoId || "sin-contrato-mantenimiento",
    maintenance.estado,
  ].join("|");
}

function rankPreventiveMaintenance(maintenance: Maintenance) {
  let score = 0;
  if (maintenance.contratoMantenimientoId) score += 8;
  if (maintenance.horaProgramada) score += 2;
  if ((Number(maintenance.costoTecnicoTotal ?? 0) || 0) > 0) score += 1;
  return score;
}

function normalizeMaintenanceParticipants(
  maintenanceId: string,
  tecnicoId: string | undefined,
  participants: MaintenanceParticipant[] | undefined,
  fallbackTotal: number
) {
  const normalizedParticipants = (participants || [])
    .map((participant) => {
      const usuarioId = participant.usuarioId;
      if (!usuarioId) return null;

      const porcentaje = Math.max(0, Number(participant.porcentaje ?? 0) || 0);
      const valorCalculado = Math.max(0, Math.round(Number(participant.valorCalculado ?? 0) || 0));

      return {
        maintenance_id: maintenanceId,
        usuario_id: usuarioId,
        porcentaje,
        valor_calculado: valorCalculado,
      };
    })
    .filter(Boolean) as Array<{
      maintenance_id: string;
      usuario_id: string;
      porcentaje: number;
      valor_calculado: number;
    }>;

  if (normalizedParticipants.length > 0) {
    return normalizedParticipants;
  }

  if (!tecnicoId) {
    return [];
  }

  return [{
    maintenance_id: maintenanceId,
    usuario_id: tecnicoId,
    porcentaje: 100,
    valor_calculado: Math.max(0, Math.round(Number(fallbackTotal) || 0)),
  }];
}

async function replaceMaintenanceParticipants(
  maintenanceId: string,
  tecnicoId: string | undefined,
  participants: MaintenanceParticipant[] | undefined,
  fallbackTotal: number
) {
  const participantRows = normalizeMaintenanceParticipants(maintenanceId, tecnicoId, participants, fallbackTotal);

  const { error: deleteParticipantsError } = await supabase
    .from("mantenimiento_participantes")
    .delete()
    .eq("maintenance_id", maintenanceId);
  if (deleteParticipantsError) throw deleteParticipantsError;

  if (participantRows.length === 0) {
    return;
  }

  const { error: insertParticipantsError } = await supabase
    .from("mantenimiento_participantes")
    .insert(participantRows);
  if (insertParticipantsError) throw insertParticipantsError;
}

async function getMaintenanceParticipantsMap(maintenanceIds: string[]) {
  if (maintenanceIds.length === 0) {
    return new Map<string, MaintenanceParticipant[]>();
  }

  const { data, error } = await supabase
    .from("mantenimiento_participantes")
    .select("id, maintenance_id, usuario_id, porcentaje, valor_calculado")
    .in("maintenance_id", maintenanceIds)
    .order("fecha_creacion", { ascending: true });
  if (error) throw error;

  const participantsByMaintenance = new Map<string, MaintenanceParticipant[]>();
  const participantUserIds = Array.from(new Set(
    (data || []).map((row: { usuario_id?: string | null }) => row.usuario_id).filter(Boolean)
  )) as string[];
  const activeUserIds = new Set<string>();

  if (participantUserIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from("usuarios")
      .select("id")
      .in("id", participantUserIds);
    if (usersError) throw usersError;

    (users || []).forEach((user: { id: string }) => {
      if (user.id) {
        activeUserIds.add(user.id);
      }
    });
  }

  for (const row of data || []) {
    const maintenanceId = row.maintenance_id;
    if (!maintenanceId || !row.usuario_id) continue;
    if (!activeUserIds.has(row.usuario_id)) continue;

    const current = participantsByMaintenance.get(maintenanceId) || [];
    current.push({
      id: row.id,
      usuarioId: row.usuario_id,
      porcentaje: Number(row.porcentaje ?? 0) || 0,
      valorCalculado: Number(row.valor_calculado ?? 0) || 0,
    });
    participantsByMaintenance.set(maintenanceId, current);
  }

  return participantsByMaintenance;
}

async function upsertMaintenanceParticipantActivityReports(params: {
  maintenanceId: string;
  clienteId?: string | null;
  fecha: string;
  descripcion: string;
  costoTecnicoTotal: number;
  participants: MaintenanceParticipant[];
}) {
  if (!params.maintenanceId || !params.fecha || params.participants.length === 0) return;

  const participantUserIds = Array.from(new Set(params.participants.map((participant) => participant.usuarioId).filter(Boolean)));
  if (participantUserIds.length === 0) return;

  const [{ data: users, error: usersError }, { data: existingReports, error: existingReportsError }, { data: periodo, error: periodoError }] = await Promise.all([
    supabase
      .from("usuarios")
      .select("id, grupo_id")
      .in("id", participantUserIds),
    supabase
      .from("reportes_actividad")
      .select("id, tecnico_id, descripcion")
      .eq("tipo", "mantenimiento_preventivo")
      .eq("fecha", params.fecha)
      .eq("mantenimiento_id", params.maintenanceId),
    supabase
      .from("periodos_liquidacion")
      .select("id")
      .eq("estado", "abierto")
      .lte("fecha_inicio", params.fecha)
      .gte("fecha_fin", params.fecha)
      .order("fecha_inicio", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (usersError) throw usersError;
  if (existingReportsError) throw existingReportsError;
  if (periodoError) throw periodoError;

  let periodoId = periodo?.id || null;
  if (!periodoId) {
    const { data: recentPeriodo, error: recentPeriodoError } = await supabase
      .from("periodos_liquidacion")
      .select("id")
      .eq("estado", "abierto")
      .order("fecha_inicio", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentPeriodoError) throw recentPeriodoError;
    periodoId = recentPeriodo?.id || null;
  }

  if (!periodoId) {
    return;
  }

  const usersById = new Map((users || []).map((user: { id: string; grupo_id?: string | null }) => [user.id, user]));
  const groupsById = new Map<string, string | null>();

  await Promise.all(
    Array.from(new Set((users || []).map((user: { grupo_id?: string | null }) => user.grupo_id).filter(Boolean) as string[])).map(async (groupId) => {
      const { data: group, error: groupError } = await supabase
        .from("grupos_trabajo")
        .select("id, lider_id")
        .eq("id", groupId)
        .maybeSingle();
      if (groupError) throw groupError;
      groupsById.set(groupId, group?.lider_id || null);
    })
  );

  const existingReportByParticipantKey = new Map(
    (existingReports || []).map((report: { id: string; tecnico_id: string; descripcion?: string | null }) => [
      `${report.tecnico_id}|${report.descripcion || ""}`,
      report,
    ])
  );

  await Promise.all(params.participants.map(async (participant) => {
    const user = usersById.get(participant.usuarioId);
    const grupoId = user?.grupo_id || null;
    const liderId = grupoId ? (groupsById.get(grupoId) || null) : null;
    const existingReport = existingReportByParticipantKey.get(`${participant.usuarioId}|${params.descripcion}`);
    const payload = {
      tipo: "mantenimiento_preventivo",
      tecnico_id: participant.usuarioId,
      lider_grupo_id: liderId,
      grupo_id: grupoId,
      cliente_id: params.clienteId || null,
      fecha: params.fecha,
      descripcion: params.descripcion,
      costo_actividad_default: params.costoTecnicoTotal,
      costo_actividad: Math.max(0, Math.round(Number(participant.valorCalculado ?? 0) || 0)),
      costo_administrable: true,
      valor_modificado: Math.max(0, Math.round(Number(participant.valorCalculado ?? 0) || 0)) !== Math.max(0, Math.round(Number(params.costoTecnicoTotal ?? 0) || 0)),
      periodo_id: periodoId,
      mantenimiento_id: params.maintenanceId,
      mantenimiento_participante_id: participant.id || null,
    };

    if (!payload.grupo_id || !payload.lider_grupo_id) {
      return;
    }

    if (existingReport?.id) {
      const { error: updateError } = await supabase
        .from("reportes_actividad")
        .update(payload)
        .eq("id", existingReport.id);
      if (updateError) throw updateError;
      return;
    }

    const { error: insertError } = await supabase
      .from("reportes_actividad")
      .insert(payload);
    if (insertError) throw insertError;
  }));
}

async function deleteMaintenanceParticipantActivityReports(maintenanceId: string) {
  if (!maintenanceId) return;

  const { data: existingReports, error: existingReportsError } = await supabase
    .from("reportes_actividad")
    .select("id")
    .eq("tipo", "mantenimiento_preventivo")
    .eq("mantenimiento_id", maintenanceId);
  if (existingReportsError) throw existingReportsError;

  const reportIds = (existingReports || []).map((report: { id: string }) => report.id).filter(Boolean);
  if (reportIds.length === 0) return;

  const { error: deleteApprovalItemsError } = await supabase
    .from("items_aprobacion")
    .delete()
    .in("referencia_id", reportIds);
  if (deleteApprovalItemsError) throw deleteApprovalItemsError;

  const { error: deleteLiquidationItemsError } = await supabase
    .from("items_liquidacion")
    .delete()
    .in("referencia_id", reportIds);
  if (deleteLiquidationItemsError) throw deleteLiquidationItemsError;

  const { error: deleteReportsError } = await supabase
    .from("reportes_actividad")
    .delete()
    .in("id", reportIds);
  if (deleteReportsError) throw deleteReportsError;
}

export async function getMantenimientos(): Promise<Maintenance[]> {
  return getCachedValue(MANTENIMIENTOS_CACHE_KEY, MANTENIMIENTOS_CACHE_TTL, async () => {
    let rows = [] as any[];
    const { data, error } = await supabase
      .from("mantenimientos")
      .select("*")
      .order("fecha_programada", { ascending: false });
    if (error) {
      if (!isMissingContractLinkColumnError(error)) throw error;

      const fallbackResponse = await supabase
        .from("mantenimientos")
        .select("id, cliente_id, tecnico_id, lider_id, titulo, descripcion, fecha_programada, hora_programada, proxima_fecha, estado, observaciones, tipo_pendiente, descripcion_pendiente, costo_tecnico_total, fecha_creacion, fecha_cierre")
        .order("fecha_programada", { ascending: false });
      if (fallbackResponse.error) throw fallbackResponse.error;
      rows = fallbackResponse.data || [];
    } else {
      rows = data || [];
    }

    const { data: contratos, error: contratosError } = await supabase
      .from("contratos_mantenimiento")
      .select("id, cliente_id, fecha_creacion");
    if (contratosError) throw contratosError;

    const contratoIds = (contratos || []).map((contrato) => contrato.id);
    let mantenimientosContrato: any[] = [];
    if (contratoIds.length > 0) {
      const { data: contratoMants, error: contratoMantsError } = await supabase
        .from("contrato_mantenimientos")
        .select("*")
        .in("contrato_id", contratoIds);
      if (contratoMantsError) throw contratoMantsError;
      mantenimientosContrato = contratoMants || [];
    }

    const contratosById = new Map((contratos || []).map((contrato) => [contrato.id, contrato]));
    const maintenanceRows = rows.map(mapRow);
    const executableContractMaintenanceIds = new Set(
      maintenanceRows
        .map((maintenance) => maintenance.contratoMantenimientoId)
        .filter(Boolean)
    );
    const executableMaintenanceKeys = new Set(
      maintenanceRows.map((maintenance) => [
        maintenance.clienteId,
        maintenance.tecnicoId,
        maintenance.fechaProgramada,
        String(maintenance.estado).toLowerCase(),
      ].join("|"))
    );
    const contractRows = mantenimientosContrato
      .filter((mant) => {
        if (executableContractMaintenanceIds.has(mant.id)) return false;
        const contrato = contratosById.get(mant.contrato_id);
        const key = [
          contrato?.cliente_id || "",
          mant.tecnico_id || "",
          toDateOnly(mant.fecha_programada),
          String(mant.estado).toLowerCase(),
        ].join("|");
        return !executableMaintenanceKeys.has(key);
      })
      .map((mant) => mapContratoRow(mant, contratosById.get(mant.contrato_id)));
    const allMaintenanceIds = [...maintenanceRows, ...contractRows].map((row) => row.id).filter(Boolean);
    const participantsByMaintenance = await getMaintenanceParticipantsMap(allMaintenanceIds);

    const normalizedRows = [...maintenanceRows, ...contractRows]
      .map((maintenance) => ({
        ...maintenance,
        participantes: participantsByMaintenance.get(maintenance.id) || undefined,
      }));

    const canonicalByKey = new Map<string, Maintenance>();
    normalizedRows.forEach((maintenance) => {
      const key = buildPreventiveMaintenanceCanonicalKey(maintenance);
      const current = canonicalByKey.get(key);
      if (!current) {
        canonicalByKey.set(key, maintenance);
        return;
      }

      const currentScore = rankPreventiveMaintenance(current);
      const nextScore = rankPreventiveMaintenance(maintenance);
      if (nextScore > currentScore || (nextScore === currentScore && (maintenance.fechaCreacion || "") > (current.fechaCreacion || ""))) {
        canonicalByKey.set(key, maintenance);
      }
    });

    return Array.from(canonicalByKey.values())
      .sort((a, b) => b.fechaProgramada.localeCompare(a.fechaProgramada));
  });
}

export async function createMantenimiento(m: Partial<Maintenance>): Promise<Maintenance> {
  const costoTecnicoTotal = Math.max(0, Math.round(Number(m.costoTecnicoTotal ?? m.valorRecaudado ?? 0) || 0));
  const liderId = await resolveMaintenanceLeaderId(m.tecnicoId);
  const { data, error } = await supabase
    .from("mantenimientos")
    .insert({
      cliente_id: m.clienteId,
      tecnico_id: m.tecnicoId,
      lider_id: liderId,
      titulo: "Mantenimiento programado",
      fecha_programada: m.fechaProgramada,
      hora_programada: m.horaProgramada || null,
      proxima_fecha: m.proximaFecha || null,
      estado: m.estado || "programado",
      observaciones: m.observaciones || null,
      costo_tecnico_total: costoTecnicoTotal,
    })
    .select()
    .single();
  if (error) throw error;

  await replaceMaintenanceParticipants(data.id, m.tecnicoId, m.participantes, costoTecnicoTotal);
  invalidateMantenimientosCache();
  return {
    ...mapRow(data),
    participantes: normalizeMaintenanceParticipants(data.id, m.tecnicoId, m.participantes, costoTecnicoTotal).map((participant) => ({
      usuarioId: participant.usuario_id,
      porcentaje: participant.porcentaje,
      valorCalculado: participant.valor_calculado,
    })),
  };
}

export async function updateMantenimiento(id: string, m: Partial<Maintenance>): Promise<Maintenance> {
  const { data: mantenimientoExistente, error: mantenimientoExistenteError } = await supabase
    .from("mantenimientos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (mantenimientoExistenteError) throw mantenimientoExistenteError;

  if (!mantenimientoExistente) {
    const contractUpdateData: any = {};
    if (m.tecnicoId !== undefined) contractUpdateData.tecnico_id = m.tecnicoId || null;
    if (m.fechaProgramada !== undefined) contractUpdateData.fecha_programada = m.fechaProgramada;
    if (m.estado !== undefined) contractUpdateData.estado = m.estado;
    if (m.valorRecaudado !== undefined) contractUpdateData.valor_recaudado = m.valorRecaudado;
    if (m.costoTecnicoTotal !== undefined) contractUpdateData.costo_tecnico_total = m.costoTecnicoTotal;

    const contratoMantQuery = supabase
      .from("contrato_mantenimientos")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    const { data: contratoMant, error: contratoMantError } = Object.keys(contractUpdateData).length > 0
      ? await supabase
        .from("contrato_mantenimientos")
        .update(contractUpdateData)
        .eq("id", id)
        .select("*")
        .maybeSingle()
      : await contratoMantQuery;
    if (contratoMantError) throw contratoMantError;
    if (!contratoMant) throw new Error("Mantenimiento no encontrado.");

    const { data: contrato, error: contratoError } = await supabase
      .from("contratos_mantenimiento")
      .select("id, cliente_id, fecha_creacion")
      .eq("id", contratoMant.contrato_id)
      .maybeSingle();
    if (contratoError) throw contratoError;

    invalidateMantenimientosCache();
    const costoTecnicoTotal = Math.max(0, Math.round(Number(m.costoTecnicoTotal ?? contratoMant.costo_tecnico_total ?? 0) || 0));

    const executableMaintenance = await upsertExecutableMaintenanceFromContract(contratoMant, contrato, {
      ...m,
      tecnicoId: m.tecnicoId ?? contratoMant.tecnico_id,
      fechaProgramada: toDateOnly(contratoMant.fecha_programada),
      estado: m.estado ?? contratoMant.estado,
      costoTecnicoTotal,
    });

    if (executableMaintenance?.id) {
      await replaceMaintenanceParticipants(
        executableMaintenance.id,
        executableMaintenance.tecnico_id,
        m.participantes,
        costoTecnicoTotal
      );

      if (String(contratoMant.estado).toLowerCase() === "realizado" || String(contratoMant.estado).toLowerCase() === "completado") {
        const participants = normalizeMaintenanceParticipants(executableMaintenance.id, executableMaintenance.tecnico_id, m.participantes, costoTecnicoTotal).map((participant) => ({
          usuarioId: participant.usuario_id,
          porcentaje: participant.porcentaje,
          valorCalculado: participant.valor_calculado,
        }));

        await upsertMaintenanceParticipantActivityReports({
          maintenanceId: executableMaintenance.id,
          clienteId: contrato?.cliente_id,
          fecha: toDateOnly(contratoMant.fecha_programada),
          descripcion: "Mantenimiento preventivo realizado",
          costoTecnicoTotal,
          participants,
        });
      } else {
        await deleteMaintenanceParticipantActivityReports(executableMaintenance.id);
      }
    }

    invalidateMantenimientosCache();

    if (executableMaintenance) {
      return {
        ...mapRow(executableMaintenance),
        contratoId: contratoMant.contrato_id,
        contratoMantenimientoId: contratoMant.id,
        participantes: normalizeMaintenanceParticipants(executableMaintenance.id, executableMaintenance.tecnico_id, m.participantes, costoTecnicoTotal).map((participant) => ({
          usuarioId: participant.usuario_id,
          porcentaje: participant.porcentaje,
          valorCalculado: participant.valor_calculado,
        })),
      };
    }

    return mapContratoRow(contratoMant, contrato);
  }

  const updateData: any = {};
  if (m.clienteId !== undefined) updateData.cliente_id = m.clienteId;
  if (m.tecnicoId !== undefined) {
    updateData.tecnico_id = m.tecnicoId;
    updateData.lider_id = await resolveMaintenanceLeaderId(m.tecnicoId);
  }
  if (m.fechaProgramada !== undefined) updateData.fecha_programada = m.fechaProgramada;
  if (m.horaProgramada !== undefined) updateData.hora_programada = m.horaProgramada;
  if (m.proximaFecha !== undefined) updateData.proxima_fecha = m.proximaFecha;
  if (m.estado !== undefined) updateData.estado = m.estado;
  if (m.observaciones !== undefined) updateData.observaciones = m.observaciones;
  if (m.costoTecnicoTotal !== undefined) updateData.costo_tecnico_total = m.costoTecnicoTotal;

  const { data, error } = await supabase
    .from("mantenimientos")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  const costoTecnicoTotal = Math.max(0, Math.round(Number(m.costoTecnicoTotal ?? data.costo_tecnico_total ?? 0) || 0));
  const normalizedParticipants = normalizeMaintenanceParticipants(
    id,
    m.tecnicoId ?? data.tecnico_id,
    m.participantes,
    costoTecnicoTotal
  ).map((participant) => ({
    usuarioId: participant.usuario_id,
    porcentaje: participant.porcentaje,
    valorCalculado: participant.valor_calculado,
  }));

  if (m.participantes !== undefined) {
    await replaceMaintenanceParticipants(id, m.tecnicoId ?? data.tecnico_id, m.participantes, costoTecnicoTotal);
  }

  if (String(data.estado).toLowerCase() === "realizado" || String(data.estado).toLowerCase() === "completado") {
    await upsertMaintenanceParticipantActivityReports({
      maintenanceId: id,
      clienteId: data.cliente_id,
      fecha: toDateOnly(data.fecha_programada),
      descripcion: (data.observaciones || "").trim() || "Mantenimiento preventivo realizado",
      costoTecnicoTotal,
      participants: normalizedParticipants,
    });
  } else {
    await deleteMaintenanceParticipantActivityReports(id);
  }

  await syncContractMaintenanceFromExecutable(data);

  invalidateMantenimientosCache();
  return {
    ...mapRow(data),
    participantes: normalizedParticipants,
  };
}

export async function deleteMantenimiento(id: string): Promise<void> {
  const { data: mantenimientoExistente, error: mantenimientoExistenteError } = await supabase
    .from("mantenimientos")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (mantenimientoExistenteError) throw mantenimientoExistenteError;

  if (mantenimientoExistente) {
    const { error } = await supabase.from("mantenimientos").delete().eq("id", id);
    if (error) throw error;
    invalidateMantenimientosCache();
    return;
  }

  const { error } = await supabase.from("contrato_mantenimientos").delete().eq("id", id);
  if (error) throw error;
  invalidateMantenimientosCache();
}

function mapReport(
  row: any,
  fotosAntes: string[],
  fotosDespues: string[],
  fotoBitacoraUrl?: string,
  tipoPendiente?: string,
  descripcionPendiente?: string
): MaintenanceReport {
  const mantenimientoRefId = row.mantenimiento_id || row.id;
  return {
    id: row.id,
    mantenimientoId: mantenimientoRefId,
    tecnicoId: row.tecnico_id,
    clienteId: row.cliente_id,
    fotosAntes,
    fotosDespues,
    observaciones: row.observaciones || "",
    fechaGeneracion: row.fecha_generacion?.split("T")[0] || "",
    enviado: row.enviado || false,
    fechaEnvio: row.fecha_envio?.split("T")[0] || undefined,
    firmaReceptor: row.firma_receptor_url || undefined,
    datosReceptor: row.nombre_receptor
      ? { nombre: row.nombre_receptor, cedula: row.cedula_receptor || "", cargo: row.cargo_receptor || "" }
      : undefined,
    fotoBitacora:
      fotoBitacoraUrl ||
      row.foto_bitacora_url ||
      row.foto_bitacora ||
      undefined,
    tipoPendiente: tipoPendiente || row.tipo_pendiente || undefined,
    descripcionPendiente: descripcionPendiente || row.descripcion_pendiente || undefined,
  };
}

export async function getReportesMantenimiento(): Promise<MaintenanceReport[]> {
  return getCachedValue(REPORTES_MANTENIMIENTO_CACHE_KEY, REPORTES_MANTENIMIENTO_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("reportes_mantenimiento")
      .select("*")
      .order("fecha_generacion", { ascending: false });
    if (error) throw error;

    const mantenimientoIds = Array.from(
      new Set(
        (data || [])
          .map((row: any) => row.mantenimiento_id || row.id)
          .filter(Boolean)
      )
    );

    const [mantenimientosResponse, fotosResponse] = await Promise.all([
      mantenimientoIds.length > 0
        ? supabase
          .from("mantenimientos")
          .select("id, foto_bitacora_url, tipo_pendiente, descripcion_pendiente")
          .in("id", mantenimientoIds)
        : Promise.resolve({ data: [], error: null }),
      mantenimientoIds.length > 0
        ? supabase
          .from("mantenimiento_fotos")
          .select("mantenimiento_id, tipo, url, orden")
          .in("mantenimiento_id", mantenimientoIds)
          .order("orden")
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (mantenimientosResponse.error) throw mantenimientosResponse.error;
    if (fotosResponse.error) throw fotosResponse.error;

    const bitacoraByMantenimientoId = new Map<string, string>();
    const tipoPendienteByMantenimientoId = new Map<string, string>();
    const descripcionPendienteByMantenimientoId = new Map<string, string>();
    for (const mantenimiento of mantenimientosResponse.data || []) {
      if (mantenimiento?.id && mantenimiento?.foto_bitacora_url) {
        bitacoraByMantenimientoId.set(mantenimiento.id, mantenimiento.foto_bitacora_url);
      }
      if (mantenimiento?.id && mantenimiento?.tipo_pendiente) {
        tipoPendienteByMantenimientoId.set(mantenimiento.id, mantenimiento.tipo_pendiente);
      }
      if (mantenimiento?.id && mantenimiento?.descripcion_pendiente) {
        descripcionPendienteByMantenimientoId.set(mantenimiento.id, mantenimiento.descripcion_pendiente);
      }
    }

    const fotosByMantenimientoId = new Map<string, { antes: string[]; despues: string[] }>();
    for (const foto of fotosResponse.data || []) {
      const mantenimientoId = foto.mantenimiento_id;
      if (!mantenimientoId) continue;
      const current = fotosByMantenimientoId.get(mantenimientoId) || { antes: [], despues: [] };
      if (foto.tipo === "antes") current.antes.push(foto.url);
      if (foto.tipo === "despues") current.despues.push(foto.url);
      fotosByMantenimientoId.set(mantenimientoId, current);
    }

    const uniqueBitacoraUrls = Array.from(new Set(
      (data || []).map((row: any) => {
        const mantenimientoRefId = row.mantenimiento_id || row.id;
        return bitacoraByMantenimientoId.get(mantenimientoRefId) || row.foto_bitacora_url || row.foto_bitacora || undefined;
      }).filter(Boolean)
    ));

    const resolvedBitacoras = new Map<string, string | undefined>(
      await Promise.all(
        uniqueBitacoraUrls.map(async (url) => [url, await resolveStorageUrl(url)] as const)
      )
    );

    return (data || []).map((row: any) => {
      const mantenimientoRefId = row.mantenimiento_id || row.id;
      const fotos = fotosByMantenimientoId.get(mantenimientoRefId);
      const rawBitacoraUrl =
        bitacoraByMantenimientoId.get(mantenimientoRefId) ||
        row.foto_bitacora_url ||
        row.foto_bitacora ||
        undefined;
      const tipoPendiente =
        tipoPendienteByMantenimientoId.get(mantenimientoRefId) ||
        row.tipo_pendiente ||
        undefined;
      const descripcionPendiente =
        descripcionPendienteByMantenimientoId.get(mantenimientoRefId) ||
        row.descripcion_pendiente ||
        undefined;

      return mapReport(
        row,
        fotos?.antes || [],
        fotos?.despues || [],
        rawBitacoraUrl ? resolvedBitacoras.get(rawBitacoraUrl) : undefined,
        tipoPendiente,
        descripcionPendiente
      );
    });
  });
}

export async function syncReporteMantenimientoToActividad(reporteId: string): Promise<void> {
  const { data: reporte } = await supabase
    .from("reportes_mantenimiento")
    .select("id, mantenimiento_id, tecnico_id, cliente_id, observaciones, fecha_generacion")
    .eq("id", reporteId)
    .single();

  if (!reporte) return;

  const mantenimientoId = reporte.mantenimiento_id || reporte.id;
  const { data: mantenimiento } = await supabase
    .from("mantenimientos")
    .select("id, tecnico_id, cliente_id, observaciones, fecha_programada, costo_tecnico_total")
    .eq("id", mantenimientoId)
    .single();

  const fecha = mantenimiento?.fecha_programada?.split("T")[0] || reporte.fecha_generacion?.split("T")[0] || new Date().toISOString().split("T")[0];

  const participantsByMaintenance = await getMaintenanceParticipantsMap([mantenimientoId]);
  const participants = participantsByMaintenance.get(mantenimientoId)
    || (reporte.tecnico_id ? [{ usuarioId: reporte.tecnico_id, porcentaje: 100, valorCalculado: Number(mantenimiento?.costo_tecnico_total ?? 0) || 0 }] : []);

  await upsertMaintenanceParticipantActivityReports({
    maintenanceId: mantenimientoId,
    clienteId: mantenimiento?.cliente_id || reporte.cliente_id,
    fecha,
    descripcion: (reporte.observaciones || mantenimiento?.observaciones || "").trim() || "Mantenimiento preventivo realizado",
    costoTecnicoTotal: Number(mantenimiento?.costo_tecnico_total ?? 0) || 0,
    participants,
  });

  invalidateCachedValue(REPORTES_MANTENIMIENTO_CACHE_KEY);
  invalidateCachedValue("reportes-actividad:list");
}

export async function updateReporteEnvio(id: string): Promise<void> {
  await supabase
    .from("reportes_mantenimiento")
    .update({ enviado: true, fecha_envio: new Date().toISOString() })
    .eq("id", id);

  invalidateCachedValue(REPORTES_MANTENIMIENTO_CACHE_KEY);
}

export async function deleteReporteMantenimiento(id: string): Promise<void> {
  const { data: reportRow, error: reportError } = await supabase
    .from("reportes_mantenimiento")
    .select("id, mantenimiento_id")
    .eq("id", id)
    .single();

  if (reportError) throw reportError;

  const mantenimientoRefId = reportRow?.mantenimiento_id || reportRow?.id;

  if (mantenimientoRefId) {
    await deleteAllFotosMantenimiento(mantenimientoRefId);

    const { error: mantenimientoUpdateError } = await supabase
      .from("mantenimientos")
      .update({
        foto_bitacora_url: null,
        firma_receptor_url: null,
        tiene_bitacora: false,
        firmado: false,
      })
      .eq("id", mantenimientoRefId);

    if (mantenimientoUpdateError) throw mantenimientoUpdateError;
  }

  const { error: deleteReportError } = await supabase
    .from("reportes_mantenimiento")
    .delete()
    .eq("id", id);

  if (deleteReportError) throw deleteReportError;

  invalidateCachedValue(REPORTES_MANTENIMIENTO_CACHE_KEY);
  invalidateCachedValue(MANTENIMIENTOS_CACHE_KEY);
  invalidateCachedValue("reportes-actividad:list");
}
