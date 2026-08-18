import { WorkGroup } from "@/lib/types";
import { dataRequest } from "../client";

export async function getGrupos(): Promise<WorkGroup[]> { return dataRequest<WorkGroup[]>("groups.list"); }
export async function getGrupoById(id: string): Promise<WorkGroup | null> { return dataRequest<WorkGroup | null>("groups.get", { id }); }
export async function createGrupo(group: Partial<WorkGroup>): Promise<WorkGroup> { return dataRequest<WorkGroup>("groups.create", group); }
export async function updateGrupo(id: string, group: Partial<WorkGroup>): Promise<WorkGroup> { return dataRequest<WorkGroup>("groups.update", { id, ...group }); }
export async function deleteGrupo(id: string): Promise<void> { await dataRequest("groups.delete", { id }); }
