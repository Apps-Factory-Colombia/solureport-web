import { supabase } from "../client";
import { CompanySettings, ScheduleDay } from "@/lib/types";
import { getCachedValue, invalidateCachedValue } from "@/lib/utils/request-cache";

const CONFIGURACION_CACHE_KEY = "configuracion:empresa";
const CONFIGURACION_CACHE_TTL = 60_000;
const DEFAULT_AUTOMATIC_DISCOUNT_DAYS: ScheduleDay[] = ["lunes", "martes", "miercoles", "jueves", "viernes"];
const DEFAULT_AUTOMATIC_DISCOUNT_TIME = "08:30";
const VALID_SCHEDULE_DAYS = new Set<ScheduleDay>([
  "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo",
]);

interface ConfiguracionEmpresaRow {
  nombre: string;
  logo_url?: string | null;
  correo_remitente: string;
  correo_empresa?: string | null;
  plantilla_reporte_pdf?: string | null;
  porcentaje_descuento_tardanza?: number | string | null;
  dias_descuento_automatico?: string[] | null;
  hora_descuento_automatico?: string | null;
  porcentaje_extra_lider?: number | string | null;
  extra_lider_activo?: boolean | null;
  costo_revision_lider?: number | string | null;
  costo_visita_tecnica_default?: number | string | null;
  costo_recorrido_normal?: number | string | null;
  costo_recorrido_herramienta?: number | string | null;
}

function normalizeAutomaticDiscountDays(value?: string[] | null): ScheduleDay[] {
  if (value === undefined || value === null) return [...DEFAULT_AUTOMATIC_DISCOUNT_DAYS];
  return value.filter((day): day is ScheduleDay => VALID_SCHEDULE_DAYS.has(day as ScheduleDay));
}

function normalizeAutomaticDiscountTime(value?: string | null): string {
  return value && /^([01]\d|2[0-3]):[0-5]\d/.test(value.slice(0, 5))
    ? value.slice(0, 5)
    : DEFAULT_AUTOMATIC_DISCOUNT_TIME;
}

function mapRow(row: ConfiguracionEmpresaRow): CompanySettings {
  return {
    nombre: row.nombre,
    logo: row.logo_url || "/logo.png",
    correoRemitente: row.correo_remitente,
    correoEmpresa: row.correo_empresa || "solucionesyautomatizaciones@hotmail.com",
    plantillaReportePDF: row.plantilla_reporte_pdf || "default",
    porcentajeDescuentoTardanza: Number(row.porcentaje_descuento_tardanza ?? 5) || 5,
    diasDescuentoAutomatico: normalizeAutomaticDiscountDays(row.dias_descuento_automatico),
    horaDescuentoAutomatico: normalizeAutomaticDiscountTime(row.hora_descuento_automatico),
    porcentajeExtraLider: Number(row.porcentaje_extra_lider ?? 10) || 10,
    extraLiderActivo: row.extra_lider_activo ?? true,
    costoRevisionLider: Number(row.costo_revision_lider ?? 15000) || 15000,
    costoVisitaTecnicaDefault: Number(row.costo_visita_tecnica_default ?? 0) || 0,
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
        diasDescuentoAutomatico: [...DEFAULT_AUTOMATIC_DISCOUNT_DAYS],
        horaDescuentoAutomatico: DEFAULT_AUTOMATIC_DISCOUNT_TIME,
        porcentajeExtraLider: 10,
        extraLiderActivo: true,
        costoRevisionLider: 15000,
        costoVisitaTecnicaDefault: 0,
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
  if (settings.diasDescuentoAutomatico !== undefined) updateData.dias_descuento_automatico = settings.diasDescuentoAutomatico;
  if (settings.horaDescuentoAutomatico !== undefined) updateData.hora_descuento_automatico = settings.horaDescuentoAutomatico;
  if (settings.porcentajeExtraLider !== undefined) updateData.porcentaje_extra_lider = settings.porcentajeExtraLider;
  if (settings.extraLiderActivo !== undefined) updateData.extra_lider_activo = settings.extraLiderActivo;
  if (settings.costoRevisionLider !== undefined) updateData.costo_revision_lider = settings.costoRevisionLider;
  if (settings.costoVisitaTecnicaDefault !== undefined) updateData.costo_visita_tecnica_default = settings.costoVisitaTecnicaDefault;
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
