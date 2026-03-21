import { supabase } from "../client";
import { CompanySettings } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const CONFIGURACION_CACHE_KEY = "configuracion:empresa";
const CONFIGURACION_CACHE_TTL = 60_000;

interface ConfiguracionEmpresaRow {
  nombre: string;
  logo_url?: string | null;
  correo_remitente: string;
  correo_empresa?: string | null;
  plantilla_reporte_pdf?: string | null;
  porcentaje_descuento_tardanza?: number | string | null;
  porcentaje_extra_lider?: number | string | null;
  extra_lider_activo?: boolean | null;
  costo_revision_lider?: number | string | null;
  costo_recorrido_normal?: number | string | null;
  costo_recorrido_herramienta?: number | string | null;
}

function mapRow(row: ConfiguracionEmpresaRow): CompanySettings {
  return {
    nombre: row.nombre,
    logo: row.logo_url || "/logo.png",
    correoRemitente: row.correo_remitente,
    correoEmpresa: row.correo_empresa || "solucionesyautomatizaciones@hotmail.com",
    plantillaReportePDF: row.plantilla_reporte_pdf || "default",
    porcentajeDescuentoTardanza: Number(row.porcentaje_descuento_tardanza ?? 5) || 5,
    porcentajeExtraLider: Number(row.porcentaje_extra_lider ?? 10) || 10,
    extraLiderActivo: row.extra_lider_activo ?? true,
    costoRevisionLider: Number(row.costo_revision_lider ?? 15000) || 15000,
    costoRecorridoNormal: Number(row.costo_recorrido_normal ?? 25000) || 25000,
    costoRecorridoHerramienta: Number(row.costo_recorrido_herramienta ?? 40000) || 40000,
  };
}

export async function getConfiguracion(): Promise<CompanySettings> {
  return getCachedValue(CONFIGURACION_CACHE_KEY, CONFIGURACION_CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from("configuracion_empresa")
      .select("*")
      .limit(1)
      .single();
    if (error) {
      return {
        nombre: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        logo: "/logo.png",
        correoRemitente: "notificaciones@solucionesyautomatizaciones.com",
        correoEmpresa: "solucionesyautomatizaciones@hotmail.com",
        plantillaReportePDF: "default",
        porcentajeDescuentoTardanza: 5,
        porcentajeExtraLider: 10,
        extraLiderActivo: true,
        costoRevisionLider: 15000,
        costoRecorridoNormal: 25000,
        costoRecorridoHerramienta: 40000,
      };
    }
    return mapRow(data);
  });
}

export async function updateConfiguracion(settings: Partial<CompanySettings>): Promise<CompanySettings> {
  const { data: existing } = await supabase
    .from("configuracion_empresa")
    .select("id")
    .limit(1)
    .single();

  const updateData: Record<string, unknown> = {};
  if (settings.nombre !== undefined) updateData.nombre = settings.nombre;
  if (settings.correoRemitente !== undefined) updateData.correo_remitente = settings.correoRemitente;
  if (settings.correoEmpresa !== undefined) updateData.correo_empresa = settings.correoEmpresa;
  if (settings.plantillaReportePDF !== undefined) updateData.plantilla_reporte_pdf = settings.plantillaReportePDF;
  if (settings.porcentajeDescuentoTardanza !== undefined) updateData.porcentaje_descuento_tardanza = settings.porcentajeDescuentoTardanza;
  if (settings.porcentajeExtraLider !== undefined) updateData.porcentaje_extra_lider = settings.porcentajeExtraLider;
  if (settings.extraLiderActivo !== undefined) updateData.extra_lider_activo = settings.extraLiderActivo;
  if (settings.costoRevisionLider !== undefined) updateData.costo_revision_lider = settings.costoRevisionLider;
  if (settings.costoRecorridoNormal !== undefined) updateData.costo_recorrido_normal = settings.costoRecorridoNormal;
  if (settings.costoRecorridoHerramienta !== undefined) updateData.costo_recorrido_herramienta = settings.costoRecorridoHerramienta;

  if (existing) {
    const { data, error } = await supabase
      .from("configuracion_empresa")
      .update(updateData)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    invalidateCachedValue(CONFIGURACION_CACHE_KEY);
    return mapRow(data);
  } else {
    const { data, error } = await supabase
      .from("configuracion_empresa")
      .insert({
        nombre: settings.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        correo_remitente: settings.correoRemitente || "notificaciones@solucionesyautomatizaciones.com",
        correo_empresa: settings.correoEmpresa || "solucionesyautomatizaciones@hotmail.com",
        ...updateData,
      })
      .select()
      .single();
    if (error) throw error;
    invalidateCachedValue(CONFIGURACION_CACHE_KEY);
    return mapRow(data);
  }
}
