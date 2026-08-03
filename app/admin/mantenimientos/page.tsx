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
  FileSpreadsheet,
} from "lucide-react";
import { Maintenance, MaintenanceStatus, Client, User, CompanySettings, LiquidationPeriod } from "@/lib/types";
import { getMantenimientos, createMantenimiento, updateMantenimiento, deleteMantenimiento } from "@/lib/supabase/services/mantenimientos";
import { getContratos, createContrato } from "@/lib/supabase/services/contratos";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { createNotificacion } from "@/lib/supabase/services/notificaciones";
import { getConfiguracion } from "@/lib/supabase/services/configuracion";
import { getPeriodos } from "@/lib/supabase/services/liquidacion";
import { cn } from "@/lib/utils";
import { generateTablePDF } from "@/lib/utils/pdf-generator";
import { formatClientDoorBreakdown } from "@/lib/utils/report-content";
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
const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getMonthInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
  const [periods, setPeriods] = useState<LiquidationPeriod[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [overdueSearch, setOverdueSearch] = useState("");
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
  const [uncoveredSearch, setUncoveredSearch] = useState("");
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [reactivatingContract, setReactivatingContract] = useState<MaintenanceContract | null>(null);
  const [reactivateStartMonth, setReactivateStartMonth] = useState(String(new Date().getMonth() + 1));
  const [reactivateStartDay, setReactivateStartDay] = useState(String(new Date().getDate()));
  const [reactivateStartYear, setReactivateStartYear] = useState(String(new Date().getFullYear()));
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const [programadosMonthFilter, setProgramadosMonthFilter] = useState<string>(() => getMonthInputValue(new Date()));
  const [vencidosMonthFilter, setVencidosMonthFilter] = useState<string>(() => getMonthInputValue(new Date()));
  const [completedPeriodFilter, setCompletedPeriodFilter] = useState<string>("");

  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<Date | null>(null);

  const parseLocalDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [m, ct, c, u, s, p] = await Promise.all([
        getMantenimientos(),
        getContratos(),
        getClientes(),
        getUsuarios(),
        getConfiguracion().catch((error) => {
          console.error("Error cargando configuración de empresa:", error);
          return null;
        }),
        getPeriodos().catch((error) => {
          console.error("Error cargando períodos de liquidación:", error);
          return [];
        }),
      ]);
      setMaintenances(m);
      setContracts(ct);
      setClients(c);
      setUsers(u);
      setCompanySettings(s);
      setPeriods(p);
      setCompletedPeriodFilter((current) => {
        if (current && p.some((period) => period.id === current)) return current;
        return p[0]?.id || "";
      });
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
    const contract = getMaintenanceContract(maintenance);
    if (contract) {
      return (contract.puertasPeatonales || 0) + (contract.puertasVehiculares || 0);
    }

    const client = clientsById.get(maintenance.clienteId);
    return (client?.puertasPeatonales || 0) + (client?.puertasVehiculares || 0);
  }, [clientsById, getMaintenanceContract]);

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
    if ((Number(maintenance.costoTecnicoTotal ?? 0) || 0) > 0) {
      return Number(maintenance.costoTecnicoTotal ?? 0) || 0;
    }

    return 0;
  }, []);

  const getMaintenanceChargedValue = useCallback((maintenance: Maintenance) => {
    if ((Number(maintenance.valorRecaudado ?? 0) || 0) > 0) {
      return Number(maintenance.valorRecaudado ?? 0) || 0;
    }

    const contract = getMaintenanceContract(maintenance);
    const contractMaintenance = contract?.mantenimientosRealizados.find((item) => item.id === (maintenance.contratoMantenimientoId || maintenance.id));
    const chargedValue = Number(contractMaintenance?.valorRecaudado ?? 0) || 0;
    return chargedValue > 0 ? chargedValue : Number(contract?.costoPorMantenimiento ?? 0) || 0;
  }, [getMaintenanceContract]);

  const getMaintenanceAnnualValue = useCallback((maintenance: Maintenance) => {
    return getMaintenanceContract(maintenance)?.costoTotalAnual || 0;
  }, [getMaintenanceContract]);

  const isMaintenanceCompleted = useCallback((maintenance: Maintenance) => {
    const status = String(maintenance.estado).toLowerCase();
    return status === "realizado" || status === "completado";
  }, []);

  const getMaintenanceCompletedDate = useCallback((maintenance: Maintenance) => {
    return maintenance.fechaCierre || maintenance.fechaProgramada || "";
  }, []);

  const getPeriodLabel = useCallback((period?: LiquidationPeriod) => {
    if (!period) return "Sin período";
    return `${period.fechaInicio} al ${period.fechaFin}`;
  }, []);

  const canScheduleMaintenance = useCallback((maintenance: Maintenance) => {
    return String(maintenance.estado).toLowerCase() === "pendiente";
  }, []);

  const isMaintenanceOverdue = useCallback((maintenance: Maintenance) => {
    if (!maintenance.fechaProgramada) return false;
    if (isMaintenanceCompleted(maintenance)) return false;
    const maintenanceDate = parseLocalDate(maintenance.fechaProgramada);
    return maintenanceDate.getTime() < todayStart.getTime();
  }, [isMaintenanceCompleted, todayStart]);

  const openScheduleDialog = useCallback((maintenance: Maintenance) => {
    setSchedulingMaint(maintenance);
    setScheduleTecnico(maintenance.tecnicoId);
    setScheduleDate(maintenance.fechaProgramada);
    setScheduleTime(maintenance.horaProgramada || "");
    setScheduleOpen(true);
  }, []);

  const proximosMantenimientos = useMemo(() => {
    return maintenances.filter((m) => {
      if (!canScheduleMaintenance(m)) return false;
      const fecha = parseLocalDate(m.fechaProgramada);
      const diffTime = fecha.getTime() - todayStart.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 3;
    });
  }, [canScheduleMaintenance, maintenances, todayStart]);

  const programados = useMemo(() => {
    const scheduledMaintenances = maintenances.filter((m) => {
      const status = String(m.estado).toLowerCase();
      return status === "programado" || status === "en_ejecucion" || status === "en_progreso";
    });

    if (scheduledMaintenances.length === 0) {
      return [];
    }

    if (programadosMonthFilter) {
      return scheduledMaintenances.filter((m) => m.fechaProgramada.startsWith(programadosMonthFilter));
    }

    return scheduledMaintenances;
  }, [maintenances, programadosMonthFilter]);

  const vencidos = useMemo(() => {
    return maintenances.filter((m) => canScheduleMaintenance(m) && isMaintenanceOverdue(m));
  }, [canScheduleMaintenance, maintenances, isMaintenanceOverdue]);

  const activeCoverageClientIds = useMemo(() => {
    return new Set(
      contracts
        .filter((contract) => contract.estado === "activo")
        .map((contract) => contract.clienteId)
    );
  }, [contracts]);

  const uncoveredContracts = useMemo(() => {
    const latestClosedByClient = new Map<string, MaintenanceContract>();

    contracts.forEach((contract) => {
      if (contract.estado !== "cerrado" || activeCoverageClientIds.has(contract.clienteId)) {
        return;
      }

      const current = latestClosedByClient.get(contract.clienteId);
      if (!current) {
        latestClosedByClient.set(contract.clienteId, contract);
        return;
      }

      const currentDate = `${current.anio}-${String(current.mesInicio || 1).padStart(2, "0")}-${current.fechaCreacion}`;
      const nextDate = `${contract.anio}-${String(contract.mesInicio || 1).padStart(2, "0")}-${contract.fechaCreacion}`;
      if (nextDate > currentDate) {
        latestClosedByClient.set(contract.clienteId, contract);
      }
    });

    return Array.from(latestClosedByClient.values());
  }, [activeCoverageClientIds, contracts]);

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
      const scheduledMaintenance = await updateMantenimiento(schedulingMaint.id, {
        estado: "programado" as MaintenanceStatus,
        tecnicoId,
        fechaProgramada: fecha,
        horaProgramada: scheduleTime,
        participantes: [{
          usuarioId: tecnicoId,
          porcentaje: 100,
          valorCalculado: getMaintenancePaymentCost(schedulingMaint),
        }],
        observaciones: scheduleTime
          ? `Hora: ${scheduleTime}. ${schedulingMaint.observaciones || ""}`
          : schedulingMaint.observaciones,
      });

      const client = clients.find((c) => c.id === schedulingMaint.clienteId);
      const contratoMantenimientoId = scheduledMaintenance.contratoMantenimientoId || schedulingMaint.contratoMantenimientoId;
      await createNotificacion({
        usuarioId: tecnicoId,
        titulo: "Mantenimiento Programado",
        mensaje: `Se te ha asignado un mantenimiento en ${client?.edificio || "un edificio"} para el ${fecha}${scheduleTime ? ` a las ${scheduleTime}` : ""}. Revisa los detalles en la app.`,
        tipo: "mantenimiento",
        datos: {
          mantenimientoId: scheduledMaintenance.id,
          ...(contratoMantenimientoId ? { contratoMantenimientoId } : {}),
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

  const maintenanceMatchesSearch = useCallback((maintenance: Maintenance, query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;

    const client = clientsById.get(maintenance.clienteId);
    const mainTechnician = usersById.get(maintenance.tecnicoId);
    const maintenanceStatusLabel = (statusConfig[maintenance.estado] || defaultStatusConfig).label;
    const participantNames = (maintenance.participantes || [])
      .map((participant) => usersById.get(participant.usuarioId))
      .filter(Boolean)
      .map((user) => `${user!.nombre} ${user!.apellido}`.trim());
    const searchableText = [
      client?.edificio || "",
      client?.nombre || "",
      client?.direccion || "",
      mainTechnician ? `${mainTechnician.nombre} ${mainTechnician.apellido}`.trim() : "",
      ...participantNames,
      maintenance.fechaProgramada || "",
      maintenance.horaProgramada || "",
      maintenance.observaciones || "",
      maintenanceStatusLabel,
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(normalizedQuery);
  }, [clientsById, usersById]);

  const filtered = maintenances.filter((m) => {
    const matchesSearch = maintenanceMatchesSearch(m, search);
    const matchesStatus = statusFilter === "todos"
      || (statusFilter === "vencido" ? canScheduleMaintenance(m) && isMaintenanceOverdue(m) : m.estado === statusFilter);
    return matchesSearch && matchesStatus;
  });

  const filteredOverdueMaintenances = useMemo(() => {
    return vencidos.filter((maintenance) => {
      const matchesSearch = maintenanceMatchesSearch(maintenance, overdueSearch);
      const matchesMonth = !vencidosMonthFilter || maintenance.fechaProgramada.startsWith(vencidosMonthFilter);
      return matchesSearch && matchesMonth;
    });
  }, [maintenanceMatchesSearch, overdueSearch, vencidos, vencidosMonthFilter]);

  const filteredUncoveredContracts = useMemo(() => {
    return uncoveredContracts.filter((contract) => {
      const client = clientsById.get(contract.clienteId);
      const query = uncoveredSearch.trim().toLowerCase();
      if (!query) return true;

      return Boolean(
        client?.edificio?.toLowerCase().includes(query) ||
        client?.nombre?.toLowerCase().includes(query)
      );
    });
  }, [clientsById, uncoveredContracts, uncoveredSearch]);

  const completedMaintenances = useMemo(() => {
    return maintenances.filter((maintenance) => isMaintenanceCompleted(maintenance));
  }, [isMaintenanceCompleted, maintenances]);

  const completedMaintenancesByPeriod = useMemo(() => {
    const selectedPeriod = periods.find((period) => period.id === completedPeriodFilter);
    if (!selectedPeriod) return [];

    return completedMaintenances.filter((maintenance) => {
      const completedDate = getMaintenanceCompletedDate(maintenance);
      return !!completedDate && completedDate >= selectedPeriod.fechaInicio && completedDate <= selectedPeriod.fechaFin;
    }).sort((left, right) => {
      const dateCompare = getMaintenanceCompletedDate(right).localeCompare(getMaintenanceCompletedDate(left));
      if (dateCompare !== 0) return dateCompare;
      return right.id.localeCompare(left.id);
    });
  }, [completedMaintenances, completedPeriodFilter, getMaintenanceCompletedDate, periods]);

  const selectedCompletedPeriod = useMemo(
    () => periods.find((period) => period.id === completedPeriodFilter),
    [completedPeriodFilter, periods]
  );

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

  const getMaintenanceClientLabel = useCallback((maintenance: Maintenance) => {
    const client = clientsById.get(maintenance.clienteId);
    return client?.edificio || client?.nombre || "Cliente no registrado";
  }, [clientsById]);

  const getMaintenanceParticipantNames = useCallback((maintenance: Maintenance) => {
    const participantIds = maintenance.participantes?.map((participant) => participant.usuarioId).filter(Boolean) || [];

    if (participantIds.length === 0 && maintenance.tecnicoId) {
      const tech = usersById.get(maintenance.tecnicoId);
      return tech ? [`${tech.nombre} ${tech.apellido}`.trim()] : [];
    }

    return participantIds.map((participantId) => {
      const participant = usersById.get(participantId);
      return participant ? `${participant.nombre} ${participant.apellido}`.trim() : null;
    }).filter(Boolean) as string[];
  }, [usersById]);

  const getMaintenanceTechnicianLabel = useCallback((maintenance: Maintenance) => {
    const participantNames = getMaintenanceParticipantNames(maintenance);
    if (participantNames.length === 0) return "Sin técnico asignado";
    if (participantNames.length === 1) return participantNames[0];
    return `${participantNames.length} participantes`;
  }, [getMaintenanceParticipantNames]);

  const getMaintenanceStatusLabel = useCallback((maintenance: Maintenance) => {
    return (statusConfig[maintenance.estado] || defaultStatusConfig).label;
  }, []);

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
        { label: "Mes", value: programadosMonthFilter || "Todos" },
      ],
      fileName: `mantenimientos_programados${programadosMonthFilter ? `_${programadosMonthFilter}` : ""}`,
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
      headers: ["Cliente", "Puertas", "Avance", "Valor total", "Valor técnico", "Técnico", "Fecha", "Estado"],
      rows: calendarFilteredMaintenances.map((maintenance) => [
        getMaintenanceClientLabel(maintenance),
        formatClientDoorBreakdown(getMaintenanceContract(maintenance) || clientsById.get(maintenance.clienteId)) || `${getMaintenanceDoorCount(maintenance)} puertas`,
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
          label: "Valor técnico total",
          value: formatCurrency(calendarFilteredMaintenances.reduce((sum, maintenance) => sum + getMaintenancePaymentCost(maintenance), 0)),
        },
        { label: "Vista", value: calendarSelectedDate ? "Día" : "Mes" },
      ],
      fileName: `mantenimientos_calendario_${filePeriod}`,
      landscape: true,
    });
  };

  const handleExportCompletedByPeriodPDF = useCallback(() => {
    if (!selectedCompletedPeriod) {
      alert("Debes seleccionar un período para exportar los mantenimientos realizados.");
      return;
    }

    if (completedMaintenancesByPeriod.length === 0) {
      alert("No hay mantenimientos realizados en el período seleccionado.");
      return;
    }

    generateTablePDF({
      titulo: "MANTENIMIENTOS REALIZADOS POR PERIODO",
      subtitulo: "Exportación de mantenimientos realizados con el valor total del contrato y el valor cobrado de cada avance.",
      empresa: companyName,
      periodo: getPeriodLabel(selectedCompletedPeriod),
      headers: ["Fecha realizada", "Cliente", "Tecnico", "Avance", "Estado", "Valor total", "Valor cobrado avance"],
      rows: completedMaintenancesByPeriod.map((maintenance) => [
        getMaintenanceCompletedDate(maintenance),
        getMaintenanceClientLabel(maintenance),
        getMaintenanceTechnicianLabel(maintenance),
        getMaintenanceProgressLabel(maintenance),
        getMaintenanceStatusLabel(maintenance),
        formatCurrency(getMaintenanceAnnualValue(maintenance)),
        formatCurrency(getMaintenanceChargedValue(maintenance)),
      ]),
      summary: [
        { label: "Periodo", value: getPeriodLabel(selectedCompletedPeriod) },
        { label: "Mantenimientos realizados", value: String(completedMaintenancesByPeriod.length) },
        {
          label: "Valor total contratos",
          value: formatCurrency(completedMaintenancesByPeriod.reduce((sum, maintenance) => sum + getMaintenanceAnnualValue(maintenance), 0)),
        },
        {
          label: "Valor cobrado avances",
          value: formatCurrency(completedMaintenancesByPeriod.reduce((sum, maintenance) => sum + getMaintenanceChargedValue(maintenance), 0)),
        },
      ],
      fileName: `mantenimientos_realizados_${selectedCompletedPeriod.fechaInicio}_${selectedCompletedPeriod.fechaFin}`,
      landscape: true,
    });
  }, [companyName, completedMaintenancesByPeriod, getMaintenanceAnnualValue, getMaintenanceChargedValue, getMaintenanceClientLabel, getMaintenanceCompletedDate, getMaintenanceProgressLabel, getMaintenanceStatusLabel, getMaintenanceTechnicianLabel, getPeriodLabel, selectedCompletedPeriod]);

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

  const openReactivateDialog = useCallback((contract: MaintenanceContract) => {
    const nextDate = new Date();
    setReactivatingContract(contract);
    setReactivateStartYear(String(nextDate.getFullYear()));
    setReactivateStartMonth(String(nextDate.getMonth() + 1));
    setReactivateStartDay(String(Math.min(nextDate.getDate(), 28)));
    setReactivateOpen(true);
  }, []);

  const buildContractMaintenances = useCallback((cantidad: number, anio: number, mesInicio: number, dia: number) => {
    const intervalo = Math.floor(12 / cantidad);
    return Array.from({ length: cantidad }, (_, index) => {
      const monthValue = ((mesInicio - 1 + index * intervalo) % 12) + 1;
      const yearValue = anio + Math.floor((mesInicio - 1 + index * intervalo) / 12);
      const dateValue = formatDateInput(new Date(yearValue, monthValue - 1, Math.min(dia, 28)));

      return {
        id: `reactivated-${index}`,
        mes: monthValue,
        fechaProgramada: dateValue,
        estado: "pendiente" as const,
        valorRecaudado: 0,
      };
    });
  }, []);

  const handleReactivateCoverage = async () => {
    if (!reactivatingContract) return;

    const year = Number(reactivateStartYear);
    const month = Number(reactivateStartMonth);
    const day = Math.min(Number(reactivateStartDay), 28);

    if (!year || !month || !day) {
      alert("Debes definir una fecha de reinicio válida para reactivar la cobertura.");
      return;
    }

    setReactivateLoading(true);
    try {
      await createContrato({
        clienteId: reactivatingContract.clienteId,
        anio: year,
        mesInicio: month,
        diaInicio: day,
        puertasPeatonales: reactivatingContract.puertasPeatonales,
        puertasVehiculares: reactivatingContract.puertasVehiculares,
        valorPuertaPeatonal: reactivatingContract.valorPuertaPeatonal,
        valorPuertaVehicular: reactivatingContract.valorPuertaVehicular,
        costoTotalAnual: reactivatingContract.costoTotalAnual,
        cantidadMantenimientos: reactivatingContract.cantidadMantenimientos,
        costoPorMantenimiento: reactivatingContract.costoPorMantenimiento,
        mantenimientosRealizados: buildContractMaintenances(
          reactivatingContract.cantidadMantenimientos,
          year,
          month,
          day
        ),
        estado: "activo",
      });

      setReactivateOpen(false);
      setReactivatingContract(null);
      await loadData();
    } catch (err) {
      console.error("Error reactivando cobertura:", err);
      alert("No se pudo reactivar la cobertura. Intenta nuevamente.");
    } finally {
      setReactivateLoading(false);
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
              value="realizados"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Realizados
              <Badge className="ml-1.5 bg-emerald-500/20 text-emerald-400 text-[10px] border-0 px-1.5">
                {completedMaintenancesByPeriod.length}
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
            <TabsTrigger
              value="sin-cubrimiento"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <Clock className="h-4 w-4 mr-2" />
              Sin Cubrimiento
              {uncoveredContracts.length > 0 && (
                <Badge className="ml-1.5 bg-muted text-muted-foreground text-[10px] border-0 px-1.5">
                  {uncoveredContracts.length}
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
                      const participantNames = getMaintenanceParticipantNames(m);
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
                              {participantNames.length > 0 && (
                                <p className="text-xs text-foreground/60">
                                  Asignados: {participantNames.join(", ")}
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
                              onClick={() => openScheduleDialog(m)}
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
                      Muestra todos los mantenimientos con estado programado, en ejecucion o en progreso. Puedes filtrarlos por mes.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 sm:items-end">
                    <div className="flex items-center gap-2">
                      <Input
                        type="month"
                        value={programadosMonthFilter}
                        onChange={(e) => setProgramadosMonthFilter(e.target.value)}
                        className="w-[180px] bg-secondary/50 border-border/50"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setProgramadosMonthFilter("")}
                        className="border-border/50"
                      >
                        Todos
                      </Button>
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
                        return (
                          <TableRow key={m.id} className="border-border/50 hover:bg-secondary/30">
                            <TableCell>
                              <p className="font-medium text-foreground">{client?.edificio}</p>
                              <p className="text-xs text-muted-foreground">{client?.nombre}</p>
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">
                              <p>{getMaintenanceTechnicianLabel(m)}</p>
                              {m.participantes && m.participantes.length > 1 && (
                                <p className="text-xs text-muted-foreground truncate">{getMaintenanceParticipantNames(m).join(", ")}</p>
                              )}
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

          <TabsContent value="realizados">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-lg text-foreground flex items-center gap-2">
                      <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                      Mantenimientos Realizados por Período
                    </CardTitle>
                    <p className="mt-2 text-sm text-muted-foreground">
                      En este módulo puedes ver y exportar por período el valor total del contrato y el valor cobrado correspondiente a cada avance realizado.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 sm:items-end">
                    <Select value={completedPeriodFilter} onValueChange={setCompletedPeriodFilter}>
                      <SelectTrigger className="w-[260px] bg-secondary/50 border-border/50">
                        <SelectValue placeholder="Seleccionar período" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {periods.map((period) => (
                          <SelectItem key={period.id} value={period.id}>
                            {getPeriodLabel(period)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
                      onClick={handleExportCompletedByPeriodPDF}
                      disabled={!selectedCompletedPeriod || completedMaintenancesByPeriod.length === 0}
                    >
                      <Download className="h-4 w-4" />
                      Exportar PDF
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Fecha realizada</TableHead>
                      <TableHead className="text-muted-foreground">Cliente</TableHead>
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Avance</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground text-right">Valor total</TableHead>
                      <TableHead className="text-muted-foreground text-right">Valor cobrado avance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {completedMaintenancesByPeriod.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          {selectedCompletedPeriod
                            ? "No hay mantenimientos realizados en el período seleccionado"
                            : "No hay períodos disponibles para exportar"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      completedMaintenancesByPeriod.map((maintenance) => {
                        const status = statusConfig[maintenance.estado] || defaultStatusConfig;
                        return (
                          <TableRow key={maintenance.id} className="border-border/50 hover:bg-secondary/30">
                            <TableCell className="text-sm text-foreground/80">{getMaintenanceCompletedDate(maintenance)}</TableCell>
                            <TableCell>
                              <p className="font-medium text-foreground">{getMaintenanceClientLabel(maintenance)}</p>
                              <p className="text-xs text-muted-foreground">{clientsById.get(maintenance.clienteId)?.nombre || "Cliente no registrado"}</p>
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">{getMaintenanceTechnicianLabel(maintenance)}</TableCell>
                            <TableCell className="text-sm text-foreground/80">{getMaintenanceProgressLabel(maintenance)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn("text-xs", status.color)}>
                                {status.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium text-foreground">
                              {formatCurrency(getMaintenanceAnnualValue(maintenance))}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium text-gold">
                              {formatCurrency(getMaintenanceChargedValue(maintenance))}
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
                              {getMaintenanceParticipantNames(m).join(", ") || "Sin asignados"} · {m.fechaProgramada} {m.horaProgramada ? `· ${m.horaProgramada}` : ""}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {getMaintenanceDoorCount(m)} puertas · avance {getMaintenanceProgressLabel(m)} · valor contrato {formatCurrency(getMaintenanceAnnualValue(m))} · valor técnico {formatCurrency(getMaintenancePaymentCost(m))}
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
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative max-w-sm flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar en vencidos por cliente o técnico..."
                      value={overdueSearch}
                      onChange={(e) => setOverdueSearch(e.target.value)}
                      className="pl-10 bg-secondary/50 border-border/50"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="month"
                      value={vencidosMonthFilter}
                      onChange={(e) => setVencidosMonthFilter(e.target.value)}
                      className="w-[180px] bg-secondary/50 border-border/50"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setVencidosMonthFilter("")}
                      className="border-border/50"
                    >
                      Todos
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Cliente</TableHead>
                      <TableHead className="text-muted-foreground">Técnico</TableHead>
                      <TableHead className="text-muted-foreground">Fecha programada</TableHead>
                      <TableHead className="text-muted-foreground">Avance</TableHead>
                      <TableHead className="text-muted-foreground">Valor técnico</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground text-right">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOverdueMaintenances.length === 0 ? (
                      <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          {vencidos.length === 0
                            ? "No hay mantenimientos vencidos"
                            : "No se encontraron mantenimientos vencidos con esos filtros"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredOverdueMaintenances.map((m) => {
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
                            <TableCell className="text-right">
                              <Button
                                onClick={() => openScheduleDialog(m)}
                                size="sm"
                                className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
                              >
                                <UserCheck className="h-4 w-4" />
                                Programar
                              </Button>
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

          <TabsContent value="sin-cubrimiento">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-foreground flex items-center gap-2">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  Clientes Sin Cubrimiento
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Clientes cuyo ultimo contrato de mantenimiento fue cerrado y actualmente no tienen una cobertura activa.
                </p>
                <div className="relative max-w-sm pt-2">
                  <Search className="absolute left-3 top-1/2 mt-1 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar cliente sin cubrimiento..."
                    value={uncoveredSearch}
                    onChange={(e) => setUncoveredSearch(e.target.value)}
                    className="pl-10 bg-secondary/50 border-border/50"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Cliente</TableHead>
                      <TableHead className="text-muted-foreground">Ultimo contrato</TableHead>
                      <TableHead className="text-muted-foreground">Cantidad mant.</TableHead>
                      <TableHead className="text-muted-foreground">Valor anual</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground text-right">Accion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUncoveredContracts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          {uncoveredContracts.length === 0
                            ? "No hay clientes sin cubrimiento"
                            : "No se encontraron clientes sin cubrimiento con esa busqueda"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUncoveredContracts.map((contract) => {
                        const client = clientsById.get(contract.clienteId);

                        return (
                          <TableRow key={contract.id} className="border-border/50 hover:bg-secondary/30">
                            <TableCell>
                              <p className="font-medium text-foreground">{client?.edificio || client?.nombre}</p>
                              <p className="text-xs text-muted-foreground">{client?.nombre || "Cliente no registrado"}</p>
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">
                              <p>{contract.anio}</p>
                              <p className="text-xs text-muted-foreground">Desde {monthNames[(contract.mesInicio || 1) - 1]}</p>
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">
                              {contract.cantidadMantenimientos}
                            </TableCell>
                            <TableCell className="text-sm font-medium text-gold">
                              {formatCurrency(contract.costoTotalAnual)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs bg-muted text-muted-foreground border-border/50">
                                Sin cubrimiento
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                onClick={() => openReactivateDialog(contract)}
                                size="sm"
                                className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
                              >
                                <ArrowRight className="h-4 w-4" />
                                Reactivar
                              </Button>
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
        key={`${dialogOpen ? "open" : "closed"}-${editingMaintenance?.id || "new"}`}
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

      <Dialog
        open={reactivateOpen}
        onOpenChange={(open) => {
          if (!reactivateLoading) {
            setReactivateOpen(open);
            if (!open) setReactivatingContract(null);
          }
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Reactivar Cobertura</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Se creara un nuevo contrato activo con mantenimientos pendientes a partir de la fecha de reinicio definida.
            </DialogDescription>
          </DialogHeader>

          {reactivatingContract && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/50 bg-secondary/30 p-3">
                {(() => {
                  const client = clientsById.get(reactivatingContract.clienteId);
                  return (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        {client?.edificio || client?.nombre || "Cliente no registrado"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Se reutilizaran {reactivatingContract.cantidadMantenimientos} mantenimientos por {formatCurrency(reactivatingContract.costoTotalAnual)} anuales.
                      </p>
                    </>
                  );
                })()}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-foreground/80">Ano inicio</Label>
                  <Input
                    type="number"
                    value={reactivateStartYear}
                    onChange={(e) => setReactivateStartYear(e.target.value)}
                    className="bg-secondary/50 border-border/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/80">Mes inicio</Label>
                  <Select value={reactivateStartMonth} onValueChange={setReactivateStartMonth}>
                    <SelectTrigger className="bg-secondary/50 border-border/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {monthNames.map((monthName, index) => (
                        <SelectItem key={monthName} value={String(index + 1)}>
                          {monthName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground/80">Dia</Label>
                  <Input
                    type="number"
                    min="1"
                    max="28"
                    value={reactivateStartDay}
                    onChange={(e) => setReactivateStartDay(e.target.value)}
                    className="bg-secondary/50 border-border/50"
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                El contrato anterior permanece cerrado para conservar el historico. La reactivacion genera un nuevo ciclo de cobertura activo para el cliente.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setReactivateOpen(false);
                setReactivatingContract(null);
              }}
              disabled={reactivateLoading}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleReactivateCoverage}
              disabled={reactivateLoading || !reactivatingContract}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              {reactivateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {reactivateLoading ? "Reactivando..." : "Crear nueva cobertura"}
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
