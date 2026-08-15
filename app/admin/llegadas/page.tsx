"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Send,
  Ban,
  MessageSquareWarning,
  FileWarning,
  Percent,
  ImageIcon,
  MapPin,
  Pencil,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { ArrivalRecord, ScheduleDay, User, CompanySettings } from "@/lib/types";
import { ensureNoRegistradosForToday, getLlegadas, updateLlegada } from "@/lib/supabase/services/llegadas";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getConfiguracion, updateConfiguracion } from "@/lib/supabase/services/configuracion";
import { createNotificacion } from "@/lib/supabase/services/notificaciones";
import { cn } from "@/lib/utils";

function formatLocationTimestamp(value?: string) {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function getBogotaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

const WEEKDAY_OPTIONS: Array<{ value: ScheduleDay; label: string }> = [
  { value: "lunes", label: "Lunes" },
  { value: "martes", label: "Martes" },
  { value: "miercoles", label: "Miércoles" },
  { value: "jueves", label: "Jueves" },
  { value: "viernes", label: "Viernes" },
  { value: "sabado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
];

function getWeekdayForDate(fecha: string): ScheduleDay {
  const [year, month, day] = fecha.split("-").map(Number);
  const dayIndex = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12)).getUTCDay();
  return ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"][dayIndex] as ScheduleDay;
}

function calculateDelay(scheduled?: string, real?: string) {
  if (!scheduled || !real) return 0;
  const [scheduledHour, scheduledMinute] = scheduled.split(":").map(Number);
  const [realHour, realMinute] = real.split(":").map(Number);
  return Math.max(0, realHour * 60 + realMinute - (scheduledHour * 60 + scheduledMinute));
}

export default function LlegadasPage() {
  const [records, setRecords] = useState<ArrivalRecord[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [dayFilter, setDayFilter] = useState<"todos" | ScheduleDay>("todos");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [messageOpen, setMessageOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<ArrivalRecord | null>(null);
  const [messageType, setMessageType] = useState<"pedagogico" | "citacion_descargos">("pedagogico");
  const [messageText, setMessageText] = useState("");
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountPercent, setDiscountPercent] = useState("5");
  const [configuredDiscountPercent, setConfiguredDiscountPercent] = useState("5");
  const [configuredDiscountTime, setConfiguredDiscountTime] = useState("08:30");
  const [automaticDiscountDays, setAutomaticDiscountDays] = useState<ScheduleDay[]>([
    "lunes", "martes", "miercoles", "jueves", "viernes",
  ]);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [attendanceEditOpen, setAttendanceEditOpen] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<"a_tiempo" | "tarde" | "no_reportado">("no_reportado");
  const [attendanceTime, setAttendanceTime] = useState("");
  const [attendanceReason, setAttendanceReason] = useState("");
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [processingAutomatic, setProcessingAutomatic] = useState(false);
  const [arrivalDetailRecord, setArrivalDetailRecord] = useState<ArrivalRecord | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [u, s] = await Promise.all([getUsuarios(), getConfiguracion()]);
      await ensureNoRegistradosForToday(
        u,
        s.porcentajeDescuentoTardanza,
        s.diasDescuentoAutomatico,
        s.horaDescuentoAutomatico,
      );
      const r = await getLlegadas();
      setRecords(r);
      setUsers(u);
      setCompanySettings(s);
      setDiscountPercent(String(s.porcentajeDescuentoTardanza));
      setConfiguredDiscountPercent(String(s.porcentajeDescuentoTardanza));
      setConfiguredDiscountTime(s.horaDescuentoAutomatico || "08:30");
      setAutomaticDiscountDays(s.diasDescuentoAutomatico || []);
    } catch (err) {
      console.error("Error cargando llegadas:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (users.length === 0 || !companySettings) return;

    const timer = window.setInterval(async () => {
      try {
        const changed = await ensureNoRegistradosForToday(
          users,
          companySettings.porcentajeDescuentoTardanza,
          companySettings.diasDescuentoAutomatico,
          companySettings.horaDescuentoAutomatico,
        );
        if (changed > 0) setRecords(await getLlegadas());
      } catch (err) {
        console.error("Error en el corte automático de asistencia:", err);
      }
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [users, companySettings]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, dateFilter, dayFilter, statusFilter]);

  if (loading) {
    return (
      <div>
        <AdminHeader title="Control de Llegadas" />
        <AdminPageLoader
          title="Cargando llegadas"
          message="Estamos preparando los registros de asistencia y tardanzas."
          showStats={false}
          rows={6}
        />
      </div>
    );
  }

  const filtered = records.filter((r) => {
    const user = users.find((u) => u.id === r.usuarioId);
    const matchesSearch =
      user?.nombre.toLowerCase().includes(search.toLowerCase()) ||
      user?.apellido.toLowerCase().includes(search.toLowerCase());
    const matchesDate = !dateFilter || r.fecha === dateFilter;
    const matchesDay = dayFilter === "todos" || getWeekdayForDate(r.fecha) === dayFilter;
    const matchesStatus =
      statusFilter === "todos" ||
      (statusFilter === "tarde" && r.tarde && r.estadoEntrada !== "no_reportado") ||
      (statusFilter === "puntual" && r.estadoEntrada === "a_tiempo") ||
      (statusFilter === "no_registrado" && r.estadoEntrada === "no_reportado");
    return matchesSearch && matchesDate && matchesDay && matchesStatus;
  });

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentRecords = filtered.slice(startIndex, endIndex);

  const todayRecords = records.filter(
    (r) => r.fecha === getBogotaDate()
  );
  const tardanzasHoy = todayRecords.filter((r) => r.tarde && r.estadoEntrada !== "no_reportado").length;
  const puntualesHoy = todayRecords.filter((r) => r.estadoEntrada === "a_tiempo").length;
  const noRegistradosHoy = todayRecords.filter((r) => r.estadoEntrada === "no_reportado").length;
  const totalTarde = records.filter((r) => r.tarde && r.estadoEntrada !== "no_reportado").length;

  const handleSaveConfiguredDiscount = async () => {
    const value = Math.max(0, Math.min(100, Number(configuredDiscountPercent) || 0));
    setSettingsSaving(true);
    try {
      const updated = await updateConfiguracion({
        porcentajeDescuentoTardanza: value,
        diasDescuentoAutomatico: automaticDiscountDays,
        horaDescuentoAutomatico: configuredDiscountTime,
      });
      setCompanySettings(updated);
      setConfiguredDiscountPercent(String(updated.porcentajeDescuentoTardanza));
      setDiscountPercent(String(updated.porcentajeDescuentoTardanza));
      setAutomaticDiscountDays(updated.diasDescuentoAutomatico || []);
      setConfiguredDiscountTime(updated.horaDescuentoAutomatico || "08:30");
    } catch (err) {
      console.error("Error actualizando descuento configurado:", err);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleProcessAutomatic = async () => {
    setProcessingAutomatic(true);
    try {
      await ensureNoRegistradosForToday(
        users,
        companySettings?.porcentajeDescuentoTardanza || 0,
        companySettings?.diasDescuentoAutomatico,
        companySettings?.horaDescuentoAutomatico,
      );
      await loadData();
    } catch (err) {
      console.error("Error procesando asistencia automática:", err);
    } finally {
      setProcessingAutomatic(false);
    }
  };

  const toggleAutomaticDiscountDay = (day: ScheduleDay) => {
    setAutomaticDiscountDays((current) =>
      current.includes(day) ? current.filter((item) => item !== day) : [...current, day]
    );
  };

  const handleOpenAttendanceEdit = (record: ArrivalRecord) => {
    setSelectedRecord(record);
    setAttendanceStatus(record.estadoEntrada || "no_reportado");
    setAttendanceTime(record.horaLlegada || "");
    setAttendanceReason(record.razonTardanza || "");
    setAttendanceEditOpen(true);
  };

  const handleSaveAttendanceEdit = async () => {
    if (!selectedRecord) return;
    const isUnregistered = attendanceStatus === "no_reportado";
    const realTime = isUnregistered ? null : attendanceTime || selectedRecord.horaLlegada || null;
    const discountCutoff = (companySettings?.horaDescuentoAutomatico || "08:30").slice(0, 5);
    const isAtOrAfterDiscountCutoff = Boolean(realTime && realTime.slice(0, 5) >= discountCutoff);
    const appliesDiscount = isUnregistered || (attendanceStatus === "tarde" && isAtOrAfterDiscountCutoff);
    setAttendanceSaving(true);
    try {
      await updateLlegada(selectedRecord.id, {
        estadoEntrada: attendanceStatus,
        horaLlegada: realTime,
        tarde: appliesDiscount,
        minutosRetraso: attendanceStatus === "tarde" ? calculateDelay(selectedRecord.horaEsperada, realTime || undefined) : 0,
        razonTardanza: attendanceReason.trim() || (isUnregistered ? "No registró la entrada." : null),
        descuentoAplicado: appliesDiscount && Number(selectedRecord.porcentajeDescuento || companySettings?.porcentajeDescuentoTardanza || 0) > 0,
        porcentajeDescuento: appliesDiscount ? Number(selectedRecord.porcentajeDescuento || companySettings?.porcentajeDescuentoTardanza || 0) : 0,
      });
      setAttendanceEditOpen(false);
      setSelectedRecord(null);
      await loadData();
    } catch (err) {
      console.error("Error actualizando estado de asistencia:", err);
    } finally {
      setAttendanceSaving(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedRecord) return;
    try {
      await updateLlegada(selectedRecord.id, {
        mensajeEnviado: messageText,
        tipoMensaje: messageType,
      });

      const user = users.find((u) => u.id === selectedRecord.usuarioId);
      if (user) {
        await createNotificacion({
          usuarioId: user.id,
          titulo: messageType === "pedagogico" ? "Mensaje Pedagógico" : "Citación a Descargos",
          mensaje: messageText,
          tipo: "general",
          datos: { registroAsistenciaId: selectedRecord.id, tipoMensaje: messageType },
        });
      }

      setMessageOpen(false);
      setSelectedRecord(null);
      setMessageText("");
      await loadData();
    } catch (err) {
      console.error("Error enviando mensaje:", err);
    }
  };

  const handleApplyDiscount = async () => {
    if (!selectedRecord) return;
    try {
      await updateLlegada(selectedRecord.id, {
        descuentoAplicado: true,
        porcentajeDescuento: Number(discountPercent),
      });
      setDiscountOpen(false);
      setSelectedRecord(null);
      await loadData();
    } catch (err) {
      console.error("Error aplicando descuento:", err);
    }
  };

  const defaultPedagogicoMsg =
    "Se le recuerda la importancia de la puntualidad para el correcto desarrollo de las actividades programadas. Este mensaje tiene carácter formativo y busca el mejoramiento continuo del servicio.";
  const defaultCitacionMsg =
    "Por medio del presente se le cita a descargos por incumplimiento reiterado del horario laboral establecido. Favor presentarse en la oficina administrativa para dar explicación de los hechos.";

  return (
    <div>
      <AdminHeader title="Registro de Asistencia" />
      <div className="min-w-0 space-y-5 p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-emerald-400">{puntualesHoy}</p>
                <p className="text-xs text-muted-foreground">Puntuales Hoy</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-red-500/10 p-2.5">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-red-400">{tardanzasHoy}</p>
                <p className="text-xs text-muted-foreground">Tardanzas Hoy</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/10 p-2.5">
                <Clock className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-foreground">{totalTarde}</p>
                <p className="text-xs text-muted-foreground">Total Tardanzas (Período)</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-gold/10 p-2.5">
                <Percent className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-xl font-bold text-gold">
                  {companySettings?.porcentajeDescuentoTardanza || 5}%
                </p>
                <p className="text-xs text-muted-foreground">Descuento Configurado</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-sky-500/10 p-2.5">
                <Ban className="h-5 w-5 text-sky-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-sky-400">{noRegistradosHoy}</p>
                <p className="text-xs text-muted-foreground">No registrados hoy</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-card/60 p-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-secondary/50 border-border/50"
              />
            </div>
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full sm:w-44 bg-secondary/50 border-border/50"
            />
            <Select value={dayFilter} onValueChange={(value: "todos" | ScheduleDay) => setDayFilter(value)}>
              <SelectTrigger className="w-full sm:w-44 bg-secondary/50 border-border/50">
                <SelectValue placeholder="Día de la semana" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="todos">Todos los días</SelectItem>
                {WEEKDAY_OPTIONS.map((day) => (
                  <SelectItem key={day.value} value={day.value}>{day.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44 bg-secondary/50 border-border/50">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="puntual">Puntuales</SelectItem>
                <SelectItem value="tarde">Tardanzas</SelectItem>
                <SelectItem value="no_registrado">No registrados</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={handleProcessAutomatic}
              disabled={processingAutomatic}
              className="gap-2 border-border/50 bg-secondary/30"
              title={`Procesar el corte automático de las ${configuredDiscountTime}`}
            >
              <RefreshCw className={cn("h-4 w-4", processingAutomatic && "animate-spin")} />
              <span className="hidden sm:inline">Actualizar corte</span>
            </Button>
          </div>

          <div className="rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/10 via-card/80 to-card/60 p-4 shadow-sm">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,140px)_minmax(0,140px)_minmax(0,1fr)] sm:items-end">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-2 text-xs text-foreground/80">
                    <Settings2 className="h-3.5 w-3.5 text-gold" />
                    Descuento (%)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={configuredDiscountPercent}
                    onChange={(event) => setConfiguredDiscountPercent(event.target.value)}
                    className="bg-secondary/50 border-border/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground/80">Hora de corte</Label>
                  <Input
                    type="time"
                    value={configuredDiscountTime}
                    onChange={(event) => setConfiguredDiscountTime(event.target.value)}
                    className="bg-secondary/50 border-border/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs text-foreground/80">Días con descuento automático</Label>
                    <span className="text-[11px] text-muted-foreground">{automaticDiscountDays.length}/7 activos</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_OPTIONS.map((day) => {
                      const active = automaticDiscountDays.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleAutomaticDiscountDay(day.value)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs transition-colors",
                            active
                              ? "border-gold/50 bg-gold text-background"
                              : "border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {day.label.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] leading-4 text-muted-foreground">
                  El descuento se aplica solo en los días seleccionados y cuando llega la hora configurada.
                </p>
                <Button
                  type="button"
                  onClick={handleSaveConfiguredDiscount}
                  disabled={settingsSaving}
                  className="shrink-0 bg-gold text-background hover:bg-gold-dark"
                >
                  {settingsSaving ? "Guardando..." : "Guardar configuración"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-0">
            <Table className="min-w-[1180px]">
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Empleado</TableHead>
                  <TableHead className="text-muted-foreground">Fecha</TableHead>
                  <TableHead className="text-muted-foreground">Entrada</TableHead>
                  <TableHead className="text-muted-foreground">Salida</TableHead>
                  <TableHead className="text-muted-foreground">Retraso</TableHead>
                  <TableHead className="text-muted-foreground">Evidencia</TableHead>
                  <TableHead className="text-muted-foreground">Estado</TableHead>
                  <TableHead className="text-muted-foreground">Mensaje</TableHead>
                  <TableHead className="text-muted-foreground">Descuento</TableHead>
                  <TableHead className="text-muted-foreground w-28">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentRecords.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="h-28 text-center text-sm text-muted-foreground">
                      No hay registros que coincidan con los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                )}
                {currentRecords.map((record) => {
                  const user = users.find((u) => u.id === record.usuarioId);
                  const hasArrivalDetail = Boolean(
                    record.fotoLlegadaUrl ||
                    record.ubicacionLlegadaDireccion ||
                    record.ubicacionLlegadaPrecisionMetros !== undefined ||
                    record.ubicacionLlegadaTimestamp
                  );

                  return (
                    <TableRow
                      key={record.id}
                      className={cn(
                        "border-border/50 hover:bg-secondary/30",
                        record.tarde && "bg-red-500/3",
                        record.estadoEntrada === "no_reportado" && "bg-sky-500/5"
                      )}
                    >
                      <TableCell>
                        <p className="font-medium text-foreground">
                          {user?.nombre} {user?.apellido}
                        </p>
                        <p className="text-xs text-muted-foreground">{user?.rol}</p>
                      </TableCell>
                      <TableCell className="text-sm text-foreground/80">{record.fecha}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Prog: {record.horaEsperada}</span>
                          <div className="flex items-center gap-2">
                            <span className={cn("text-sm font-medium", record.tarde ? "text-red-400" : "text-emerald-400")}>
                              Real: {record.horaLlegada || "--:--"}
                            </span>
                            {record.estadoEntrada !== "no_reportado" && (
                              <Badge variant="outline" className={cn("text-[10px] px-1 py-0 h-4", record.tarde ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20")}>
                                {record.tarde ? "Tarde" : "Puntual"}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Prog: {record.horaSalidaProgramada || "--:--"}</span>
                          <div className="flex items-center gap-2">
                            <span className={cn("text-sm font-medium", record.estadoSalida === "salida_anticipada" ? "text-amber-400" : "text-foreground/80")}>
                              Real: {record.horaSalidaReal || "--:--"}
                            </span>
                            {record.estadoSalida && record.estadoSalida !== "no_reportado" && (
                              <Badge variant="outline" className={cn("text-[10px] px-1 py-0 h-4", record.estadoSalida === "salida_anticipada" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20")}>
                                {record.estadoSalida === "salida_anticipada" ? "Anticipada" : "Normal"}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {record.estadoEntrada === "no_reportado" ? (
                          <Badge
                            variant="outline"
                            className="bg-sky-500/10 text-sky-300 border-sky-500/20 text-xs"
                          >
                            No registrado
                          </Badge>
                        ) : record.tarde ? (
                          <Badge
                            variant="outline"
                            className="bg-red-500/10 text-red-400 border-red-500/20 text-xs"
                          >
                            +{record.minutosRetraso} min
                          </Badge>
                        ) : (
                          <span className="text-xs text-emerald-400">A tiempo</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-60 space-y-2.5">
                          <div className="rounded-lg border border-border/50 bg-secondary/20 p-2">
                            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Foto
                            </p>
                            {record.fotoLlegadaUrl ? (
                              <button
                                type="button"
                                onClick={() => setArrivalDetailRecord(record)}
                                className="group relative h-14 w-14 overflow-hidden rounded-md border border-border/50 bg-secondary/40"
                                title="Ver detalle de llegada"
                              >
                                <img
                                  src={record.fotoLlegadaUrl}
                                  alt={`Foto de llegada de ${user?.nombre || "empleado"}`}
                                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                />
                              </button>
                            ) : (
                              <p className="text-xs text-muted-foreground">Sin foto</p>
                            )}
                          </div>

                          <div className="rounded-lg border border-border/50 bg-secondary/20 p-2">
                            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Ubicacion
                            </p>
                            {record.ubicacionLlegadaDireccion ? (
                              <div className="space-y-1.5 text-xs text-muted-foreground">
                                <div className="flex items-start gap-1.5">
                                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                                  <span className="line-clamp-3 text-foreground/80">
                                    {record.ubicacionLlegadaDireccion}
                                  </span>
                                </div>
                                {record.ubicacionLlegadaPrecisionMetros !== undefined && (
                                  <p>Precision: {record.ubicacionLlegadaPrecisionMetros.toFixed(1)} m</p>
                                )}
                                {formatLocationTimestamp(record.ubicacionLlegadaTimestamp) && (
                                  <p>Capturada: {formatLocationTimestamp(record.ubicacionLlegadaTimestamp)}</p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">Sin ubicacion</p>
                            )}
                          </div>

                          {hasArrivalDetail && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 w-full border-border/50 bg-background/40 text-xs"
                              onClick={() => setArrivalDetailRecord(record)}
                            >
                              Ver detalle
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            record.estadoEntrada === "no_reportado"
                              ? "bg-sky-500/10 text-sky-300 border-sky-500/20"
                              : record.tarde
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          )}
                        >
                          {record.estadoEntrada === "no_reportado"
                            ? "No registrado"
                            : record.tarde ? "Tarde" : "Puntual"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {record.tipoMensaje ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              record.tipoMensaje === "pedagogico"
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                : "bg-red-500/10 text-red-400 border-red-500/20"
                            )}
                          >
                            {record.tipoMensaje === "pedagogico"
                              ? "Pedagógico"
                              : "Citación"}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {record.descuentoAplicado ? (
                          <Badge
                            variant="outline"
                            className="bg-gold/10 text-gold border-gold/20 text-xs"
                          >
                            -{record.porcentajeDescuento}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-sky-300 hover:text-sky-200 hover:bg-sky-500/10"
                              title="Editar estado de asistencia"
                              onClick={() => handleOpenAttendanceEdit(record)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          {record.tarde && (
                            <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                              title="Enviar mensaje"
                              onClick={() => {
                                setSelectedRecord(record);
                                setMessageType("pedagogico");
                                setMessageText(defaultPedagogicoMsg);
                                setMessageOpen(true);
                              }}
                            >
                              <Send className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              title="Aplicar descuento"
                              onClick={() => {
                                setSelectedRecord(record);
                                setDiscountPercent(
                                  String(record.porcentajeDescuento || companySettings?.porcentajeDescuentoTardanza || 5)
                                );
                                setDiscountOpen(true);
                              }}
                            >
                              <Percent className="h-3.5 w-3.5" />
                            </Button>
                            </>
                          )}
                          </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 p-3">
                <p className="text-xs text-muted-foreground">
                  Mostrando {startIndex + 1}-{Math.min(endIndex, filtered.length)} de {filtered.length}
                </p>
                <Pagination>
                  <PaginationContent className="flex-wrap justify-center">
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                    {Array.from({ length: totalPages }).map((_, i) => {
                      const page = i + 1;
                      const visible = page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1;
                      const previousVisible = page > 1 && (page - 1 === 1 || page - 1 === totalPages || Math.abs(page - 1 - currentPage) <= 1);
                      if (!visible) return previousVisible ? (
                        <PaginationItem key={`ellipsis-${page}`}><PaginationEllipsis /></PaginationItem>
                      ) : null;
                      return (
                      <PaginationItem key={page}>
                        <PaginationLink
                          onClick={() => setCurrentPage(page)}
                          isActive={currentPage === page}
                          className="cursor-pointer"
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                      );
                    })}
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={attendanceEditOpen} onOpenChange={setAttendanceEditOpen}>
        <DialogContent className="bg-card border-border sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Editar estado de asistencia</DialogTitle>
          </DialogHeader>
          {selectedRecord && (() => {
            const user = users.find((u) => u.id === selectedRecord.usuarioId);
            return (
              <div className="space-y-4">
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{user?.nombre} {user?.apellido}</span>
                    <span className="text-muted-foreground"> · {selectedRecord.fecha}</span>
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Estado de entrada</Label>
                    <Select
                      value={attendanceStatus}
                      onValueChange={(value: "a_tiempo" | "tarde" | "no_reportado") => setAttendanceStatus(value)}
                    >
                      <SelectTrigger className="bg-secondary/50 border-border/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="a_tiempo">A tiempo</SelectItem>
                        <SelectItem value="tarde">Tarde</SelectItem>
                        <SelectItem value="no_reportado">No registrado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Hora real</Label>
                    <Input
                      type="time"
                      value={attendanceTime}
                      disabled={attendanceStatus === "no_reportado"}
                      onChange={(event) => setAttendanceTime(event.target.value)}
                      className="bg-secondary/50 border-border/50"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/80">Observación</Label>
                  <Textarea
                    value={attendanceReason}
                    onChange={(event) => setAttendanceReason(event.target.value)}
                    placeholder={`Ej. No reportó la entrada antes del corte de las ${configuredDiscountTime}`}
                    className="min-h-24 bg-secondary/50 border-border/50"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Al guardar como no registrado se elimina la hora de entrada y se conserva/aplica el descuento configurado.
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAttendanceEditOpen(false)} className="text-muted-foreground">
              Cancelar
            </Button>
            <Button
              onClick={handleSaveAttendanceEdit}
              disabled={attendanceSaving}
              className="gap-2 bg-gold text-background hover:bg-gold-dark"
            >
              <Pencil className="h-4 w-4" />
              {attendanceSaving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent className="bg-card border-border sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Enviar Mensaje</DialogTitle>
          </DialogHeader>
          {selectedRecord && (() => {
            const user = users.find((u) => u.id === selectedRecord.usuarioId);
            return (
              <div className="space-y-4">
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{user?.nombre} {user?.apellido}</span>
                    {" — "}
                    Llegó a las {selectedRecord.horaLlegada} ({selectedRecord.minutosRetraso} min de retraso)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/80">Tipo de Mensaje</Label>
                  <Select
                    value={messageType}
                    onValueChange={(v: "pedagogico" | "citacion_descargos") => {
                      setMessageType(v);
                      setMessageText(
                        v === "pedagogico" ? defaultPedagogicoMsg : defaultCitacionMsg
                      );
                    }}
                  >
                    <SelectTrigger className="bg-secondary/50 border-border/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="pedagogico">
                        <div className="flex items-center gap-2">
                          <MessageSquareWarning className="h-4 w-4 text-amber-400" />
                          Mensaje Pedagógico
                        </div>
                      </SelectItem>
                      <SelectItem value="citacion_descargos">
                        <div className="flex items-center gap-2">
                          <FileWarning className="h-4 w-4 text-red-400" />
                          Citación a Descargos
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/80">Mensaje</Label>
                  <Textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    className="bg-secondary/50 border-border/50 min-h-25"
                  />
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setMessageOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSendMessage}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              <Send className="h-4 w-4" />
              Enviar Mensaje
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discountOpen} onOpenChange={setDiscountOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {selectedRecord?.descuentoAplicado ? "Editar Descuento" : "Aplicar Descuento por Tardanza"}
            </DialogTitle>
          </DialogHeader>
          {selectedRecord && (() => {
            const user = users.find((u) => u.id === selectedRecord.usuarioId);
            return (
              <div className="space-y-4">
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">{user?.nombre} {user?.apellido}</span>
                    {" — "}
                    {selectedRecord.minutosRetraso} minutos de retraso
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/80">Porcentaje de Descuento sobre Actividades</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                    className="bg-secondary/50 border-border/50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Se descontará este porcentaje de las actividades del técnico/líder en este período.
                  </p>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDiscountOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleApplyDiscount}
              className="gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold"
            >
              <Ban className="h-4 w-4" />
              {selectedRecord?.descuentoAplicado ? "Actualizar Descuento" : "Aplicar Descuento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(arrivalDetailRecord)} onOpenChange={(open) => !open && setArrivalDetailRecord(null)}>
        <DialogContent className="bg-card border-border sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <ImageIcon className="h-5 w-5 text-gold" />
              Detalle de llegada
            </DialogTitle>
          </DialogHeader>
          {arrivalDetailRecord && (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)]">
              <div className="overflow-hidden rounded-lg border border-border/50 bg-secondary/20">
                {arrivalDetailRecord.fotoLlegadaUrl ? (
                  <img
                    src={arrivalDetailRecord.fotoLlegadaUrl}
                    alt="Foto de llegada"
                    className="max-h-[70vh] w-full object-contain"
                  />
                ) : (
                  <div className="flex min-h-72 items-center justify-center p-6 text-sm text-muted-foreground">
                    Sin foto de llegada
                  </div>
                )}
              </div>

              <div className="space-y-4 rounded-lg border border-border/50 bg-secondary/20 p-4">
                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Direccion
                  </p>
                  <p className="text-sm text-foreground/85">
                    {arrivalDetailRecord.ubicacionLlegadaDireccion || "Sin ubicacion"}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Precision
                  </p>
                  <p className="text-sm text-foreground/85">
                    {arrivalDetailRecord.ubicacionLlegadaPrecisionMetros !== undefined
                      ? `${arrivalDetailRecord.ubicacionLlegadaPrecisionMetros.toFixed(1)} m`
                      : "Sin precision"}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Fecha de captura
                  </p>
                  <p className="text-sm text-foreground/85">
                    {formatLocationTimestamp(arrivalDetailRecord.ubicacionLlegadaTimestamp) || "Sin fecha de captura"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
