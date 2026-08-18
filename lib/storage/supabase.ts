import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) throw new Error("Falta la configuración de Supabase Storage.");

export const storageClient = createClient(supabaseUrl, supabaseAnonKey);

export const BUCKETS = {
  FOTOS_MANTENIMIENTOS: "fotos-mantenimientos",
  FOTOS_REPORTES: "fotos-reportes",
  FOTOS_VISITAS: "fotos-visitas",
  FOTOS_RECORRIDOS: "fotos-recorridos",
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

export async function uploadFile(bucket: BucketName, path: string, file: File | Blob): Promise<string> {
  const { error } = await storageClient.storage.from(bucket).upload(path, file, { upsert: true, cacheControl: "3600" });
  if (error) throw error;
  return getPublicUrl(bucket, path);
}

export function getPublicUrl(bucket: BucketName, path: string): string {
  return storageClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function deleteFile(bucket: BucketName, path: string): Promise<void> {
  const { error } = await storageClient.storage.from(bucket).remove([path]);
  if (error) throw error;
}

export async function deleteFiles(bucket: BucketName, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await storageClient.storage.from(bucket).remove(paths);
  if (error) throw error;
}

export async function listFiles(bucket: BucketName, folder: string): Promise<string[]> {
  const { data, error } = await storageClient.storage.from(bucket).list(folder);
  if (error) throw error;
  return (data || []).map((file) => `${folder}/${file.name}`);
}

function extension(file: File | Blob): string { return file instanceof File ? file.name.split(".").pop() || "jpg" : "jpg"; }
export async function uploadFotoMantenimiento(id: string, tipo: "antes" | "despues", file: File | Blob, orden = 0) { return uploadFile(BUCKETS.FOTOS_MANTENIMIENTOS, `${id}/${tipo}/${Date.now()}_${orden}.${extension(file)}`, file); }
export async function uploadFirmaMantenimiento(id: string, file: File | Blob) { return uploadFile(BUCKETS.FOTOS_MANTENIMIENTOS, `${id}/firma_receptor.png`, file); }
export async function uploadBitacoraMantenimiento(id: string, file: File | Blob) { return uploadFile(BUCKETS.FOTOS_MANTENIMIENTOS, `${id}/bitacora.jpg`, file); }
export async function uploadFotoReporteActividad(id: string, tipo: "antes" | "despues", file: File | Blob, orden = 0) { return uploadFile(BUCKETS.FOTOS_REPORTES, `${id}/${tipo}/${Date.now()}_${orden}.${extension(file)}`, file); }
export async function uploadFirmaReporteActividad(id: string, file: File | Blob) { return uploadFile(BUCKETS.FOTOS_REPORTES, `${id}/firma_receptor.png`, file); }
export async function uploadBitacoraReporteActividad(id: string, file: File | Blob) { return uploadFile(BUCKETS.FOTOS_REPORTES, `${id}/bitacora.jpg`, file); }
export async function uploadHerramientaReporteActividad(id: string, file: File | Blob) { return uploadFile(BUCKETS.FOTOS_REPORTES, `${id}/herramienta.jpg`, file); }
export async function uploadFotoVisita(id: string, tipo: "antes" | "despues", file: File | Blob, orden = 0) { return uploadFile(BUCKETS.FOTOS_VISITAS, `${id}/${tipo}/${Date.now()}_${orden}.${extension(file)}`, file); }
export async function uploadFirmaVisita(id: string, file: File | Blob) { return uploadFile(BUCKETS.FOTOS_VISITAS, `${id}/firma_receptor.png`, file); }
export async function uploadBitacoraVisita(id: string, file: File | Blob) { return uploadFile(BUCKETS.FOTOS_VISITAS, `${id}/bitacora.jpg`, file); }
export async function uploadHerramientaRecorrido(id: string, file: File | Blob) { return uploadFile(BUCKETS.FOTOS_RECORRIDOS, `${id}/herramienta.jpg`, file); }
export async function replaceGroupActivityEvidenceFile(id: string, file: File | Blob) {
  const folder = `group-activities/${id}`;
  const existing = await listFiles(BUCKETS.FOTOS_REPORTES, folder).catch(() => []);
  if (existing.length) await deleteFiles(BUCKETS.FOTOS_REPORTES, existing);
  return uploadFile(BUCKETS.FOTOS_REPORTES, `${folder}/evidencia_${Date.now()}.${extension(file)}`, file);
}
export async function deleteGroupActivityEvidenceFiles(id: string) { const files = await listFiles(BUCKETS.FOTOS_REPORTES, `group-activities/${id}`).catch(() => []); await deleteFiles(BUCKETS.FOTOS_REPORTES, files); }
export async function deleteAllFotosMantenimiento(id: string) { const files = await listFiles(BUCKETS.FOTOS_MANTENIMIENTOS, id).catch(() => []); await deleteFiles(BUCKETS.FOTOS_MANTENIMIENTOS, files); }
export async function deleteAllFotosReporteActividad(id: string) { const files = await listFiles(BUCKETS.FOTOS_REPORTES, id).catch(() => []); await deleteFiles(BUCKETS.FOTOS_REPORTES, files); }
export async function deleteAllFotosVisita(id: string) { const files = await listFiles(BUCKETS.FOTOS_VISITAS, id).catch(() => []); await deleteFiles(BUCKETS.FOTOS_VISITAS, files); }
export async function deleteAllFotosRecorrido(id: string) { const files = await listFiles(BUCKETS.FOTOS_RECORRIDOS, id).catch(() => []); await deleteFiles(BUCKETS.FOTOS_RECORRIDOS, files); }
