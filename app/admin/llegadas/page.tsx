"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CalendarDays, Camera, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, Eye, FileDown, FileStack, FileText, MapPin, Pencil, RefreshCw, RotateCcw, Search, Settings2, ShieldAlert, Timer, Trash2, UserRound, XCircle } from "lucide-react";
import { AttendanceDaySummary, AttendanceFortnightlyReport, AttendanceMemo, CompanySettings, User } from "@/lib/types";
import { getUsuarios } from "@/lib/data/services/usuarios";
import { getConfiguracion, updateConfiguracion } from "@/lib/data/services/configuracion";
import { updateLlegada } from "@/lib/data/services/llegadas";
import { AttendanceDayResponse, AttendanceHistoryResponse, AttendanceMemosResponse, createAttendanceFortnightMemos, getAttendanceDay, getAttendanceFortnightly, getAttendanceHistory, getAttendanceMemos, updateAttendanceMemo } from "@/lib/data/services/asistencia";
import { cn } from "@/lib/utils";

type AttendanceRow = AttendanceDayResponse["records"][number];
type AttendanceTab = "dia" | "historial" | "quincena" | "memorandos" | "reglas";
type AttendanceStatus = "a_tiempo" | "tarde" | "no_reportado";
type StatusFilter = "todos" | AttendanceStatus;
type RuleForm = {
  horaInicio: string;
  horaCorte: string;
  minutosNoReportado: string;
  tardanzaPorcentaje: string;
  reposicionPorcentaje: string;
  noReportadoPorcentaje: string;
};

const PAGE_SIZE = 20;
const ALL_USERS = "todos";
const NO_USER = "seleccione";
const DEFAULT_MEMO_TITLE = "Llamado de atención formal por incidencias de asistencia";
const DEFAULT_MEMO_NARRATIVE = "Se deja constancia de las incidencias de asistencia registradas para {trabajador} durante la quincena del {desde} al {hasta}. El detalle cronológico y la evidencia disponible se adjuntan en este documento.";
const EMPTY_COMPANY_SETTINGS: CompanySettings = {
  nombre: "SoluReport", logo: "", correoRemitente: "", correoEmpresa: "", plantillaReportePDF: "",
  porcentajeDescuentoTardanza: 5, porcentajeExtraLider: 0, extraLiderActivo: false,
  costoRevisionLider: 0, costoVisitaTecnicaDefault: 0, costoRecorridoNormal: 0, costoRecorridoHerramienta: 0,
};

function getBogotaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

function monthStart(value: string) { return `${value.slice(0, 7)}-01`; }

function formatDate(value?: string) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "full", timeZone: "America/Bogota" }).format(new Date(`${value}T12:00:00-05:00`));
}

function formatMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "America/Bogota" }).format(new Date(Date.UTC(year, month - 1, 15, 12)));
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateValue(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function shiftDate(value: string, days: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return dateValue(date);
}

function money(value?: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value || 0);
}

function fullName(user?: Pick<User, "nombre" | "apellido"> | null) {
  return [user?.nombre, user?.apellido].filter(Boolean).join(" ");
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase("es-CO").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function useDebouncedValue<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);
  return debounced;
}

function statusMeta(row: AttendanceRow) {
  const percentage = row.porcentajeReglaAplicada ?? row.porcentajeDescuento ?? 0;
  if (row.estadoEntrada === "no_reportado" || row.categoriaLlegada === "no_reportado") {
    return { label: `No reportó · ${percentage}%`, className: "border-red-500/30 bg-red-500/10 text-red-300", icon: XCircle };
  }
  if (row.categoriaLlegada === "reposicion" || row.categoriaLlegada === "tardanza_mayor") {
    return { label: `Fuera del corte · ${percentage}%`, className: "border-orange-500/30 bg-orange-500/10 text-orange-300", icon: ShieldAlert };
  }
  if (row.tarde || row.categoriaLlegada === "tardanza_leve") {
    return { label: `Tarde · ${percentage}%`, className: "border-amber-500/30 bg-amber-500/10 text-amber-300", icon: AlertTriangle };
  }
  return { label: "A tiempo", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: CheckCircle2 };
}

function SummaryCard({ label, value, detail, tone, icon: Icon }: { label: string; value: string | number; detail?: string; tone: string; icon: typeof Clock3 }) {
  return (
    <Card className="border-border/50 bg-card/70 shadow-none">
      <CardContent className="flex items-center gap-3 p-3 sm:p-4">
        <div className={cn("rounded-xl p-2", tone)}><Icon className="h-4 w-4" /></div>
        <div className="min-w-0"><p className="text-lg font-semibold text-foreground">{value}</p><p className="truncate text-xs text-muted-foreground">{label}</p>{detail && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{detail}</p>}</div>
      </CardContent>
    </Card>
  );
}

export default function LlegadasPage() {
  const [activeTab, setActiveTab] = useState<AttendanceTab>("dia");
  const [selectedDate, setSelectedDate] = useState(getBogotaDate());
  const [day, setDay] = useState<AttendanceDayResponse | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [memos, setMemos] = useState<AttendanceMemo[]>([]);
  const [memoTotal, setMemoTotal] = useState(0);
  const [fortnight, setFortnight] = useState<AttendanceFortnightlyReport | null>(null);
  const [fortnightMonth, setFortnightMonth] = useState(getBogotaDate().slice(0, 7));
  const [fortnightHalf, setFortnightHalf] = useState<"primera" | "segunda">("primera");
  const [fortnightSearch, setFortnightSearch] = useState("");
  const [fortnightPage, setFortnightPage] = useState(1);
  const [daySearch, setDaySearch] = useState("");
  const [dayStatus, setDayStatus] = useState<StatusFilter>("todos");
  const [dayPage, setDayPage] = useState(1);
  const [historyFilters, setHistoryFilters] = useState({ userId: NO_USER, start: monthStart(getBogotaDate()), end: getBogotaDate(), search: "", status: "todos" as StatusFilter });
  const [history, setHistory] = useState<AttendanceHistoryResponse | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [memoSearch, setMemoSearch] = useState("");
  const [memoUserId, setMemoUserId] = useState(ALL_USERS);
  const [memoStatus, setMemoStatus] = useState("todos");
  const [memoPage, setMemoPage] = useState(1);
  const [memoRefresh, setMemoRefresh] = useState(0);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [fortnightRefresh, setFortnightRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dayLoading, setDayLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [fortnightLoading, setFortnightLoading] = useState(false);
  const [memosLoading, setMemosLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRow | null>(null);
  const [editingRecord, setEditingRecord] = useState<AttendanceRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus>("no_reportado");
  const [attendanceTime, setAttendanceTime] = useState("");
  const [attendanceReason, setAttendanceReason] = useState("");
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [memoSaving, setMemoSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [bulkMemoOpen, setBulkMemoOpen] = useState(false);
  const [bulkMemoTitle, setBulkMemoTitle] = useState(DEFAULT_MEMO_TITLE);
  const [bulkMemoNarrative, setBulkMemoNarrative] = useState(DEFAULT_MEMO_NARRATIVE);
  const [bulkMemoBasis, setBulkMemoBasis] = useState("");
  const [bulkMemoRegime, setBulkMemoRegime] = useState("");
  const [editingMemo, setEditingMemo] = useState<AttendanceMemo | null>(null);
  const [editMemoTitle, setEditMemoTitle] = useState("");
  const [editMemoNarrative, setEditMemoNarrative] = useState("");
  const [editMemoBasis, setEditMemoBasis] = useState("");
  const [editMemoRegime, setEditMemoRegime] = useState("");
  const [memoEditSaving, setMemoEditSaving] = useState(false);
  const dayRequest = useRef(0);
  const historySearch = useDebouncedValue(historyFilters.search);
  const fortnightSearchDebounced = useDebouncedValue(fortnightSearch);
  const memoSearchDebounced = useDebouncedValue(memoSearch);
  const [ruleForm, setRuleForm] = useState<RuleForm>({ horaInicio: "08:05", horaCorte: "08:30", minutosNoReportado: "30", tardanzaPorcentaje: "5", reposicionPorcentaje: "0", noReportadoPorcentaje: "30" });

  const eligibleUsers = useMemo(() => users.filter((user) => user.rol !== "admin"), [users]);

  const syncSettings = useCallback((value: CompanySettings) => {
    setSettings(value);
    setRuleForm({
      horaInicio: value.horaInicioDescuentoTardanza || "08:05",
      horaCorte: value.horaDescuentoAutomatico || "08:30",
      minutosNoReportado: String(value.minutosNoReportado ?? 30),
      tardanzaPorcentaje: String(value.porcentajeDescuentoTardanza ?? 5),
      reposicionPorcentaje: String(value.porcentajeDescuentoReposicion ?? 0),
      noReportadoPorcentaje: String(value.porcentajeDescuentoNoReportado ?? 30),
    });
  }, []);

  const loadDay = useCallback(async (date: string) => {
    const requestId = ++dayRequest.current;
    setDayLoading(true);
    setError("");
    try {
      const result = await getAttendanceDay(date, { limit: 2000, offset: 0 });
      if (requestId === dayRequest.current) setDay(result);
    } catch (err) {
      if (requestId === dayRequest.current) setError(err instanceof Error ? err.message : "No se pudo cargar la asistencia.");
    } finally {
      if (requestId === dayRequest.current) setDayLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getUsuarios(), getConfiguracion()])
      .then(([loadedUsers, loadedSettings]) => {
        if (!active) return;
        setUsers(loadedUsers);
        syncSettings(loadedSettings);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "No se pudo cargar la configuración de asistencia."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [syncSettings]);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => { if (active) void loadDay(selectedDate); }, 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [loadDay, selectedDate]);

  useEffect(() => {
    if (activeTab !== "historial" || historyFilters.userId === NO_USER) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      if (!active) return;
      setHistory(null);
      setHistoryLoading(true);
      getAttendanceHistory(historyFilters.start, historyFilters.end, {
        usuarioId: historyFilters.userId,
        search: historySearch.trim() || undefined,
        estado: historyFilters.status,
        page: historyPage,
        pageSize: PAGE_SIZE,
      }).then((result) => { if (active) setHistory(result); })
        .catch((err) => { if (active) setError(err instanceof Error ? err.message : "No se pudo cargar el historial."); })
        .finally(() => { if (active) setHistoryLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [activeTab, historyFilters.start, historyFilters.end, historyFilters.userId, historyFilters.status, historyPage, historySearch, historyRefresh]);

  useEffect(() => {
    if (activeTab !== "quincena") return;
    let active = true;
    const timeout = window.setTimeout(() => {
      if (!active) return;
      setFortnightLoading(true);
      getAttendanceFortnightly(fortnightMonth, fortnightHalf, {
        search: fortnightSearchDebounced.trim() || undefined,
      }).then((result) => { if (active) setFortnight(result); })
        .catch((err) => { if (active) setError(err instanceof Error ? err.message : "No se pudo cargar la quincena."); })
        .finally(() => { if (active) setFortnightLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [activeTab, fortnightMonth, fortnightHalf, fortnightSearchDebounced, fortnightRefresh]);

  const loadMemos = useCallback(async () => {
    setMemosLoading(true);
    try {
      const result: AttendanceMemosResponse = await getAttendanceMemos({
        usuarioId: memoUserId === ALL_USERS ? undefined : memoUserId,
        search: memoSearchDebounced.trim() || undefined,
        estado: memoStatus,
        page: memoPage,
        pageSize: PAGE_SIZE,
      });
      setMemos(result.items);
      setMemoTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los memorandos.");
    } finally {
      setMemosLoading(false);
    }
  }, [memoPage, memoSearchDebounced, memoStatus, memoUserId]);

  useEffect(() => {
    if (activeTab !== "memorandos") return;
    let active = true;
    const timeout = window.setTimeout(() => { if (active) void loadMemos(); }, 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [activeTab, loadMemos, memoRefresh]);

  const filteredDayRows = useMemo(() => {
    const query = daySearch.trim().toLocaleLowerCase("es-CO");
    return (day?.records || []).filter((row) => {
      const searchable = `${row.usuarioNombre || ""} ${row.razonTardanza || ""}`.toLocaleLowerCase("es-CO");
      const searchMatches = !query || searchable.includes(query);
      const statusMatches = dayStatus === "todos"
        || (dayStatus === "no_reportado" && row.estadoEntrada === "no_reportado")
        || (dayStatus === "tarde" && row.estadoEntrada === "tarde")
        || (dayStatus === "a_tiempo" && row.estadoEntrada === "a_tiempo");
      return searchMatches && statusMatches;
    });
  }, [day?.records, daySearch, dayStatus]);

  const defaultCompany = settings || EMPTY_COMPANY_SETTINGS;
  const summary: AttendanceDaySummary = day?.summary || { fecha: selectedDate, total: 0, reportados: 0, aTiempo: 0, tardanzas: 0, reposiciones: 0, noReportados: 0, minutosAdeudados: 0, descuentoTotal: 0 };

  const openEdit = (row: AttendanceRow) => {
    setSelectedRecord(null);
    setEditingRecord(row);
    setAttendanceStatus(row.estadoEntrada || "no_reportado");
    setAttendanceTime(row.horaLlegada || "");
    setAttendanceReason(row.razonTardanza || "");
    setEditOpen(true);
  };

  const closeEdit = (open: boolean) => {
    setEditOpen(open);
    if (!open) setEditingRecord(null);
  };

  const refresh = async () => {
    if (activeTab === "dia") await loadDay(selectedDate);
    if (activeTab === "historial") setHistoryRefresh((value) => value + 1);
    if (activeTab === "quincena") setFortnightRefresh((value) => value + 1);
    if (activeTab === "memorandos") setMemoRefresh((value) => value + 1);
  };

  const saveEdit = async () => {
    if (!editingRecord) return;
    setAttendanceSaving(true);
    try {
      await updateLlegada(editingRecord.id, {
        estadoEntrada: attendanceStatus,
        horaLlegada: attendanceStatus === "no_reportado" ? null : attendanceTime || null,
        razonTardanza: attendanceReason.trim() || (attendanceStatus === "no_reportado" ? "No registró la entrada." : null),
      });
      closeEdit(false);
      setSelectedRecord(null);
      await loadDay(selectedDate);
      setHistoryRefresh((value) => value + 1);
      setFortnightRefresh((value) => value + 1);
      setMemoRefresh((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la asistencia.");
    } finally {
      setAttendanceSaving(false);
    }
  };

  const createFortnightMemos = async () => {
    setMemoSaving(true);
    try {
      const result = await createAttendanceFortnightMemos({
        mes: fortnightMonth,
        quincena: fortnightHalf,
        titulo: bulkMemoTitle,
        narrativa: bulkMemoNarrative,
        fundamento: bulkMemoBasis,
        regimenSancionatorio: bulkMemoRegime,
      });
      setBulkMemoOpen(false);
      setMemoPage(1);
      setMemoStatus("todos");
      setMemoUserId(ALL_USERS);
      setMemoSearch("");
      setMemoRefresh((value) => value + 1);
      setActiveTab("memorandos");
      setNotice(`Quincena procesada: ${result.creados} memorandos nuevos, ${result.actualizados} completados con incidencias nuevas y ${result.existentes} ya existentes.`);
      if (result.memorandos.length) {
        try {
          const { generateAttendanceMemosFortnightlyPDF } = await import("@/lib/utils/attendance-pdf");
          await generateAttendanceMemosFortnightlyPDF({
            memos: result.memorandos,
            users: eligibleUsers,
            company: defaultCompany,
            fechaInicio: result.fechaInicio,
            fechaFin: result.fechaFin,
          });
          setNotice((current) => `${current} Se descargó un PDF consolidado con ${result.memorandos.length} memorandos.`);
        } catch (err) {
          setError(err instanceof Error ? `Los memorandos quedaron guardados, pero no se pudo descargar el PDF consolidado: ${err.message}` : "Los memorandos quedaron guardados, pero falló la descarga del PDF consolidado.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron generar los memorandos de la quincena.");
    } finally {
      setMemoSaving(false);
    }
  };

  const openMemoEdit = (memo: AttendanceMemo) => {
    setEditingMemo(memo);
    setEditMemoTitle(memo.titulo);
    setEditMemoNarrative(memo.narrativa || "");
    setEditMemoBasis(memo.fundamento || "");
    setEditMemoRegime(memo.regimenSancionatorio || "");
  };

  const saveMemoEdit = async () => {
    if (!editingMemo) return;
    setMemoEditSaving(true);
    try {
      await updateAttendanceMemo({
        id: editingMemo.id,
        action: "editar",
        titulo: editMemoTitle,
        narrativa: editMemoNarrative,
        fundamento: editMemoBasis,
        regimenSancionatorio: editMemoRegime,
      });
      setEditingMemo(null);
      setMemoRefresh((value) => value + 1);
      setNotice("Memorando actualizado. El PDF descargado reflejará estos cambios.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el memorando.");
    } finally {
      setMemoEditSaving(false);
    }
  };

  const runMemoAction = async (memo: AttendanceMemo, action: "firmar" | "anular" | "desanular" | "eliminar" | "restaurar") => {
    const prompts: Partial<Record<typeof action, string>> = {
      anular: `¿Anular el memorando ${memo.numero}? Podrás desanularlo después.`,
      eliminar: `¿Mover ${memo.numero} a eliminados? Es una eliminación reversible.`,
    };
    if (prompts[action] && !window.confirm(prompts[action])) return;
    try {
      await updateAttendanceMemo({ id: memo.id, action });
      setMemoRefresh((value) => value + 1);
      setNotice(action === "eliminar" ? "Memorando movido a eliminados. Puedes restaurarlo desde ese filtro." : "Estado del memorando actualizado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el memorando.");
    }
  };

  const downloadMemo = async (memo: AttendanceMemo) => {
    const user = users.find((item) => item.id === memo.usuarioId);
    const { generateAttendanceMemoPDF } = await import("@/lib/utils/attendance-pdf");
    await generateAttendanceMemoPDF({ memo, user, company: defaultCompany });
  };

  const saveRules = async () => {
    setSettingsSaving(true);
    try {
      const updated = await updateConfiguracion({
        horaInicioDescuentoTardanza: ruleForm.horaInicio,
        horaDescuentoAutomatico: ruleForm.horaCorte,
        minutosNoReportado: Math.max(0, Number(ruleForm.minutosNoReportado) || 0),
        porcentajeDescuentoTardanza: Math.min(100, Math.max(0, Number(ruleForm.tardanzaPorcentaje) || 0)),
        porcentajeDescuentoReposicion: Math.min(100, Math.max(0, Number(ruleForm.reposicionPorcentaje) || 0)),
        porcentajeDescuentoNoReportado: Math.min(100, Math.max(0, Number(ruleForm.noReportadoPorcentaje) || 0)),
        fundamentoAsistencia: "",
        regimenSancionatorioAsistencia: "",
      });
      syncSettings(updated);
      setDay(null);
      await loadDay(selectedDate);
      setHistoryRefresh((value) => value + 1);
      setFortnightRefresh((value) => value + 1);
      setNotice("Reglas guardadas. Se recalcularon asistencia y liquidaciones de periodos abiertos; los periodos cerrados permanecen congelados.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la configuración.");
    } finally {
      setSettingsSaving(false);
    }
  };

  if (loading) return <div><AdminHeader title="Registro de Asistencia" /><AdminPageLoader title="Cargando asistencia" message="Estamos preparando la jornada y sus reglas de liquidación." showStats={false} rows={7} /></div>;

  return (
    <div>
      <AdminHeader title="Registro de Asistencia" />
      <main className="min-w-0 space-y-5 p-4 sm:p-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div><p className="text-sm text-muted-foreground">Control operativo y evidencia para liquidación</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Asistencia</h2></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={dayLoading || historyLoading || fortnightLoading || memosLoading}>
              <RefreshCw className={cn("h-4 w-4", (dayLoading || historyLoading || fortnightLoading || memosLoading) && "animate-spin")} />Actualizar
            </Button>
            {activeTab === "quincena" && fortnight && <>
              <Button variant="outline" size="sm" onClick={() => setBulkMemoOpen(true)} disabled={fortnightLoading || memoSaving}>
                <FileStack className="h-4 w-4" />Generar memorandos de la quincena
              </Button>
              <Button size="sm" onClick={async () => {
                try {
                  const [allReport, { generateAttendanceFortnightlyPDF }] = await Promise.all([
                    getAttendanceFortnightly(fortnightMonth, fortnightHalf),
                    import("@/lib/utils/attendance-pdf"),
                  ]);
                  generateAttendanceFortnightlyPDF({ report: allReport, company: defaultCompany });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "No se pudo generar el informe quincenal.");
                }
              }}><Download className="h-4 w-4" />Descargar informe oficial</Button>
            </>}
          </div>
        </div>

        {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"><span>{error}</span><Button variant="ghost" size="sm" onClick={() => setError("")}>Cerrar</Button></div>}
        {notice && <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"><span>{notice}</span><Button variant="ghost" size="sm" onClick={() => setNotice("")}>Cerrar</Button></div>}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AttendanceTab)}>
          <TabsList className="w-full justify-start overflow-x-auto bg-card/70 p-1 sm:w-fit">
            <TabsTrigger value="dia"><Clock3 className="h-4 w-4" />Día actual</TabsTrigger>
            <TabsTrigger value="historial"><CalendarDays className="h-4 w-4" />Historial</TabsTrigger>
            <TabsTrigger value="quincena"><FileDown className="h-4 w-4" />Quincena</TabsTrigger>
            <TabsTrigger value="memorandos"><FileText className="h-4 w-4" />Memorandos</TabsTrigger>
            <TabsTrigger value="reglas"><Settings2 className="h-4 w-4" />Reglas</TabsTrigger>
          </TabsList>

          <TabsContent value="dia" className="space-y-4">
            <DayToolbar date={selectedDate} setDate={(value) => { setSelectedDate(value); setDayPage(1); }} search={daySearch} setSearch={(value) => { setDaySearch(value); setDayPage(1); }} status={dayStatus} setStatus={(value) => { setDayStatus(value); setDayPage(1); }} />
            <SummaryGrid summary={summary} />
            <AttendanceTable title="Asistencia del día" subtitle={`Jornada del ${formatLongDate(selectedDate)}`} rows={filteredDayRows} loading={dayLoading} page={dayPage} onPageChange={setDayPage} total={filteredDayRows.length} onSelect={setSelectedRecord} onEdit={openEdit} />
          </TabsContent>

          <TabsContent value="historial" className="space-y-4">
            <HistoryToolbar filters={historyFilters} users={eligibleUsers} onChange={(patch) => { if (patch.userId !== undefined) setHistory(null); setHistoryFilters((current) => ({ ...current, ...patch })); setHistoryPage(1); }} />
            {historyFilters.userId === NO_USER ? (
              <EmptyPanel icon={UserRound} title="Busca un trabajador" description="Escribe al menos dos letras para encontrar a una persona. Su historial aparecerá como tarjetas detalladas." />
            ) : (
              <AttendanceHistoryCards title={`Historial · ${fullName(eligibleUsers.find((user) => user.id === historyFilters.userId)) || "Trabajador"}`} subtitle={`${formatDate(historyFilters.start)} al ${formatDate(historyFilters.end)} · consulta individual`} rows={history?.records || []} summary={history?.summary} loading={historyLoading} page={historyPage} onPageChange={setHistoryPage} total={history?.total || 0} onEdit={openEdit} onSelect={setSelectedRecord} />
            )}
          </TabsContent>

          <TabsContent value="quincena" className="space-y-4">
            <div className="grid gap-3 rounded-xl border border-border/50 bg-card/60 p-3 sm:grid-cols-2 xl:grid-cols-4 xl:items-end">
              <MonthPicker value={fortnightMonth} onChange={(value) => { setFortnightMonth(value); setFortnightPage(1); }} />
              <div><Label>Periodo</Label><Select value={fortnightHalf} onValueChange={(value) => { setFortnightHalf(value as "primera" | "segunda"); setFortnightPage(1); }}><SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="primera">1 al 15</SelectItem><SelectItem value="segunda">16 al cierre</SelectItem></SelectContent></Select></div>
              <SearchField label="Buscar trabajador en la quincena" value={fortnightSearch} onChange={(value) => { setFortnightSearch(value); setFortnightPage(1); }} placeholder="Escribe un nombre..." />
            </div>
            <FortnightView report={fortnight} loading={fortnightLoading} page={fortnightPage} onPageChange={setFortnightPage} />
          </TabsContent>

          <TabsContent value="memorandos" className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><h3 className="font-semibold">Memorandos</h3><p className="text-sm text-muted-foreground">Consulta, descarga y controla la firma de cada documento.</p></div>
              <Badge variant="outline">{memoTotal} documentos</Badge>
            </div>
            <div className="grid gap-3 rounded-xl border border-border/50 bg-card/60 p-3 sm:grid-cols-3">
              <WorkerPicker label="Filtrar trabajador" users={eligibleUsers} value={memoUserId} onChange={(value) => { setMemoUserId(value); setMemoPage(1); }} clearValue={ALL_USERS} />
              <SearchField label="Buscar memorando" value={memoSearch} onChange={(value) => { setMemoSearch(value); setMemoPage(1); }} placeholder="Nombre, número o motivo..." />
              <div><Label>Estado</Label><Select value={memoStatus} onValueChange={(value) => { setMemoStatus(value); setMemoPage(1); }}><SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos excepto eliminados</SelectItem><SelectItem value="generado">Generado</SelectItem><SelectItem value="firmado">Firmado</SelectItem><SelectItem value="anulado">Anulado</SelectItem><SelectItem value="eliminados">Eliminados</SelectItem></SelectContent></Select></div>
            </div>
            <MemoList memos={memos} loading={memosLoading} total={memoTotal} page={memoPage} onPageChange={setMemoPage} onDownload={downloadMemo} onEdit={openMemoEdit} onUpdate={runMemoAction} />
          </TabsContent>

          <TabsContent value="reglas" className="space-y-4">
            <RulesPanel form={ruleForm} setForm={setRuleForm} saving={settingsSaving} onSave={saveRules} />
          </TabsContent>
        </Tabs>
      </main>

      <Sheet open={Boolean(selectedRecord)} onOpenChange={(open) => !open && setSelectedRecord(null)}>
        <SheetContent className="w-full overflow-y-auto border-border bg-card sm:max-w-xl">
          <SheetHeader><SheetTitle>Detalle de asistencia</SheetTitle><SheetDescription>{selectedRecord?.usuarioNombre || "Trabajador"} · {formatDate(selectedRecord?.fecha)}</SheetDescription></SheetHeader>
          {selectedRecord && <RecordDetail row={selectedRecord} onEdit={() => openEdit(selectedRecord)} />}
        </SheetContent>
      </Sheet>

      <Dialog open={editOpen} onOpenChange={closeEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajustar registro de asistencia</DialogTitle><p className="text-sm text-muted-foreground">{editingRecord?.usuarioNombre} · {formatDate(editingRecord?.fecha)}</p></DialogHeader>
          <div className="space-y-4">
            <div><Label>Estado</Label><Select value={attendanceStatus} onValueChange={(value) => setAttendanceStatus(value as AttendanceStatus)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a_tiempo">A tiempo</SelectItem><SelectItem value="tarde">Tarde</SelectItem><SelectItem value="no_reportado">No reportó</SelectItem></SelectContent></Select></div>
            <div><Label>Hora de llegada</Label><Input className="mt-1" type="time" value={attendanceTime} onChange={(event) => setAttendanceTime(event.target.value)} disabled={attendanceStatus === "no_reportado"} /></div>
            <div><Label>Motivo / observación</Label><Textarea className="mt-1" value={attendanceReason} onChange={(event) => setAttendanceReason(event.target.value)} placeholder="Deja trazabilidad del ajuste..." /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => closeEdit(false)}>Cancelar</Button><Button onClick={saveEdit} disabled={attendanceSaving || !editingRecord}>{attendanceSaving ? "Guardando..." : "Guardar y recalcular"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkMemoOpen} onOpenChange={setBulkMemoOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generar memorandos de la quincena</DialogTitle>
            <p className="text-sm text-muted-foreground">Se prepara un documento por trabajador con todas sus incidencias de {fortnight ? `${formatDate(fortnight.fechaInicio)} al ${formatDate(fortnight.fechaFin)}` : "la quincena seleccionada"}. Los documentos existentes no se duplican.</p>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs text-muted-foreground">Variables disponibles: <code>{"{trabajador}"}</code>, <code>{"{desde}"}</code>, <code>{"{hasta}"}</code>, <code>{"{eventos}"}</code> y <code>{"{minutos}"}</code>. Los campos jurídicos son opcionales y se incluyen solo si los escribes.</div>
            <div><Label>Título del documento</Label><Input className="mt-1" value={bulkMemoTitle} onChange={(event) => setBulkMemoTitle(event.target.value)} /></div>
            <div><Label>Descripción / texto principal</Label><Textarea className="mt-1 min-h-28" value={bulkMemoNarrative} onChange={(event) => setBulkMemoNarrative(event.target.value)} /></div>
            <div><Label>Fundamento jurídico (opcional)</Label><Textarea className="mt-1 min-h-20" value={bulkMemoBasis} onChange={(event) => setBulkMemoBasis(event.target.value)} placeholder="Déjalo vacío si no deseas incluir esta sección." /></div>
            <div><Label>Régimen o medidas informadas (opcional)</Label><Textarea className="mt-1 min-h-20" value={bulkMemoRegime} onChange={(event) => setBulkMemoRegime(event.target.value)} placeholder="Texto revisado por la empresa, si aplica." /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setBulkMemoOpen(false)}>Cancelar</Button><Button onClick={createFortnightMemos} disabled={memoSaving || !bulkMemoTitle.trim() || !bulkMemoNarrative.trim()}><FileStack className="h-4 w-4" />{memoSaving ? "Generando lote..." : "Generar todos"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingMemo)} onOpenChange={(open) => !open && setEditingMemo(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Editar memorando</DialogTitle><p className="text-sm text-muted-foreground">{editingMemo?.numero} · {editingMemo?.usuarioNombre}</p></DialogHeader>
          <div className="space-y-4">
            <div><Label>Título</Label><Input className="mt-1" value={editMemoTitle} onChange={(event) => setEditMemoTitle(event.target.value)} /></div>
            <div><Label>Descripción / texto principal</Label><Textarea className="mt-1 min-h-28" value={editMemoNarrative} onChange={(event) => setEditMemoNarrative(event.target.value)} /></div>
            <div><Label>Fundamento jurídico (opcional)</Label><Textarea className="mt-1 min-h-20" value={editMemoBasis} onChange={(event) => setEditMemoBasis(event.target.value)} /></div>
            <div><Label>Régimen o medidas informadas (opcional)</Label><Textarea className="mt-1 min-h-20" value={editMemoRegime} onChange={(event) => setEditMemoRegime(event.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditingMemo(null)}>Cancelar</Button><Button onClick={saveMemoEdit} disabled={memoEditSaving || !editMemoTitle.trim()}>{memoEditSaving ? "Guardando..." : "Guardar cambios"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DatePicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0"><Label>{label}</Label><Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="outline" className="mt-1 w-full justify-start gap-2 font-normal"><CalendarDays className="h-4 w-4 shrink-0 text-gold" /><span>{formatDate(value)}</span></Button></PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0"><Calendar mode="single" selected={parseDate(value)} onSelect={(date) => { if (date) onChange(dateValue(date)); setOpen(false); }} /></PopoverContent>
    </Popover></div>
  );
}

function MonthPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0"><Label>Mes</Label><Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="outline" className="mt-1 w-full justify-start gap-2 font-normal"><CalendarDays className="h-4 w-4 shrink-0 text-gold" /><span className="capitalize">{formatMonth(value)}</span></Button></PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2"><p className="px-2 pt-1 text-xs text-muted-foreground">Selecciona cualquier día del mes que quieres consultar.</p><Calendar mode="single" defaultMonth={parseDate(`${value}-01`)} selected={parseDate(`${value}-01`)} onSelect={(date) => { if (date) onChange(dateValue(date).slice(0, 7)); setOpen(false); }} /></PopoverContent>
    </Popover></div>
  );
}

function WorkerPicker({ label, users, value, onChange, clearValue }: { label: string; users: User[]; value: string; onChange: (value: string) => void; clearValue: string }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = value !== clearValue && value !== NO_USER ? users.find((user) => user.id === value) : undefined;
  const matches = useMemo(() => {
    const normalized = normalizeSearch(query.trim());
    if (normalized.length < 2) return [];
    return users
      .filter((user) => normalizeSearch(fullName(user)).includes(normalized) || normalizeSearch(user.email || "").includes(normalized))
      .slice(0, 8);
  }, [query, users]);

  return <div className="relative min-w-0">
    <Label>{label}</Label>
    {selected ? (
      <div className="mt-1 flex h-10 items-center gap-2 rounded-md border border-border bg-background/60 px-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold/10 text-[10px] font-semibold text-gold">{(fullName(selected) || "?").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{fullName(selected) || selected.email}</span>
        <button type="button" aria-label="Cambiar trabajador" title="Cambiar trabajador" onClick={() => { onChange(clearValue); setQuery(""); setOpen(false); }} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><XCircle className="h-4 w-4" /></button>
      </div>
    ) : (
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} placeholder="Busca por nombre..." className="pl-9" />
        {open && query.trim().length >= 2 && <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
          {matches.length ? matches.map((user) => <button key={user.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(user.id); setQuery(""); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/10 text-[10px] font-semibold text-gold">{(fullName(user) || "?").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span className="min-w-0"><span className="block truncate font-medium">{fullName(user) || user.email}</span><span className="block text-xs capitalize text-muted-foreground">{user.rol}</span></span>
          </button>) : <p className="px-3 py-2 text-sm text-muted-foreground">No encontramos coincidencias.</p>}
        </div>}
      </div>
    )}
    <p className="mt-1 text-[11px] text-muted-foreground">Escribe al menos dos letras; no se despliega toda la lista.</p>
  </div>;
}

function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="min-w-0"><Label>{label}</Label><div className="relative mt-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="pl-9" /></div></div>;
}

function DayToolbar({ date, setDate, search, setSearch, status, setStatus }: { date: string; setDate: (value: string) => void; search: string; setSearch: (value: string) => void; status: StatusFilter; setStatus: (value: StatusFilter) => void }) {
  return <div className="grid gap-3 rounded-xl border border-border/50 bg-card/60 p-3 lg:grid-cols-[auto_190px_minmax(220px,1fr)_170px] lg:items-end">
    <div className="flex items-center justify-between gap-1 rounded-lg border border-border/40 px-1 py-0.5 lg:min-w-[270px]"><Button variant="ghost" size="icon-sm" aria-label="Día anterior" onClick={() => setDate(shiftDate(date, -1))}><ChevronLeft className="h-4 w-4" /></Button><div className="min-w-0 text-center"><p className="truncate text-sm font-medium capitalize">{formatLongDate(date)}</p><p className="text-[11px] text-muted-foreground">{date === getBogotaDate() ? "Jornada actual" : "Consulta histórica"}</p></div><Button variant="ghost" size="icon-sm" aria-label="Día siguiente" onClick={() => setDate(shiftDate(date, 1))}><ChevronRight className="h-4 w-4" /></Button></div>
    <DatePicker label="Fecha" value={date} onChange={setDate} />
    <SearchField label="Buscar trabajador" value={search} onChange={setSearch} placeholder="Nombre u observación..." />
    <div><Label>Estado</Label><Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}><SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="a_tiempo">A tiempo</SelectItem><SelectItem value="tarde">Tarde</SelectItem><SelectItem value="no_reportado">No reportó</SelectItem></SelectContent></Select></div>
  </div>;
}

function HistoryToolbar({ filters, users, onChange }: { filters: { userId: string; start: string; end: string; search: string; status: StatusFilter }; users: User[]; onChange: (patch: Partial<typeof filters>) => void }) {
  return <div className="grid gap-3 rounded-xl border border-border/50 bg-card/60 p-3 sm:grid-cols-2 xl:grid-cols-5 xl:items-end">
    <WorkerPicker label="Trabajador" users={users} value={filters.userId} onChange={(userId) => onChange({ userId })} clearValue={NO_USER} />
    <DatePicker label="Desde" value={filters.start} onChange={(start) => onChange({ start })} />
    <DatePicker label="Hasta" value={filters.end} onChange={(end) => onChange({ end })} />
    <SearchField label="Buscar en sus registros" value={filters.search} onChange={(search) => onChange({ search })} placeholder="Observación..." />
    <div><Label>Estado</Label><Select value={filters.status} onValueChange={(status) => onChange({ status: status as StatusFilter })}><SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="a_tiempo">A tiempo</SelectItem><SelectItem value="tarde">Tarde</SelectItem><SelectItem value="no_reportado">No reportó</SelectItem></SelectContent></Select></div>
  </div>;
}

function SummaryGrid({ summary }: { summary: AttendanceDaySummary }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
    <SummaryCard label="Trabajadores" value={summary.total} tone="bg-slate-500/10 text-slate-300" icon={UserRound} />
    <SummaryCard label="Reportaron" value={summary.reportados} tone="bg-sky-500/10 text-sky-300" icon={CheckCircle2} />
    <SummaryCard label="A tiempo" value={summary.aTiempo} tone="bg-emerald-500/10 text-emerald-300" icon={CheckCircle2} />
    <SummaryCard label="Tarde / fuera del corte" value={summary.tardanzas + summary.reposiciones} tone="bg-amber-500/10 text-amber-300" icon={AlertTriangle} />
    <SummaryCard label="No reportaron" value={summary.noReportados} detail={`${summary.descuentoTotal}% descuento acumulado`} tone="bg-red-500/10 text-red-300" icon={Timer} />
  </div>;
}

function Pagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  return <div className="flex flex-col gap-2 border-t border-border/40 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
    <span>{first}–{last} de {total}</span>
    <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}><ChevronLeft className="h-4 w-4" />Anterior</Button><span>Página {page} de {pages}</span><Button variant="outline" size="sm" onClick={() => onPageChange(Math.min(pages, page + 1))} disabled={page >= pages}>Siguiente<ChevronRight className="h-4 w-4" /></Button></div>
  </div>;
}

function AttendanceHistoryCards({ title, subtitle, rows, summary, loading, page, onPageChange, total, onEdit, onSelect }: {
  title: string;
  subtitle: string;
  rows: AttendanceRow[];
  summary?: AttendanceHistoryResponse["summary"];
  loading: boolean;
  page: number;
  onPageChange: (page: number) => void;
  total: number;
  onEdit: (row: AttendanceRow) => void;
  onSelect: (row: AttendanceRow) => void;
}) {
  const visibleRows = rows;
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <SummaryCard label="Registros del periodo" value={summary?.total || 0} tone="bg-slate-500/10 text-slate-300" icon={CalendarDays} />
      <SummaryCard label="Tarde / fuera del corte" value={(summary?.tardanzas || 0) + (summary?.reposiciones || 0)} tone="bg-amber-500/10 text-amber-300" icon={AlertTriangle} />
      <SummaryCard label="No reportó" value={summary?.noReportados || 0} tone="bg-red-500/10 text-red-300" icon={XCircle} />
      <SummaryCard label="Minutos adeudados" value={summary?.minutosAdeudados || 0} tone="bg-gold/10 text-gold" icon={Timer} />
    </div>
    <div className="flex items-end justify-between gap-3"><div><h3 className="font-semibold">{title}</h3><p className="text-xs text-muted-foreground">{subtitle} · cada tarjeta muestra evidencia, horario, regla y efecto en liquidación.</p></div><Badge variant="outline">{total} registros</Badge></div>
    {loading && rows.length === 0 ? <EmptyPanel icon={CalendarDays} title="Cargando historial" description="Consultando los registros de esta persona." /> : total === 0 ? <EmptyPanel icon={CalendarDays} title="No hay registros para estas fechas" description="Amplía el rango o limpia los filtros de estado y búsqueda." /> : <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")}>
      {visibleRows.map((row) => {
        const meta = statusMeta(row);
        const Icon = meta.icon;
        return <Card key={row.id} className="overflow-hidden border-border/50 bg-card/70 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/40 px-4 py-3 sm:px-5">
            <div className="min-w-0"><CardTitle className="text-sm capitalize">{formatLongDate(row.fecha)}</CardTitle><p className="mt-0.5 text-xs text-muted-foreground">Jornada de {row.usuarioNombre || "trabajador"}</p></div>
            <div className="flex shrink-0 items-center gap-2"><Badge variant="outline" className={meta.className}><Icon className="h-3 w-3" />{meta.label}</Badge><Button variant="ghost" size="icon-sm" title="Ver detalle" aria-label="Ver detalle" onClick={() => onSelect(row)}><Eye className="h-4 w-4" /></Button><Button variant="ghost" size="icon-sm" title="Editar asistencia" aria-label="Editar asistencia" onClick={() => onEdit(row)}><Pencil className="h-4 w-4" /></Button></div>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_220px] sm:p-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Detail label="Hora programada" value={row.horaEsperada || "—"} />
              <Detail label="Hora reportada" value={row.horaLlegada || "No reportó"} />
              <Detail label="Minutos de retraso" value={`${row.minutosRetraso || 0} min`} />
              <Detail label="Minutos adeudados" value={`${row.minutosAdeudados ?? row.minutosRetraso ?? 0} min`} />
              <Detail label="Regla aplicada" value={`${row.porcentajeReglaAplicada ?? row.porcentajeDescuento ?? 0}% · ${(row.categoriaLlegada || "—").replaceAll("_", " ")}`} />
              <Detail label="Liquidación quincenal" value={`${row.liquidacionPorcentaje || 0}% · ${money(row.liquidacionValor)}`} />
              <Detail label="Periodo" value={row.periodoFechaInicio && row.periodoFechaFin ? `${formatDate(row.periodoFechaInicio)} – ${formatDate(row.periodoFechaFin)}` : "Sin periodo"} />
              {row.horaSalidaProgramada && <Detail label="Salida programada" value={row.horaSalidaProgramada} />}
              {row.horaSalidaReal && <Detail label="Salida reportada" value={row.horaSalidaReal} />}
            </div>
            <div className="space-y-2">
              {row.fotoLlegadaUrl ? <button type="button" onClick={() => onSelect(row)} className="block w-full overflow-hidden rounded-lg border border-border/50 bg-background/40 text-left"><img src={row.fotoLlegadaUrl} alt={`Evidencia de llegada ${formatDate(row.fecha)}`} className="h-40 w-full object-cover" /><span className="block border-t border-border/50 p-2 text-xs text-muted-foreground"><Camera className="mr-1 inline h-3 w-3" />Abrir evidencia</span></button> : <div className="flex h-40 flex-col items-center justify-center rounded-lg border border-dashed border-border/60 text-sm text-muted-foreground"><Camera className="mb-2 h-5 w-5" />Sin fotografía</div>}
              {row.razonTardanza && <p className="rounded-lg bg-background/40 p-3 text-xs text-muted-foreground">{row.razonTardanza}</p>}
              {row.ubicacionLlegadaDireccion && <p className="rounded-lg bg-background/40 p-3 text-xs text-muted-foreground"><MapPin className="mr-1 inline h-3 w-3 text-sky-300" />{row.ubicacionLlegadaDireccion}</p>}
            </div>
          </CardContent>
        </Card>;
      })}
      <Card className="overflow-hidden border-border/50 bg-card/70 shadow-none"><Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={onPageChange} /></Card>
    </div>}
  </div>;
}

function AttendanceTable({ title, subtitle, rows, loading, page, onPageChange, total, onSelect, onEdit }: { title: string; subtitle: string; rows: AttendanceRow[]; loading: boolean; page: number; onPageChange: (page: number) => void; total: number; onSelect: (row: AttendanceRow) => void; onEdit: (row: AttendanceRow) => void }) {
  const visibleRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [page, rows]);
  useEffect(() => { if (!loading && total > 0 && page > Math.ceil(total / PAGE_SIZE)) onPageChange(Math.max(1, Math.ceil(total / PAGE_SIZE))); }, [loading, onPageChange, page, total]);
  return <Card className="overflow-hidden border-border/50 bg-card/70 shadow-none">
    <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/40 px-4 py-3 sm:px-5"><div><CardTitle className="text-base">{title}</CardTitle><p className="text-xs text-muted-foreground">{subtitle}</p></div><Badge variant="outline">{total} {total === 1 ? "registro" : "registros"}</Badge></CardHeader>
    <CardContent className="p-0">
      {loading && rows.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Cargando registros...</div> : total === 0 ? <div className="p-10 text-center"><CalendarDays className="mx-auto h-7 w-7 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">No hay registros para estos filtros</p><p className="mt-1 text-xs text-muted-foreground">Cambia la fecha o limpia la búsqueda.</p></div> : <>
        <div className={cn("overflow-x-auto transition-opacity", loading && "opacity-60")}><Table><TableHeader><TableRow><TableHead>Trabajador</TableHead><TableHead>Programada</TableHead><TableHead>Llegada</TableHead><TableHead>Estado</TableHead><TableHead>Minutos</TableHead><TableHead>Descuento</TableHead><TableHead>Liquidación</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
          <TableBody>{visibleRows.map((row) => { const meta = statusMeta(row); const Icon = meta.icon; return <TableRow key={row.id}>
            <TableCell><button type="button" onClick={() => onSelect(row)} className="flex items-center gap-2 text-left"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/10 text-xs font-semibold text-gold">{(row.usuarioNombre || "?").split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span className="min-w-0"><span className="block truncate font-medium hover:text-gold">{row.usuarioNombre || row.usuarioId}</span><span className="block max-w-48 truncate text-xs text-muted-foreground">{formatDate(row.fecha)}</span></span></button></TableCell>
            <TableCell className="text-muted-foreground">{row.horaEsperada || "—"}</TableCell><TableCell className="font-medium">{row.horaLlegada || "—"}{row.fotoLlegadaUrl && <Camera className="ml-1 inline h-3 w-3 text-sky-300" />}</TableCell>
            <TableCell><Badge variant="outline" className={meta.className}><Icon className="h-3 w-3" />{meta.label}</Badge></TableCell><TableCell>{row.minutosAdeudados || row.minutosRetraso || 0} min</TableCell>
            <TableCell className={cn("font-medium", row.porcentajeDescuento > 0 ? "text-amber-300" : "text-muted-foreground")}>{row.porcentajeDescuento || 0}%</TableCell>
            <TableCell>{row.liquidacionValor ? money(row.liquidacionValor) : <span className="text-xs text-muted-foreground">Pendiente</span>}</TableCell>
            <TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon-sm" title="Ver detalle" aria-label="Ver detalle" onClick={() => onSelect(row)}><Eye className="h-4 w-4" /></Button><Button variant="ghost" size="icon-sm" title="Editar asistencia" aria-label="Editar asistencia" onClick={() => onEdit(row)}><Pencil className="h-4 w-4" /></Button></div></TableCell>
          </TableRow>; })}</TableBody>
        </Table></div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={onPageChange} />
      </>}
    </CardContent>
  </Card>;
}

function RecordDetail({ row, onEdit }: { row: AttendanceRow; onEdit: () => void }) {
  const meta = statusMeta(row);
  const Icon = meta.icon;
  return <div className="space-y-4 px-4 pb-6">
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/40 p-3"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-gold/10 font-semibold text-gold">{(row.usuarioNombre || "?").split(" ").map((part) => part[0]).slice(0, 2).join("")}</div><div><p className="font-semibold">{row.usuarioNombre || row.usuarioId}</p><p className="text-xs text-muted-foreground">{formatDate(row.fecha)}</p></div><Badge variant="outline" className={cn("ml-auto", meta.className)}><Icon className="h-3 w-3" />{meta.label}</Badge></div>
    {row.fotoLlegadaUrl ? <div className="overflow-hidden rounded-xl border border-border/50 bg-background/40"><img src={row.fotoLlegadaUrl} alt="Evidencia de llegada" className="max-h-64 w-full object-contain" /><p className="border-t border-border/50 p-2 text-xs text-muted-foreground"><Camera className="mr-1 inline h-3 w-3" />Evidencia fotográfica</p></div> : <div className="rounded-xl border border-dashed border-border/60 p-5 text-center text-sm text-muted-foreground"><Camera className="mx-auto mb-2 h-5 w-5" />No hay fotografía asociada</div>}
    <div className="grid grid-cols-2 gap-2 text-sm"><Detail label="Hora programada" value={row.horaEsperada || "—"} /><Detail label="Hora reportada" value={row.horaLlegada || "No reportó"} /><Detail label="Minutos adeudados" value={`${row.minutosAdeudados || row.minutosRetraso || 0} min`} /><Detail label="Regla aplicada" value={`${row.porcentajeReglaAplicada ?? row.porcentajeDescuento ?? 0}% · ${row.categoriaLlegada || "—"}`} /><Detail label="Descuento en liquidación" value={row.liquidacionValor ? money(row.liquidacionValor) : "Pendiente"} /><Detail label="Periodo" value={row.periodoFechaInicio && row.periodoFechaFin ? `${formatDate(row.periodoFechaInicio)} – ${formatDate(row.periodoFechaFin)}` : "Sin periodo"} /></div>
    {row.ubicacionLlegadaDireccion && <div className="rounded-lg bg-background/40 p-3 text-sm"><MapPin className="mr-2 inline h-4 w-4 text-sky-300" />{row.ubicacionLlegadaDireccion}</div>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-4 w-4" />Ajustar</Button></div>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-background/40 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 break-words font-medium">{value}</p></div>;
}

function FortnightView({ report, loading, page, onPageChange }: { report: AttendanceFortnightlyReport | null; loading: boolean; page: number; onPageChange: (page: number) => void }) {
  const workers = report?.trabajadores || [];
  const visibleWorkers = workers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { if (!loading && workers.length > 0 && page > Math.ceil(workers.length / PAGE_SIZE)) onPageChange(Math.max(1, Math.ceil(workers.length / PAGE_SIZE))); }, [loading, onPageChange, page, workers.length]);
  if (loading && !report) return <EmptyPanel icon={FileDown} title="Cargando quincena" description="Estamos preparando el consolidado del periodo." />;
  if (!report) return <EmptyPanel icon={FileDown} title="No se pudo cargar la quincena" description="Actualiza la consulta para intentarlo de nuevo." />;
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><SummaryCard label="Incidencias" value={report.summary.eventos} tone="bg-slate-500/10 text-slate-300" icon={FileText} /><SummaryCard label="Trabajadores" value={report.summary.trabajadores} tone="bg-sky-500/10 text-sky-300" icon={UserRound} /><SummaryCard label="No reportados" value={report.summary.noReportados} tone="bg-red-500/10 text-red-300" icon={XCircle} /><SummaryCard label="Minutos adeudados" value={report.summary.minutosAdeudados} tone="bg-gold/10 text-gold" icon={Timer} /></div>
    <Card className="overflow-hidden border-border/50 bg-card/70"><CardHeader className="flex flex-row items-center justify-between border-b border-border/40 px-4 py-3"><div><CardTitle className="text-base">Detalle por trabajador</CardTitle><p className="text-xs text-muted-foreground">Solo novedades de {formatDate(report.fechaInicio)} al {formatDate(report.fechaFin)}.</p></div><Badge variant="outline">{workers.length} trabajadores</Badge></CardHeader><CardContent className="p-0">
      {!workers.length ? <div className="p-10 text-center text-sm text-muted-foreground">No hay incidencias en esta quincena para los filtros elegidos.</div> : <><div className={cn("overflow-x-auto transition-opacity", loading && "opacity-60")}><Table><TableHeader><TableRow><TableHead>Trabajador</TableHead><TableHead>Incidencias</TableHead><TableHead>Minutos adeudados</TableHead><TableHead>Tardanzas / fuera del corte</TableHead><TableHead>No reportados</TableHead><TableHead>Descuento quincenal</TableHead></TableRow></TableHeader><TableBody>{visibleWorkers.map((worker) => <TableRow key={worker.usuarioId}><TableCell className="font-medium">{worker.nombre}</TableCell><TableCell>{worker.eventos}</TableCell><TableCell>{worker.minutosAdeudados}</TableCell><TableCell>{worker.tardanzasLeves + worker.tardanzasMayores}</TableCell><TableCell>{worker.noReportados}</TableCell><TableCell className="text-amber-300">{worker.porcentajeDescuento}%</TableCell></TableRow>)}</TableBody></Table></div><Pagination page={page} pageSize={PAGE_SIZE} total={workers.length} onPageChange={onPageChange} /></>}
    </CardContent></Card>
  </div>;
}

function MemoList({ memos, loading, total, page, onPageChange, onDownload, onEdit, onUpdate }: { memos: AttendanceMemo[]; loading: boolean; total: number; page: number; onPageChange: (page: number) => void; onDownload: (memo: AttendanceMemo) => void; onEdit: (memo: AttendanceMemo) => void; onUpdate: (memo: AttendanceMemo, action: "firmar" | "anular" | "desanular" | "eliminar" | "restaurar") => void }) {
  return <Card className="overflow-hidden border-border/50 bg-card/70">
    <CardContent className="p-0">{loading && !memos.length ? <div className="p-10 text-center text-sm text-muted-foreground">Cargando memorandos...</div> : !memos.length ? <EmptyPanel icon={FileText} title="No hay memorandos para estos filtros" description="Prueba con otra persona o limpia la búsqueda." /> : <>
      <div className={cn("overflow-x-auto transition-opacity", loading && "opacity-60")}><Table><TableHeader><TableRow><TableHead>Documento</TableHead><TableHead>Trabajador</TableHead><TableHead>Incidencias</TableHead><TableHead>Minutos</TableHead><TableHead>Descuento del periodo</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader><TableBody>{memos.map((memo) => {
        const totalMinutes = memo.eventos.reduce((sum, event) => sum + event.minutosAdeudados, 0);
        const cumulativePercentage = Math.min(100, memo.eventos.reduce((sum, event) => sum + event.porcentaje, 0));
        const deleted = Boolean(memo.eliminadoEn);
        return <TableRow key={memo.id}><TableCell><div className="font-medium">{memo.numero}</div><div className="max-w-52 truncate text-xs text-muted-foreground">{memo.titulo}</div><div className="text-[11px] text-muted-foreground">{memo.periodoFechaInicio && memo.periodoFechaFin ? `${formatDate(memo.periodoFechaInicio)} – ${formatDate(memo.periodoFechaFin)}` : "Sin periodo"}</div></TableCell><TableCell>{memo.usuarioNombre || memo.usuarioId || "—"}</TableCell><TableCell>{memo.eventos.length}</TableCell><TableCell>{totalMinutes}</TableCell><TableCell>{cumulativePercentage}%</TableCell><TableCell><Badge variant="outline" className={deleted ? "border-slate-500/30 text-slate-300" : memo.estado === "firmado" ? "border-emerald-500/30 text-emerald-300" : memo.estado === "anulado" ? "border-red-500/30 text-red-300" : ""}>{deleted ? "eliminado" : memo.estado}</Badge></TableCell><TableCell><div className="flex justify-end gap-1">
          <Button size="icon-sm" variant="ghost" title="Descargar PDF" aria-label="Descargar PDF" onClick={() => onDownload(memo)}><Download className="h-4 w-4" /></Button>
          {!deleted && memo.estado !== "firmado" && <Button size="icon-sm" variant="ghost" title="Editar texto" aria-label="Editar texto" onClick={() => onEdit(memo)}><Pencil className="h-4 w-4" /></Button>}
          {!deleted && memo.estado !== "firmado" && memo.estado !== "anulado" && <Button size="sm" variant="ghost" onClick={() => onUpdate(memo, "firmar")}>Firmado</Button>}
          {!deleted && memo.estado === "anulado" && <Button size="sm" variant="ghost" onClick={() => onUpdate(memo, "desanular")}><RotateCcw className="h-3 w-3" />Desanular</Button>}
          {!deleted && memo.estado !== "anulado" && <Button size="sm" variant="ghost" onClick={() => onUpdate(memo, "anular")}>Anular</Button>}
          {deleted ? <Button size="icon-sm" variant="ghost" title="Restaurar" aria-label="Restaurar" onClick={() => onUpdate(memo, "restaurar")}><RotateCcw className="h-4 w-4" /></Button> : <Button size="icon-sm" variant="ghost" className="text-red-300 hover:text-red-200" title="Mover a eliminados" aria-label="Mover a eliminados" onClick={() => onUpdate(memo, "eliminar")}><Trash2 className="h-4 w-4" /></Button>}
        </div></TableCell></TableRow>;
      })}</TableBody></Table></div><Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={onPageChange} />
    </>}</CardContent>
  </Card>;
}

function RulesPanel({ form, setForm, saving, onSave }: { form: RuleForm; setForm: (value: RuleForm) => void; saving: boolean; onSave: () => void }) {
  const update = (key: keyof RuleForm, value: string | boolean) => setForm({ ...form, [key]: value });
  const [hour = "08", minute = "30"] = form.horaCorte.split(":");
  const cutoffEndDate = new Date(2000, 0, 1, Number(hour), Number(minute) - 1);
  const finalLeveMinute = `${String(cutoffEndDate.getHours()).padStart(2, "0")}:${String(cutoffEndDate.getMinutes()).padStart(2, "0")}`;
  return <Card className="border-border/50 bg-card/70"><CardHeader className="border-b border-border/40"><CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4 text-gold" />Reglas de asistencia y liquidación</CardTitle><p className="text-sm text-muted-foreground">Las horas y porcentajes se pueden editar. El cálculo usa la hora de Bogotá, no el horario individual programado.</p></CardHeader>
    <CardContent className="space-y-5 p-4 sm:p-6"><div className="rounded-lg border border-gold/20 bg-gold/5 px-3 py-2 text-sm"><span className="font-medium text-gold">Regla actual:</span> {form.horaInicio}–{finalLeveMinute}, {form.tardanzaPorcentaje}% si reporta; desde {form.horaCorte}, {form.noReportadoPorcentaje}% si no registra. Si reporta desde el corte, se aplica reposición de {form.reposicionPorcentaje}%.</div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><TimeField label="Inicio del descuento por tardanza" value={form.horaInicio} onChange={(value) => update("horaInicio", value)} /><TimeField label="Corte para no reportado" value={form.horaCorte} onChange={(value) => update("horaCorte", value)} /><Field label="Descuento por tardanza reportada" value={form.tardanzaPorcentaje} onChange={(value) => update("tardanzaPorcentaje", value)} suffix="%" /><Field label="Descuento si no reporta al corte" value={form.noReportadoPorcentaje} onChange={(value) => update("noReportadoPorcentaje", value)} suffix="%" /><Field label="Descuento por reposición posterior" value={form.reposicionPorcentaje} onChange={(value) => update("reposicionPorcentaje", value)} suffix="%" /><Field label="Minutos adeudados sin reporte" value={form.minutosNoReportado} onChange={(value) => update("minutosNoReportado", value)} suffix="min" /></div>
      <p className="text-xs text-muted-foreground">Al guardar, el sistema vuelve a calcular los registros y la liquidación en periodos abiertos. Los periodos cerrados no se modifican.</p>
      <div className="flex justify-end"><Button onClick={onSave} disabled={saving}>{saving ? "Guardando..." : "Guardar reglas"}</Button></div>
    </CardContent>
  </Card>;
}

function Field({ label, value, onChange, suffix }: { label: string; value: string; onChange: (value: string) => void; suffix: string }) {
  return <div><Label>{label}</Label><div className="relative mt-1"><Input type="number" min="0" max={suffix === "%" ? 100 : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="pr-12" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span></div></div>;
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div><Label>{label}</Label><Input className="mt-1" type="time" value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function EmptyPanel({ icon: Icon, title, description }: { icon: typeof Clock3; title: string; description: string }) {
  return <Card className="border-border/50 bg-card/70"><CardContent className="p-10 text-center"><Icon className="mx-auto h-7 w-7 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></CardContent></Card>;
}
