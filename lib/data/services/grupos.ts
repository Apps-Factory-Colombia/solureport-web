import { WorkGroup } from "@/lib/types";
import { dataRequest } from "../client";

export async function getGrupos(): Promise<WorkGroup[]> { return dataRequest<WorkGroup[]>("groups.list"); }
export async function getGrupoById(id: string): Promise<WorkGroup | null> { return dataRequest<WorkGroup | null>("groups.get", { id }); }
export async function createGrupo(group: Partial<WorkGroup>): Promise<WorkGroup> { return dataRequest<WorkGroup>("groups.create", group); }
export async function updateGrupo(id: string, group: Partial<WorkGroup>): Promise<WorkGroup> { return dataRequest<WorkGroup>("groups.update", { id, ...group }); }
export type GroupDeleteResult = { id: string; deleted: boolean; archived: boolean; message: string };
export async function deleteGrupo(id: string): Promise<GroupDeleteResult> { return dataRequest<GroupDeleteResult>("groups.delete", { id }); }
