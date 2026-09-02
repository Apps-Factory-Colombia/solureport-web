import { Activity } from "@/lib/types";
import { dataRequest } from "../client";

export async function getActividades(): Promise<Activity[]> { return dataRequest<Activity[]>("catalog.list"); }
export async function createActividad(activity: Partial<Activity>): Promise<Activity> { return dataRequest<Activity>("catalog.create", activity); }
export async function updateActividad(id: string, activity: Partial<Activity>): Promise<Activity> { return dataRequest<Activity>("catalog.update", { id, ...activity }); }
export type ActivityDeleteResult = { id: string; deleted: boolean; archived: boolean; message: string };
export async function deleteActividad(id: string): Promise<ActivityDeleteResult> { return dataRequest<ActivityDeleteResult>("catalog.delete", { id }); }
