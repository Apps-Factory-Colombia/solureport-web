import { dataRequest } from "../client";

export interface Notificacion { id: string; usuarioId: string; titulo: string; mensaje: string; tipo: "mantenimiento" | "liquidacion" | "mensaje" | "general" | "aprobacion" | "visit" | "attendance"; leida: boolean; datos?: Record<string, unknown>; fechaCreacion: string; }
export async function getNotificaciones(usuarioId?: string): Promise<Notificacion[]> { return dataRequest<Notificacion[]>("notifications.list", { usuarioId }); }
export async function createNotificacion(notif: Omit<Notificacion, "id" | "leida" | "fechaCreacion">): Promise<Notificacion> { return dataRequest<Notificacion>("notifications.create", notif); }
export async function marcarLeida(id: string): Promise<void> { await dataRequest("notifications.read", { id }); }
export async function createNotificacionesBulk(items: Array<Omit<Notificacion, "id" | "leida" | "fechaCreacion">>): Promise<void> { await dataRequest("notifications.bulk", { items }); }
