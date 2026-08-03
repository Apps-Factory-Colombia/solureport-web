import { supabase } from "../client";
import { WorkGroup } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const GRUPOS_CACHE_KEY = "grupos:list";
const GRUPOS_CACHE_TTL = 60_000;

interface GrupoRow {
  id: string;
  nombre: string;
  lider_id: string;
  estado: "activo" | "inactivo";
  fecha_creacion?: string | null;
}

interface GrupoMiembroRow {
  grupo_id: string;
  usuario_id: string;
}

interface GrupoReporteroRow {
  grupo_id: string;
  usuario_id: string;
}

function isMissingGroupReportersTableError(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null | undefined;
  const code = String(candidate?.code || "");
  const message = String(candidate?.message || "");

  return code === "42P01"
    || code === "PGRST205"
    || message.includes("grupo_reportadores_actividad");
}

function normalizeUniqueIds(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function resolveReporterIds(miembros: string[], explicitReporterIds: string[]) {
  const normalizedMembers = normalizeUniqueIds(miembros);
  const normalizedExplicitReporterIds = normalizeUniqueIds(
    explicitReporterIds.filter((userId) => normalizedMembers.includes(userId))
  );

  return normalizedExplicitReporterIds.length > 0
    ? normalizedExplicitReporterIds
    : normalizedMembers;
}

function mapRow(row: GrupoRow, miembros: string[], explicitReporterIds: string[]): WorkGroup {
  return {
    id: row.id,
    nombre: row.nombre,
    liderId: row.lider_id,
    miembros,
    reporterosIds: resolveReporterIds(miembros, explicitReporterIds),
    estado: row.estado,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

async function getExplicitGrupoReporteros(grupoId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("grupo_reportadores_actividad")
    .select("usuario_id")
    .eq("grupo_id", grupoId);
  if (error) {
    if (isMissingGroupReportersTableError(error)) return [];
    throw error;
  }

  return normalizeUniqueIds((data || []).map((row: { usuario_id: string }) => row.usuario_id));
}

async function syncGrupoReporteros(grupoId: string, miembros: string[], reporterosIds?: string[]) {
  const normalizedMembers = normalizeUniqueIds(miembros);
  const normalizedReporterIds = normalizeUniqueIds(
    (reporterosIds || []).filter((userId) => normalizedMembers.includes(userId))
  );

  const { error: deleteReporterRowsError } = await supabase
    .from("grupo_reportadores_actividad")
    .delete()
    .eq("grupo_id", grupoId);
  if (deleteReporterRowsError) {
    if (isMissingGroupReportersTableError(deleteReporterRowsError)) return;
    throw deleteReporterRowsError;
  }

  if (normalizedMembers.length === 0 || normalizedReporterIds.length === 0 || normalizedReporterIds.length === normalizedMembers.length) {
    return;
  }

  const reporterRows = normalizedReporterIds.map((usuarioId) => ({ grupo_id: grupoId, usuario_id: usuarioId }));
  const { error: insertReporterRowsError } = await supabase
    .from("grupo_reportadores_actividad")
    .insert(reporterRows);
  if (insertReporterRowsError) {
    if (isMissingGroupReportersTableError(insertReporterRowsError)) return;
    throw insertReporterRowsError;
  }
}

export async function getGrupos(): Promise<WorkGroup[]> {
  return getCachedValue(GRUPOS_CACHE_KEY, GRUPOS_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("grupos_trabajo")
      .select("*")
      .order("fecha_creacion", { ascending: false });
    if (error) throw error;

    const groupIds = (data || []).map((row: GrupoRow) => row.id).filter(Boolean);
    const [{ data: members, error: membersError }, { data: reporters, error: reportersError }] = groupIds.length > 0
      ? await Promise.all([
        supabase
          .from("grupo_miembros")
          .select("grupo_id, usuario_id")
          .in("grupo_id", groupIds),
        supabase
          .from("grupo_reportadores_actividad")
          .select("grupo_id, usuario_id")
          .in("grupo_id", groupIds),
      ])
      : [
        { data: [], error: null },
        { data: [], error: null },
      ];
    if (membersError) throw membersError;
    if (reportersError && !isMissingGroupReportersTableError(reportersError)) throw reportersError;

    const miembrosByGrupo = new Map<string, string[]>();
    for (const member of (members || []) as GrupoMiembroRow[]) {
      const groupId = member.grupo_id;
      if (!groupId) continue;
      const current = miembrosByGrupo.get(groupId) || [];
      current.push(member.usuario_id);
      miembrosByGrupo.set(groupId, current);
    }

    const reporterosByGrupo = new Map<string, string[]>();
    for (const reporter of (reporters || []) as GrupoReporteroRow[]) {
      const groupId = reporter.grupo_id;
      if (!groupId) continue;
      const current = reporterosByGrupo.get(groupId) || [];
      current.push(reporter.usuario_id);
      reporterosByGrupo.set(groupId, current);
    }

    return (data || []).map((row: GrupoRow) => mapRow(
      row,
      miembrosByGrupo.get(row.id) || [],
      reporterosByGrupo.get(row.id) || []
    ));
  });
}

export async function getGrupoById(id: string): Promise<WorkGroup | null> {
  const { data, error } = await supabase
    .from("grupos_trabajo")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;

  const { data: members } = await supabase
    .from("grupo_miembros")
    .select("usuario_id")
    .eq("grupo_id", id);
  const miembros = normalizeUniqueIds((members || []).map((m: { usuario_id: string }) => m.usuario_id));
  const reporterosIds = await getExplicitGrupoReporteros(id);
  return mapRow(data as GrupoRow, miembros, reporterosIds);
}

export async function createGrupo(group: Partial<WorkGroup>): Promise<WorkGroup> {
  const { data, error } = await supabase
    .from("grupos_trabajo")
    .insert({
      nombre: group.nombre,
      lider_id: group.liderId,
      estado: group.estado || "activo",
    })
    .select()
    .single();
  if (error) throw error;

  const miembros = normalizeUniqueIds(group.miembros || []);
  if (miembros.length > 0) {
    const rows = miembros.map((uid) => ({ grupo_id: data.id, usuario_id: uid }));
    const { error: membersError } = await supabase.from("grupo_miembros").insert(rows);
    if (membersError) throw membersError;

    const { error: usersError } = await supabase
      .from("usuarios")
      .update({ grupo_id: data.id })
      .in("id", miembros);
    if (usersError) throw usersError;
  }

  await syncGrupoReporteros(data.id, miembros, group.reporterosIds ?? miembros);

  invalidateCachedValue(GRUPOS_CACHE_KEY);
  return mapRow(data as GrupoRow, miembros, group.reporterosIds || miembros);
}

export async function updateGrupo(id: string, group: Partial<WorkGroup>): Promise<WorkGroup> {
  const updateData: Partial<Pick<GrupoRow, "nombre" | "lider_id" | "estado">> = {};
  if (group.nombre !== undefined) updateData.nombre = group.nombre;
  if (group.liderId !== undefined) updateData.lider_id = group.liderId;
  if (group.estado !== undefined) updateData.estado = group.estado;

  const { data, error } = await supabase
    .from("grupos_trabajo")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  let effectiveMemberIds: string[] | undefined;

  if (group.miembros !== undefined) {
    const { data: currentMembers, error: currentMembersError } = await supabase
      .from("grupo_miembros")
      .select("usuario_id")
      .eq("grupo_id", id);
    if (currentMembersError) throw currentMembersError;

    const previousMemberIds = normalizeUniqueIds((currentMembers || []).map((m: { usuario_id: string }) => m.usuario_id));

    const { error: deleteMembersError } = await supabase.from("grupo_miembros").delete().eq("grupo_id", id);
    if (deleteMembersError) throw deleteMembersError;

    if (previousMemberIds.length > 0) {
      const { error: resetUsersError } = await supabase
        .from("usuarios")
        .update({ grupo_id: null })
        .in("id", previousMemberIds);
      if (resetUsersError) throw resetUsersError;
    }

    effectiveMemberIds = normalizeUniqueIds(group.miembros);

    if (effectiveMemberIds.length > 0) {
      const rows = effectiveMemberIds.map((uid) => ({ grupo_id: id, usuario_id: uid }));
      const { error: insertMembersError } = await supabase.from("grupo_miembros").insert(rows);
      if (insertMembersError) throw insertMembersError;

      const { error: assignUsersError } = await supabase
        .from("usuarios")
        .update({ grupo_id: id })
        .in("id", effectiveMemberIds);
      if (assignUsersError) throw assignUsersError;
    }
  }

  if (group.reporterosIds !== undefined || group.miembros !== undefined) {
    const miembros = effectiveMemberIds || await (async () => {
      const { data: members, error: membersError } = await supabase
        .from("grupo_miembros")
        .select("usuario_id")
        .eq("grupo_id", id);
      if (membersError) throw membersError;
      return normalizeUniqueIds((members || []).map((m: { usuario_id: string }) => m.usuario_id));
    })();

    const reporterosIds = group.reporterosIds !== undefined
      ? group.reporterosIds
      : (() => {
        return miembros;
      })();

    await syncGrupoReporteros(id, miembros, reporterosIds);
  }

  const { data: members } = await supabase
    .from("grupo_miembros")
    .select("usuario_id")
    .eq("grupo_id", id);
  const miembros = normalizeUniqueIds((members || []).map((m: { usuario_id: string }) => m.usuario_id));
  const reporterosIds = await getExplicitGrupoReporteros(id);
  invalidateCachedValue(GRUPOS_CACHE_KEY);
  return mapRow(data as GrupoRow, miembros, reporterosIds);
}

export async function deleteGrupo(id: string): Promise<void> {
  const { data: members, error: membersError } = await supabase
    .from("grupo_miembros")
    .select("usuario_id")
    .eq("grupo_id", id);
  if (membersError) throw membersError;

  const memberIds = normalizeUniqueIds((members || []).map((m: { usuario_id: string }) => m.usuario_id));

  const { error: deleteReportersError } = await supabase
    .from("grupo_reportadores_actividad")
    .delete()
    .eq("grupo_id", id);
  if (deleteReportersError && !isMissingGroupReportersTableError(deleteReportersError)) throw deleteReportersError;

  const { error: deleteMembersError } = await supabase
    .from("grupo_miembros")
    .delete()
    .eq("grupo_id", id);
  if (deleteMembersError) throw deleteMembersError;

  if (memberIds.length > 0) {
    const { error: usersError } = await supabase
      .from("usuarios")
      .update({ grupo_id: null })
      .in("id", memberIds);
    if (usersError) throw usersError;
  }

  const { error } = await supabase.from("grupos_trabajo").delete().eq("id", id);
  if (error) throw error;
  invalidateCachedValue(GRUPOS_CACHE_KEY);
}
