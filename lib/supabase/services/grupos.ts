import { supabase } from "../client";
import { WorkGroup } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const GRUPOS_CACHE_KEY = "grupos:list";
const GRUPOS_CACHE_TTL = 60_000;

function mapRow(row: any, miembros: string[]): WorkGroup {
  return {
    id: row.id,
    nombre: row.nombre,
    liderId: row.lider_id,
    miembros,
    estado: row.estado,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

export async function getGrupos(): Promise<WorkGroup[]> {
  return getCachedValue(GRUPOS_CACHE_KEY, GRUPOS_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("grupos_trabajo")
      .select("*")
      .order("fecha_creacion", { ascending: false });
    if (error) throw error;

    const groupIds = (data || []).map((row: any) => row.id).filter(Boolean);
    const { data: members, error: membersError } = groupIds.length > 0
      ? await supabase
        .from("grupo_miembros")
        .select("grupo_id, usuario_id")
        .in("grupo_id", groupIds)
      : { data: [], error: null };
    if (membersError) throw membersError;

    const miembrosByGrupo = new Map<string, string[]>();
    for (const member of members || []) {
      const groupId = member.grupo_id;
      if (!groupId) continue;
      const current = miembrosByGrupo.get(groupId) || [];
      current.push(member.usuario_id);
      miembrosByGrupo.set(groupId, current);
    }

    return (data || []).map((row: any) => mapRow(row, miembrosByGrupo.get(row.id) || []));
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
  const miembros = (members || []).map((m: any) => m.usuario_id);
  return mapRow(data, miembros);
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

  const miembros = group.miembros || [];
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

  invalidateCachedValue(GRUPOS_CACHE_KEY);
  return mapRow(data, miembros);
}

export async function updateGrupo(id: string, group: Partial<WorkGroup>): Promise<WorkGroup> {
  const updateData: any = {};
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

  if (group.miembros !== undefined) {
    const { data: currentMembers, error: currentMembersError } = await supabase
      .from("grupo_miembros")
      .select("usuario_id")
      .eq("grupo_id", id);
    if (currentMembersError) throw currentMembersError;

    const previousMemberIds = (currentMembers || []).map((m: any) => m.usuario_id);

    const { error: deleteMembersError } = await supabase.from("grupo_miembros").delete().eq("grupo_id", id);
    if (deleteMembersError) throw deleteMembersError;

    if (previousMemberIds.length > 0) {
      const { error: resetUsersError } = await supabase
        .from("usuarios")
        .update({ grupo_id: null })
        .in("id", previousMemberIds);
      if (resetUsersError) throw resetUsersError;
    }

    if (group.miembros.length > 0) {
      const rows = group.miembros.map((uid) => ({ grupo_id: id, usuario_id: uid }));
      const { error: insertMembersError } = await supabase.from("grupo_miembros").insert(rows);
      if (insertMembersError) throw insertMembersError;

      const { error: assignUsersError } = await supabase
        .from("usuarios")
        .update({ grupo_id: id })
        .in("id", group.miembros);
      if (assignUsersError) throw assignUsersError;
    }
  }

  const { data: members } = await supabase
    .from("grupo_miembros")
    .select("usuario_id")
    .eq("grupo_id", id);
  const miembros = (members || []).map((m: any) => m.usuario_id);
  invalidateCachedValue(GRUPOS_CACHE_KEY);
  return mapRow(data, miembros);
}

export async function deleteGrupo(id: string): Promise<void> {
  const { data: members, error: membersError } = await supabase
    .from("grupo_miembros")
    .select("usuario_id")
    .eq("grupo_id", id);
  if (membersError) throw membersError;

  const memberIds = (members || []).map((m: any) => m.usuario_id);

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
