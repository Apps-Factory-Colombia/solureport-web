import { supabase } from "../client";
import { CompanySettings } from "@/lib/types";

function mapRow(row: any): CompanySettings {
  return {
    nombre: row.nombre,
    logo: row.logo_url || "/logo.png",
    correoRemitente: row.correo_remitente,
    plantillaReportePDF: row.plantilla_reporte_pdf || "default",
    porcentajeDescuentoTardanza: parseFloat(row.porcentaje_descuento_tardanza) || 5,
    porcentajeExtraLider: parseFloat(row.porcentaje_extra_lider) || 10,
    extraLiderActivo: row.extra_lider_activo ?? true,
    costoRevisionLider: parseFloat(row.costo_revision_lider) || 15000,
    costoRecorridoNormal: parseFloat(row.costo_recorrido_normal) || 25000,
    costoRecorridoHerramienta: parseFloat(row.costo_recorrido_herramienta) || 40000,
  };
}

export async function getConfiguracion(): Promise<CompanySettings> {
  const { data, error } = await supabase
    .from("configuracion_empresa")
    .select("*")
    .limit(1)
    .single();
  if (error) {
    return {
      nombre: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
      logo: "/logo.png",
      correoRemitente: "reportes@solureport.com",
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
}

export async function updateConfiguracion(settings: Partial<CompanySettings>): Promise<CompanySettings> {
  const { data: existing } = await supabase
    .from("configuracion_empresa")
    .select("id")
    .limit(1)
    .single();

  const updateData: any = {};
  if (settings.nombre !== undefined) updateData.nombre = settings.nombre;
  if (settings.correoRemitente !== undefined) updateData.correo_remitente = settings.correoRemitente;
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
    return mapRow(data);
  } else {
    const { data, error } = await supabase
      .from("configuracion_empresa")
      .insert({
        nombre: settings.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        correo_remitente: settings.correoRemitente || "reportes@solureport.com",
        ...updateData,
      })
      .select()
      .single();
    if (error) throw error;
    return mapRow(data);
  }
}
