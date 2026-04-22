"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { MaintenanceDialog } from "@/components/mantenimientos/maintenance-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  CalendarDays,
  List,
  Clock,
  CheckCircle2,
  Play,
  AlertTriangle,
  Bell,
  UserCheck,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
} from "lucide-react";
import { Maintenance, MaintenanceStatus, Client, User, CompanySettings } from "@/lib/types";
import { getMantenimientos, createMantenimiento, updateMantenimiento, deleteMantenimiento } from "@/lib/supabase/services/mantenimientos";
import { getContratos } from "@/lib/supabase/services/contratos";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { createNotificacion } from "@/lib/supabase/services/notificaciones";
import { getConfiguracion } from "@/lib/supabase/services/configuracion";
import { cn } from "@/lib/utils";
import { generateTablePDF } from "@/lib/utils/pdf-generator";
import type { MaintenanceContract } from "@/lib/types";

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  programado: {
    label: "Programado",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    icon: Clock,
  },
  en_ejecucion: {
    label: "En Ejecución",
    color: "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20",
    icon: Play,
  },
  realizado: {
    label: "Realizado",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    icon: CheckCircle2,
  },
  pendiente: {
    label: "Pendiente",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    icon: AlertTriangle,
  },
  en_progreso: {
    label: "En Progreso",
    color: "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20",
    icon: Play,
  },
  completado: {
    label: "Completado",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    icon: CheckCircle2,
  },
};

const defaultStatusConfig = {
  label: "Pendiente",
  color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  icon: AlertTriangle,
};

const daysOfWeek = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

interface MiniCalendarProps {
  maintenances: Maintenance[];
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
  selectedDate: Date | null;
  onSelectDate: (date: Date | null) => void;
}

function MiniCalendar({ maintenances, currentMonth, onMonthChange, selectedDate, onSelectDate }: MiniCalendarProps) {
  const today = new Date();
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthName = currentMonth.toLocaleDateString("es-ES", { month: "long" });

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const getMaintenancesForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return maintenances.filter((m) => m.fechaProgramada === dateStr);
  };

  const nextMonth = () => onMonthChange(new Date(year, month + 1, 1));
  const prevMonth = () => onMonthChange(new Date(year, month - 1, 1));

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground capitalize">
            {monthName} {year}
          </h3>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-secondary/80" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-secondary/80" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {daysOfWeek.map((d) => (
            <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">
              {d}
            </div>
          ))}
          {days.map((day, i) => {
            if (day === null) return <div key={`e-${i}`} />;
            const dayMaintenances = getMaintenancesForDay(day);
            const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            const isSelected = selectedDate?.getDate() === day && selectedDate?.getMonth() === month && selectedDate?.getFullYear() === year;

            return (
              <div
                key={day}
                onClick={() => {
                  const newDate = new Date(year, month, day);
                  if (isSelected) {
                    onSelectDate(null);
                  } else {
                    onSelectDate(newDate);
                  }
                }}
                className={cn(
                  "relative flex flex-col items-center justify-center rounded-md p-1 text-xs transition-colors cursor-pointer",
                  isSelected ? "bg-gold text-background font-bold" : isToday ? "bg-gold/10 text-gold font-bold" : dayMaintenances.length > 0 ? "bg-secondary/50" : "",
                  !isSelected && "hover:bg-secondary/80"
                )}
              >
                {day}
                {dayMaintenances.length > 0 && (
                  <div className="flex gap-0.5 mt-0.5">
                    {dayMaintenances.slice(0, 3).map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          "h-1 w-1 rounded-full",
                          m.estado === "programado" && "bg-blue-400",
                          m.estado === "en_ejecucion" && "bg-cyan-neon",
                          m.estado === "realizado" && "bg-emerald-400",
                          m.estado === "pendiente" && "bg-amber-400",
                          isSelected && "bg-background"
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-blue-400" /> Programado
          </span>
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-cyan-neon" /> En Ejecución
          </span>
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-emerald-400" /> Realizado
          </span>
          <span className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-amber-400" /> Pendiente
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MantenimientosPage() {
  const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
  const [contracts, setContracts] = useState<MaintenanceContract[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMaintenance, setEditingMaintenance] = useState<Maintenance | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedulingMaint, setSchedulingMaint] = useState<Maintenance | null>(null);
  const [scheduleTecnico, setScheduleTecnico] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [maintenanceToDelete, setMaintenanceToDelete] = useState<Maintenance | null>(null);
  const [deletingMaintenanceId, setDeletingMaintenanceId] = useState<string | null>(null);

  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<Date | null>(null);

  const parseLocalDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [m, ct, c, u, s] = await Promise.all([
        getMantenimientos(),
        getContratos(),
        getClientes(),
        getUsuarios(),
        getConfiguracion().catch((error) => {
          console.error("Error cargando configuración de empresa:", error);
          return null;
        }),
      ]);
      setMaintenances(m);
      setContracts(ct);
      setClients(c);
      setUsers(u);
      setCompanySettings(s);
    } catch (err) {
      console.error("Error cargando mantenimientos:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const todayStart = useMemo(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }, []);

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients]
  );

  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users]
  );

  const contractsById = useMemo(
    () => new Map(contracts.map((contract) => [contract.id, contract])),
    [contracts]
  );

  const contractByMaintenanceId = useMemo(() => {
    const nextMap = new Map<string, MaintenanceContract>();
    contracts.forEach((contract) => {
      contract.mantenimientosRealizados.forEach((item) => {
        if (item.id) {
          nextMap.set(item.id, contract);
        }
      });
    });
    return nextMap;
  }, [contracts]);

  const getMaintenanceContract = useCallback((maintenance: Maintenance) => {
    if (maintenance.contratoId) {
      return contractsById.get(maintenance.contratoId);
    }

    if (maintenance.contratoMantenimientoId) {
      return contractByMaintenanceId.get(maintenance.contratoMantenimientoId);
    }

    return contractByMaintenanceId.get(maintenance.id);
  }, [contractByMaintenanceId, contractsById]);

  const getMaintenanceDoorCount = useCallback((maintenance: Maintenance) => {
    const client = clientsById.get(maintenance.clienteId);
    return (client?.puertasPeatonales || 0) + (client?.puertasVehiculares || 0);
  }, [clientsById]);

  const getMaintenanceProgressLabel = useCallback((maintenance: Maintenance) => {
    const contract = getMaintenanceContract(maintenance);
    if (!contract) return "—";

    const orderedMaintenances = [...contract.mantenimientosRealizados].sort((a, b) => {
      const dateCompare = (a.fechaProgramada || "").localeCompare(b.fechaProgramada || "");
      if (dateCompare !== 0) return dateCompare;
      return a.id.localeCompare(b.id);
    });

    const currentIndex = orderedMaintenances.findIndex((item) => item.id === (maintenance.contratoMantenimientoId || maintenance.id));
    if (currentIndex === -1) return `0/${contract.cantidadMantenimientos}`;

    return `${currentIndex + 1}/${contract.cantidadMantenimientos}`;
  }, [getMaintenanceContract]);

  const getMaintenancePaymentCost = useCallback((maintenance: Maintenance) => {
    const contract = getMaintenanceContract(maintenance);
    if (maintenance.valorRecaudado && maintenance.valorRecaudado > 0) {
      return maintenance.valorRecaudado;
    }

    return contract?.costoPorMantenimiento || 0;
  }, [getMaintenanceContract]);

  const getMaintenanceAnnualValue = useCallback((maintenance: Maintenance) => {
    return getMaintenanceContract(maintenance)?.costoTotalAnual || 0;
  }, [getMaintenanceContract]);

  const isMaintenanceOverdue = useCallback((maintenance: Maintenance) => {
    if (!maintenance.fechaProgramada) return false;
    if (maintenance.estado === "realizado") return false;
    const maintenanceDate = parseLocalDate(maintenance.fechaProgramada);
    return maintenanceDate.getTime() < todayStart.getTime();
  }, [todayStart]);

  const proximosMantenimientos = useMemo(() => {
    return maintenances.filter((m) => {
      if (m.estado !== "pendiente") return false;
      const fecha = parseLocalDate(m.fechaProgramada);
      const diffTime = fecha.getTime() - todayStart.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 3;
    });
  }, [maintenances, todayStart]);

  const programados = useMemo(() => {
    return maintenances.filter((m) => m.estado === "programado" && !isMaintenanceOverdue(m));
  }, [maintenances, isMaintenanceOverdue]);

  const vencidos = useMemo(() => {
    return maintenances.filter((m) => isMaintenanceOverdue(m));
  }, [maintenances, isMaintenanceOverdue]);

  const assignableUsers = users.filter(
    (u) =>
      u.estado === "activo" &&
      (u.rol === "tecnico" || u.rol === "lider" || u.esLider)
  );

  const handleSchedule = async () => {
    if (!schedulingMaint) return;
    try {
      const tecnicoId = scheduleTecnico || schedulingMaint.tecnicoId;
      const fecha = scheduleDate || schedulingMaint.fechaProgramada;
      await updateMantenimiento(schedulingMaint.id, {
        estado: "programado" as MaintenanceStatus,
        tecnicoId,
        fechaProgramada: fecha,
        observaciones: scheduleTime
          ? `Hora: ${scheduleTime}. ${schedulingMaint.observaciones || ""}`
          : schedulingMaint.observaciones,
      });

      const client = clients.find((c) => c.id === schedulingMaint.clienteId);
      await createNotificacion({
        usuarioId: tecnicoId,
        titulo: "Mantenimiento Programado",
        mensaje: `Se te ha asignado un mantenimiento en ${client?.edificio || "un edificio"} para el ${fecha}${scheduleTime ? ` a las ${scheduleTime}` : ""}. Revisa los detalles en la app.`,
        tipo: "mantenimiento",
        datos: {
          mantenimientoId: schedulingMaint.id,
          clienteId: schedulingMaint.clienteId,
          fecha,
          hora: scheduleTime || null,
        },
      });

      setScheduleOpen(false);
      setSchedulingMaint(null);
      await loadData();
    } catch (err) {
      console.error("Error programando mantenimiento:", err);
    }
  };

  const filtered = maintenances.filter((m) => {
    const client = clients.find((c) => c.id === m.clienteId);
    const tech = users.find((u) => u.id === m.tecnicoId);
    const matchesSearch =
      client?.edificio.toLowerCase().includes(search.toLowerCase()) ||
      client?.nombre.toLowerCase().includes(search.toLowerCase()) ||
      tech?.nombre.toLowerCase().includes(search.toLowerCase()) ||
      tech?.apellido.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "todos"
      || (statusFilter === "vencido" ? isMaintenanceOverdue(m) : m.estado === statusFilter);
    return matchesSearch && matchesStatus;
  });

  const calendarFilteredMaintenances = useMemo(() => {
    return filtered.filter((m) => {
      if (!m.fechaProgramada) return false;
      if (calendarSelectedDate) {
        const dateStr = `${calendarSelectedDate.getFullYear()}-${String(calendarSelectedDate.getMonth() + 1).padStart(2, "0")}-${String(calendarSelectedDate.getDate()).padStart(2, "0")}`;
        return m.fechaProgramada === dateStr;
      } else {
        const year = calendarMonth.getFullYear();
        const month = calendarMonth.getMonth() + 1;
        const prefix = `${year}-${String(month).padStart(2, "0")}`;
        return m.fechaProgramada.startsWith(prefix);
      }
    });
  }, [filtered, calendarMonth, calendarSelectedDate]);

  const companyName = companySettings?.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.";

  const getMaintenanceClientLabel = (maintenance: Maintenance) => {
    const client = clientsById.get(maintenance.clienteId);
    return client?.edificio || client?.nombre || "Cliente no registrado";
  };

  const getMaintenanceTechnicianLabel = (maintenance: Maintenance) => {
    const tech = usersById.get(maintenance.tecnicoId);
    if (!tech) return "Sin técnico asignado";
    return `${tech.nombre} ${tech.apellido}`.trim();
  };

  const getMaintenanceStatusLabel = (maintenance: Maintenance) => {
    return (statusConfig[maintenance.estado] || defaultStatusConfig).label;
  };

  const formatSelectedCalendarLabel = () => {
    if (calendarSelectedDate) {
      return calendarSelectedDate.toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    }

    return calendarMonth.toLocaleDateString("es-CO", {
      month: "long",
      year: "numeric",
    });
  };

  const handleExportProgramadosPDF = () => {
    if (programados.length === 0) {
      alert("No hay mantenimientos programados para exportar.");
      return;
    }

    generateTablePDF({
      titulo: "MANTENIMIENTOS PROGRAMADOS",
      subtitulo: "Programación confirmada con técnico asignado, fecha y hora registradas.",
      empresa: companyName,
      headers: ["Cliente", "Técnico", "Fecha", "Hora", "Estado"],
      rows: programados.map((maintenance) => [
        getMaintenanceClientLabel(maintenance),
        getMaintenanceTechnicianLabel(maintenance),
        maintenance.fechaProgramada,
        maintenance.horaProgramada || "—",
        getMaintenanceStatusLabel(maintenance),
      ]),
      summary: [
        { label: "Programados", value: String(programados.length) },
      ],
      fileName: "mantenimientos_programados",
    });
  };

  const handleExportCalendarPDF = () => {
    if (calendarFilteredMaintenances.length === 0) {
      alert(`No hay mantenimientos para exportar en ${calendarSelectedDate ? "la fecha" : "el mes"} seleccionada.`);
      return;
    }

    const periodLabel = formatSelectedCalendarLabel();
    const filePeriod = calendarSelectedDate
      ? `${calendarSelectedDate.getFullYear()}-${String(calendarSelectedDate.getMonth() + 1).padStart(2, "0")}-${String(calendarSelectedDate.getDate()).padStart(2, "0")}`
      : `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}`;

    generateTablePDF({
      titulo: calendarSelectedDate ? "MANTENIMIENTOS DEL DÍA" : "MANTENIMIENTOS DEL MES",
      subtitulo: calendarSelectedDate
        ? "Exportación de la fecha seleccionada en el calendario."
        : "Exportación del mes seleccionado en el calendario.",
      empresa: companyName,
      periodo: periodLabel,
      headers: ["Cliente", "Puertas", "Avance", "Valor total", "Costo mant.", "Técnico", "Fecha", "Estado"],
      rows: calendarFilteredMaintenances.map((maintenance) => [
        getMaintenanceClientLabel(maintenance),
        String(getMaintenanceDoorCount(maintenance)),
        getMaintenanceProgressLabel(maintenance),
        formatCurrency(getMaintenanceAnnualValue(maintenance)),
        formatCurrency(getMaintenancePaymentCost(maintenance)),
        getMaintenanceTechnicianLabel(maintenance),
        `${maintenance.fechaProgramada}${maintenance.horaProgramada ? ` · ${maintenance.horaProgramada}` : ""}`,
        getMaintenanceStatusLabel(maintenance),
      ]),
      summary: [
        { label: "Mantenimientos", value: String(calendarFilteredMaintenances.length) },
        {
          label: "Costo total",
          value: formatCurrency(calendarFilteredMaintenances.reduce((sum, maintenance) => sum + getMaintenancePaymentCost(maintenance), 0)),
        },
        { label: "Vista", value: calendarSelectedDate ? "Día" : "Mes" },
      ],
      fileName: `mantenimientos_calendario_${filePeriod}`,
      landscape: true,
    });
  };

  const handleSave = async (data: Partial<Maintenance>) => {
    try {
      if (editingMaintenance) {
        await updateMantenimiento(editingMaintenance.id, data);
      } else {
        await createMantenimiento(data);
      }
      setEditingMaintenance(null);
      await loadData();
    } catch (err) {
      console.error("Error guardando mantenimiento:", err);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingMaintenanceId(id);
    try {
      await deleteMantenimiento(id);
      setMaintenanceToDelete(null);
      await loadData();
    } catch (err) {
      console.error("Error eliminando mantenimiento:", err);
      const message = err instanceof Error
        ? err.message
        : "No se pudo eliminar el mantenimiento. Verifica relaciones activas.";
      alert(message);
    } finally {
      setDeletingMaintenanceId(null);
    }
  };

  if (loading) {
    return (
      <div>
        <AdminHeader title="Programación de Mantenimientos" />
        <AdminPageLoader
          title="Cargando mantenimientos"
          message="Estamos preparando la programación y el calendario de mantenimientos."
          showStats={false}
          rows={7}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Programación de Mantenimientos" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por cliente o técnico..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-secondary/50 border-border/50"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48 bg-secondary/50 border-border/50">
                <SelectValue placeholder="Filtrar por estado" />
              </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="todos">Todos los estados</SelectItem>
                  <SelectItem value="programado">Programado</SelectItem>
                  <SelectItem value="en_ejecucion">En Ejecución</SelectItem>
                  <SelectItem value="realizado">Realizado</SelectItem>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="vencido">Vencidos</SelectItem>
                </SelectContent>
              </Select>
          </div>
          <Button
            onClick={() => {
              setEditingMaintenance(null);
              setDialogOpen(true);
            }}
            className="bg-gold hover:bg-gold-dark text-background font-semibold gap-2"
          >
            <Plus className="h-4 w-4" />
            Nuevo Mantenimiento
          </Button>
        </div>

        <Tabs defaultValue="lista" className="space-y-4">
          <TabsList className="bg-secondary/50 border border-border/50">
            <TabsTrigger
              value="lista"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <List className="h-4 w-4 mr-2" />
              Todos
            </TabsTrigger>
            <TabsTrigger
              value="programados"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <UserCheck className="h-4 w-4 mr-2" />
              Programados
              <Badge className="ml-1.5 bg-blue-500/20 text-blue-400 text-[10px] border-0 px-1.5">
                {programados.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="proximos"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <Bell className="h-4 w-4 mr-2" />
              Próximos
              {proximosMantenimientos.length > 0 && (
                <Badge className="ml-1.5 h-5 w-5 rounded-full bg-red-500 text-[10px] text-white p-0 flex items-center justify-center border-0">
                  {proximosMantenimientos.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="calendario"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              Calendario
            </TabsTrigger>
            <TabsTrigger
              value="vencidos"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Vencidos
              {vencidos.length > 0 && (
                <Badge className="ml-1.5 bg-red-500/20 text-red-400 text-[10px] border-0 px-1.5">
                  {vencidos.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proximos">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground flex items-center gap-2">
                  <Bell className="h-5 w-5 text-amber-400" />
                  Mantenimientos por Realizar (Próximos 3 días)
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Estos mantenimientos se cargan automáticamente 3 días antes de su fecha. Asigne líder o técnico, fecha y hora para programarlos.
                </p>
              </CardHeader>
              <CardContent>
                {proximosMantenimientos.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="h-12 w-12 text-emerald-400/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No hay mantenimientos próximos a realizar</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {proximosMantenimientos.map((m) => {
                      const client = clients.find((c) => c.id === m.clienteId);
                      const tech = users.find((u) => u.id === m.tecnicoId);
                      const fecha = parseLocalDate(m.fechaProgramada);
                      const diffDays = Math.floor(
                        (fecha.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24)
                      );

                      return (
                        <div
                          key={m.id}
                          className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-4"
                        >
                          <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500/10">
                              <Clock className="h-6 w-6 text-amber-400" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{client?.edificio}</p>
                              <p className="text-xs text-muted-foreground">
                                {client?.nombre} · Fecha: {m.fechaProgramada}
                              </p>
                              {tech && (
                                <p className="text-xs text-foreground/60">
                                  Técnico actual: {tech.nombre} {tech.apellido}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs",
                                diffDays <= 0
                                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                                  : diffDays === 1
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                              )}
                            >
                              {diffDays <= 0 ? "HOY" : `En ${diffDays} día(s)`}
                            </Badge>
                            <Button
                              onClick={() => {
                                setSchedulingMaint(m);
                                setScheduleTecnico(m.tecnicoId);
                                setScheduleDate(m.fechaProgramada);
                                setScheduleTime("");
                                setScheduleOpen(true);
                              }}
                              size="sm"
                              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
                            >
                              <UserCheck className="h-4 w-4" />
                              Programar
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="programados">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-lg text-foreground flex items-center gap-2">
                      <UserCheck className="h-5 w-5 text-blue-400" />
                      Mantenimientos Programados
                    </CardTitle>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Mantenimientos con técnico asignado, fecha y hora confirmados. Se notifica automáticamente al aplicativo.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
                    onClick={handleExportProgramadosPDF}
                    disabled={programados.length === 0}
                  >
                    <Download className="h-4 w-4" />
                    Exportar PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Cliente</TableHead>
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Fecha</TableHead>
                      <TableHead className="text-muted-foreground">Observaciones</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {programados.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No hay mantenimientos programados
                        </TableCell>
                      </TableRow>
                    ) : (
                      programados.map((m) => {
                        const client = clients.find((c) => c.id === m.clienteId);
                        const tech = users.find((u) => u.id === m.tecnicoId);
                        return (
                          <TableRow key={m.id} className="border-border/50 hover:bg-secondary/30">
                            <TableCell>
                              <p className="font-medium text-foreground">{client?.edificio}</p>
                              <p className="text-xs text-muted-foreground">{client?.nombre}</p>
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">
                              {tech?.nombre} {tech?.apellido}
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">
                              <p>{m.fechaProgramada}</p>
                              {m.horaProgramada && (
                                <p className="text-xs text-muted-foreground">{m.horaProgramada}</p>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80 max-w-48 truncate">
                              {m.observaciones || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20"
                              >
                                <Bell className="h-3 w-3 mr-1" />
                                Notificado
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lista">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Cliente</TableHead>
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Fecha Programada</TableHead>
                      <TableHead className="text-muted-foreground">Próxima Fecha</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((m) => {
                      const client = clients.find((c) => c.id === m.clienteId);
                      const tech = users.find((u) => u.id === m.tecnicoId);
                      const status = statusConfig[m.estado] || defaultStatusConfig;
                      const StatusIcon = status.icon;

                      return (
                        <TableRow key={m.id} className="border-border/50 hover:bg-secondary/30">
                          <TableCell>
                            <p className="font-medium text-foreground">{client?.edificio}</p>
                            <p className="text-xs text-muted-foreground">{client?.nombre}</p>
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {tech?.nombre} {tech?.apellido}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            <p>{m.fechaProgramada}</p>
                            {m.horaProgramada && (
                              <p className="text-xs text-muted-foreground">{m.horaProgramada}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{m.proximaFecha || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-xs gap-1", status.color)}>
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-card border-border">
                                <DropdownMenuItem
                                  onClick={() => { setEditingMaintenance(m); setDialogOpen(true); }}
                                  className="gap-2 cursor-pointer"
                                >
                                  <Pencil className="h-4 w-4" /> Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setMaintenanceToDelete(m)}
                                  className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                                >
                                  <Trash2 className="h-4 w-4" /> Eliminar
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calendario">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <MiniCalendar
                  maintenances={maintenances}
                  currentMonth={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  selectedDate={calendarSelectedDate}
                  onSelectDate={setCalendarSelectedDate}
                />
              </div>
              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    Mantenimientos del {calendarSelectedDate ? "día seleccionado" : "mes seleccionado"}
                  </h3>
                  <div className="flex items-center gap-2">
                    {calendarSelectedDate && (
                      <Button variant="ghost" size="sm" onClick={() => setCalendarSelectedDate(null)} className="h-8 text-xs">
                        Ver todo el mes
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
                      onClick={handleExportCalendarPDF}
                      disabled={calendarFilteredMaintenances.length === 0}
                    >
                      <Download className="h-4 w-4" />
                      Exportar PDF
                    </Button>
                  </div>
                </div>
                {calendarFilteredMaintenances.length === 0 ? (
                  <div className="text-center py-10 rounded-lg border border-border/50 bg-card/50">
                    <CalendarDays className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      No hay mantenimientos programados para {calendarSelectedDate ? "este día" : "este mes"}
                    </p>
                  </div>
                ) : (
                  calendarFilteredMaintenances.map((m) => {
                    const client = clientsById.get(m.clienteId);
                    const tech = usersById.get(m.tecnicoId);
                    const status = statusConfig[m.estado] || defaultStatusConfig;
                    const StatusIcon = status.icon;

                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between rounded-lg border border-border/50 bg-card/80 p-4 hover:bg-secondary/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", status.color.split(" ")[0])}>
                            <StatusIcon className={cn("h-5 w-5", status.color.split(" ")[1])} />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{client?.edificio}</p>
                            <p className="text-xs text-muted-foreground">
                              {tech?.nombre} {tech?.apellido} · {m.fechaProgramada} {m.horaProgramada ? `· ${m.horaProgramada}` : ""}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {getMaintenanceDoorCount(m)} puertas · avance {getMaintenanceProgressLabel(m)} · valor {formatCurrency(getMaintenanceAnnualValue(m))} · pago {formatCurrency(getMaintenancePaymentCost(m))}
                            </p>
                          </div>
                        </div>
                        <Badge variant="outline" className={cn("text-xs", status.color)}>
                          {status.label}
                        </Badge>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="vencidos">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                  Mantenimientos Vencidos
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Mantenimientos cuya fecha ya pasó y aún no fueron realizados.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Cliente</TableHead>
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Fecha programada</TableHead>
                      <TableHead className="text-muted-foreground">Avance</TableHead>
                      <TableHead className="text-muted-foreground">Costo mant.</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vencidos.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No hay mantenimientos vencidos
                        </TableCell>
                      </TableRow>
                    ) : (
                      vencidos.map((m) => {
                        const status = statusConfig[m.estado] || defaultStatusConfig;
                        return (
                          <TableRow key={m.id} className="border-border/50 hover:bg-secondary/30">
                            <TableCell>
                              <p className="font-medium text-foreground">{getMaintenanceClientLabel(m)}</p>
                              <p className="text-xs text-muted-foreground">{clientsById.get(m.clienteId)?.nombre}</p>
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">
                              {getMaintenanceTechnicianLabel(m)}
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">
                              {m.fechaProgramada}
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">
                              {getMaintenanceProgressLabel(m)}
                            </TableCell>
                            <TableCell className="text-sm font-medium text-gold">
                              {formatCurrency(getMaintenancePaymentCost(m))}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn("text-xs", status.color)}>
                                {status.label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <MaintenanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        maintenance={editingMaintenance}
        onSave={handleSave}
      />

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Programar Mantenimiento</DialogTitle>
            <div id="schedule-dialog-desc" className="sr-only">
              Formulario para asignar líder o técnico, fecha y hora a un mantenimiento pendiente.
            </div>
          </DialogHeader>
          {schedulingMaint && (() => {
            const client = clients.find((c) => c.id === schedulingMaint.clienteId);
            return (
              <div className="space-y-4">
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                  <p className="text-sm font-medium text-foreground">{client?.edificio}</p>
                  <p className="text-xs text-muted-foreground">{client?.nombre}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/80">Líder o Técnico Asignado</Label>
                  <Select value={scheduleTecnico} onValueChange={setScheduleTecnico}>
                    <SelectTrigger className="bg-secondary/50 border-border/50">
                      <SelectValue placeholder="Seleccionar líder o técnico" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {assignableUsers.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.nombre} {t.apellido}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Fecha</Label>
                    <Input
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="bg-secondary/50 border-border/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-foreground/80">Hora</Label>
                    <Input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="bg-secondary/50 border-border/50"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Al programar, se notificará automáticamente al aplicativo del líder o técnico asignado.
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setScheduleOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSchedule}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              <ArrowRight className="h-4 w-4" />
              Programar y Notificar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!maintenanceToDelete}
        onOpenChange={(open) => {
          if (!open && !deletingMaintenanceId) setMaintenanceToDelete(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmar eliminación</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Seguro que quieres eliminar este mantenimiento? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setMaintenanceToDelete(null)}
              disabled={!!deletingMaintenanceId}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => maintenanceToDelete && handleDelete(maintenanceToDelete.id)}
              disabled={!!deletingMaintenanceId}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingMaintenanceId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deletingMaintenanceId ? "Eliminando..." : "Sí, eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deletingMaintenanceId && (
        <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center">
          <div className="rounded-lg border border-border bg-card px-6 py-4 flex items-center gap-3 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
            <p className="text-sm text-foreground">Eliminando mantenimiento...</p>
          </div>
        </div>
      )}
    </div>
  );
}
