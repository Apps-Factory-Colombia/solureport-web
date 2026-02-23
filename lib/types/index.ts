export type UserRole = "admin" | "tecnico" | "lider";

export type UserStatus = "activo" | "inactivo";

export interface User {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  rol: UserRole;
  estado: UserStatus;
  grupoId?: string;
  esLider?: boolean;
  fechaCreacion: string;
  avatar?: string;
}

export interface WorkGroup {
  id: string;
  nombre: string;
  liderId: string;
  miembros: string[];
  estado: "activo" | "inactivo";
  fechaCreacion: string;
}

export interface Client {
  id: string;
  nombre: string;
  edificio: string;
  direccion: string;
  contacto: string;
  correo: string;
  telefono: string;
  frecuenciaMantenimiento: number;
  estado: "activo" | "inactivo";
  fechaCreacion: string;
}

export type MaintenanceStatus = "programado" | "en_ejecucion" | "realizado" | "pendiente";

export interface Maintenance {
  id: string;
  clienteId: string;
  tecnicoId: string;
  fechaProgramada: string;
  proximaFecha?: string;
  estado: MaintenanceStatus;
  observaciones?: string;
  fechaCreacion: string;
  fechaCierre?: string;
}

export interface MaintenanceReport {
  id: string;
  mantenimientoId: string;
  tecnicoId: string;
  clienteId: string;
  fotosAntes: string[];
  fotosDespues: string[];
  observaciones: string;
  fechaGeneracion: string;
  enviado: boolean;
  fechaEnvio?: string;
}

export interface Activity {
  id: string;
  codigo: string;
  descripcion: string;
  valorEconomico: number;
  estado: "activo" | "inactivo";
  historialPrecios: PriceHistory[];
  fechaCreacion: string;
}

export interface PriceHistory {
  fecha: string;
  valorAnterior: number;
  valorNuevo: number;
}

export interface LiquidationEntry {
  id: string;
  actividadId: string;
  grupoId: string;
  lugar: string;
  fecha: string;
  participantes: LiquidationParticipant[];
  periodoId: string;
}

export interface LiquidationParticipant {
  tecnicoId: string;
  porcentaje: number;
  valorCalculado: number;
}

export interface LiquidationPeriod {
  id: string;
  fechaInicio: string;
  fechaFin: string;
  estado: "abierto" | "cerrado";
  fechaCierre?: string;
}

export interface CompanySettings {
  nombre: string;
  logo: string;
  correoRemitente: string;
  plantillaReportePDF: string;
}
