export type UserRole = "admin" | "tecnico" | "lider";

export type UserStatus = "activo" | "inactivo";

export type ScheduleDay = "lunes" | "martes" | "miercoles" | "jueves" | "viernes" | "sabado" | "domingo";

export interface UserSchedule {
  id?: string;
  usuarioId?: string;
  diaSemana: ScheduleDay;
  activo: boolean;
  horaEntrada?: string;
  horaSalida?: string;
}

export type UserScheduleDraft = UserSchedule;

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
  tieneRecorrido?: boolean;
  tieneMoto?: boolean;
  esSupervisor?: boolean;
  horaEntrada?: string;
  horaSalida?: string;
  horarios?: UserSchedule[];
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
  correoAliado?: string;
  telefono: string;
  frecuenciaMantenimiento: number;
  puertasPeatonales: number;
  puertasVehiculares: number;
  estado: "activo" | "inactivo";
  fechaCreacion: string;
}

export type MaintenanceStatus = "programado" | "en_ejecucion" | "realizado" | "pendiente";

export interface Maintenance {
  id: string;
  clienteId: string;
  tecnicoId: string;
  origen?: "mantenimiento" | "contrato";
  contratoId?: string;
  contratoMantenimientoId?: string;
  fechaProgramada: string;
  horaProgramada?: string;
  proximaFecha?: string;
  estado: MaintenanceStatus;
  observaciones?: string;
  tipoPendiente?: string;
  descripcionPendiente?: string;
  valorRecaudado?: number;
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
  firmaReceptor?: string;
  datosReceptor?: { nombre: string; cedula: string; cargo: string };
  fotoBitacora?: string;
  tipoPendiente?: string;
  descripcionPendiente?: string;
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
  correoEmpresa: string;
  plantillaReportePDF: string;
  porcentajeDescuentoTardanza: number;
  porcentajeExtraLider: number;
  extraLiderActivo: boolean;
  costoRevisionLider: number;
  costoRecorridoNormal: number;
  costoRecorridoHerramienta: number;
}

export interface MaintenanceContract {
  id: string;
  clienteId: string;
  anio: number;
  mesInicio: number;
  diaInicio: number;
  costoTotalAnual: number;
  cantidadMantenimientos: number;
  costoPorMantenimiento: number;
  mantenimientosRealizados: MantenimientoContrato[];
  estado: "activo" | "cerrado";
  fechaCreacion: string;
}

export interface MantenimientoContrato {
  id: string;
  mes: number;
  fechaProgramada: string;
  fechaRealizado?: string;
  tecnicoId?: string;
  estado: "pendiente" | "programado" | "realizado";
  valorRecaudado: number;
}

export interface TechnicalVisit {
  id: string;
  clienteId: string;
  tecnicoId: string;
  liderId?: string;
  fecha: string;
  descripcion: string;
  tipoVisita: string;
  observaciones?: string;
  ubicacion?: string;
  edificio?: string;
  nombreReceptor?: string;
  firmaReceptorUrl?: string;
  tieneBitacora?: boolean;
  fotoBitacoraUrl?: string;
  valorCobradoCliente: number;
  estado: string;
  fotosAntes?: string[];
  fotosDespues?: string[];
  fechaCreacion: string;
}

export interface ArrivalRecord {
  id: string;
  usuarioId: string;
  fecha: string;
  horaEsperada: string;
  horaLlegada: string;
  horaSalidaProgramada?: string;
  horaSalidaReal?: string;
  estadoEntrada?: "a_tiempo" | "tarde" | "no_reportado";
  estadoSalida?: "normal" | "salida_anticipada" | "no_reportado";
  tarde: boolean;
  minutosRetraso: number;
  fotoObraUrl?: string;
  mensajeEnviado?: string;
  tipoMensaje?: "pedagogico" | "citacion_descargos";
  descuentoAplicado: boolean;
  porcentajeDescuento: number;
  fechaCreacion: string;
}

export type TipoInforme = "mantenimiento_preventivo" | "visita_tecnica" | "recorrido" | "actividad_grupal";
export type EstadoAprobacion = "pendiente" | "aprobado" | "rechazado";
export type TipoRecorrido = "normal" | "con_herramienta";

export interface ActivityReport {
  id: string;
  tipo: TipoInforme;
  tecnicoId: string;
  liderGrupoId: string;
  grupoId: string;
  fecha: string;
  clienteId?: string;
  descripcion: string;
  observaciones?: string;
  fotosAntes?: string[];
  fotosDespues?: string[];
  firmaReceptor?: string;
  datosReceptor?: { nombre: string; cedula: string; cargo: string };
  bitacora?: boolean;
  fotoBitacora?: string;
  puntoPartida?: string;
  puntoLlegada?: string;
  tipoRecorrido?: TipoRecorrido;
  fotoHerramienta?: string;
  estadoAprobacionLider: EstadoAprobacion;
  fechaAprobacionLider?: string;
  costoActividad: number;
  costoAdministrable: boolean;
  periodoId: string;
  fechaCreacion: string;
}

export interface LeaderApprovalBatch {
  id: string;
  liderId: string;
  grupoId: string;
  periodoId: string;
  reportesAprobados: string[];
  fechaCierre: string;
  costoLiderPorRevision: number;
  totalRevisiones: number;
  totalCostoLider: number;
}

export interface LeaderAccumulation {
  liderId: string;
  periodoId: string;
  totalAprobadoPago: number;
  totalPendientePago: number;
  extraLider: number;
  totalRecorridos: number;
  totalAcumulado: number;
  porcentajeExtraLiderAplicado: number;
  extraLiderActivo: boolean;
}
