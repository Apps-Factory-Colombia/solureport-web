"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
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
  Wrench,
  ClipboardCheck,
  Route,
  Download,
  Mail,
  CheckCircle2,
  Clock,
  MapPin,
  Package,
  Image as ImageIcon,
  Eye,
  PenLine,
  BookOpen,
  DollarSign,
  Trash2,
  Loader2,
  Users,
  Send,
  Save,
  ChevronDown,
} from "lucide-react";
import { ActivityReport, User, Client, WorkGroup, CompanySettings, LiquidationPeriod, MaintenanceContract } from "@/lib/types";
import { deleteReporteActividadAdmin, getReportesActividad, markReporteActividadEmailSent, updateCostoActividadAdmin, updateCostoClienteVisitaAdmin } from "@/lib/supabase/services/reportes-actividad";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getGrupos } from "@/lib/supabase/services/grupos";
import { getConfiguracion } from "@/lib/supabase/services/configuracion";
import { getContratos } from "@/lib/supabase/services/contratos";
import { getPeriodos } from "@/lib/supabase/services/liquidacion";
import { cn } from "@/lib/utils";
import { generateReportePDF, generateTablePDF } from "@/lib/utils/pdf-generator";
import { filterPreventiveMirrorReports } from "@/lib/utils/report-filters";
import { buildReportMultilineText, formatClientDoorBreakdown, getDisplayReportObservations, getReportServiceDetail } from "@/lib/utils/report-content";

const DEFAULT_NOTIFICATION_BCC = "solucionesyautomatizaciones@hotmail.com";
const TABLE_PAGE_SIZE = 10;

type ReportTableKey = "preventivos" | "visitas" | "recorridos" | "grupales";
type GroupedActivityRow = {
  id: string;
  report: ActivityReport;
  reports: ActivityReport[];
  tipo: ActivityReport["tipo"];
  estadoAprobacionLider: ActivityReport["estadoAprobacionLider"];
  fechaAprobacionLider?: string;
  costoActividad: number;
  participantCount: number;
  participantNames: string[];
  isShared: boolean;
};

type PreventiveExportEntry = {
  report: ActivityReport;
  contract?: MaintenanceContract;
  maintenanceDate: string;
  maintenanceValue: number;
  annualContractValue: number;
  clientName: string;
  buildingName: string;
  technicianName: string;
  detail: string;
  contractKey: string;
  monthKey: string;
};

const monthLabelFormatter = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" });

function getTodayDateString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0] || "";
}

function shiftDateString(baseDate: string, amount: number, unit: "days" | "months") {
  const date = new Date(`${baseDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return baseDate;

  if (unit === "days") {
    date.setDate(date.getDate() + amount);
  } else {
    date.setMonth(date.getMonth() + amount);
  }

  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().split("T")[0] || baseDate;
}

function normalizeRange(start: string, end: string) {
  if (!start && !end) return { start: "", end: "" };
  if (!start) return { start: end, end };
  if (!end) return { start, end: start };
  return start <= end ? { start, end } : { start: end, end: start };
}

function formatRangeLabel(start: string, end: string) {
  if (!start && !end) return "Sin rango";

  const formatter = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });
  const normalized = normalizeRange(start, end);
  const startDate = normalized.start ? new Date(`${normalized.start}T00:00:00`) : null;
  const endDate = normalized.end ? new Date(`${normalized.end}T00:00:00`) : null;

  if (!startDate || Number.isNaN(startDate.getTime()) || !endDate || Number.isNaN(endDate.getTime())) {
    return `${normalized.start || "-"} al ${normalized.end || "-"}`;
  }

  if (normalized.start === normalized.end) {
    return formatter.format(startDate);
  }

  return `${formatter.format(startDate)} al ${formatter.format(endDate)}`;
}

function formatPeriodLabel(period?: LiquidationPeriod) {
  if (!period) return "Sin período";
  return `${period.fechaInicio} al ${period.fechaFin}`;
}

function isWithinDateRange(fecha: string, start: string, end: string) {
  const normalized = normalizeRange(start, end);
  if (!normalized.start && !normalized.end) return true;
  if (normalized.start && fecha < normalized.start) return false;
  if (normalized.end && fecha > normalized.end) return false;
  return true;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

function getPreferredSharedTotal(values: Array<number | string | null | undefined>, fallback: number) {
  for (const value of values) {
    const normalized = Number(value ?? 0) || 0;
    if (normalized > 0) return normalized;
  }

  return fallback;
}

function normalizeSearchValue(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getGroupActivityBaseTitle(report: ActivityReport) {
  const normalized = (report.descripcion || "").trim();
  if (!normalized) return "";

  const emDashParts = normalized.split(" — ").map((part) => part.trim()).filter(Boolean);
  if (emDashParts.length >= 2) {
    return emDashParts.slice(1).join(" — ");
  }

  const dashParts = normalized.split(" - ").map((part) => part.trim()).filter(Boolean);
  return dashParts[0] || normalized;
}

function getGroupActivitySpecification(report: ActivityReport) {
  if (report.especificacion?.trim()) return report.especificacion.trim();

  const observationMatch = report.observaciones?.match(/Especificaci[oó]n:\s*(.+?)(?:$|\n)/i);
  if (observationMatch?.[1]?.trim()) return observationMatch[1].trim();

  const description = (report.descripcion || "").trim();
  if (!description || description.includes(" — ")) return "";

  const dashParts = description.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (dashParts.length < 3) return "";

  return dashParts.slice(1, -1).join(" - ").trim();
}

function getGroupActivityUiIdentity(report: ActivityReport) {
  return [
    "group-ui",
    report.fecha,
    report.grupoId,
    report.clienteId || "sin-cliente",
    normalizeSearchValue(getGroupActivityBaseTitle(report)),
  ].join("|");
}

function getGroupActivityUiSpecificity(report: ActivityReport) {
  let score = 0;
  if (report.registroActividadId) score += 4;
  if (getGroupActivitySpecification(report)) score += 6;
  if ((report.descripcion || "").includes(" - ")) score += 2;
  if (report.observaciones?.includes("Especificación:")) score += 1;
  return score;
}

function shouldPreferGroupActivityUiCandidate(current: ActivityReport | undefined, next: ActivityReport) {
  if (!current) return true;

  const currentScore = getGroupActivityUiSpecificity(current);
  const nextScore = getGroupActivityUiSpecificity(next);
  if (nextScore !== currentScore) return nextScore > currentScore;

  const currentCreatedAt = current.fechaCreacion || "";
  const nextCreatedAt = next.fechaCreacion || "";
  if (nextCreatedAt !== currentCreatedAt) return nextCreatedAt > currentCreatedAt;

  return next.id > current.id;
}

function dedupeGroupActivityRowsForUi(reports: ActivityReport[]) {
  const canonicalByTech = new Map<string, ActivityReport>();

  reports.forEach((report) => {
    if (!isGroupActivity(report)) {
      canonicalByTech.set(`direct:${report.id}`, report);
      return;
    }

    const key = `${getGroupActivityUiIdentity(report)}|${report.tecnicoId}`;
    const current = canonicalByTech.get(key);
    if (shouldPreferGroupActivityUiCandidate(current, report)) {
      canonicalByTech.set(key, report);
    }
  });

  return Array.from(canonicalByTech.values());
}

function isGroupActivity(report: ActivityReport) {
  return report.tipo === "actividad_grupal";
}

function isSharedVisit(report: ActivityReport) {
  const participationPercentage = Number(report.porcentajeParticipacion ?? 0) || 0;
  return (report.tipo === "visita_tecnica"
    || report.tipo === "mantenimiento_preventivo")
    && participationPercentage > 0
    && participationPercentage < 100;
}

function scoreTechnicianScopedReport(report: ActivityReport) {
  let score = 0;

  if ((report.fotosAntes?.length || 0) + (report.fotosDespues?.length || 0) > 0) score += 8;
  if (report.fotoBitacora) score += 6;
  if (report.firmaReceptor) score += 3;
  if (report.datosReceptor?.nombre) score += 3;
  if (normalizeSearchValue(report.descripcion) && normalizeSearchValue(report.descripcion) !== "sin novedad") score += 2;
  if (normalizeSearchValue(report.observaciones) && normalizeSearchValue(report.observaciones) !== "sin novedad") score += 2;
  if (report.mantenimientoParticipanteId) score += 1;

  return score;
}

function usesSharedBasePricing(report: ActivityReport) {
  return isGroupActivity(report)
    || isSharedVisit(report)
    || report.tipo === "mantenimiento_preventivo";
}

function getGroupActivityIdentity(report: ActivityReport) {
  if (!isGroupActivity(report)) return report.id;

  if (report.registroActividadId) {
    return `group:${report.registroActividadId}`;
  }

  return [
    "legacy-group",
    report.fecha,
    report.grupoId,
    report.clienteId || "sin-cliente",
    normalizeSearchValue(report.descripcion),
    normalizeSearchValue(report.especificacion),
  ].join("|");
}

function dedupeReportsByTechnician(reports: ActivityReport[]) {
  return Array.from(
    reports.reduce((map, report) => {
      const current = map.get(report.tecnicoId);

      if (!current) {
        map.set(report.tecnicoId, report);
        return map;
      }

      if (!!report.registroActividadId !== !!current.registroActividadId) {
        if (report.registroActividadId) {
          map.set(report.tecnicoId, report);
        }
        return map;
      }

      const currentScore = scoreTechnicianScopedReport(current);
      const nextScore = scoreTechnicianScopedReport(report);
      if (nextScore !== currentScore) {
        if (nextScore > currentScore) {
          map.set(report.tecnicoId, report);
        }
        return map;
      }

      const creationCompare = (report.fechaCreacion || "").localeCompare(current.fechaCreacion || "");
      if (creationCompare > 0 || (creationCompare === 0 && report.id.localeCompare(current.id) > 0)) {
        map.set(report.tecnicoId, report);
      }

      return map;
    }, new Map<string, ActivityReport>()).values()
  );
}

function getPreventiveMaintenanceCanonicalKey(report: ActivityReport) {
  if (report.tipo !== "mantenimiento_preventivo") return report.id;

  if (report.mantenimientoId) {
    return `maintenance:${report.mantenimientoId}:${report.mantenimientoParticipanteId || report.tecnicoId}`;
  }

  return [
    report.periodoId || "sin-periodo",
    report.grupoId || "sin-grupo",
    report.clienteId || "sin-cliente",
    normalizeSearchValue(report.descripcion),
    normalizeSearchValue(report.especificacion),
    report.mantenimientoId || "sin-mantenimiento",
  ].join("|");
}

function rankPreventiveMaintenanceReport(report: ActivityReport) {
  let score = 0;
  if (report.mantenimientoParticipanteId) score += 8;
  if (report.mantenimientoId) score += 4;
  if ((Number(report.costoActividad ?? 0) || 0) > 0) score += 2;
  if ((Number(report.porcentajeParticipacion ?? 0) || 0) > 0) score += 1;
  return score;
}

function sortReportsForSharedActivity(reports: ActivityReport[]) {
  return [...reports].sort((a, b) => {
    if (!!a.registroActividadId !== !!b.registroActividadId) {
      return a.registroActividadId ? -1 : 1;
    }

    if (a.id.startsWith("reg-") !== b.id.startsWith("reg-")) {
      return a.id.startsWith("reg-") ? -1 : 1;
    }

    const creationCompare = (b.fechaCreacion || "").localeCompare(a.fechaCreacion || "");
    if (creationCompare !== 0) return creationCompare;

    return b.id.localeCompare(a.id);
  });
}

function getVisualActivityIdentity(report: ActivityReport) {
  if (isGroupActivity(report)) {
    return getGroupActivityUiIdentity(report);
  }

  if (report.tipo === "mantenimiento_preventivo") {
    if (report.mantenimientoId) {
      return `shared-maintenance-visual:${report.mantenimientoId}`;
    }

    return [
      "shared-maintenance-visual",
      report.periodoId || "sin-periodo",
      report.grupoId,
      report.clienteId || "sin-cliente",
      normalizeSearchValue(report.descripcion),
      normalizeSearchValue(report.especificacion),
    ].join("|");
  }

  if (isSharedVisit(report)) {
    return [
      "shared-visit-visual",
      report.visitaTecnicaId || "sin-visita",
      report.fecha,
      report.periodoId || "sin-periodo",
      report.grupoId,
      report.clienteId || "sin-cliente",
      normalizeSearchValue(report.descripcion),
    ].join("|");
  }

  return report.id;
}

function getSharedPricingIdentity(report: ActivityReport) {
  if (isGroupActivity(report)) {
    return getGroupActivityIdentity(report);
  }

  if (isSharedVisit(report)) {
    return getSharedVisitIdentity(report);
  }

  return report.id;
}

function getSharedVisitIdentity(report: ActivityReport) {
  if (!isSharedVisit(report)) return report.id;

  if (report.tipo === "mantenimiento_preventivo") {
    if (report.mantenimientoId) {
      return `shared-maintenance:${report.mantenimientoId}`;
    }

    return [
      "shared-maintenance",
      report.periodoId || "sin-periodo",
      report.grupoId,
      report.clienteId || "sin-cliente",
      normalizeSearchValue(report.descripcion),
      normalizeSearchValue(report.especificacion),
    ].join("|");
  }

  return [
    "shared-visit",
    report.visitaTecnicaId || "sin-visita",
    report.fecha,
    report.periodoId || "sin-periodo",
    report.grupoId,
    report.clienteId || "sin-cliente",
    normalizeSearchValue(report.descripcion),
  ].join("|");
}

function parseClientCostInput(value: string): number | null {
  if (!value.trim()) return 0;

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error("El costo cliente debe ser un numero igual o mayor a cero.");
  }

  return parsed;
}

function parseTechnicalCostInput(value: string): number {
  if (!value.trim()) return 0;

  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error("El costo tecnico debe ser un numero igual o mayor a cero.");
  }

  return parsed;
}

function formatDateTime(value?: string) {
  if (!value) return "Sin envío";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function paginateReports<T>(reports: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(reports.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (currentPage - 1) * TABLE_PAGE_SIZE;

  return {
    currentPage,
    totalPages,
    items: reports.slice(startIndex, startIndex + TABLE_PAGE_SIZE),
  };
}

function getMonthKey(fecha: string) {
  return fecha.slice(0, 7);
}

function formatMonthKey(monthKey: string) {
  const date = new Date(`${monthKey}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return monthKey;
  const label = monthLabelFormatter.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function canSendReportEmail(report: ActivityReport) {
  if (report.tipo === "mantenimiento_preventivo") return true;
  if (report.tipo === "visita_tecnica") return report.tipoVisita !== "garantia";
  return false;
}

function isDeliveryVisit(report: ActivityReport) {
  return report.tipo === "visita_tecnica" && report.tipoVisita === "entregas";
}

function getVisitCategoryLabel(tipoVisita?: ActivityReport["tipoVisita"]) {
  if (tipoVisita === "garantia") return "Garantía";
  if (tipoVisita === "emergencia") return "Emergencia";
  if (tipoVisita === "entregas") return "Entregas";
  if (tipoVisita === "imprevisto") return "Imprevisto";
  return "Sin categoría";
}

function sortReportsByNewestCreation(reports: ActivityReport[]) {
  return [...reports].sort((left, right) => {
    const creationCompare = (right.fechaCreacion || "").localeCompare(left.fechaCreacion || "");
    if (creationCompare !== 0) return creationCompare;

    const dateCompare = (right.fecha || "").localeCompare(left.fecha || "");
    if (dateCompare !== 0) return dateCompare;

    return right.id.localeCompare(left.id);
  });
}

function getYearRangeFromDates(start: string, end: string) {
  const normalized = normalizeRange(start, end);
  const referenceStart = normalized.start || normalized.end;
  const referenceEnd = normalized.end || normalized.start;

  if (!referenceStart || !referenceEnd) return null;

  const startYear = Number(referenceStart.slice(0, 4));
  const endYear = Number(referenceEnd.slice(0, 4));

  if (Number.isNaN(startYear) || Number.isNaN(endYear)) return null;

  const years = new Set<number>();
  const minYear = Math.min(startYear, endYear);
  const maxYear = Math.max(startYear, endYear);

  for (let year = minYear; year <= maxYear; year += 1) {
    years.add(year);
  }

  return years;
}

function getMonthInputValue(date: string) {
  return date.slice(0, 7);
}

function getQuincenaRange(monthValue: string, half: "primera" | "segunda") {
  const [yearText, monthText] = monthValue.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!year || !month) {
    const fallback = getTodayDateString();
    return half === "primera"
      ? { start: `${fallback.slice(0, 7)}-01`, end: `${fallback.slice(0, 7)}-15` }
      : { start: `${fallback.slice(0, 7)}-16`, end: fallback };
  }

  const lastDay = new Date(year, month, 0).getDate();
  const paddedMonth = String(month).padStart(2, "0");

  return half === "primera"
    ? {
      start: `${year}-${paddedMonth}-01`,
      end: `${year}-${paddedMonth}-15`,
    }
    : {
      start: `${year}-${paddedMonth}-16`,
      end: `${year}-${paddedMonth}-${String(lastDay).padStart(2, "0")}`,
    };
}

export default function InformesPage() {
  const today = useMemo(() => getTodayDateString(), []);
  const [reports, setReports] = useState<ActivityReport[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [periods, setPeriods] = useState<LiquidationPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [contracts, setContracts] = useState<MaintenanceContract[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewRangeStart, setViewRangeStart] = useState("");
  const [viewRangeEnd, setViewRangeEnd] = useState("");
  const [viewQuincenaMonth, setViewQuincenaMonth] = useState(() => getMonthInputValue(getTodayDateString()));
  const [grupoFilter, setGrupoFilter] = useState<string>("todos");
  const [selectedReport, setSelectedReport] = useState<ActivityReport | null>(null);
  const [selectedDetailReports, setSelectedDetailReports] = useState<ActivityReport[]>([]);
  const [selectedParticipantReportId, setSelectedParticipantReportId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<ActivityReport | null>(null);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [sendingReportId, setSendingReportId] = useState<string | null>(null);
  const [editableTechnicalCost, setEditableTechnicalCost] = useState("");
  const [savingTechnicalCost, setSavingTechnicalCost] = useState(false);
  const [editableClientCost, setEditableClientCost] = useState("");
  const [savingClientCost, setSavingClientCost] = useState(false);
  const [inlineTechnicalCostDrafts, setInlineTechnicalCostDrafts] = useState<Record<string, string>>({});
  const [savingInlineTechnicalCostId, setSavingInlineTechnicalCostId] = useState<string | null>(null);
  const [inlineClientCostDrafts, setInlineClientCostDrafts] = useState<Record<string, string>>({});
  const [savingInlineClientCostId, setSavingInlineClientCostId] = useState<string | null>(null);
  const [exportRangeStart, setExportRangeStart] = useState(() => shiftDateString(getTodayDateString(), -14, "days"));
  const [exportRangeEnd, setExportRangeEnd] = useState(() => getTodayDateString());
  const [exportQuincenaMonth, setExportQuincenaMonth] = useState(() => getMonthInputValue(getTodayDateString()));
  const [exportPanelOpen, setExportPanelOpen] = useState(false);
  const [exportReportType, setExportReportType] = useState<ActivityReport["tipo"]>("visita_tecnica");
  const [preventiveExportClientId, setPreventiveExportClientId] = useState<string>("todos");
  const [preventiveExportClientSearch, setPreventiveExportClientSearch] = useState("");
  const [preventiveClientSelectorOpen, setPreventiveClientSelectorOpen] = useState(false);
  const [exportingPreventiveMonthlySummary, setExportingPreventiveMonthlySummary] = useState(false);
  const [exportingPreventiveAnnualSummary, setExportingPreventiveAnnualSummary] = useState(false);
  const [exportingTechnicalSummary, setExportingTechnicalSummary] = useState(false);
  const [exportingClientSummary, setExportingClientSummary] = useState(false);
  const [tablePages, setTablePages] = useState<Record<ReportTableKey, number>>({
    preventivos: 1,
    visitas: 1,
    recorridos: 1,
    grupales: 1,
  });

  const loadData = async () => {
    setLoading(true);
    Promise.allSettled([getReportesActividad(), getUsuarios(), getClientes(), getGrupos(), getConfiguracion(), getContratos(), getPeriodos()])
      .then(([reportsResult, usersResult, clientsResult, groupsResult, settingsResult, contractsResult, periodsResult]) => {
        const r = reportsResult.status === "fulfilled" ? reportsResult.value : [];
        const u = usersResult.status === "fulfilled" ? usersResult.value : [];
        const c = clientsResult.status === "fulfilled" ? clientsResult.value : [];
        const g = groupsResult.status === "fulfilled" ? groupsResult.value : [];
        const s = settingsResult.status === "fulfilled" ? settingsResult.value : null;
        const ct = contractsResult.status === "fulfilled" ? contractsResult.value : [];
        const p = periodsResult.status === "fulfilled" ? periodsResult.value : [];

        if (reportsResult.status === "rejected") console.error("Error cargando reportes en informes:", reportsResult.reason);
        if (usersResult.status === "rejected") console.error("Error cargando usuarios en informes:", usersResult.reason);
        if (clientsResult.status === "rejected") console.error("Error cargando clientes en informes:", clientsResult.reason);
        if (groupsResult.status === "rejected") console.error("Error cargando grupos en informes:", groupsResult.reason);
        if (settingsResult.status === "rejected") console.error("Error cargando configuración en informes:", settingsResult.reason);
        if (contractsResult.status === "rejected") console.error("Error cargando contratos en informes:", contractsResult.reason);
        if (periodsResult.status === "rejected") console.error("Error cargando períodos en informes:", periodsResult.reason);

        setReports(r); setUsers(u); setClients(c); setGroups(g); setCompanySettings(s); setContracts(ct); setPeriods(p);
        setSelectedPeriodId((current) => {
          if (current && p.some((period) => period.id === current)) return current;
          return p[0]?.id || "";
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId),
    [periods, selectedPeriodId]
  );
  const hasSelectedPeriod = !!selectedPeriod;

  useEffect(() => {
    if (!selectedPeriod) {
      setViewRangeStart("");
      setViewRangeEnd("");
      return;
    }

    setViewRangeStart(selectedPeriod.fechaInicio);
    setViewRangeEnd(selectedPeriod.fechaFin);
    setViewQuincenaMonth(getMonthInputValue(selectedPeriod.fechaInicio));
  }, [selectedPeriod]);

  const periodScopedReports = useMemo(
    () => selectedPeriodId ? reports.filter((report) => report.periodoId === selectedPeriodId) : [],
    [reports, selectedPeriodId]
  );

  const getConfiguredRecorridoCost = useCallback((report: ActivityReport) => {
    const normalCost = companySettings?.costoRecorridoNormal ?? 25000;
    const toolCost = companySettings?.costoRecorridoHerramienta ?? 40000;
    return report.tipoRecorrido === "con_herramienta" ? toolCost : normalCost;
  }, [companySettings]);

  const getSuggestedTechnicalValue = useCallback((report: ActivityReport) => {
    if (usesSharedBasePricing(report)) {
      if (report.valorSugeridoGlobal != null) {
        return report.valorSugeridoGlobal;
      }

      const suggestedParticipantValue = Number(report.valorSugerido ?? 0) || 0;
      const participationPercentage = Number(report.porcentajeParticipacion ?? 0) || 0;

      if (suggestedParticipantValue > 0 && participationPercentage > 0) {
        return Number(((suggestedParticipantValue * 100) / participationPercentage).toFixed(2));
      }

      return report.valorSugerido;
    }

    return report.valorSugerido;
  }, []);

  const getSuggestedTechnicalValueForReports = useCallback((reportList: ActivityReport[]) => {
    const uniqueReports = Array.from(new Map(reportList.map((report) => [report.id, report])).values());
    const participantSuggestedTotal = uniqueReports.reduce((sum, report) => sum + (Number(report.valorSugerido ?? 0) || 0), 0);

    if (uniqueReports.length > 1 && participantSuggestedTotal > 0) {
      return participantSuggestedTotal;
    }

    return uniqueReports[0] ? getSuggestedTechnicalValue(uniqueReports[0]) : undefined;
  }, [getSuggestedTechnicalValue]);

  const getSuggestionReasonForReports = useCallback((reportList: ActivityReport[]) => {
    return reportList.find((report) => report.motivoSugerenciaValor)?.motivoSugerenciaValor;
  }, []);

  const getEffectiveTechnicalCost = useCallback((report: ActivityReport) => {
    if (report.tipo !== "recorrido") return Number(report.costoActividad ?? 0) || 0;

    const configuredCost = getConfiguredRecorridoCost(report);
    if (report.valorModificado) {
      return Number(report.costoActividad ?? configuredCost) || configuredCost;
    }

    return configuredCost;
  }, [getConfiguredRecorridoCost]);

  useEffect(() => {
    const initialTechnicalCost = selectedReport
      ? String(
        isSharedVisit(selectedReport)
          ? (selectedReport.valorActividadAplicadoGlobal
            ?? selectedReport.valorActividadBaseGlobal
            ?? (Number(selectedReport.costoActividad ?? 0) || 0))
          : getEffectiveTechnicalCost(selectedReport)
      )
      : "";

    setEditableTechnicalCost(initialTechnicalCost);
    setEditableClientCost(
      selectedReport?.tipo === "visita_tecnica"
        ? String(selectedReport.costoCliente ?? 0)
        : ""
    );
  }, [getEffectiveTechnicalCost, selectedReport]);

  const handleDeleteReport = async () => {
    if (!reportToDelete) return;
    setDeletingReportId(reportToDelete.id);
    try {
      await deleteReporteActividadAdmin(reportToDelete.id);
      setReportToDelete(null);
      await loadData();
    } catch (err) {
      console.error("Error eliminando informe:", err);
      alert("No se pudo eliminar el informe. Intenta nuevamente.");
    } finally {
      setDeletingReportId(null);
    }
  };

  const viewScopedReports = useMemo(
    () => periodScopedReports.filter((report) => isWithinDateRange(report.fecha, viewRangeStart, viewRangeEnd)),
    [periodScopedReports, viewRangeEnd, viewRangeStart]
  );

  const preventivos = useMemo(
    () => filterPreventiveMirrorReports(periodScopedReports).filter((r) => r.tipo === "mantenimiento_preventivo"),
    [periodScopedReports]
  );
  const visitas = useMemo(
    () => viewScopedReports.filter((r) => r.tipo === "visita_tecnica"),
    [viewScopedReports]
  );
  const recorridos = useMemo(
    () => viewScopedReports.filter((r) => r.tipo === "recorrido"),
    [viewScopedReports]
  );
  const grupales = useMemo(
    () => viewScopedReports.filter((r) => r.tipo === "actividad_grupal"),
    [viewScopedReports]
  );

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const clientsById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  const sharedVisitStats = useMemo(() => {
    const totalByKey = new Map<string, number>();
    const countByKey = new Map<string, number>();
    const percentageByReportId = new Map<string, number>();

    reports.forEach((report) => {
      if (!usesSharedBasePricing(report)) return;

      const key = getSharedPricingIdentity(report);
      totalByKey.set(key, (totalByKey.get(key) ?? 0) + (Number(report.costoActividad) || 0));
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    });

    reports.forEach((report) => {
      if (!usesSharedBasePricing(report)) return;

      const explicitPercentage = Number(report.porcentajeParticipacion ?? 0) || 0;
      if (explicitPercentage > 0) {
        percentageByReportId.set(report.id, explicitPercentage);
        return;
      }

      const key = getSharedPricingIdentity(report);
      const total = totalByKey.get(key) ?? 0;
      if (total > 0) {
        percentageByReportId.set(report.id, Number((((Number(report.costoActividad) || 0) / total) * 100).toFixed(2)));
        return;
      }

      const count = countByKey.get(key) ?? 1;
      percentageByReportId.set(report.id, Number((100 / count).toFixed(2)));
    });

    return { totalByKey, percentageByReportId };
  }, [reports]);

  const getSharedVisitBaseValue = useCallback(
    (report: ActivityReport) => {
      if (!isSharedVisit(report)) return getEffectiveTechnicalCost(report);

      const derivedTotal = sharedVisitStats.totalByKey.get(getSharedPricingIdentity(report))
        ?? getEffectiveTechnicalCost(report);

      return getPreferredSharedTotal([
        report.valorActividadAplicadoGlobal,
        report.valorActividadBaseGlobal,
      ], derivedTotal);
    },
    [getEffectiveTechnicalCost, sharedVisitStats.totalByKey]
  );

  const getVisitParticipationPercentage = useCallback(
    (report: ActivityReport) => {
      if (!isSharedVisit(report)) return 100;
      return sharedVisitStats.percentageByReportId.get(report.id) ?? 100;
    },
    [sharedVisitStats.percentageByReportId]
  );

  const getEditableTechnicalCost = useCallback(
    (report: ActivityReport) => {
      if (isSharedVisit(report)) {
        return getSharedVisitBaseValue(report);
      }

      return getEffectiveTechnicalCost(report);
    },
    [getEffectiveTechnicalCost, getSharedVisitBaseValue]
  );
  const getActivityTotalForReport = useCallback(
    (report: ActivityReport) => {
      if (!usesSharedBasePricing(report)) return getEffectiveTechnicalCost(report);

      if (isSharedVisit(report)) {
        return getSharedVisitBaseValue(report);
      }

      return sharedVisitStats.totalByKey.get(getSharedPricingIdentity(report)) ?? getEffectiveTechnicalCost(report);
    },
    [getEffectiveTechnicalCost, getSharedVisitBaseValue, sharedVisitStats.totalByKey]
  );
  const getExportTechnicalValue = useCallback(
    (report: ActivityReport, relatedReports?: ActivityReport[]) => {
      if (!usesSharedBasePricing(report)) {
        return getEffectiveTechnicalCost(report);
      }

      if (isSharedVisit(report)) {
        const scopedReports = relatedReports && relatedReports.length > 0 ? relatedReports : [report];
        const participantReports = dedupeReportsByTechnician(scopedReports);

        if (participantReports.length <= 1) {
          return getEffectiveTechnicalCost(participantReports[0] || report);
        }
      }

      return getActivityTotalForReport(report);
    },
    [getActivityTotalForReport, getEffectiveTechnicalCost]
  );
  const getSharedReportsForReport = useCallback((report: ActivityReport) => {
    if (!usesSharedBasePricing(report)) return [report];
    const sharedKey = getVisualActivityIdentity(report);
    return viewScopedReports.filter((item) => usesSharedBasePricing(item) && getVisualActivityIdentity(item) === sharedKey);
  }, [viewScopedReports]);
  const getParticipantName = useCallback((tecnicoId: string) => {
    const tech = usersById.get(tecnicoId);
    return [tech?.nombre, tech?.apellido].filter(Boolean).join(" ") || "Técnico sin nombre";
  }, [usersById]);

  const getTechnicalCostDraftKey = useCallback(
    (report: ActivityReport) => isSharedVisit(report) ? getSharedVisitIdentity(report) : report.id,
    []
  );

  const getInlineTechnicalCostValue = useCallback(
    (report: ActivityReport) => inlineTechnicalCostDrafts[getTechnicalCostDraftKey(report)] ?? String(getEditableTechnicalCost(report)),
    [getEditableTechnicalCost, getTechnicalCostDraftKey, inlineTechnicalCostDrafts]
  );

  const getInlineClientCostValue = useCallback(
    (report: ActivityReport) => inlineClientCostDrafts[report.id] ?? String(report.costoCliente ?? 0),
    [inlineClientCostDrafts]
  );

  const persistTechnicalCost = useCallback(async (report: ActivityReport, nextCost: number) => {
    await updateCostoActividadAdmin(report.id, nextCost, { visitId: report.visitaTecnicaId });

    if (isSharedVisit(report)) {
      const sharedKey = getSharedVisitIdentity(report);

      setReports((current) => current.map((item) => {
        if (!isSharedVisit(item) || getSharedVisitIdentity(item) !== sharedKey) return item;

        const percentage = getVisitParticipationPercentage(item);
        const technicalCost = Math.round((nextCost * percentage) / 100);

        return {
          ...item,
          costoActividad: technicalCost,
          valorActividadAplicadoGlobal: nextCost,
          valorActividadBaseGlobal: item.valorActividadBaseGlobal ?? getSharedVisitBaseValue(item),
          porcentajeParticipacion: percentage,
          valorModificado: nextCost !== (item.valorActividadBaseGlobal ?? getSharedVisitBaseValue(item)),
        };
      }));
      setSelectedReport((current) => {
        if (!current || !isSharedVisit(current) || getSharedVisitIdentity(current) !== sharedKey) return current;

        const percentage = getVisitParticipationPercentage(current);
        const technicalCost = Math.round((nextCost * percentage) / 100);

        return {
          ...current,
          costoActividad: technicalCost,
          valorActividadAplicadoGlobal: nextCost,
          valorActividadBaseGlobal: current.valorActividadBaseGlobal ?? getSharedVisitBaseValue(current),
          porcentajeParticipacion: percentage,
          valorModificado: nextCost !== (current.valorActividadBaseGlobal ?? getSharedVisitBaseValue(current)),
        };
      });
    } else {
      setReports((current) => current.map((item) => item.id === report.id ? {
        ...item,
        costoActividad: nextCost,
        valorModificado: item.tipo === "recorrido" ? nextCost !== getConfiguredRecorridoCost(item) : item.valorModificado,
      } : item));
      setSelectedReport((current) => current && current.id === report.id ? {
        ...current,
        costoActividad: nextCost,
        valorModificado: current.tipo === "recorrido" ? nextCost !== getConfiguredRecorridoCost(current) : current.valorModificado,
      } : current);
    }

    setInlineTechnicalCostDrafts((current) => {
      const draftKey = getTechnicalCostDraftKey(report);
      if (!(draftKey in current)) return current;
      const next = { ...current };
      delete next[draftKey];
      return next;
    });
  }, [getConfiguredRecorridoCost, getSharedVisitBaseValue, getTechnicalCostDraftKey, getVisitParticipationPercentage]);

  const persistVisitClientCost = useCallback(async (report: ActivityReport, nextCost: number | null) => {
    await updateCostoClienteVisitaAdmin(report.id, nextCost, report.visitaTecnicaId);
    const persistedCost = nextCost ?? 0;
    setReports((current) => current.map((item) => item.id === report.id ? { ...item, costoCliente: persistedCost } : item));
    setSelectedReport((current) => current && current.id === report.id ? { ...current, costoCliente: persistedCost } : current);
    setInlineClientCostDrafts((current) => {
      if (!(report.id in current)) return current;
      const next = { ...current };
      delete next[report.id];
      return next;
    });
  }, []);

  const handleInlineSaveTechnicalCost = async (report: ActivityReport) => {
    let nextCost: number;
    try {
      nextCost = parseTechnicalCostInput(inlineTechnicalCostDrafts[getTechnicalCostDraftKey(report)] ?? String(getEditableTechnicalCost(report)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo interpretar el costo tecnico.");
      return;
    }

    if (nextCost === getEditableTechnicalCost(report)) return;

    setSavingInlineTechnicalCostId(report.id);
    try {
      await persistTechnicalCost(report, nextCost);
    } catch (err) {
      console.error("Error actualizando costo tecnico del informe:", err);
      alert("No se pudo guardar el costo tecnico del informe.");
    } finally {
      setSavingInlineTechnicalCostId(null);
    }
  };

  const handleInlineSaveVisitClientCost = async (report: ActivityReport) => {
    let nextCost: number | null;
    try {
      nextCost = parseClientCostInput(inlineClientCostDrafts[report.id] ?? (report.costoCliente != null ? String(report.costoCliente) : ""));
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo interpretar el costo cliente.");
      return;
    }

    if (nextCost === (report.costoCliente ?? null)) return;

    setSavingInlineClientCostId(report.id);
    try {
      await persistVisitClientCost(report, nextCost);
    } catch (err) {
      console.error("Error actualizando costo cliente de la visita:", err);
      alert("No se pudo guardar el costo cliente de la visita.");
    } finally {
      setSavingInlineClientCostId(null);
    }
  };

  const handleSaveSelectedVisitClientCost = async () => {
    if (!selectedReport || selectedReport.tipo !== "visita_tecnica") return;

    let nextCost: number | null;
    try {
      nextCost = parseClientCostInput(editableClientCost);
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo interpretar el costo cliente.");
      return;
    }

    if (nextCost === (selectedReport.costoCliente ?? null)) return;

    setSavingClientCost(true);
    try {
      await persistVisitClientCost(selectedReport, nextCost);
    } catch (err) {
      console.error("Error actualizando costo cliente desde modal:", err);
      alert("No se pudo guardar el costo cliente de la visita.");
    } finally {
      setSavingClientCost(false);
    }
  };

  const handleSaveSelectedTechnicalCost = async () => {
    if (!selectedReport) return;

    let nextCost: number;
    try {
      nextCost = parseTechnicalCostInput(editableTechnicalCost);
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo interpretar el costo tecnico.");
      return;
    }

    if (nextCost === getEditableTechnicalCost(selectedReport)) return;

    setSavingTechnicalCost(true);
    try {
      await persistTechnicalCost(selectedReport, nextCost);
    } catch (err) {
      console.error("Error actualizando costo tecnico desde modal:", err);
      alert("No se pudo guardar el costo tecnico.");
    } finally {
      setSavingTechnicalCost(false);
    }
  };

  const getTipoLabel = (tipo: ActivityReport["tipo"]) => {
    if (tipo === "mantenimiento_preventivo") return "Mantenimiento Preventivo";
    if (tipo === "visita_tecnica") return "Visita Técnica";
    if (tipo === "recorrido") return "Recorrido";
    return "Actividad Grupal";
  };

  const getExportTitleLabel = (tipo: ActivityReport["tipo"]) => {
    if (tipo === "mantenimiento_preventivo") return "Mantenimientos Preventivos";
    if (tipo === "visita_tecnica") return "Visitas Técnicas";
    if (tipo === "recorrido") return "Recorridos";
    return "Actividades Grupales";
  };

  const buildMultilineText = buildReportMultilineText;

  const getSafeFileSegment = (value: string) => {
    return value
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "") || "reporte";
  };

  const getEvidenceCount = useCallback((report: ActivityReport) => {
    return (report.fotosAntes?.length || 0) + (report.fotosDespues?.length || 0) + (report.fotoBitacora ? 1 : 0) + (report.fotoHerramienta ? 1 : 0);
  }, []);

  const applySentState = (targetReport: ActivityReport, sentAt: string) => {
    setReports((current) => current.map((item) => {
      if (targetReport.id.startsWith("reg-")) {
        const parts = targetReport.id.split("-");
        const registroId = parts.slice(1, -1).join("-");
        return item.id.startsWith(`reg-${registroId}-`)
          ? { ...item, correoEnviado: true, fechaUltimoEnvioCorreo: sentAt }
          : item;
      }

      return item.id === targetReport.id
        ? { ...item, correoEnviado: true, fechaUltimoEnvioCorreo: sentAt }
        : item;
    }));

    setSelectedReport((current) => {
      if (!current) return current;

      if (targetReport.id.startsWith("reg-")) {
        const parts = targetReport.id.split("-");
        const registroId = parts.slice(1, -1).join("-");
        return current.id.startsWith(`reg-${registroId}-`)
          ? { ...current, correoEnviado: true, fechaUltimoEnvioCorreo: sentAt }
          : current;
      }

      return current.id === targetReport.id
        ? { ...current, correoEnviado: true, fechaUltimoEnvioCorreo: sentAt }
        : current;
    });
  };

  const getReportContext = (report: ActivityReport) => {
    const tech = usersById.get(report.tecnicoId);
    const client = report.clienteId ? clientsById.get(report.clienteId) : null;
    const reportYear = report.fecha ? new Date(`${report.fecha}T00:00:00`).getFullYear() : new Date().getFullYear();
    const contract = report.clienteId
      ? contracts.find((item) => item.clienteId === report.clienteId && item.anio === reportYear)
      : undefined;
    const group = groupsById.get(report.grupoId);
    const tecnicoNombre = tech ? `${tech.nombre} ${tech.apellido}`.trim() : "—";
    const companyName = companySettings?.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.";
    const tipoLabel = getTipoLabel(report.tipo);
    const edificio = client?.edificio || group?.nombre || tipoLabel;
    const visitCategoryLabel = report.tipo === "visita_tecnica" ? getVisitCategoryLabel(report.tipoVisita) : undefined;
    const maintenanceDetail = getReportServiceDetail(report);
    const puertasDetalle = report.tipo === "mantenimiento_preventivo" || report.tipo === "visita_tecnica"
      ? formatClientDoorBreakdown(contract || client)
      : undefined;
    const normalizedObservaciones = getDisplayReportObservations(report);

    const observaciones = (() => {
      if (report.tipo === "visita_tecnica") {
        return buildMultilineText([
          report.descripcion,
          normalizedObservaciones,
        ]);
      }

      if (report.tipo === "recorrido") {
        return buildMultilineText([
          report.puntoPartida ? `Punto de partida: ${report.puntoPartida}` : undefined,
          report.puntoLlegada ? `Punto de llegada: ${report.puntoLlegada}` : undefined,
          report.tipoRecorrido ? `Tipo de recorrido: ${report.tipoRecorrido === "con_herramienta" ? "Con herramienta" : "Normal"}` : undefined,
          normalizedObservaciones,
        ]);
      }

      if (report.tipo === "actividad_grupal") {
        return buildMultilineText([
          report.descripcion,
          report.especificacion ? `Especificación: ${report.especificacion}` : undefined,
          normalizedObservaciones,
        ]);
      }

      if (report.tipo === "mantenimiento_preventivo") {
        return buildMultilineText([
          maintenanceDetail,
          normalizedObservaciones,
          !maintenanceDetail ? report.descripcion : undefined,
        ]);
      }

      return buildMultilineText([
        report.descripcion,
        normalizedObservaciones,
      ]);
    })();

    return {
      client,
      tech,
      group,
      tipoLabel,
      companyName,
      tecnicoNombre,
      edificio,
      pdfData: {
        titulo:
          report.tipo === "mantenimiento_preventivo"
            ? "REPORTE DE MANTENIMIENTO PREVENTIVO"
            : report.tipo === "visita_tecnica"
              ? "REPORTE DE VISITA TÉCNICA"
              : report.tipo === "recorrido"
                ? "REPORTE DE RECORRIDO"
                : "REPORTE DE ACTIVIDAD GRUPAL",
        subtitulo:
          report.tipo === "visita_tecnica"
            ? "Informe técnico consolidado"
            : report.tipo === "recorrido"
              ? report.tipoRecorrido === "con_herramienta"
                ? "Recorrido con herramienta"
                : "Recorrido normal"
              : undefined,
        empresa: companyName,
        fecha: report.fecha,
        categoria: visitCategoryLabel,
        tecnico: tecnicoNombre,
        cliente: client?.nombre || "—",
        edificio,
        puertasDetalle,
        direccionCliente: client?.direccion || "—",
        correoCliente: client?.correo || "—",
        valorActividad: report.tipo === "visita_tecnica" || report.tipo === "mantenimiento_preventivo"
          ? undefined
          : getExportTechnicalValue(report),
        observaciones: observaciones || maintenanceDetail || report.descripcion || "Sin detalle registrado.",
        fotosAntes: report.fotosAntes,
        fotosDespues: report.fotosDespues,
        fotoBitacora: report.fotoBitacora,
        firmaUrl: report.firmaReceptor,
        receptor: report.datosReceptor,
      },
    };
  };

  const getReportEmailContext = (report: ActivityReport) => {
    const { client, group, pdfData, tipoLabel, companyName, tecnicoNombre, edificio } = getReportContext(report);
    const operationalEmail = companySettings?.correoEmpresa || DEFAULT_NOTIFICATION_BCC;
    const clienteNombre = client?.contacto || client?.nombre || "Cliente";
    const fileBaseName = getSafeFileSegment(client?.edificio || group?.nombre || tipoLabel);
    const maintenanceDetail = getReportServiceDetail(report);
    const normalizedObservaciones = getDisplayReportObservations(report);
    const resumen = maintenanceDetail || report.descripcion || report.especificacion || normalizedObservaciones || `Servicio de ${tipoLabel.toLowerCase()}`;

    const detailLines = (() => {
      if (report.tipo === "visita_tecnica") {
        return buildMultilineText([
          report.descripcion,
          normalizedObservaciones,
        ]);
      }

      if (report.tipo === "recorrido") {
        return buildMultilineText([
          report.puntoPartida ? `Punto de partida: ${report.puntoPartida}` : undefined,
          report.puntoLlegada ? `Punto de llegada: ${report.puntoLlegada}` : undefined,
          report.tipoRecorrido ? `Tipo de recorrido: ${report.tipoRecorrido === "con_herramienta" ? "Con herramienta" : "Normal"}` : undefined,
          report.fotoHerramienta ? "Incluye evidencia fotográfica de herramienta." : undefined,
          normalizedObservaciones,
        ]);
      }

      if (report.tipo === "actividad_grupal") {
        return buildMultilineText([
          report.descripcion,
          report.especificacion ? `Especificación: ${report.especificacion}` : undefined,
          normalizedObservaciones,
        ]);
      }

      if (report.tipo === "mantenimiento_preventivo") {
        return buildMultilineText([
          maintenanceDetail,
          normalizedObservaciones,
          !maintenanceDetail ? report.descripcion : undefined,
        ]);
      }

      return buildMultilineText([
        report.descripcion,
        normalizedObservaciones,
      ]);
    })();

    const template =
      report.tipo === "mantenimiento_preventivo"
        ? "maintenance-report"
        : report.tipo === "visita_tecnica"
          ? "technical-visit-report"
          : "approval-report";

    const templateData =
      report.tipo === "mantenimiento_preventivo"
        ? {
          companyName,
          clienteNombre,
          edificio,
          fecha: report.fecha,
          tecnicoNombre,
          observaciones: detailLines || resumen,
        }
        : report.tipo === "visita_tecnica"
          ? {
            companyName,
            clienteNombre,
            edificio,
            fecha: report.fecha,
            tecnicoNombre,
            tipoVisita: getVisitCategoryLabel(report.tipoVisita),
            descripcion: report.descripcion,
            observaciones: normalizedObservaciones,
          }
          : {
            companyName,
            clienteNombre,
            edificio,
            fecha: report.fecha,
            tecnicoNombre,
            tipoInforme: tipoLabel,
            resumen,
            observaciones: detailLines !== resumen ? detailLines : undefined,
          };

    return {
      client,
      operationalEmail,
      pdfData,
      template,
      templateData,
      subject: `Reporte de ${tipoLabel.toLowerCase()} - ${edificio}`,
      filename: `${getSafeFileSegment(tipoLabel)}_${fileBaseName}_${report.fecha}.pdf`,
      ccRecipients: [client?.correoAliado, operationalEmail].filter(Boolean),
    };
  };

  const handleDownloadPDF = async (report: ActivityReport) => {
    const { pdfData } = getReportContext(report);

    try {
      await generateReportePDF(pdfData);
    } catch (err) {
      console.error("Error generando PDF del informe técnico:", err);
      alert("Hubo un error al generar el PDF del informe.");
    }
  };

  const handleSendEmail = async (report: ActivityReport) => {
    if (!canSendReportEmail(report)) {
      alert("Las garantías no se exportan en el PDF enviado al cliente. Solo se envían correos para mantenimientos preventivos y visitas técnicas habilitadas.");
      return;
    }

    const context = getReportEmailContext(report);

    if (!context.client?.correo) {
      alert("Este informe no tiene correo del cliente registrado.");
      return;
    }

    setSendingReportId(report.id);

    try {
      const pdfBase64 = await generateReportePDF(context.pdfData, true) as string;
      const base64Content = pdfBase64.split(",")[1];

      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: context.client.correo,
          cc: context.ccRecipients,
          subject: context.subject,
          template: context.template,
          data: context.templateData,
          replyTo: context.operationalEmail,
          pdfAttachment: {
            filename: context.filename,
            base64: base64Content,
          },
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "No se pudo enviar el correo del informe.");
      }

      const sentAt = new Date().toISOString();
      await markReporteActividadEmailSent(report.id, sentAt);
      applySentState(report, sentAt);

      alert("Correo enviado correctamente.");
    } catch (err) {
      console.error("Error enviando correo del informe:", err);
      alert(err instanceof Error ? err.message : "Hubo un error al enviar el correo del informe.");
    } finally {
      setSendingReportId(null);
    }
  };

  const renderActionButtons = (report: ActivityReport, detailReports?: ActivityReport[]) => (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation();
          openReportDetail(report, detailReports);
        }}
      >
        <Eye className="h-4 w-4" />
      </Button>
      {canSendReportEmail(report) && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-cyan-neon"
          onClick={(event) => {
            event.stopPropagation();
            handleSendEmail(report);
          }}
          disabled={sendingReportId === report.id}
        >
          {sendingReportId === report.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-gold"
        onClick={(event) => {
          event.stopPropagation();
          handleDownloadPDF(report);
        }}
      >
        <Download className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={(event) => {
          event.stopPropagation();
          setReportToDelete(report);
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );

  const renderEmailStatusBadge = (report: ActivityReport) => (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px]",
        !canSendReportEmail(report)
          ? "bg-secondary text-muted-foreground border-border/50"
          : report.correoEnviado
            ? "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/30"
            : "bg-secondary text-muted-foreground border-border/50"
      )}
    >
      {!canSendReportEmail(report) ? (
        report.tipo === "visita_tecnica" && report.tipoVisita === "garantia"
          ? "Garantía sin envío"
          : "No aplica"
      ) : report.correoEnviado ? (
        <><Send className="mr-0.5 h-3 w-3" />Enviado</>
      ) : (
        "Pendiente"
      )}
    </Badge>
  );

  const openReportDetail = (report: ActivityReport, detailReports: ActivityReport[] = [report]) => {
    setSelectedReport(report);
    setSelectedDetailReports(detailReports);
    setSelectedParticipantReportId(report.id);
    setDetailOpen(true);
  };

  const matchesActivitySearch = useCallback((report: ActivityReport, participantNames: string[] = []) => {
    const client = report.clienteId ? clientsById.get(report.clienteId) : null;
    const group = groupsById.get(report.grupoId);
    const normalizedSearch = normalizeSearchValue(search);

    if (!normalizedSearch) {
      return true;
    }

    const searchableFields = [
      ...participantNames.map((name) => normalizeSearchValue(name)),
      normalizeSearchValue(client?.edificio),
      normalizeSearchValue(client?.nombre),
      normalizeSearchValue(group?.nombre),
      normalizeSearchValue(report.fecha),
      normalizeSearchValue(report.descripcion),
      normalizeSearchValue(report.especificacion),
    ];

    return searchableFields.some((field) => field.includes(normalizedSearch));
  }, [clientsById, groupsById, search]);

  const filterReports = useCallback((list: ActivityReport[]) =>
    list.filter((r) => {
      const tech = usersById.get(r.tecnicoId);
      const participantNames = tech ? [`${tech.nombre} ${tech.apellido}`.trim()] : [];
      const matchSearch = matchesActivitySearch(r, participantNames);
      const matchGrupo = grupoFilter === "todos" || r.grupoId === grupoFilter;
      return matchSearch && matchGrupo;
    }),
  [grupoFilter, matchesActivitySearch, usersById]);

  const buildGroupedActivityRows = useCallback((list: ActivityReport[]) => {
    const grouped = new Map<string, ActivityReport[]>();
    const uiScopedReports = dedupeGroupActivityRowsForUi(list);
    const canonicalPreventiveByKey = new Map<string, ActivityReport>();

    uiScopedReports.forEach((report) => {
      if (report.tipo !== "mantenimiento_preventivo") return;

      const key = getPreventiveMaintenanceCanonicalKey(report);
      const current = canonicalPreventiveByKey.get(key);
      const currentScore = current ? rankPreventiveMaintenanceReport(current) : -1;
      const nextScore = rankPreventiveMaintenanceReport(report);

      if (!current || nextScore > currentScore || (nextScore === currentScore && (report.fechaCreacion || "") > (current.fechaCreacion || ""))) {
        canonicalPreventiveByKey.set(key, report);
      }
    });

    uiScopedReports.forEach((report) => {
      if (report.tipo === "mantenimiento_preventivo") {
        const canonical = canonicalPreventiveByKey.get(getPreventiveMaintenanceCanonicalKey(report));
        if (canonical && canonical.id !== report.id) return;
      }

      const key = usesSharedBasePricing(report)
        ? `${report.tipo}:${getVisualActivityIdentity(report)}`
        : report.id;
      const current = grouped.get(key) || [];
      current.push(report);
      grouped.set(key, current);
    });

    return Array.from(grouped.values()).map((items) => {
      const uniqueTechnicianItems = Array.from(
        items.reduce((map, item) => {
          if (!map.has(item.tecnicoId) || item.registroActividadId) {
            map.set(item.tecnicoId, item);
          }
          return map;
        }, new Map<string, ActivityReport>()).values()
      );
      const leadReport = [...items].sort((a, b) => {
        if (a.id.startsWith("reg-") !== b.id.startsWith("reg-")) {
          return a.id.startsWith("reg-") ? 1 : -1;
        }

        if (!!a.registroActividadId !== !!b.registroActividadId) {
          return a.registroActividadId ? -1 : 1;
        }

        const creationCompare = (b.fechaCreacion || "").localeCompare(a.fechaCreacion || "");
        if (creationCompare !== 0) return creationCompare;
        return b.id.localeCompare(a.id);
      })[0];
      const participantNames = Array.from(new Set(uniqueTechnicianItems.map((item) => getParticipantName(item.tecnicoId))));
      const approvalDate = items
        .map((item) => item.fechaAprobacionLider)
        .filter(Boolean)
        .sort()
        .at(-1);
      const isShared = usesSharedBasePricing(leadReport) && uniqueTechnicianItems.length > 1;

      return {
        id: isShared ? `${leadReport.tipo}:${getVisualActivityIdentity(leadReport)}` : leadReport.id,
        report: leadReport,
        reports: uniqueTechnicianItems,
        tipo: leadReport.tipo,
        estadoAprobacionLider: (new Set(items.map((item) => item.estadoAprobacionLider))).size > 1
          ? "pendiente"
          : items.some((item) => item.estadoAprobacionLider === "pendiente")
            ? "pendiente"
            : items.some((item) => item.estadoAprobacionLider === "rechazado")
              ? "rechazado"
              : "aprobado",
        fechaAprobacionLider: approvalDate,
        costoActividad: isShared ? getActivityTotalForReport(leadReport) : getEffectiveTechnicalCost(leadReport),
        participantCount: participantNames.length,
        participantNames,
        isShared,
      } satisfies GroupedActivityRow;
    });
  }, [getActivityTotalForReport, getEffectiveTechnicalCost, getParticipantName]);

  const filterGroupedRows = useCallback((rows: GroupedActivityRow[]) => {
    return rows
      .filter((row) => {
        const matchSearch = matchesActivitySearch(row.report, row.participantNames);
        const matchGrupo = grupoFilter === "todos" || row.report.grupoId === grupoFilter;
        return matchSearch && matchGrupo;
      })
      .sort((a, b) => {
        const creationCompare = (b.report.fechaCreacion || "").localeCompare(a.report.fechaCreacion || "");
        if (creationCompare !== 0) return creationCompare;

        const dateCompare = (b.report.fecha || "").localeCompare(a.report.fecha || "");
        if (dateCompare !== 0) return dateCompare;

        return b.report.id.localeCompare(a.report.id);
      });
  }, [grupoFilter, matchesActivitySearch]);

  const groupedPreventivos = useMemo(() => buildGroupedActivityRows(preventivos).filter((row) => row.reports.some((r) => getEvidenceCount(r) > 0)), [buildGroupedActivityRows, preventivos, getEvidenceCount]);
  const groupedVisitas = useMemo(() => buildGroupedActivityRows(visitas), [buildGroupedActivityRows, visitas]);
  const groupedGrupales = useMemo(() => buildGroupedActivityRows(grupales), [buildGroupedActivityRows, grupales]);
  const filteredPreventivos = useMemo(() => filterGroupedRows(groupedPreventivos), [filterGroupedRows, groupedPreventivos]);
  const filteredVisitas = useMemo(() => filterGroupedRows(groupedVisitas), [filterGroupedRows, groupedVisitas]);
  const filteredRecorridos = useMemo(() => sortReportsByNewestCreation(filterReports(recorridos)), [filterReports, recorridos]);
  const filteredGrupales = useMemo(() => filterGroupedRows(groupedGrupales), [filterGroupedRows, groupedGrupales]);
  const groupedPreventivosCount = groupedPreventivos.length;
  const groupedVisitasCount = groupedVisitas.length;
  const groupedGrupalesCount = groupedGrupales.length;

  const paginatedPreventivos = useMemo(() => paginateReports(filteredPreventivos, tablePages.preventivos), [filteredPreventivos, tablePages.preventivos]);
  const paginatedVisitas = useMemo(() => paginateReports(filteredVisitas, tablePages.visitas), [filteredVisitas, tablePages.visitas]);
  const paginatedRecorridos = useMemo(() => paginateReports(filteredRecorridos, tablePages.recorridos), [filteredRecorridos, tablePages.recorridos]);
  const paginatedGrupales = useMemo(() => paginateReports(filteredGrupales, tablePages.grupales), [filteredGrupales, tablePages.grupales]);

  const exportScopedReports = useMemo(
    () => reports.filter((report) => isWithinDateRange(report.fecha, exportRangeStart, exportRangeEnd)),
    [reports, exportRangeStart, exportRangeEnd]
  );

  const selectedExportReports = useMemo(
    () => exportScopedReports
      .filter((report) => {
        if (report.tipo !== exportReportType) return false;
        if (exportReportType === "visita_tecnica" && isDeliveryVisit(report)) return false;
        if (exportReportType !== "mantenimiento_preventivo") return true;
        return preventiveExportClientId === "todos" || report.clienteId === preventiveExportClientId;
      })
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.fechaCreacion.localeCompare(b.fechaCreacion)),
    [exportScopedReports, exportReportType, preventiveExportClientId]
  );
  const selectedExportGroupedRows = useMemo(() => {
    if (exportReportType !== "visita_tecnica" && exportReportType !== "actividad_grupal" && exportReportType !== "mantenimiento_preventivo") return [];
    return buildGroupedActivityRows(selectedExportReports);
  }, [buildGroupedActivityRows, exportReportType, selectedExportReports]);
  const getParticipantSplitLabel = useCallback((reportsList: ActivityReport[]) => {
    return dedupeReportsByTechnician(reportsList)
      .map((report) => `${getParticipantName(report.tecnicoId)}: ${formatCurrency(getEffectiveTechnicalCost(report))}`)
      .join(" / ");
  }, [getEffectiveTechnicalCost, getParticipantName]);

  const selectedExportTechnicalTotal = useMemo(
    () => exportReportType === "visita_tecnica" || exportReportType === "actividad_grupal"
      ? selectedExportGroupedRows.reduce((sum, row) => sum + getExportTechnicalValue(row.report, row.reports), 0)
      : exportReportType === "mantenimiento_preventivo"
        ? selectedExportGroupedRows.reduce((sum, row) => sum + getExportTechnicalValue(row.report, row.reports), 0)
      : selectedExportReports.reduce((sum, report) => sum + getEffectiveTechnicalCost(report), 0),
    [exportReportType, getEffectiveTechnicalCost, getExportTechnicalValue, selectedExportGroupedRows, selectedExportReports]
  );

  const selectedExportClientTotal = useMemo(
    () => exportReportType === "visita_tecnica"
      ? selectedExportReports.reduce((sum, report) => sum + (Number(report.costoCliente ?? 0) || 0), 0)
      : 0,
    [exportReportType, selectedExportReports]
  );

  const selectedExportClientReports = useMemo(
    () => exportReportType === "visita_tecnica"
      ? selectedExportReports.filter((report) => report.tipoVisita !== "garantia" && report.tipoVisita !== "entregas")
      : [],
    [exportReportType, selectedExportReports]
  );

  const selectedExportClientVisibleTotal = useMemo(
    () => selectedExportClientReports.reduce((sum, report) => sum + (Number(report.costoCliente ?? 0) || 0), 0),
    [selectedExportClientReports]
  );

  const selectedPreventiveContracts = useMemo(() => {
    if (exportReportType !== "mantenimiento_preventivo") return [];

    const selectedYears = getYearRangeFromDates(exportRangeStart, exportRangeEnd);

    return contracts.filter((contract) => {
      const matchesClient = preventiveExportClientId === "todos" || contract.clienteId === preventiveExportClientId;
      const matchesYear = !selectedYears || selectedYears.has(contract.anio);
      return matchesClient && matchesYear;
    });
  }, [contracts, exportRangeEnd, exportRangeStart, exportReportType, preventiveExportClientId]);

  const selectedPreventiveAnnualTotal = useMemo(
    () => selectedPreventiveContracts.reduce((sum, contract) => sum + (Number(contract.costoTotalAnual) || 0), 0),
    [selectedPreventiveContracts]
  );

  const filteredPreventiveExportClients = useMemo(() => {
    const normalizedSearch = preventiveExportClientSearch.trim().toLowerCase();

    if (!normalizedSearch) return clients;

    return clients.filter((client) => {
      return (client.edificio || "").toLowerCase().includes(normalizedSearch)
        || (client.nombre || "").toLowerCase().includes(normalizedSearch)
        || (client.contacto || "").toLowerCase().includes(normalizedSearch)
        || (client.correo || "").toLowerCase().includes(normalizedSearch);
    });
  }, [clients, preventiveExportClientSearch]);

  const selectedPreventiveEntries = useMemo<PreventiveExportEntry[]>(() => {
    if (exportReportType !== "mantenimiento_preventivo") return [];

    return selectedExportReports
      .map((report) => {
        const reportYear = new Date(`${report.fecha}T00:00:00`).getFullYear();
        const contract = contracts.find((item) => item.clienteId === report.clienteId && item.anio === reportYear);
        const client = report.clienteId ? clientsById.get(report.clienteId) : null;
        const tech = usersById.get(report.tecnicoId);
        const matchingMaintenance = contract?.mantenimientosRealizados.find((maintenance) => {
          const candidateDate = maintenance.fechaRealizado || maintenance.fechaProgramada;
          return candidateDate === report.fecha;
        });
        const maintenanceDate = report.fecha || matchingMaintenance?.fechaRealizado || matchingMaintenance?.fechaProgramada || "";
        const reportedCost = Number(report.costoActividad) || 0;
        const maintenanceValue = reportedCost;

        return {
          report,
          contract,
          maintenanceDate,
          maintenanceValue,
          annualContractValue: contract?.costoTotalAnual || 0,
          clientName: client?.nombre || "—",
          buildingName: client?.edificio || client?.nombre || "—",
          technicianName: tech ? `${tech.nombre} ${tech.apellido}` : "—",
          detail: report.especificacion
            ? `${report.descripcion} · ${report.especificacion}`
            : (report.descripcion || "Mantenimiento preventivo realizado"),
          contractKey: contract ? contract.id : `${report.clienteId || "sin-cliente"}:${reportYear}`,
          monthKey: getMonthKey(maintenanceDate),
        };
      })
      .sort((left, right) => {
        return left.buildingName.localeCompare(right.buildingName, "es", { sensitivity: "base" })
          || left.maintenanceDate.localeCompare(right.maintenanceDate)
          || left.detail.localeCompare(right.detail, "es", { sensitivity: "base" });
      });
  }, [clientsById, contracts, exportReportType, selectedExportReports, usersById]);

  const selectedPreventiveMaintenanceTotal = useMemo(
    () => selectedPreventiveEntries.reduce((sum, entry) => sum + entry.maintenanceValue, 0),
    [selectedPreventiveEntries]
  );

  const selectedExportTotalDisplay = useMemo(
    () => exportReportType === "mantenimiento_preventivo"
      ? selectedPreventiveMaintenanceTotal
      : selectedExportTechnicalTotal,
    [exportReportType, selectedPreventiveMaintenanceTotal, selectedExportTechnicalTotal]
  );

  const activeRangeLabel = useMemo(() => formatRangeLabel(exportRangeStart, exportRangeEnd), [exportRangeStart, exportRangeEnd]);
  const selectedPreventiveClientLabel = useMemo(
    () => preventiveExportClientId === "todos"
      ? "Todos los clientes"
      : (clientsById.get(preventiveExportClientId)?.edificio || clientsById.get(preventiveExportClientId)?.nombre || "Cliente seleccionado"),
    [clientsById, preventiveExportClientId]
  );

  const selectedPreventiveAnnualRows = useMemo(() => {
    if (exportReportType !== "mantenimiento_preventivo") return [];

    return selectedPreventiveContracts
      .map((contract) => {
        const client = clientsById.get(contract.clienteId);
        const entries = selectedPreventiveEntries.filter((entry) => entry.contract?.id === contract.id);
        const executedValue = entries.reduce((sum, entry) => sum + entry.maintenanceValue, 0);
        const monthsCovered = new Set(entries.map((entry) => entry.monthKey)).size;

        return {
          contract,
          clientName: client?.nombre || "—",
          buildingName: client?.edificio || client?.nombre || "—",
          executedMaintenances: entries.length,
          executedValue,
          monthsCovered,
        };
      })
      .sort((left, right) => {
        return left.buildingName.localeCompare(right.buildingName, "es", { sensitivity: "base" })
          || left.contract.anio - right.contract.anio;
      });
  }, [clientsById, exportReportType, selectedPreventiveContracts, selectedPreventiveEntries]);

  const selectedPreventiveContractCount = useMemo(
    () => selectedPreventiveContracts.length,
    [selectedPreventiveContracts]
  );
  const selectedExportCountLabel = useMemo(
    () => exportReportType === "mantenimiento_preventivo"
      ? `${selectedExportGroupedRows.length} mantenimiento(s) · ${selectedPreventiveContractCount} contrato(s)`
      : exportReportType === "visita_tecnica" || exportReportType === "actividad_grupal"
        ? `${selectedExportGroupedRows.length} actividades`
        : `${selectedExportReports.length} registros`,
    [exportReportType, selectedExportGroupedRows.length, selectedExportReports.length, selectedPreventiveContractCount]
  );

  useEffect(() => {
    setTablePages({
      preventivos: 1,
      visitas: 1,
      recorridos: 1,
      grupales: 1,
    });
  }, [search, grupoFilter, viewRangeStart, viewRangeEnd, selectedPeriodId, periodScopedReports.length]);

  const applyQuickRange = useCallback((days?: number, months?: number) => {
    const nextEnd = today;
    const nextStart = months != null
      ? shiftDateString(nextEnd, -months, "months")
      : shiftDateString(nextEnd, -(Math.max((days ?? 1) - 1, 0)), "days");

    setExportRangeStart(nextStart);
    setExportRangeEnd(nextEnd);
  }, [today]);

  const applyViewQuincenaRange = useCallback((half: "primera" | "segunda") => {
    const range = getQuincenaRange(viewQuincenaMonth, half);
    setViewRangeStart(range.start);
    setViewRangeEnd(range.end);
  }, [viewQuincenaMonth]);

  const applyExportQuincenaRange = useCallback((half: "primera" | "segunda") => {
    const range = getQuincenaRange(exportQuincenaMonth, half);
    setExportRangeStart(range.start);
    setExportRangeEnd(range.end);
  }, [exportQuincenaMonth]);

  const handleExportPreventiveMonthlySummary = useCallback(() => {
    if (selectedPreventiveEntries.length === 0) {
      alert("No hay mantenimientos preventivos realizados en el rango seleccionado para exportar.");
      return;
    }

    setExportingPreventiveMonthlySummary(true);
    try {
      const rows: string[][] = [];
      let currentContractKey = "";
      let currentMonthKey = "";
      let currentMonthlyTotal = 0;

      selectedPreventiveEntries.forEach((entry, index) => {
        const contractKey = entry.contractKey;
        const monthKey = entry.monthKey;
        const isNewContract = contractKey !== currentContractKey;
        const isNewMonth = monthKey !== currentMonthKey;

        if (index > 0 && (isNewContract || isNewMonth)) {
          rows.push(["", "", "", "", `Cierre mensual ${formatMonthKey(currentMonthKey)}`, "", formatCurrency(currentMonthlyTotal)]);
          currentMonthlyTotal = 0;
        }

        if (index > 0 && isNewContract) {
          rows.push(["", "", "", "", "", "", ""]);
        }

        currentContractKey = contractKey;
        currentMonthKey = monthKey;
        currentMonthlyTotal += entry.maintenanceValue;

        rows.push([
          entry.maintenanceDate,
          entry.clientName,
          entry.buildingName,
          entry.technicianName,
          entry.detail,
          formatCurrency(entry.maintenanceValue),
          "",
        ]);
      });

      rows.push(["", "", "", "", `Cierre mensual ${formatMonthKey(currentMonthKey)}`, "", formatCurrency(currentMonthlyTotal)]);

      generateTablePDF({
        titulo: "REPORTE MENSUAL - MANTENIMIENTOS PREVENTIVOS",
        subtitulo: "Detalle de mantenimientos realizados con cierre mensual por cliente y rango seleccionado.",
        empresa: companySettings?.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        periodo: `${activeRangeLabel} · ${selectedPreventiveClientLabel}`,
        landscape: true,
        fileName: `preventivos_mensual_${preventiveExportClientId}_${exportRangeStart || "inicio"}_${exportRangeEnd || "fin"}`,
        summary: [
          { label: "Mantenimientos realizados", value: String(selectedPreventiveEntries.length) },
          { label: "Cliente", value: selectedPreventiveClientLabel },
          { label: "Total mensual / rango", value: formatCurrency(selectedPreventiveMaintenanceTotal) },
        ],
        headers: ["Fecha", "Cliente", "Edificio", "Técnico", "Detalle", "Valor técnico", "Cierre mensual"],
        rows,
        totales: ["", "", "", "", "Total", formatCurrency(selectedPreventiveMaintenanceTotal), ""],
      });
    } finally {
      setExportingPreventiveMonthlySummary(false);
    }
  }, [activeRangeLabel, companySettings?.nombre, exportRangeEnd, exportRangeStart, preventiveExportClientId, selectedPreventiveClientLabel, selectedPreventiveEntries, selectedPreventiveMaintenanceTotal]);

  const handleExportPreventiveAnnualSummary = useCallback(() => {
    if (selectedPreventiveAnnualRows.length === 0) {
      alert("No hay contratos preventivos para el cliente y año seleccionados.");
      return;
    }

    setExportingPreventiveAnnualSummary(true);
    try {
      generateTablePDF({
        titulo: "VALOR ANUAL - MANTENIMIENTOS PREVENTIVOS",
        subtitulo: "Resumen de contratos preventivos con valor anual contratado y ejecución del rango seleccionado.",
        empresa: companySettings?.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        periodo: `${activeRangeLabel} · ${selectedPreventiveClientLabel}`,
        landscape: true,
        fileName: `preventivos_anual_${preventiveExportClientId}_${exportRangeStart || "inicio"}_${exportRangeEnd || "fin"}`,
        summary: [
          { label: "Contratos", value: String(selectedPreventiveContractCount) },
          { label: "Valor anual contratado", value: formatCurrency(selectedPreventiveAnnualTotal) },
          { label: "Valor ejecutado rango", value: formatCurrency(selectedPreventiveMaintenanceTotal) },
        ],
        headers: ["Cliente", "Edificio", "Año", "Mant. contrato", "Valor por mant.", "Valor anual", "Mant. ejecutados", "Valor ejecutado"],
        rows: selectedPreventiveAnnualRows.map((item) => [
          item.clientName,
          item.buildingName,
          String(item.contract.anio),
          String(item.contract.cantidadMantenimientos),
          formatCurrency(item.contract.costoPorMantenimiento),
          formatCurrency(item.contract.costoTotalAnual),
          `${item.executedMaintenances} (${item.monthsCovered} mes${item.monthsCovered === 1 ? "" : "es"})`,
          formatCurrency(item.executedValue),
        ]),
        totales: ["", "", "", "", "", formatCurrency(selectedPreventiveAnnualTotal), "", formatCurrency(selectedPreventiveMaintenanceTotal)],
      });
    } finally {
      setExportingPreventiveAnnualSummary(false);
    }
  }, [activeRangeLabel, companySettings?.nombre, exportRangeEnd, exportRangeStart, preventiveExportClientId, selectedPreventiveAnnualRows, selectedPreventiveAnnualTotal, selectedPreventiveClientLabel, selectedPreventiveContractCount, selectedPreventiveMaintenanceTotal]);

  const handleExportTechnicalSummary = useCallback(() => {
    if ((exportReportType === "visita_tecnica" || exportReportType === "actividad_grupal") && selectedExportGroupedRows.length === 0) {
      alert(`No hay ${getExportTitleLabel(exportReportType).toLowerCase()} en el rango seleccionado para exportar.`);
      return;
    }

    if (selectedExportReports.length === 0) {
      alert(`No hay ${getExportTitleLabel(exportReportType).toLowerCase()} en el rango seleccionado para exportar.`);
      return;
    }

    setExportingTechnicalSummary(true);
    try {
      const sortedReports = [...selectedExportReports].sort((left, right) => {
        const leftTech = usersById.get(left.tecnicoId);
        const rightTech = usersById.get(right.tecnicoId);
        const leftTechName = leftTech ? `${leftTech.nombre} ${leftTech.apellido}` : "";
        const rightTechName = rightTech ? `${rightTech.nombre} ${rightTech.apellido}` : "";

        return leftTechName.localeCompare(rightTechName, "es", { sensitivity: "base" })
          || left.fecha.localeCompare(right.fecha)
          || (left.descripcion || "").localeCompare(right.descripcion || "", "es", { sensitivity: "base" });
      });

      const exportRows = exportReportType === "visita_tecnica" || exportReportType === "actividad_grupal"
        ? selectedExportGroupedRows.map((row) => {
          const report = row.report;
          const client = report.clienteId ? clientsById.get(report.clienteId) : null;
          const projectName = client?.edificio || client?.nombre || groupsById.get(report.grupoId)?.nombre || "—";
          const detail = report.especificacion
            ? `${report.descripcion} · ${report.especificacion}`
            : report.descripcion;
          const exportValue = getExportTechnicalValue(report, row.reports);

          return exportReportType === "visita_tecnica"
            ? [
              report.fecha,
              projectName,
              getVisitCategoryLabel(report.tipoVisita),
              detail || "—",
              getParticipantSplitLabel(row.reports),
              row.estadoAprobacionLider,
              formatCurrency(exportValue),
            ]
            : [
              report.fecha,
              projectName,
              detail || "—",
              getParticipantSplitLabel(row.reports),
              row.estadoAprobacionLider,
              formatCurrency(exportValue),
            ];
        })
        : exportReportType === "recorrido"
        ? (() => {
          const rows: string[][] = [];
          let currentTechName = "";
          let currentSubtotal = 0;

          sortedReports.forEach((report, index) => {
            const tech = usersById.get(report.tecnicoId);
            const client = report.clienteId ? clientsById.get(report.clienteId) : null;
            const projectName = client?.edificio || client?.nombre || groupsById.get(report.grupoId)?.nombre || "—";
            const detail = report.especificacion
              ? `${report.descripcion} · ${report.especificacion}`
              : report.descripcion;
            const techName = tech ? `${tech.nombre} ${tech.apellido}` : "—";

            if (index === 0) {
              currentTechName = techName;
            }

            if (techName !== currentTechName) {
              rows.push(["", `${currentTechName}`, "", "", "Subtotal", formatCurrency(currentSubtotal)]);
              rows.push(["", "", "", "", "", ""]);
              currentTechName = techName;
              currentSubtotal = 0;
            }

            currentSubtotal += getEffectiveTechnicalCost(report);
            rows.push([
              report.fecha,
              techName,
              projectName,
              detail || "—",
              report.estadoAprobacionLider,
              formatCurrency(getEffectiveTechnicalCost(report)),
            ]);
          });

          if (sortedReports.length > 0) {
            rows.push(["", `${currentTechName}`, "", "", "Subtotal", formatCurrency(currentSubtotal)]);
          }

          return rows;
        })()
        : sortedReports.map((report) => {
          const tech = usersById.get(report.tecnicoId);
          const client = report.clienteId ? clientsById.get(report.clienteId) : null;
          const projectName = client?.edificio || client?.nombre || groupsById.get(report.grupoId)?.nombre || "—";
          const detail = report.especificacion
            ? `${report.descripcion} · ${report.especificacion}`
            : report.descripcion;

          return [
            report.fecha,
            tech ? `${tech.nombre} ${tech.apellido}` : "—",
            projectName,
            detail || "—",
            report.estadoAprobacionLider,
            formatCurrency(report.costoActividad),
          ];
        });

      generateTablePDF({
        titulo: `Reporte Consolidado de ${getExportTitleLabel(exportReportType)}`,
        subtitulo: exportReportType === "visita_tecnica"
          ? "Resumen administrativo de costos técnicos de visitas sin evidencia fotográfica."
          : `Resumen administrativo de ${getExportTitleLabel(exportReportType).toLowerCase()} sin evidencia fotográfica.`,
        empresa: companySettings?.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        periodo: activeRangeLabel,
        landscape: true,
        fileName: `reporte_${exportReportType}_${exportRangeStart || "inicio"}_${exportRangeEnd || "fin"}`,
        summary: [
          { label: exportReportType === "visita_tecnica" || exportReportType === "actividad_grupal" ? "Actividades" : "Registros", value: String(exportReportType === "visita_tecnica" || exportReportType === "actividad_grupal" ? selectedExportGroupedRows.length : selectedExportReports.length) },
          { label: "Tipo", value: getExportTitleLabel(exportReportType) },
          { label: exportReportType === "visita_tecnica" ? "Total costo técnico" : "Total", value: formatCurrency(selectedExportTechnicalTotal) },
        ],
        headers: exportReportType === "visita_tecnica"
          ? ["Fecha", "Cliente / Proyecto", "Categoría", "Actividad", "Técnicos", "Estado", "Costo técnico"]
          : exportReportType === "actividad_grupal"
            ? ["Fecha", "Grupo / Cliente", "Actividad", "Técnicos", "Estado", "Costo"]
            : ["Fecha", "Técnico", "Cliente / Proyecto", "Detalle", "Estado", "Costo"],
        rows: exportRows,
        totales: exportReportType === "visita_tecnica"
          ? ["", "", "", "", "", "Total", formatCurrency(selectedExportTechnicalTotal)]
          : exportReportType === "actividad_grupal"
            ? ["", "", "", "", "Total", formatCurrency(selectedExportTechnicalTotal)]
            : ["", "", "", "", "Total", formatCurrency(selectedExportTechnicalTotal)],
      });
    } finally {
      setExportingTechnicalSummary(false);
    }
  }, [
    activeRangeLabel,
    clientsById,
    companySettings?.nombre,
    exportRangeEnd,
    exportRangeStart,
    exportReportType,
    getEffectiveTechnicalCost,
    getExportTechnicalValue,
    groupsById,
    getParticipantSplitLabel,
    selectedExportGroupedRows,
    selectedExportReports,
    selectedExportTechnicalTotal,
    usersById,
  ]);

  const updateTablePage = useCallback((table: ReportTableKey, page: number) => {
    setTablePages((current) => ({
      ...current,
      [table]: page,
    }));
  }, []);

  const renderTablePagination = useCallback((table: ReportTableKey, currentPage: number, totalPages: number) => {
    if (totalPages <= 1) return null;

    return (
      <div className="border-t border-border/50 px-4 py-3 flex justify-center">
        <Pagination className="w-auto justify-center">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => updateTablePage(table, Math.max(1, currentPage - 1))}
                className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, index) => {
              const page = index + 1;

              return (
                <PaginationItem key={`${table}-${page}`}>
                  <PaginationLink
                    onClick={() => updateTablePage(table, page)}
                    isActive={page === currentPage}
                    className="cursor-pointer"
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              );
            })}
            <PaginationItem>
              <PaginationNext
                onClick={() => updateTablePage(table, Math.min(totalPages, currentPage + 1))}
                className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    );
  }, [updateTablePage]);

  const handleExportClientSummary = useCallback(() => {
    if (selectedExportClientReports.length === 0) {
      alert("No hay visitas técnicas exportables al cliente en el rango seleccionado. Las garantías y entregas se excluyen de este PDF.");
      return;
    }

    setExportingClientSummary(true);
    try {
      generateTablePDF({
        titulo: "Reporte Consolidado de Costos Cliente",
        subtitulo: "Relación de valores cobrados al cliente para visitas técnicas en el período seleccionado.",
        empresa: companySettings?.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        periodo: activeRangeLabel,
        landscape: true,
        fileName: `costos_cliente_${exportRangeStart || "inicio"}_${exportRangeEnd || "fin"}`,
        summary: [
          { label: "Visitas incluidas", value: String(selectedExportClientReports.length) },
          { label: "Rango", value: activeRangeLabel },
          { label: "Total costo cliente", value: formatCurrency(selectedExportClientVisibleTotal) },
        ],
        headers: ["Fecha", "Técnico", "Cliente / Proyecto", "Categoría", "Detalle", "Costo cliente"],
        rows: selectedExportClientReports.map((report) => {
          const tech = usersById.get(report.tecnicoId);
          const client = report.clienteId ? clientsById.get(report.clienteId) : null;
          const projectName = client?.edificio || client?.nombre || "—";

          return [
            report.fecha,
            tech ? `${tech.nombre} ${tech.apellido}` : "—",
            projectName,
            getVisitCategoryLabel(report.tipoVisita),
            report.descripcion || "—",
            formatCurrency(report.costoCliente ?? 0),
          ];
        }),
        totales: ["", "", "", "", "Total", formatCurrency(selectedExportClientVisibleTotal)],
      });
    } finally {
      setExportingClientSummary(false);
    }
  }, [activeRangeLabel, clientsById, companySettings?.nombre, exportRangeEnd, exportRangeStart, selectedExportClientReports, selectedExportClientVisibleTotal, usersById]);

  if (loading) {
    return (
      <div>
        <AdminHeader title="Informes Técnicos" />
        <AdminPageLoader
          title="Cargando informes técnicos"
          message="Estamos preparando los reportes, técnicos, clientes y grupos."
          statsCount={4}
          rows={6}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Informes Técnicos" />
      <div className="p-6 space-y-6">
        {hasSelectedPeriod && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border/50 bg-card/80">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2.5">
                  <Wrench className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{groupedPreventivosCount}</p>
                  <p className="text-xs text-muted-foreground">Mant. Preventivos</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/80">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-cyan-neon/10 p-2.5">
                  <ClipboardCheck className="h-5 w-5 text-cyan-neon" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{groupedVisitasCount}</p>
                  <p className="text-xs text-muted-foreground">Visitas Técnicas</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/80">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-emerald-500/10 p-2.5">
                  <Route className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{recorridos.length}</p>
                  <p className="text-xs text-muted-foreground">Recorridos</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/80">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-purple-500/10 p-2.5">
                  <Users className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{groupedGrupalesCount}</p>
                  <p className="text-xs text-muted-foreground">Act. Grupales</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={!hasSelectedPeriod}
              className="pl-10 bg-secondary/50 border-border/50"
            />
          </div>
          <Select value={selectedPeriodId || undefined} onValueChange={setSelectedPeriodId}>
            <SelectTrigger className="w-56 bg-secondary/50 border-border/50" disabled={periods.length === 0}>
              <SelectValue placeholder="Selecciona un período" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {periods.map((period) => (
                <SelectItem key={period.id} value={period.id}>
                  {formatPeriodLabel(period)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="date"
              value={viewRangeStart}
              onChange={(event) => setViewRangeStart(event.target.value)}
              disabled={!hasSelectedPeriod}
              className="w-40 bg-secondary/50 border-border/50"
            />
            <Input
              type="date"
              value={viewRangeEnd}
              onChange={(event) => setViewRangeEnd(event.target.value)}
              disabled={!hasSelectedPeriod}
              className="w-40 bg-secondary/50 border-border/50"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={!hasSelectedPeriod}
              onClick={() => {
                setViewRangeStart(selectedPeriod?.fechaInicio || "");
                setViewRangeEnd(selectedPeriod?.fechaFin || "");
              }}
            >
              Restablecer período
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
            <span className="text-xs text-muted-foreground">Quincena</span>
            <Input
              type="month"
              value={viewQuincenaMonth}
              onChange={(event) => setViewQuincenaMonth(event.target.value)}
              disabled={!hasSelectedPeriod}
              className="w-40 bg-secondary/50 border-border/50"
            />
            <Button type="button" variant="outline" size="sm" className="border-border/50 bg-secondary/40" onClick={() => applyViewQuincenaRange("primera")} disabled={!hasSelectedPeriod}>
              1ra
            </Button>
            <Button type="button" variant="outline" size="sm" className="border-border/50 bg-secondary/40" onClick={() => applyViewQuincenaRange("segunda")} disabled={!hasSelectedPeriod}>
              2da
            </Button>
          </div>
          <Select value={grupoFilter} onValueChange={setGrupoFilter} disabled={!hasSelectedPeriod}>
            <SelectTrigger className="w-44 bg-secondary/50 border-border/50">
              <SelectValue placeholder="Grupo" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="todos">Todos</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="border-gold/30 bg-gold/10 text-gold">
            {selectedPeriod ? `Período activo: ${formatPeriodLabel(selectedPeriod)}` : periods.length > 0 ? "Selecciona un período" : "No hay períodos disponibles"}
          </Badge>
        </div>

        {hasSelectedPeriod && (
          <Collapsible open={exportPanelOpen} onOpenChange={setExportPanelOpen}>
            <Card className="border-border/50 bg-card/80 overflow-hidden">
              <CollapsibleTrigger asChild>
                <button type="button" className="w-full text-left">
                  <CardHeader className="pb-4 cursor-pointer hover:bg-secondary/10 transition-colors">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <CardTitle className="text-lg text-foreground">Reportes Consolidados</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {getExportTitleLabel(exportReportType)} · {selectedExportCountLabel}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Este panel usa solo sus propias fechas y no depende del período ni de los filtros externos.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="border-gold/30 bg-gold/10 text-gold">
                          {activeRangeLabel}
                        </Badge>
                        <Badge variant="outline" className="border-border/50 bg-secondary/40 text-foreground/80">
                          {getExportTitleLabel(exportReportType)}
                        </Badge>
                        <div className={cn("rounded-full border border-border/50 p-1 transition-transform", exportPanelOpen && "rotate-180")}>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <CardContent className="space-y-5 pt-0">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.8fr)]">
                    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", exportReportType === "mantenimiento_preventivo" ? "xl:grid-cols-4" : "xl:grid-cols-4")}>
                      <div className="space-y-2 sm:col-span-2 xl:col-span-1">
                        <p className="text-xs text-muted-foreground">Tipo de reporte</p>
                        <Select value={exportReportType} onValueChange={(value) => setExportReportType(value as ActivityReport["tipo"])}>
                          <SelectTrigger className="w-full bg-secondary/50 border-border/50">
                            <SelectValue placeholder="Tipo" />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            <SelectItem value="mantenimiento_preventivo">Mantenimiento preventivo</SelectItem>
                            <SelectItem value="visita_tecnica">Visitas técnicas</SelectItem>
                            <SelectItem value="recorrido">Recorridos</SelectItem>
                            <SelectItem value="actividad_grupal">Actividades grupales</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {exportReportType === "mantenimiento_preventivo" && (
                        <div className="space-y-2 sm:col-span-2 xl:col-span-1">
                          <p className="text-xs text-muted-foreground">Cliente destino</p>
                          <Popover open={preventiveClientSelectorOpen} onOpenChange={setPreventiveClientSelectorOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full justify-between border-border/50 bg-secondary/50 text-foreground hover:bg-secondary/70"
                              >
                                <span className="truncate text-left">{selectedPreventiveClientLabel}</span>
                                <ChevronDown className="h-4 w-4 opacity-60" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] border-border bg-card p-3" align="start">
                              <div className="space-y-3">
                                <Input
                                  value={preventiveExportClientSearch}
                                  onChange={(event) => setPreventiveExportClientSearch(event.target.value)}
                                  placeholder="Buscar cliente, edificio o correo"
                                  className="bg-secondary/50 border-border/50"
                                />
                                <ScrollArea className="h-56 rounded-md border border-border/50">
                                  <div className="space-y-1 p-2">
                                    <button
                                      type="button"
                                      className={cn(
                                        "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-secondary/50",
                                        preventiveExportClientId === "todos" && "bg-gold/10 text-gold"
                                      )}
                                      onClick={() => {
                                        setPreventiveExportClientId("todos");
                                        setPreventiveClientSelectorOpen(false);
                                      }}
                                    >
                                      <span>Todos los clientes</span>
                                      {preventiveExportClientId === "todos" && <span className="text-xs">Seleccionado</span>}
                                    </button>
                                    {filteredPreventiveExportClients.map((client) => {
                                      const label = client.edificio || client.nombre;
                                      const isSelected = preventiveExportClientId === client.id;

                                      return (
                                        <button
                                          key={client.id}
                                          type="button"
                                          className={cn(
                                            "flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-secondary/50",
                                            isSelected && "bg-gold/10 text-gold"
                                          )}
                                          onClick={() => {
                                            setPreventiveExportClientId(client.id);
                                            setPreventiveClientSelectorOpen(false);
                                          }}
                                        >
                                          <span className="text-sm font-medium">{label}</span>
                                          <span className="text-xs text-muted-foreground">{client.nombre}{client.correo ? ` · ${client.correo}` : ""}</span>
                                        </button>
                                      );
                                    })}
                                    {filteredPreventiveExportClients.length === 0 && (
                                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">No hay clientes que coincidan con la búsqueda.</p>
                                    )}
                                  </div>
                                </ScrollArea>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                      )}
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Fecha inicial</p>
                        <Input
                          type="date"
                          value={exportRangeStart}
                          onChange={(event) => setExportRangeStart(event.target.value)}
                          className="bg-secondary/50 border-border/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Fecha final</p>
                        <Input
                          type="date"
                          value={exportRangeEnd}
                          onChange={(event) => setExportRangeEnd(event.target.value)}
                          className="bg-secondary/50 border-border/50"
                        />
                      </div>
                      {exportReportType !== "mantenimiento_preventivo" && (
                        <div className="space-y-2 sm:col-span-2 xl:col-span-2">
                          <p className="text-xs text-muted-foreground">Rangos rápidos</p>
                          <div className="flex flex-wrap gap-2">
                            <Input
                              type="month"
                              value={exportQuincenaMonth}
                              onChange={(event) => setExportQuincenaMonth(event.target.value)}
                              className="w-40 bg-secondary/50 border-border/50"
                            />
                            <Button type="button" variant="outline" size="sm" className="border-border/50 bg-secondary/40" onClick={() => applyExportQuincenaRange("primera")}>
                              1ra quincena
                            </Button>
                            <Button type="button" variant="outline" size="sm" className="border-border/50 bg-secondary/40" onClick={() => applyExportQuincenaRange("segunda")}>
                              2da quincena
                            </Button>
                            <Button type="button" variant="outline" size="sm" className="border-border/50 bg-secondary/40" onClick={() => applyQuickRange(7)}>
                              7 días
                            </Button>
                            <Button type="button" variant="outline" size="sm" className="border-border/50 bg-secondary/40" onClick={() => applyQuickRange(15)}>
                              15 días
                            </Button>
                            <Button type="button" variant="outline" size="sm" className="border-border/50 bg-secondary/40" onClick={() => applyQuickRange(undefined, 1)}>
                              1 mes
                            </Button>
                            <Button type="button" variant="outline" size="sm" className="border-border/50 bg-secondary/40" onClick={() => applyQuickRange(undefined, 3)}>
                              3 meses
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground"
                              onClick={() => {
                                setExportRangeStart("");
                                setExportRangeEnd("");
                              }}
                            >
                              Quitar rango
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 sm:p-4">
                        <p className="text-xs text-muted-foreground">Total seleccionado</p>
                        <p className="text-lg font-semibold text-gold">{formatCurrency(selectedExportTotalDisplay)}</p>
                        <p className="text-xs text-muted-foreground">{selectedExportCountLabel}</p>
                      </div>
                      {exportReportType === "mantenimiento_preventivo" && (
                        <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 sm:p-4">
                          <p className="text-xs text-muted-foreground">Total anual contratos</p>
                          <p className="text-lg font-semibold text-gold">{formatCurrency(selectedPreventiveAnnualTotal)}</p>
                          <p className="text-xs text-muted-foreground">{selectedPreventiveContractCount} contrato(s) del cliente y año seleccionado</p>
                        </div>
                      )}
                      {exportReportType === "visita_tecnica" && (
                        <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 sm:p-4">
                          <p className="text-xs text-muted-foreground">Total costo cliente</p>
                          <p className="text-lg font-semibold text-gold">{formatCurrency(selectedExportClientTotal)}</p>
                          <p className="text-xs text-muted-foreground">Solo visitas técnicas</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    {exportReportType === "mantenimiento_preventivo" ? (
                      <>
                        <Button type="button" className="w-full bg-gold text-black hover:bg-gold/90 sm:w-auto" onClick={handleExportPreventiveMonthlySummary} disabled={exportingPreventiveMonthlySummary}>
                          {exportingPreventiveMonthlySummary ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          Reporte mensual
                        </Button>
                        <Button type="button" variant="outline" className="w-full border-gold/30 text-gold hover:bg-gold/10 hover:text-gold sm:w-auto" onClick={handleExportPreventiveAnnualSummary} disabled={exportingPreventiveAnnualSummary}>
                          {exportingPreventiveAnnualSummary ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          Valor anual
                        </Button>
                      </>
                    ) : (
                      <Button type="button" className="w-full bg-gold text-black hover:bg-gold/90 sm:w-auto" onClick={handleExportTechnicalSummary} disabled={exportingTechnicalSummary}>
                        {exportingTechnicalSummary ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {exportReportType === "visita_tecnica" ? "PDF costos técnicos" : `PDF ${getExportTitleLabel(exportReportType).toLowerCase()}`}
                      </Button>
                    )}
                    {exportReportType === "visita_tecnica" && (
                      <Button type="button" variant="outline" className="w-full border-gold/30 text-gold hover:bg-gold/10 hover:text-gold sm:w-auto" onClick={handleExportClientSummary} disabled={exportingClientSummary}>
                        {exportingClientSummary ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        PDF costos cliente
                      </Button>
                    )}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

        {hasSelectedPeriod ? (
          <Tabs defaultValue="preventivos" className="space-y-4">
            <TabsList className="bg-secondary/50 border border-border/50">
              <TabsTrigger value="preventivos" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
                <Wrench className="h-4 w-4 mr-2" />
                Mant. Preventivo
                <Badge className="ml-1.5 bg-blue-500/20 text-blue-400 text-[10px] border-0 px-1.5">{groupedPreventivosCount}</Badge>
              </TabsTrigger>
              <TabsTrigger value="visitas" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
                <ClipboardCheck className="h-4 w-4 mr-2" />
                Visitas Técnicas
                <Badge className="ml-1.5 bg-cyan-neon/20 text-cyan-neon text-[10px] border-0 px-1.5">{groupedVisitasCount}</Badge>
              </TabsTrigger>
              <TabsTrigger value="recorridos" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
                <Route className="h-4 w-4 mr-2" />
                Recorridos
                <Badge className="ml-1.5 bg-emerald-500/20 text-emerald-400 text-[10px] border-0 px-1.5">{recorridos.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="grupales" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
                <Users className="h-4 w-4 mr-2" />
                Act. Grupales
                <Badge className="ml-1.5 bg-purple-500/20 text-purple-400 text-[10px] border-0 px-1.5">{groupedGrupalesCount}</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preventivos">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg text-foreground flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-blue-400" />
                    Informes de Mantenimiento Preventivo
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Reportes generados desde el aplicativo para los mantenimientos programados desde la web. Incluyen firma del receptor, bitácora obligatoria y fotos.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="text-muted-foreground">Técnico</TableHead>
                        <TableHead className="text-muted-foreground">Cliente</TableHead>
                        <TableHead className="text-muted-foreground">Fecha</TableHead>
                        <TableHead className="text-muted-foreground">Receptor</TableHead>
                        <TableHead className="text-muted-foreground">Bitácora</TableHead>
                        <TableHead className="text-muted-foreground">Fotos</TableHead>
                        <TableHead className="text-muted-foreground">Líder</TableHead>
                        <TableHead className="text-muted-foreground">Aprobación</TableHead>
                        <TableHead className="text-muted-foreground">Correo</TableHead>
                        <TableHead className="text-muted-foreground text-right">Costo</TableHead>
                        <TableHead className="text-muted-foreground w-32"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedPreventivos.items.map((row) => {
                        const r = row.report;
                        const tech = usersById.get(r.tecnicoId);
                        const client = r.clienteId ? clientsById.get(r.clienteId) : null;
                        const leader = usersById.get(r.liderGrupoId);
                        return (
                          <TableRow key={row.id} className="border-border/50 hover:bg-secondary/30 cursor-pointer" onClick={() => openReportDetail(r, row.reports)}>
                            <TableCell className="text-sm font-medium text-foreground">
                              {row.participantCount > 1
                                ? `${row.participantCount} participantes`
                                : `${tech?.nombre || ""} ${tech?.apellido || ""}`.trim() || "—"}
                              {row.participantCount > 1 && (
                                <p className="text-xs text-muted-foreground truncate">{row.participantNames.join(", ")}</p>
                              )}
                            </TableCell>
                            <TableCell>
                              <p className="text-sm text-foreground/80">{client?.edificio}</p>
                              {r.especificacion && (
                                <p className="text-xs text-muted-foreground truncate">
                                  Especificación: {r.especificacion}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                            <TableCell>
                              {r.datosReceptor ? (
                                <div className="flex items-center gap-1.5">
                                  <PenLine className="h-3.5 w-3.5 text-gold" />
                                  <div>
                                    <p className="text-xs text-foreground">{r.datosReceptor.nombre}</p>
                                    <p className="text-[10px] text-muted-foreground">{r.datosReceptor.cargo}</p>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {r.bitacora ? (
                                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                  <BookOpen className="h-3 w-3 mr-0.5" />
                                  Sí
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] bg-secondary text-muted-foreground border-border/50">
                                  No
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <ImageIcon className="h-3 w-3" />
                                {getEvidenceCount(r)}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-foreground/80">
                              {leader?.nombre} {leader?.apellido}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  r.estadoAprobacionLider === "aprobado"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                )}
                              >
                                {r.estadoAprobacionLider === "aprobado" ? (
                                  <><CheckCircle2 className="h-3 w-3 mr-0.5" />Aprobado</>
                                ) : (
                                  <><Clock className="h-3 w-3 mr-0.5" />Pendiente</>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>{renderEmailStatusBadge(r)}</TableCell>
                            <TableCell className="text-right font-semibold text-gold text-sm">
                              {formatCurrency(row.costoActividad)}
                            </TableCell>
                            <TableCell>{renderActionButtons(r, row.reports)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {renderTablePagination("preventivos", paginatedPreventivos.currentPage, paginatedPreventivos.totalPages)}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="visitas">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg text-foreground flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-cyan-neon" />
                    Informes de Visitas Técnicas
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Visitas del día a día: imprevistos, garantías, emergencias y entregas. Las entregas aparecen en la tabla, pero no se exportan en PDF.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="text-muted-foreground">Actividad</TableHead>
                        <TableHead className="text-muted-foreground">Cliente</TableHead>
                        <TableHead className="text-muted-foreground">Categoría</TableHead>
                        <TableHead className="text-muted-foreground">Fecha</TableHead>
                        <TableHead className="text-muted-foreground">Técnicos</TableHead>
                        <TableHead className="text-muted-foreground">Fotos</TableHead>
                        <TableHead className="text-muted-foreground">Aprobación Líder</TableHead>
                        <TableHead className="text-muted-foreground">Correo</TableHead>
                        <TableHead className="text-muted-foreground text-right">Valor real</TableHead>
                        <TableHead className="text-muted-foreground text-right">Costo cliente</TableHead>
                        <TableHead className="text-muted-foreground w-32"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedVisitas.items.map((row) => {
                        const r = row.report;
                        const client = r.clienteId ? clientsById.get(r.clienteId) : null;
                        const categoryLabel = row.reports.length > 1
                          ? "Actividad compartida"
                          : getVisitCategoryLabel(r.tipoVisita);
                        const totalFotos = row.reports.reduce((sum, item) => sum + getEvidenceCount(item), 0);
                        const inlineTechnicalCostValue = getInlineTechnicalCostValue(r);
                        const normalizedCurrentTechnicalCost = getEditableTechnicalCost(r);
                        const normalizedDraftTechnicalCost = inlineTechnicalCostValue.trim() ? Number(inlineTechnicalCostValue) : 0;
                        const isInlineTechnicalCostDirty = normalizedDraftTechnicalCost !== normalizedCurrentTechnicalCost;
                        const isInlineTechnicalCostSaving = savingInlineTechnicalCostId === r.id;
                        const inlineClientCostValue = getInlineClientCostValue(r);
                        const normalizedCurrentClientCost = r.costoCliente ?? 0;
                        const normalizedDraftClientCost = inlineClientCostValue.trim() ? Number(inlineClientCostValue) : 0;
                        const isInlineClientCostDirty = normalizedDraftClientCost !== normalizedCurrentClientCost;
                        const isInlineClientCostSaving = savingInlineClientCostId === r.id;
                        return (
                          <TableRow key={row.id} className="border-border/50 hover:bg-secondary/30 cursor-pointer" onClick={() => openReportDetail(r, row.reports)}>
                            <TableCell className="max-w-60">
                              <p className="text-sm font-medium text-foreground truncate">{r.descripcion}</p>
                              {r.especificacion && (
                                <p className="text-xs text-muted-foreground truncate">Especificación: {r.especificacion}</p>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">
                              {client?.edificio || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  r.tipoVisita === "garantia"
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : r.tipoVisita === "emergencia"
                                      ? "bg-red-500/10 text-red-400 border-red-500/20"
                                      : "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20"
                                )}
                              >
                                {categoryLabel}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                            <TableCell className="max-w-56">
                              <div>
                                <p className="text-sm text-foreground/80 truncate">{row.participantCount} técnico(s)</p>
                                <p className="text-xs text-muted-foreground truncate">{row.participantNames.join(", ")}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <ImageIcon className="h-3 w-3" />
                                {totalFotos}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  row.estadoAprobacionLider === "aprobado"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : row.estadoAprobacionLider === "rechazado"
                                      ? "bg-red-500/10 text-red-400 border-red-500/20"
                                      : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                )}
                              >
                                {row.estadoAprobacionLider === "aprobado" ? (
                                  <><CheckCircle2 className="h-3 w-3 mr-0.5" />Aprobado → Actividad</>
                                ) : row.estadoAprobacionLider === "rechazado" ? (
                                  <>Rechazado</>
                                ) : (
                                  <><Clock className="h-3 w-3 mr-0.5" />Pendiente</>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>{renderEmailStatusBadge(r)}</TableCell>
                            <TableCell className="text-right">
                              <div className="ml-auto flex w-full max-w-34 items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                                <div className="relative w-24 sm:w-28">
                                  <DollarSign className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gold" />
                                  <Input
                                    type="number"
                                    min="0"
                                    value={inlineTechnicalCostValue}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) =>
                                      setInlineTechnicalCostDrafts((current) => ({
                                        ...current,
                                        [getTechnicalCostDraftKey(r)]: event.target.value,
                                      }))
                                    }
                                    className={cn(
                                      "h-8 pl-7 pr-2 text-right bg-secondary/50 border-border/50 text-sm font-semibold text-gold",
                                      isInlineTechnicalCostDirty && "border-gold/50 bg-gold/5"
                                    )}
                                  />
                                </div>
                                {isInlineTechnicalCostDirty && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 text-gold hover:bg-gold/10 hover:text-gold"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleInlineSaveTechnicalCost(r);
                                    }}
                                    disabled={isInlineTechnicalCostSaving}
                                  >
                                    {isInlineTechnicalCostSaving ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Save className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">Base de la actividad</p>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="ml-auto flex w-full max-w-34 items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                                <div className="relative w-24 sm:w-28">
                                  <DollarSign className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gold" />
                                  <Input
                                    type="number"
                                    min="0"
                                    value={inlineClientCostValue}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) =>
                                      setInlineClientCostDrafts((current) => ({
                                        ...current,
                                        [r.id]: event.target.value,
                                      }))
                                    }
                                    className={cn(
                                      "h-8 pl-7 pr-2 text-right bg-secondary/50 border-border/50 text-sm font-semibold text-gold",
                                      isInlineClientCostDirty && "border-gold/50 bg-gold/5"
                                    )}
                                  />
                                </div>
                                {isInlineClientCostDirty && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 text-gold hover:bg-gold/10 hover:text-gold"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleInlineSaveVisitClientCost(r);
                                    }}
                                    disabled={isInlineClientCostSaving}
                                  >
                                    {isInlineClientCostSaving ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Save className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                              </div>
                              {row.isShared && <p className="mt-1 text-xs text-muted-foreground">Se edita desde la actividad</p>}
                            </TableCell>
                            <TableCell>{renderActionButtons(r, row.reports)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {renderTablePagination("visitas", paginatedVisitas.currentPage, paginatedVisitas.totalPages)}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="recorridos">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg text-foreground flex items-center gap-2">
                    <Route className="h-5 w-5 text-emerald-400" />
                    Informes de Recorridos
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Recorridos reportados desde el aplicativo. Incluyen punto de partida, punto de llegada, modalidad (normal o con herramienta) y foto obligatoria de herramienta cuando aplica.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="text-muted-foreground">Técnico</TableHead>
                        <TableHead className="text-muted-foreground">Fecha</TableHead>
                        <TableHead className="text-muted-foreground">Partida</TableHead>
                        <TableHead className="text-muted-foreground">Llegada</TableHead>
                        <TableHead className="text-muted-foreground">Modalidad</TableHead>
                        <TableHead className="text-muted-foreground">Herramienta</TableHead>
                        <TableHead className="text-muted-foreground">Aprobación</TableHead>
                        <TableHead className="text-muted-foreground">Correo</TableHead>
                        <TableHead className="text-muted-foreground text-right">Costo</TableHead>
                        <TableHead className="text-muted-foreground w-32"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedRecorridos.items.map((r) => {
                        const tech = usersById.get(r.tecnicoId);
                        const inlineTechnicalCostValue = getInlineTechnicalCostValue(r);
                        const normalizedCurrentTechnicalCost = getEffectiveTechnicalCost(r);
                        const normalizedDraftTechnicalCost = inlineTechnicalCostValue.trim() ? Number(inlineTechnicalCostValue) : 0;
                        const isInlineTechnicalCostDirty = normalizedDraftTechnicalCost !== normalizedCurrentTechnicalCost;
                        const isInlineTechnicalCostSaving = savingInlineTechnicalCostId === r.id;
                        return (
                          <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30 cursor-pointer" onClick={() => openReportDetail(r)}>
                            <TableCell className="text-sm font-medium text-foreground">
                              {tech?.nombre} {tech?.apellido}
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 max-w-40">
                                <MapPin className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                <span className="text-xs text-foreground/80 truncate">{r.puntoPartida}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 max-w-40">
                                <MapPin className="h-3.5 w-3.5 text-gold shrink-0" />
                                <span className="text-xs text-foreground/80 truncate">{r.puntoLlegada}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  r.tipoRecorrido === "con_herramienta"
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                )}
                              >
                                {r.tipoRecorrido === "con_herramienta" ? (
                                  <><Package className="h-3 w-3 mr-0.5" />Con Herram.</>
                                ) : (
                                  <><Route className="h-3 w-3 mr-0.5" />Normal</>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {r.fotoHerramienta ? (
                                <span className="text-xs text-foreground/80 flex items-center gap-1">
                                  <ImageIcon className="h-3 w-3 text-amber-400" /> Adjunta
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  r.estadoAprobacionLider === "aprobado"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                )}
                              >
                                {r.estadoAprobacionLider === "aprobado" ? "Aprobado" : "Pendiente"}
                              </Badge>
                            </TableCell>
                            <TableCell>{renderEmailStatusBadge(r)}</TableCell>
                            <TableCell className="text-right">
                              <div className="ml-auto flex w-full max-w-34 items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                                <div className="relative w-24 sm:w-28">
                                  <DollarSign className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gold" />
                                  <Input
                                    type="number"
                                    min="0"
                                    value={inlineTechnicalCostValue}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={(event) =>
                                      setInlineTechnicalCostDrafts((current) => ({
                                        ...current,
                                        [r.id]: event.target.value,
                                      }))
                                    }
                                    className={cn(
                                      "h-8 pl-7 pr-2 text-right bg-secondary/50 border-border/50 text-sm font-semibold text-gold",
                                      isInlineTechnicalCostDirty && "border-gold/50 bg-gold/5"
                                    )}
                                  />
                                </div>
                                {isInlineTechnicalCostDirty && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 text-gold hover:bg-gold/10 hover:text-gold"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleInlineSaveTechnicalCost(r);
                                    }}
                                    disabled={isInlineTechnicalCostSaving}
                                  >
                                    {isInlineTechnicalCostSaving ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Save className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Configuración actual: {formatCurrency(getConfiguredRecorridoCost(r))}
                              </p>
                            </TableCell>
                            <TableCell>{renderActionButtons(r)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {renderTablePagination("recorridos", paginatedRecorridos.currentPage, paginatedRecorridos.totalPages)}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="grupales">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg text-foreground flex items-center gap-2">
                    <Users className="h-5 w-5 text-purple-400" />
                    Actividades Grupales
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Actividades registradas por el líder desde el aplicativo móvil. Cada participante tiene su propio registro con porcentaje y valor calculado.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="text-muted-foreground">Actividad</TableHead>
                        <TableHead className="text-muted-foreground">Grupo</TableHead>
                        <TableHead className="text-muted-foreground">Fecha</TableHead>
                        <TableHead className="text-muted-foreground">Técnicos</TableHead>
                        <TableHead className="text-muted-foreground">Líder</TableHead>
                        <TableHead className="text-muted-foreground">Aprobación</TableHead>
                        <TableHead className="text-muted-foreground">Correo</TableHead>
                        <TableHead className="text-muted-foreground text-right">Valor real</TableHead>
                        <TableHead className="text-muted-foreground w-32"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedGrupales.items.map((row) => {
                        const r = row.report;
                        const group = groupsById.get(r.grupoId);
                        const leader = usersById.get(r.liderGrupoId);
                        return (
                          <TableRow key={row.id} className="border-border/50 hover:bg-secondary/30 cursor-pointer" onClick={() => openReportDetail(r, row.reports)}>
                            <TableCell className="max-w-60">
                              <p className="text-sm font-medium text-foreground truncate">{r.descripcion}</p>
                              {r.especificacion && (
                                <p className="text-xs text-muted-foreground truncate">Especificación: {r.especificacion}</p>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-foreground/80">{group?.nombre || "—"}</TableCell>
                            <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                            <TableCell className="max-w-56">
                              <div>
                                <p className="text-sm text-foreground/80 truncate">{row.participantCount} técnico(s)</p>
                                <p className="text-xs text-muted-foreground truncate">{row.participantNames.join(", ")}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-foreground/80">
                              {leader?.nombre} {leader?.apellido}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  row.estadoAprobacionLider === "aprobado"
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                    : row.estadoAprobacionLider === "rechazado"
                                      ? "bg-red-500/10 text-red-400 border-red-500/20"
                                      : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                )}
                              >
                                {row.estadoAprobacionLider === "aprobado" ? (
                                  <><CheckCircle2 className="h-3 w-3 mr-0.5" />Aprobado</>
                                ) : row.estadoAprobacionLider === "rechazado" ? (
                                  <>Rechazado</>
                                ) : (
                                  <><Clock className="h-3 w-3 mr-0.5" />Pendiente</>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>{renderEmailStatusBadge(r)}</TableCell>
                            <TableCell className="text-right font-semibold text-gold text-sm">
                              {formatCurrency(row.costoActividad)}
                            </TableCell>
                            <TableCell>{renderActionButtons(r, row.reports)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {renderTablePagination("grupales", paginatedGrupales.currentPage, paginatedGrupales.totalPages)}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : (
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              {periods.length > 0
                ? "Selecciona un período para ver los informes técnicos."
                : "No hay períodos disponibles para mostrar informes técnicos."}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedReport(null);
            setSelectedDetailReports([]);
            setSelectedParticipantReportId(null);
          }
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalle del Informe Técnico</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Vista completa del reporte seleccionado para revisión administrativa.
            </DialogDescription>
          </DialogHeader>
          {selectedReport && (() => {
            const modalReports = selectedDetailReports.length > 0
              ? selectedDetailReports
              : usesSharedBasePricing(selectedReport)
                ? getSharedReportsForReport(selectedReport)
                : [selectedReport];
            const modalParticipantReports = dedupeReportsByTechnician(modalReports);
            const activeDetailReport = modalParticipantReports.find((report) => report.id === selectedParticipantReportId)
              || modalParticipantReports[0]
              || modalReports[0]
              || selectedReport;
            const tech = usersById.get(activeDetailReport.tecnicoId);
            const leader = usersById.get(activeDetailReport.liderGrupoId);
            const client = activeDetailReport.clienteId ? clientsById.get(activeDetailReport.clienteId) : null;
            const group = groupsById.get(activeDetailReport.grupoId);
            const totalFotos = getEvidenceCount(activeDetailReport);
            const isSharedPricing = usesSharedBasePricing(selectedReport);
            const participationPercentage = getVisitParticipationPercentage(activeDetailReport);
            const editableTechnicalBase = getEditableTechnicalCost(activeDetailReport);
            const displayedSuggestedValue = isSharedPricing
              ? getSuggestedTechnicalValueForReports(modalParticipantReports)
              : getSuggestedTechnicalValue(activeDetailReport);
            const displayedSuggestionReason = isSharedPricing
              ? (getSuggestionReasonForReports(modalParticipantReports) || selectedReport.motivoSugerenciaValor || activeDetailReport.motivoSugerenciaValor)
              : activeDetailReport.motivoSugerenciaValor;
            const technicalPreviewValue = isSharedPricing
              ? Math.round(((editableTechnicalCost.trim() ? Number(editableTechnicalCost) : 0) * participationPercentage) / 100)
              : (editableTechnicalCost.trim() ? Number(editableTechnicalCost) : 0);

            return (
              <div className="space-y-5">
                {modalParticipantReports.length > 1 && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Actividad consolidada</p>
                      <p className="text-xs text-muted-foreground">Selecciona un técnico para ver el detalle individual dentro de esta actividad.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {modalParticipantReports.map((report) => {
                        const participantName = getParticipantName(report.tecnicoId);
                        const isActive = report.id === activeDetailReport.id;

                        return (
                          <Button
                            key={report.id}
                            type="button"
                            variant="outline"
                            size="sm"
                            className={cn(
                              "border-border/50 bg-background/40 text-foreground hover:bg-secondary/40",
                              isActive && "border-gold/40 bg-gold/10 text-gold"
                            )}
                            onClick={() => {
                              setSelectedParticipantReportId(report.id);
                              setSelectedReport(report);
                            }}
                          >
                            {participantName}
                          </Button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Actividad</p>
                        <p className="text-sm font-medium text-foreground">{selectedReport.descripcion}</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Participantes</p>
                        <p className="text-sm font-medium text-foreground">{modalParticipantReports.length}</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Valor real</p>
                        <p className="text-sm font-medium text-gold">{formatCurrency(getActivityTotalForReport(selectedReport))}</p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Tipo</p>
                    <p className="text-sm font-medium text-foreground">{getTipoLabel(activeDetailReport.tipo)}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Técnico</p>
                    <p className="text-sm font-medium text-foreground">{tech ? `${tech.nombre} ${tech.apellido}` : "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Grupo</p>
                    <p className="text-sm font-medium text-foreground">{group?.nombre || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Líder</p>
                    <p className="text-sm font-medium text-foreground">{leader ? `${leader.nombre} ${leader.apellido}` : "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Fecha</p>
                    <p className="text-sm font-medium text-foreground">{activeDetailReport.fecha}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Costo técnico</p>
                    <p className="text-sm font-medium text-gold">{formatCurrency(getEffectiveTechnicalCost(activeDetailReport))}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Estado aprobación</p>
                    <p className="text-sm font-medium text-foreground">{activeDetailReport.estadoAprobacionLider}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Fecha aprobación</p>
                    <p className="text-sm font-medium text-foreground">{activeDetailReport.fechaAprobacionLider || "Pendiente"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Fotos</p>
                    <p className="text-sm font-medium text-foreground">{totalFotos}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Correo</p>
                    <div className="mt-1">{renderEmailStatusBadge(selectedReport)}</div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                    <p className="text-xs text-muted-foreground">Último envío</p>
                    <p className="text-sm font-medium text-foreground">{formatDateTime(activeDetailReport.fechaUltimoEnvioCorreo)}</p>
                  </div>
                  {client && (
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 md:col-span-2 lg:col-span-3">
                      <p className="text-xs text-muted-foreground">Cliente / Proyecto</p>
                      <p className="text-sm font-medium text-foreground">{client.nombre} — {client.edificio}</p>
                    </div>
                  )}
                  {client && (
                    <>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 md:col-span-2 lg:col-span-3">
                        <p className="text-xs text-muted-foreground">Dirección</p>
                        <p className="text-sm font-medium text-foreground">{client.direccion || "Sin dirección registrada"}</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 md:col-span-2 lg:col-span-3">
                        <p className="text-xs text-muted-foreground">Correo del cliente</p>
                        <p className="text-sm font-medium text-foreground break-all">{client.correo || "Sin correo registrado"}</p>
                      </div>
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                  <p className="text-xs text-muted-foreground">Descripción</p>
                  <p className="text-sm text-foreground">{activeDetailReport.descripcion || "—"}</p>
                </div>

                {getReportServiceDetail(activeDetailReport) && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Actividades realizadas</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{getReportServiceDetail(activeDetailReport)}</p>
                  </div>
                )}

                {activeDetailReport.especificacion && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Especificación</p>
                    <p className="text-sm text-foreground">{activeDetailReport.especificacion}</p>
                  </div>
                )}

                {getDisplayReportObservations(activeDetailReport) && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Observaciones</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{getDisplayReportObservations(activeDetailReport)}</p>
                  </div>
                )}

                {displayedSuggestedValue != null && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Valor sugerido</p>
                    <p className="text-sm font-medium text-amber-200">{formatCurrency(displayedSuggestedValue ?? 0)}</p>
                    <p className="text-sm text-foreground/80">{displayedSuggestionReason || "Sin motivo registrado."}</p>
                  </div>
                )}

                {activeDetailReport.tipo === "visita_tecnica" && (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-3">
                      <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Categoría de la visita</p>
                        <p className="text-sm font-medium text-foreground">{getVisitCategoryLabel(activeDetailReport.tipoVisita)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Resumen económico</p>
                        <p className="text-sm text-foreground/80">
                          {isSharedPricing
                            ? "Esta visita comparte una base global entre varios participantes. El costo técnico del registro se calcula automáticamente según el porcentaje asignado al técnico."
                              : "El valor real corresponde al costo interno del servicio. El costo cliente se define manualmente desde administracion para esta visita."}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-3">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">{isSharedPricing ? "Editar valor real base" : "Editar valor real"}</p>
                          <p className="text-xs text-foreground/70">
                            {isSharedPricing
                              ? "Al guardar, se recalculan todos los técnicos de esta visita según su porcentaje."
                              : "La sugerencia enviada desde la app no cambia este valor. Solo administración define y guarda el valor real aplicado."}
                          </p>
                        </div>
                        <div className="relative max-w-40">
                          <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
                          <Input
                            type="number"
                            min="0"
                            value={editableTechnicalCost}
                            onChange={(event) => setEditableTechnicalCost(event.target.value)}
                            className={cn(
                              "pl-9 bg-background/70 border-border/50 text-gold font-semibold",
                              (editableTechnicalCost.trim() ? Number(editableTechnicalCost) : 0) !== editableTechnicalBase
                              && "border-gold shadow-[0_0_0_1px_rgba(234,179,8,0.25)]"
                            )}
                          />
                        </div>
                        {isSharedPricing && (
                          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-xs text-muted-foreground space-y-1">
                            <p>Base actual: {formatCurrency(getSharedVisitBaseValue(selectedReport))}</p>
                            <p>Participación: {participationPercentage}%</p>
                            <p>Costo técnico actual: {formatCurrency(activeDetailReport.costoActividad ?? 0)}</p>
                            <p>Vista previa técnico: {formatCurrency(technicalPreviewValue)}</p>
                          </div>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full gap-2 border-border/50 text-foreground hover:bg-secondary/40"
                          onClick={handleSaveSelectedTechnicalCost}
                          disabled={savingTechnicalCost || (editableTechnicalCost.trim() ? Number(editableTechnicalCost) : 0) === editableTechnicalBase}
                        >
                          {savingTechnicalCost ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          {savingTechnicalCost ? "Guardando..." : isSharedPricing ? "Guardar valor real base" : "Guardar valor real"}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-gold/20 bg-gold/5 p-4 space-y-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">Editar costo cliente</p>
                        <p className="text-xs text-muted-foreground">
                          Este valor es independiente del valor real interno y solo lo define administracion.
                        </p>
                      </div>
                      <div className="relative max-w-40">
                        <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
                        <Input
                          type="number"
                          min="0"
                          value={editableClientCost}
                          onChange={(event) => setEditableClientCost(event.target.value)}
                          className={cn(
                            "pl-9 bg-background/70 border-gold/20 text-gold font-semibold",
                            (editableClientCost.trim() ? Number(editableClientCost) : 0) !== (activeDetailReport.costoCliente ?? 0)
                            && "border-gold shadow-[0_0_0_1px_rgba(234,179,8,0.25)]"
                          )}
                        />
                      </div>
                      <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                        <p className="text-xs text-muted-foreground">Estado</p>
                        <p className="text-sm font-medium text-foreground">
                          Configurado manualmente
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
                        onClick={handleSaveSelectedVisitClientCost}
                        disabled={savingClientCost || (editableClientCost.trim() ? Number(editableClientCost) : 0) === (activeDetailReport.costoCliente ?? 0)}
                      >
                        {savingClientCost ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        {savingClientCost ? "Guardando..." : "Guardar costo cliente"}
                      </Button>
                    </div>
                  </div>
                )}

                {activeDetailReport.datosReceptor && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Receptor</p>
                    <p className="text-sm text-foreground">
                      {activeDetailReport.datosReceptor.nombre}
                      {activeDetailReport.datosReceptor.cedula ? ` · CC: ${activeDetailReport.datosReceptor.cedula}` : ""}
                      {activeDetailReport.datosReceptor.cargo ? ` · ${activeDetailReport.datosReceptor.cargo}` : ""}
                    </p>
                  </div>
                )}

                {(activeDetailReport.tipo === "mantenimiento_preventivo" || activeDetailReport.tipo === "visita_tecnica") && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Bitácora</p>
                      <p className="text-sm font-medium text-foreground">{activeDetailReport.bitacora ? "Sí" : "No"}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Firma receptor</p>
                      <p className="text-sm font-medium text-foreground">{activeDetailReport.firmaReceptor ? "Registrada" : "No registrada"}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                      <p className="text-xs text-muted-foreground">Fotos evidencias</p>
                      <p className="text-sm font-medium text-foreground">{totalFotos}</p>
                    </div>
                  </div>
                )}

                {activeDetailReport.tipo === "recorrido" && (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                        <p className="text-xs text-muted-foreground">Punto de partida</p>
                        <p className="text-sm font-medium text-foreground">{activeDetailReport.puntoPartida || "—"}</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                        <p className="text-xs text-muted-foreground">Punto de llegada</p>
                        <p className="text-sm font-medium text-foreground">{activeDetailReport.puntoLlegada || "—"}</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                        <p className="text-xs text-muted-foreground">Tipo de recorrido</p>
                        <p className="text-sm font-medium text-foreground">{activeDetailReport.tipoRecorrido || "—"}</p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-gold/20 bg-gold/5 p-4 space-y-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">Editar valor real del recorrido</p>
                        <p className="text-xs text-muted-foreground">
                          Valor real configurado: {formatCurrency(getConfiguredRecorridoCost(activeDetailReport))}
                        </p>
                      </div>
                      <div className="relative max-w-40">
                        <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
                        <Input
                          type="number"
                          min="0"
                          value={editableTechnicalCost}
                          onChange={(event) => setEditableTechnicalCost(event.target.value)}
                          className={cn(
                            "pl-9 bg-background/70 border-gold/20 text-gold font-semibold",
                            (editableTechnicalCost.trim() ? Number(editableTechnicalCost) : 0) !== getEffectiveTechnicalCost(activeDetailReport)
                            && "border-gold shadow-[0_0_0_1px_rgba(234,179,8,0.25)]"
                          )}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
                        onClick={handleSaveSelectedTechnicalCost}
                        disabled={savingTechnicalCost || (editableTechnicalCost.trim() ? Number(editableTechnicalCost) : 0) === getEffectiveTechnicalCost(activeDetailReport)}
                      >
                        {savingTechnicalCost ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        {savingTechnicalCost ? "Guardando..." : "Guardar valor real"}
                      </Button>
                    </div>
                  </div>
                )}

                {totalFotos > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">Evidencia fotográfica</p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {activeDetailReport.fotosAntes && activeDetailReport.fotosAntes.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Antes ({activeDetailReport.fotosAntes.length})</p>
                          <div className="grid grid-cols-2 gap-2">
                            {activeDetailReport.fotosAntes.map((url, index) => (
                              <a key={`antes-${index}`} href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border border-border/50 bg-secondary/20">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={`Antes ${index + 1}`} className="h-full w-full object-cover" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {activeDetailReport.fotosDespues && activeDetailReport.fotosDespues.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Después ({activeDetailReport.fotosDespues.length})</p>
                          <div className="grid grid-cols-2 gap-2">
                            {activeDetailReport.fotosDespues.map((url, index) => (
                              <a key={`despues-${index}`} href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border border-border/50 bg-secondary/20">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={`Después ${index + 1}`} className="h-full w-full object-cover" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {activeDetailReport.fotoBitacora && (
                        <div className="space-y-2 md:col-span-2">
                          <p className="text-xs text-muted-foreground">Foto de bitácora</p>
                          <a
                            href={activeDetailReport.fotoBitacora}
                            target="_blank"
                            rel="noreferrer"
                            className="block max-w-md overflow-hidden rounded-md border border-border/50 bg-secondary/20"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={activeDetailReport.fotoBitacora} alt="Foto de bitácora" className="h-full w-full object-cover" />
                          </a>
                        </div>
                      )}
                      {activeDetailReport.fotoHerramienta && (
                        <div className="space-y-2 md:col-span-2">
                          <p className="text-xs text-muted-foreground">Foto de herramienta</p>
                          <a
                            href={activeDetailReport.fotoHerramienta}
                            target="_blank"
                            rel="noreferrer"
                            className="block max-w-md overflow-hidden rounded-md border border-border/50 bg-secondary/20"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={activeDetailReport.fotoHerramienta} alt="Foto de herramienta" className="h-full w-full object-cover" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 border-t border-border/50 pt-2">
                  {canSendReportEmail(selectedReport) && (
                    <Button
                      variant="outline"
                      className="gap-2 border-border/50 text-foreground/80"
                      onClick={() => handleSendEmail(activeDetailReport)}
                      disabled={sendingReportId === activeDetailReport.id}
                    >
                      {sendingReportId === activeDetailReport.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
                      Enviar correo
                    </Button>
                  )}
                    <Button
                      variant="outline"
                      className="gap-2 border-border/50 text-foreground/80"
                      onClick={() => handleDownloadPDF(activeDetailReport)}
                    >
                    <Download className="h-4 w-4" />
                    Descargar PDF
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!reportToDelete}
        onOpenChange={(open) => {
          if (!open && !deletingReportId) setReportToDelete(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmar eliminación</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Seguro que deseas eliminar este informe? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setReportToDelete(null)}
              disabled={!!deletingReportId}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleDeleteReport}
              disabled={!!deletingReportId}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingReportId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deletingReportId ? "Eliminando..." : "Sí, eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deletingReportId && (
        <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center">
          <div className="rounded-lg border border-border bg-card px-6 py-4 flex items-center gap-3 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-gold" />
            <p className="text-sm text-foreground">Eliminando informe...</p>
          </div>
        </div>
      )}
    </div>
  );
}
