import { supabase } from "../client";
import { Client } from "@/lib/types";

function mapRow(row: any): Client {
  return {
    id: row.id,
    nombre: row.nombre,
    edificio: row.edificio,
    direccion: row.direccion,
    contacto: row.contacto || "",
    correo: row.correo,
    telefono: row.telefono || "",
    frecuenciaMantenimiento: row.frecuencia_mantenimiento || 4,
    puertasPeatonales: row.puertas_peatonales || 0,
    puertasVehiculares: row.puertas_vehiculares || 0,
    estado: row.estado,
    fechaCreacion: row.fecha_creacion?.split("T")[0] || "",
  };
}

export async function getClientes(): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clientes")
    .select("*")
    .order("fecha_creacion", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function getClienteById(id: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from("clientes")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return mapRow(data);
}

export async function createCliente(client: Partial<Client>): Promise<Client> {
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      nombre: client.nombre,
      edificio: client.edificio,
      direccion: client.direccion,
      contacto: client.contacto,
      correo: client.correo,
      telefono: client.telefono,
      frecuencia_mantenimiento: client.frecuenciaMantenimiento || 4,
      puertas_peatonales: client.puertasPeatonales || 0,
      puertas_vehiculares: client.puertasVehiculares || 0,
      estado: client.estado || "activo",
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateCliente(id: string, client: Partial<Client>): Promise<Client> {
  const updateData: any = {};
  if (client.nombre !== undefined) updateData.nombre = client.nombre;
  if (client.edificio !== undefined) updateData.edificio = client.edificio;
  if (client.direccion !== undefined) updateData.direccion = client.direccion;
  if (client.contacto !== undefined) updateData.contacto = client.contacto;
  if (client.correo !== undefined) updateData.correo = client.correo;
  if (client.telefono !== undefined) updateData.telefono = client.telefono;
  if (client.frecuenciaMantenimiento !== undefined) updateData.frecuencia_mantenimiento = client.frecuenciaMantenimiento;
  if (client.puertasPeatonales !== undefined) updateData.puertas_peatonales = client.puertasPeatonales;
  if (client.puertasVehiculares !== undefined) updateData.puertas_vehiculares = client.puertasVehiculares;
  if (client.estado !== undefined) updateData.estado = client.estado;

  const { data, error } = await supabase
    .from("clientes")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function deleteCliente(id: string): Promise<void> {
  const { error } = await supabase.from("clientes").delete().eq("id", id);
  if (error) throw error;
}
