import { supabase } from "../client";

// ── Bucket names (must match Supabase Storage buckets) ──────────────
export const BUCKETS = {
  FOTOS_MANTENIMIENTOS: "fotos-mantenimientos",
  FOTOS_REPORTES: "fotos-reportes",
  FOTOS_VISITAS: "fotos-visitas",
  FOTOS_RECORRIDOS: "fotos-recorridos",
} as const;

const GROUP_ACTIVITY_EVIDENCE_FOLDER = "group-activities";

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

// ── Upload file ─────────────────────────────────────────────────────
export async function uploadFile(
  bucket: BucketName,
  path: string,
  file: File | Blob
): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    cacheControl: "3600",
  });
  if (error) throw error;
  return getPublicUrl(bucket, path);
}

// ── Get public URL ──────────────────────────────────────────────────
export function getPublicUrl(bucket: BucketName, path: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// ── Delete file ─────────────────────────────────────────────────────
export async function deleteFile(
  bucket: BucketName,
  path: string
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}

// ── Delete multiple files ───────────────────────────────────────────
export async function deleteFiles(
  bucket: BucketName,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw error;
}

// ── List files in a folder ──────────────────────────────────────────
export async function listFiles(
  bucket: BucketName,
  folder: string
): Promise<string[]> {
  const { data, error } = await supabase.storage.from(bucket).list(folder);
  if (error) throw error;
  return (data || []).map((f) => `${folder}/${f.name}`);
}

// ── Helper: upload foto de mantenimiento ────────────────────────────
export async function uploadFotoMantenimiento(
  mantenimientoId: string,
  tipo: "antes" | "despues",
  file: File | Blob,
  orden: number = 0
): Promise<string> {
  const ext = file instanceof File ? file.name.split(".").pop() : "jpg";
  const path = `${mantenimientoId}/${tipo}/${Date.now()}_${orden}.${ext}`;
  const url = await uploadFile(BUCKETS.FOTOS_MANTENIMIENTOS, path, file);

  // Insert into mantenimiento_fotos
  await supabase.from("mantenimiento_fotos").insert({
    mantenimiento_id: mantenimientoId,
    tipo,
    url,
    orden,
  });
  return url;
}

// ── Helper: upload firma receptor (mantenimiento) ───────────────────
export async function uploadFirmaMantenimiento(
  mantenimientoId: string,
  file: File | Blob
): Promise<string> {
  const path = `${mantenimientoId}/firma_receptor.png`;
  const url = await uploadFile(BUCKETS.FOTOS_MANTENIMIENTOS, path, file);

  await supabase
    .from("mantenimientos")
    .update({ firma_receptor_url: url, firmado: true })
    .eq("id", mantenimientoId);
  return url;
}

// ── Helper: upload foto bitacora (mantenimiento) ────────────────────
export async function uploadBitacoraMantenimiento(
  mantenimientoId: string,
  file: File | Blob
): Promise<string> {
  const path = `${mantenimientoId}/bitacora.jpg`;
  const url = await uploadFile(BUCKETS.FOTOS_MANTENIMIENTOS, path, file);

  await supabase
    .from("mantenimientos")
    .update({ foto_bitacora_url: url, tiene_bitacora: true })
    .eq("id", mantenimientoId);
  return url;
}

// ── Helper: upload foto de reporte de actividad ─────────────────────
export async function uploadFotoReporteActividad(
  reporteId: string,
  tipo: "antes" | "despues",
  file: File | Blob,
  orden: number = 0
): Promise<string> {
  const ext = file instanceof File ? file.name.split(".").pop() : "jpg";
  const path = `${reporteId}/${tipo}/${Date.now()}_${orden}.${ext}`;
  const url = await uploadFile(BUCKETS.FOTOS_REPORTES, path, file);

  await supabase.from("reporte_actividad_fotos").insert({
    reporte_actividad_id: reporteId,
    tipo,
    url,
    orden,
  });
  return url;
}

// ── Helper: upload firma receptor (reporte actividad) ───────────────
export async function uploadFirmaReporteActividad(
  reporteId: string,
  file: File | Blob
): Promise<string> {
  const path = `${reporteId}/firma_receptor.png`;
  const url = await uploadFile(BUCKETS.FOTOS_REPORTES, path, file);

  await supabase
    .from("reportes_actividad")
    .update({ firma_receptor_url: url })
    .eq("id", reporteId);
  return url;
}

// ── Helper: upload foto bitacora (reporte actividad) ────────────────
export async function uploadBitacoraReporteActividad(
  reporteId: string,
  file: File | Blob
): Promise<string> {
  const path = `${reporteId}/bitacora.jpg`;
  const url = await uploadFile(BUCKETS.FOTOS_REPORTES, path, file);

  await supabase
    .from("reportes_actividad")
    .update({ foto_bitacora_url: url, tiene_bitacora: true })
    .eq("id", reporteId);
  return url;
}

// ── Helper: upload foto herramienta (reporte actividad) ─────────────
export async function uploadHerramientaReporteActividad(
  reporteId: string,
  file: File | Blob
): Promise<string> {
  const path = `${reporteId}/herramienta.jpg`;
  const url = await uploadFile(BUCKETS.FOTOS_REPORTES, path, file);

  await supabase
    .from("reportes_actividad")
    .update({ foto_herramienta_url: url })
    .eq("id", reporteId);
  return url;
}

// ── Helper: upload foto de visita técnica ───────────────────────────
export async function uploadFotoVisita(
  visitaId: string,
  tipo: "antes" | "despues",
  file: File | Blob,
  orden: number = 0
): Promise<string> {
  const ext = file instanceof File ? file.name.split(".").pop() : "jpg";
  const path = `${visitaId}/${tipo}/${Date.now()}_${orden}.${ext}`;
  const url = await uploadFile(BUCKETS.FOTOS_VISITAS, path, file);

  await supabase.from("visita_tecnica_fotos").insert({
    visita_tecnica_id: visitaId,
    tipo,
    url,
    orden,
  });
  return url;
}

// ── Helper: upload firma receptor (visita técnica) ──────────────────
export async function uploadFirmaVisita(
  visitaId: string,
  file: File | Blob
): Promise<string> {
  const path = `${visitaId}/firma_receptor.png`;
  const url = await uploadFile(BUCKETS.FOTOS_VISITAS, path, file);

  await supabase
    .from("visitas_tecnicas")
    .update({ firma_receptor_url: url })
    .eq("id", visitaId);
  return url;
}

// ── Helper: upload foto bitacora (visita técnica) ───────────────────
export async function uploadBitacoraVisita(
  visitaId: string,
  file: File | Blob
): Promise<string> {
  const path = `${visitaId}/bitacora.jpg`;
  const url = await uploadFile(BUCKETS.FOTOS_VISITAS, path, file);

  await supabase
    .from("visitas_tecnicas")
    .update({ foto_bitacora_url: url, tiene_bitacora: true })
    .eq("id", visitaId);
  return url;
}

// ── Helper: upload foto herramienta (recorrido) ─────────────────────
export async function uploadHerramientaRecorrido(
  recorridoId: string,
  file: File | Blob
): Promise<string> {
  const path = `${recorridoId}/herramienta.jpg`;
  const url = await uploadFile(BUCKETS.FOTOS_RECORRIDOS, path, file);

  await supabase
    .from("recorridos")
    .update({ foto_herramienta_url: url })
    .eq("id", recorridoId);

  const { data: recorrido } = await supabase
    .from("recorridos")
    .select("tecnico_id, fecha, punto_partida, punto_llegada, tipo_recorrido")
    .eq("id", recorridoId)
    .maybeSingle();

  if (recorrido) {
    let reportQuery = supabase
      .from("reportes_actividad")
      .update({ foto_herramienta_url: url })
      .eq("tipo", "recorrido")
      .eq("tecnico_id", recorrido.tecnico_id)
      .eq("fecha", recorrido.fecha)
      .eq("punto_partida", recorrido.punto_partida)
      .eq("punto_llegada", recorrido.punto_llegada);

    if (recorrido.tipo_recorrido) {
      reportQuery = reportQuery.eq("tipo_recorrido", recorrido.tipo_recorrido);
    }

    await reportQuery;
  }

  return url;
}

export async function replaceGroupActivityEvidenceFile(
  activityId: string,
  file: File | Blob
): Promise<string> {
  const folder = `${GROUP_ACTIVITY_EVIDENCE_FOLDER}/${activityId}`;
  const existingFiles = await listFiles(BUCKETS.FOTOS_REPORTES, folder).catch(() => []);

  if (existingFiles.length > 0) {
    await deleteFiles(BUCKETS.FOTOS_REPORTES, existingFiles);
  }

  const ext = file instanceof File ? (file.name.split(".").pop() || "jpg") : "jpg";
  const path = `${folder}/evidencia_${Date.now()}.${ext}`;
  return uploadFile(BUCKETS.FOTOS_REPORTES, path, file);
}

export async function deleteGroupActivityEvidenceFiles(activityId: string): Promise<void> {
  const folder = `${GROUP_ACTIVITY_EVIDENCE_FOLDER}/${activityId}`;
  const files = await listFiles(BUCKETS.FOTOS_REPORTES, folder).catch(() => []);

  if (files.length > 0) {
    await deleteFiles(BUCKETS.FOTOS_REPORTES, files);
  }
}

// ── Helper: delete all files for a mantenimiento ────────────────────
export async function deleteAllFotosMantenimiento(
  mantenimientoId: string
): Promise<void> {
  const files = await listFiles(
    BUCKETS.FOTOS_MANTENIMIENTOS,
    mantenimientoId
  );
  if (files.length > 0) {
    await deleteFiles(BUCKETS.FOTOS_MANTENIMIENTOS, files);
  }
  await supabase
    .from("mantenimiento_fotos")
    .delete()
    .eq("mantenimiento_id", mantenimientoId);
}

// ── Helper: delete all files for a reporte de actividad ─────────────
export async function deleteAllFotosReporteActividad(
  reporteId: string
): Promise<void> {
  const files = await listFiles(BUCKETS.FOTOS_REPORTES, reporteId);
  if (files.length > 0) {
    await deleteFiles(BUCKETS.FOTOS_REPORTES, files);
  }
  await supabase
    .from("reporte_actividad_fotos")
    .delete()
    .eq("reporte_actividad_id", reporteId);
}

// ── Helper: delete all files for a visita ───────────────────────────
export async function deleteAllFotosVisita(
  visitaId: string
): Promise<void> {
  const files = await listFiles(BUCKETS.FOTOS_VISITAS, visitaId);
  if (files.length > 0) {
    await deleteFiles(BUCKETS.FOTOS_VISITAS, files);
  }
  await supabase
    .from("visita_tecnica_fotos")
    .delete()
    .eq("visita_tecnica_id", visitaId);
}

// ── Helper: delete all files for a recorrido ───────────────────────
export async function deleteAllFotosRecorrido(
  recorridoId: string
): Promise<void> {
  const files = await listFiles(BUCKETS.FOTOS_RECORRIDOS, recorridoId);
  if (files.length > 0) {
    await deleteFiles(BUCKETS.FOTOS_RECORRIDOS, files);
  }
}
