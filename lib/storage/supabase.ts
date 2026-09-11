import { createClient } from "@supabase/supabase-js";

type StorageClient = ReturnType<typeof createClient>;

function createConfiguredClient(url?: string, publishableKey?: string): StorageClient | null {
  if (!url || !publishableKey) return null;
  return createClient(url, publishableKey);
}

// If build arguments were supplied, keep the zero-request fast path. When a
// Docker image is built without them, initialize from the runtime endpoint
// below instead of crashing the whole application at import time.
const embeddedStorageClient = createConfiguredClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
let resolvedStorageClient: StorageClient | null = embeddedStorageClient;
let storageClientPromise: Promise<StorageClient> | null = null;

// Kept as a compatible export for any future consumer; operations below
// resolve the runtime client before using it.
export const storageClient = embeddedStorageClient;

function storageConfigurationError(): Error {
  return new Error("Supabase Storage no está configurado. Define las variables públicas en Dockploy.");
}

async function getStorageClient(): Promise<StorageClient> {
  if (resolvedStorageClient) return resolvedStorageClient;
  if (storageClientPromise) return storageClientPromise;

  storageClientPromise = (async () => {
    if (typeof window === "undefined") {
      const env = process.env as Record<string, string | undefined>;
      const client = createConfiguredClient(
        env.SOLUREPORT_SUPABASE_URL || env["NEXT_PUBLIC_" + "SUPABASE_URL"],
        env.SOLUREPORT_SUPABASE_PUBLISHABLE_KEY
          || env["NEXT_PUBLIC_" + "SUPABASE_ANON_KEY"]
          || env["NEXT_PUBLIC_" + "SUPABASE_PUBLISHABLE_KEY"],
      );
      if (!client) throw storageConfigurationError();
      resolvedStorageClient = client;
      return client;
    }

    const response = await fetch("/api/config/storage", { cache: "no-store" });
    const config = await response.json() as { configured?: boolean; url?: string; publishableKey?: string };
    const client = createConfiguredClient(config.url, config.publishableKey);
    if (!response.ok || !config.configured || !client) throw storageConfigurationError();
    resolvedStorageClient = client;
    return client;
  })().finally(() => {
    storageClientPromise = null;
  });

  return storageClientPromise;
}

export const BUCKETS = {
  FOTOS_MANTENIMIENTOS: "fotos-mantenimientos",
  FOTOS_REPORTES: "fotos-reportes",
  FOTOS_VISITAS: "fotos-visitas",
  FOTOS_RECORRIDOS: "fotos-recorridos",
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

export async function uploadFile(bucket: BucketName, path: string, file: File | Blob): Promise<string> {
  const client = await getStorageClient();
  const { error } = await client.storage.from(bucket).upload(path, file, { upsert: true, cacheControl: "3600" });
  if (error) throw error;
  return getPublicUrl(bucket, path);
}

export function getPublicUrl(bucket: BucketName, path: string): string {
  if (!resolvedStorageClient) throw storageConfigurationError();
  return resolvedStorageClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function deleteFile(bucket: BucketName, path: string): Promise<void> {
  const client = await getStorageClient();
  const { error } = await client.storage.from(bucket).remove([path]);
  if (error) throw error;
}

export async function deleteFiles(bucket: BucketName, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const client = await getStorageClient();
  const { error } = await client.storage.from(bucket).remove(paths);
  if (error) throw error;
}

export async function listFiles(bucket: BucketName, folder: string): Promise<string[]> {
  const client = await getStorageClient();
  const { data, error } = await client.storage.from(bucket).list(folder);
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
