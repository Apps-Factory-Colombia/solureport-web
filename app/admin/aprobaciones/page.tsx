"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  Eye,
  Wrench,
  Route,
  ClipboardCheck,
  ShieldCheck,
  DollarSign,
  ImageIcon,
  MapPin,
  PenLine,
  FileText,
  Package,
  Users,
  Save,
  RotateCcw,
  Trash2,
  Loader2,
} from "lucide-react";
import { ActivityReport, User, Client, WorkGroup } from "@/lib/types";
import {
  deleteReporteActividadAdmin,
  getReportesActividad,
  updateActividadGrupalBaseAdmin,
  updateCostoActividadAdmin,
  updateEstadoAprobacion,
} from "@/lib/supabase/services/reportes-actividad";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getGrupos } from "@/lib/supabase/services/grupos";
import { getConfiguracion, updateConfiguracion } from "@/lib/supabase/services/configuracion";
import { createNotificacion } from "@/lib/supabase/services/notificaciones";
import { getPeriodos } from "@/lib/supabase/services/liquidacion";
import { cn } from "@/lib/utils";
import { generateReportePDF } from "@/lib/utils/pdf-generator";
import { sanitizeGroupActivityObservations, sanitizeTechnicalVisitObservations } from "@/lib/utils/report-content";
import { CompanySettings, LiquidationPeriod } from "@/lib/types";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const DEFAULT_NOTIFICATION_BCC = "solucionesyautomatizaciones@hotmail.com";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

function formatCurrencyDelta(value: number) {
  if (value === 0) return formatCurrency(0);
  const formatted = formatCurrency(Math.abs(value));
  return value > 0 ? `+${formatted}` : `-${formatted}`;
}

function formatRoundedPercentage(value: number) {
  return `${Math.round(value)}%`;
}

function formatPeriodLabel(period?: LiquidationPeriod) {
  if (!period) return "Sin período";
  return `${period.fechaInicio} al ${period.fechaFin}`;
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
  return (report.tipo === "visita_tecnica"
    || report.tipo === "mantenimiento_preventivo")
    && ((report.valorActividadAplicadoGlobal ?? report.valorActividadBaseGlobal) != null
      || Number(report.porcentajeParticipacion ?? 0) > 0);
}

function usesSharedBasePricing(report: ActivityReport) {
  return isGroupActivity(report) || isSharedVisit(report);
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

function getVisualActivityIdentity(report: ActivityReport) {
  if (isGroupActivity(report)) {
    return getGroupActivityUiIdentity(report);
  }

  if (isSharedVisit(report)) {
    const identityPrefix = report.tipo === "mantenimiento_preventivo" ? "shared-maintenance-visual" : "shared-visit-visual";
    return [
      identityPrefix,
      report.mantenimientoId || "sin-mantenimiento",
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
    const identityPrefix = report.tipo === "mantenimiento_preventivo" ? "shared-maintenance" : "shared-visit";
    return [
      identityPrefix,
      report.mantenimientoId || "sin-mantenimiento",
      report.fecha,
      report.periodoId || "sin-periodo",
      report.grupoId,
      report.clienteId || "sin-cliente",
      normalizeSearchValue(report.descripcion),
    ].join("|");
  }

  return report.id;
}

function getSharedGroupBaseValue(report: ActivityReport) {
  return report.valorActividadAplicadoGlobal ?? report.valorActividadBaseGlobal ?? report.costoActividad;
}

function getSharedGroupReferenceBaseValue(report: ActivityReport) {
  if (isSharedVisit(report)) {
    if ((Number(report.valorActividadBaseGlobal ?? 0) || 0) > 0) {
      return Number(report.valorActividadBaseGlobal ?? 0) || 0;
    }

    const participantDefaultValue = Number(report.costoActividadDefault ?? 0) || 0;
    const percentage = Number(report.porcentajeParticipacion ?? 0) || 0;

    if (participantDefaultValue > 0 && percentage > 0) {
      return Number(((participantDefaultValue * 100) / percentage).toFixed(2));
    }

    return participantDefaultValue;
  }

  return report.valorActividadBaseGlobal ?? getSharedGroupBaseValue(report);
}

function getComparisonReferenceValue(report: ActivityReport, defaultCost: number) {
  return usesSharedBasePricing(report) ? getSharedGroupReferenceBaseValue(report) : defaultCost;
}

function getComparisonCurrentValue(report: ActivityReport) {
  return usesSharedBasePricing(report) ? getSharedGroupBaseValue(report) : report.costoActividad;
}

function getComparisonCurrentLabel(report: ActivityReport) {
  return usesSharedBasePricing(report) ? "Base aplicada" : "Valor reportado";
}

function shouldShowValueChange(report: ActivityReport, referenceValue: number, currentValue: number) {
  if (report.tipo !== "visita_tecnica" && report.tipo !== "actividad_grupal") return false;

  return !!report.valorModificado || !!report.motivoModificacionValor || referenceValue !== currentValue;
}

function getValueChangeLabel(report: ActivityReport) {
  return report.tipo === "actividad_grupal" ? "Cambio reportado en la base de la actividad" : "Cambio reportado por el técnico";
}

function getDefaultValueLabel(report: ActivityReport) {
  return report.tipo === "actividad_grupal" ? "Base registrada" : "Valor default";
}

function getReasonLabel(report: ActivityReport) {
  return report.tipo === "actividad_grupal" ? "Razón de la modificación" : "Razón del cambio";
}

const tipoConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  mantenimiento_preventivo: {
    label: "Mant. Preventivo",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    icon: Wrench,
  },
  visita_tecnica: {
    label: "Visita Técnica",
    color: "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20",
    icon: ClipboardCheck,
  },
  recorrido: {
    label: "Recorrido",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    icon: Route,
  },
  actividad_grupal: {
    label: "Actividad Grupal",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    icon: Users,
  },
  // Legacy value present in reportes_actividad.tipo
  actividad: {
    label: "Actividad",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    icon: Users,
  },
};

const defaultTipoConfig = {
  label: "Actividad",
  color: "bg-secondary text-muted-foreground border-border/50",
  icon: FileText,
};

function getTipoConfig(tipo: string) {
  return tipoConfig[tipo] || defaultTipoConfig;
}

function canSendApprovalReportEmail(report: ActivityReport) {
  return report.tipo === "mantenimiento_preventivo" || report.tipo === "visita_tecnica";
}

const estadoAprobacionConfig = {
  pendiente: { label: "Pendiente", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: Clock },
  aprobado: { label: "Aprobado", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
  rechazado: { label: "Rechazado", color: "bg-red-500/10 text-red-400 border-red-500/20", icon: XCircle },
};

interface ApprovalTableRow {
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
}

interface SharedParticipantDraft {
  reportId: string;
  tecnicoId: string;
  nombre: string;
  percentage: string;
  amount: string;
  periodoId?: string;
  visitId?: string;
  defaultCost: number;
}

function dedupeSharedParticipantDrafts(drafts: SharedParticipantDraft[]) {
  const draftsByTechnician = new Map<string, SharedParticipantDraft>();

  drafts.forEach((draft) => {
    const current = draftsByTechnician.get(draft.tecnicoId);

    if (!current) {
      draftsByTechnician.set(draft.tecnicoId, draft);
      return;
    }

    if (!draft.reportId.startsWith("reg-") && current.reportId.startsWith("reg-")) {
      draftsByTechnician.set(draft.tecnicoId, draft);
    }
  });

  return Array.from(draftsByTechnician.values());
}

function isLegacyGroupDraftReportId(reportId: string) {
  return reportId.startsWith("reg-");
}

export default function AprobacionesPage() {
  const [reports, setReports] = useState<ActivityReport[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [periods, setPeriods] = useState<LiquidationPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [activeTab, setActiveTab] = useState("preventivos");
  const [search, setSearch] = useState("");
  const [tecnicoFilter, setTecnicoFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [estadoFilter, setEstadoFilter] = useState<string>("todos");
  const [grupoFilter, setGrupoFilter] = useState<string>("todos");
  const [selectedReport, setSelectedReport] = useState<ActivityReport | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [editableCost, setEditableCost] = useState("");
  const [sharedParticipantDrafts, setSharedParticipantDrafts] = useState<SharedParticipantDraft[]>([]);
  const [savingCost, setSavingCost] = useState(false);
  const [savingParticipantSplit, setSavingParticipantSplit] = useState(false);
  const [defaultVisitCost, setDefaultVisitCost] = useState("");
  const [savingDefaultVisitCost, setSavingDefaultVisitCost] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const previousCostDraftRef = useRef<number | null>(null);

  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [periodResult, reportsResult, usersResult, clientsResult, groupsResult, settingsResult] = await Promise.allSettled([
        getPeriodos(),
        getReportesActividad(),
        getUsuarios(),
        getClientes(),
        getGrupos(),
        getConfiguracion(),
      ]);

      const p = periodResult.status === "fulfilled" ? periodResult.value : [];
      const r = reportsResult.status === "fulfilled" ? reportsResult.value : [];
      const u = usersResult.status === "fulfilled" ? usersResult.value : [];
      const c = clientsResult.status === "fulfilled" ? clientsResult.value : [];
      const g = groupsResult.status === "fulfilled" ? groupsResult.value : [];
      const s = settingsResult.status === "fulfilled" ? settingsResult.value : null;

      if (periodResult.status === "rejected") console.error("Error cargando períodos en aprobaciones:", periodResult.reason);
      if (reportsResult.status === "rejected") console.error("Error cargando reportes en aprobaciones:", reportsResult.reason);
      if (usersResult.status === "rejected") console.error("Error cargando usuarios en aprobaciones:", usersResult.reason);
      if (clientsResult.status === "rejected") console.error("Error cargando clientes en aprobaciones:", clientsResult.reason);
      if (groupsResult.status === "rejected") console.error("Error cargando grupos en aprobaciones:", groupsResult.reason);
      if (settingsResult.status === "rejected") console.error("Error cargando configuración en aprobaciones:", settingsResult.reason);

      setReports(r); setUsers(u); setClients(c); setGroups(g); setCompanySettings(s); setPeriods(p);
      setSelectedPeriodId((current) => {
        if (current && p.some((period) => period.id === current)) return current;
        return p[0]?.id || "";
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshReports = useCallback(async (reportId?: string | null) => {
    const refreshedReports = await getReportesActividad();
    setReports(refreshedReports);

    if (!reportId) {
      setSelectedReport(null);
      return;
    }

    setSelectedReport(refreshedReports.find((item) => item.id === reportId) || null);
  }, []);

  const sharedActivityStats = useMemo(() => {
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

      const key = getSharedPricingIdentity(report);
      const total = totalByKey.get(key) ?? 0;
      const explicitPercentage = Number(report.porcentajeParticipacion ?? 0) || 0;

      if (explicitPercentage > 0) {
        percentageByReportId.set(report.id, explicitPercentage);
        return;
      }

      if (total > 0) {
        percentageByReportId.set(report.id, Number((((Number(report.costoActividad) || 0) / total) * 100).toFixed(2)));
        return;
      }

      const count = countByKey.get(key) ?? 1;
      percentageByReportId.set(report.id, Number((100 / count).toFixed(2)));
    });

    return { totalByKey, percentageByReportId };
  }, [reports]);

  const getActivityTotalForReport = useCallback(
    (report: ActivityReport) => {
      if (!usesSharedBasePricing(report)) return report.costoActividad;

      if (isSharedVisit(report)) {
        return getSharedGroupBaseValue(report);
      }

      return sharedActivityStats.totalByKey.get(getSharedPricingIdentity(report)) ?? getSharedGroupBaseValue(report);
    },
    [sharedActivityStats.totalByKey]
  );

  const getParticipationPercentageForReport = useCallback(
    (report: ActivityReport) => {
      if (!usesSharedBasePricing(report)) return 100;
      return sharedActivityStats.percentageByReportId.get(report.id) ?? 100;
    },
    [sharedActivityStats.percentageByReportId]
  );

  const calculateTechnicalCostForReport = useCallback(
    (report: ActivityReport, activityTotal: number) => {
      if (!usesSharedBasePricing(report)) return Math.round(activityTotal);

      const percentage = getParticipationPercentageForReport(report);
      return Math.round((activityTotal * percentage) / 100);
    },
    [getParticipationPercentageForReport]
  );

  const getEditableValueForReport = useCallback(
    (report: ActivityReport) => {
      if (usesSharedBasePricing(report)) {
        return getActivityTotalForReport(report);
      }

      if (
        report.tipo === "visita_tecnica"
        && report.costoActividad <= 0
        && !report.valorModificado
        && !report.motivoModificacionValor
      ) {
        return companySettings?.costoVisitaTecnicaDefault || 0;
      }

      return report.costoActividad;
    },
    [companySettings, getActivityTotalForReport]
  );

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    setDefaultVisitCost(companySettings ? String(companySettings.costoVisitaTecnicaDefault) : "");
  }, [companySettings]);

  const costDraft = Number(editableCost || 0);
  const isCostDirty = selectedReport ? costDraft !== getEditableValueForReport(selectedReport) : false;
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users]
  );
  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients]
  );
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups]
  );
  const getParticipantName = useCallback((tecnicoId: string) => {
    const tech = usersById.get(tecnicoId);
    return [tech?.nombre, tech?.apellido].filter(Boolean).join(" ") || "Técnico sin nombre";
  }, [usersById]);
  const getSharedReportsForReport = useCallback((report: ActivityReport) => {
    if (!usesSharedBasePricing(report)) return [report];
    const sharedKey = getVisualActivityIdentity(report);
    return reports.filter((item) => usesSharedBasePricing(item) && getVisualActivityIdentity(item) === sharedKey);
  }, [reports]);
  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId),
    [periods, selectedPeriodId]
  );
  const hasSelectedPeriod = !!selectedPeriod;
  const periodScopedReports = useMemo(
    () => selectedPeriodId ? reports.filter((report) => report.periodoId === selectedPeriodId) : [],
    [reports, selectedPeriodId]
  );
  const getDefaultCostForReport = useCallback(
    (report: ActivityReport) => {
      if (report.tipo === "visita_tecnica") {
        return report.costoActividadDefault ?? companySettings?.costoVisitaTecnicaDefault ?? 0;
      }
      return report.costoActividadDefault ?? 0;
    },
    [companySettings]
  );
  const buildSharedParticipantDrafts = useCallback((report: ActivityReport) => {
    const sharedReports = getSharedReportsForReport(report);
    return dedupeSharedParticipantDrafts(sharedReports.map((item) => ({
      reportId: item.id,
      tecnicoId: item.tecnicoId,
      nombre: getParticipantName(item.tecnicoId),
      percentage: String(getParticipationPercentageForReport(item)),
      amount: String(item.costoActividad),
      periodoId: item.periodoId,
      visitId: item.visitaTecnicaId,
      defaultCost: getDefaultCostForReport(item),
    })));
  }, [getDefaultCostForReport, getParticipantName, getParticipationPercentageForReport, getSharedReportsForReport]);
  const normalizeParticipantDrafts = useCallback((nextDrafts: SharedParticipantDraft[]) => {
    return nextDrafts.map((draft) => ({
      ...draft,
      amount: String(Math.max(0, Math.round(Number(draft.amount || 0) || 0))),
      percentage: String(Math.max(0, Number(draft.percentage || 0) || 0)),
    }));
  }, []);
  const syncParticipantDraftAmounts = useCallback((nextDrafts: SharedParticipantDraft[]) => {
    const normalized = normalizeParticipantDrafts(nextDrafts);
    const totalAmount = normalized.reduce((sum, draft) => sum + (Number(draft.amount || 0) || 0), 0);

    return normalized.map((draft, index) => {
      const amountValue = Math.max(0, Number(draft.amount || 0) || 0);
      const normalizedPercentage = totalAmount > 0
        ? index === normalized.length - 1
          ? Number((100 - normalized.slice(0, index).reduce((sum, item) => {
            const currentAmount = Math.max(0, Number(item.amount || 0) || 0);
            return sum + Number(((currentAmount / totalAmount) * 100).toFixed(2));
          }, 0)).toFixed(2))
          : Number(((amountValue / totalAmount) * 100).toFixed(2))
        : Number((100 / Math.max(normalized.length, 1)).toFixed(2));

      return {
        ...draft,
        percentage: String(Math.max(0, normalizedPercentage)),
        amount: String(amountValue),
      };
    });
  }, [normalizeParticipantDrafts]);
  const redistributeParticipantDraftAmounts = useCallback((nextDrafts: SharedParticipantDraft[], nextTotal: number) => {
    const normalizedTotal = Math.max(0, Math.round(Number(nextTotal) || 0));
    if (nextDrafts.length === 0) return nextDrafts;

    const normalizedDrafts = normalizeParticipantDrafts(nextDrafts);
    const currentPercentageTotal = normalizedDrafts.reduce((sum, draft) => sum + (Number(draft.percentage || 0) || 0), 0);

    const normalizedPercentages = currentPercentageTotal > 0
      ? normalizedDrafts.map((draft, index) => {
        if (index === normalizedDrafts.length - 1) {
          const assigned = normalizedDrafts.slice(0, index).reduce((sum, item) => {
            const currentPercentage = Number(item.percentage || 0) || 0;
            return sum + Number(((currentPercentage / currentPercentageTotal) * 100).toFixed(2));
          }, 0);

          return Number((100 - assigned).toFixed(2));
        }

        return Number((((Number(draft.percentage || 0) || 0) / currentPercentageTotal) * 100).toFixed(2));
      })
      : normalizedDrafts.map((_, index) => index === normalizedDrafts.length - 1
        ? Number((100 - ((100 / normalizedDrafts.length) * index)).toFixed(2))
        : Number((100 / normalizedDrafts.length).toFixed(2))
      );

    if (normalizedTotal === 0) {
      return normalizedDrafts.map((draft, index) => ({
        ...draft,
        amount: "0",
        percentage: String(Math.max(0, normalizedPercentages[index] || 0)),
      }));
    }

    let assigned = 0;

    return normalizedDrafts.map((draft, index) => {
      const currentPercentage = Math.max(0, normalizedPercentages[index] || 0);
      const amount = index === normalizedDrafts.length - 1
        ? normalizedTotal - assigned
        : Math.max(0, Math.round((currentPercentage / 100) * normalizedTotal));

      assigned += amount;
      return {
        ...draft,
        amount: String(amount),
        percentage: String(currentPercentage),
      };
    });
  }, [normalizeParticipantDrafts]);
  const getNormalizedSharedParticipantDrafts = useCallback(() => {
    return normalizeParticipantDrafts(sharedParticipantDrafts).map((draft) => ({
      ...draft,
      percentage: Number(draft.percentage || 0) || 0,
      amount: Number(draft.amount || 0) || 0,
    }));
  }, [normalizeParticipantDrafts, sharedParticipantDrafts]);
  const handleSharedParticipantAmountChange = useCallback((reportId: string, value: string) => {
    setSharedParticipantDrafts((current) => syncParticipantDraftAmounts(
      current.map((draft) => {
        if (draft.reportId !== reportId) return draft;
        return {
          ...draft,
          amount: String(Math.max(0, Number(value || 0))),
        };
      })
    ));
  }, [syncParticipantDraftAmounts]);
  const handleEditableCostChange = useCallback((value: string) => {
    setEditableCost(value);

    if (!selectedReport || !usesSharedBasePricing(selectedReport)) return;

    setSharedParticipantDrafts((current) => {
      if (current.length === 0) return current;
      return redistributeParticipantDraftAmounts(current, Number(value || 0));
    });
  }, [redistributeParticipantDraftAmounts, selectedReport]);
  useEffect(() => {
    previousCostDraftRef.current = null;
  }, [selectedReport?.id]);
  useEffect(() => {
    if (!selectedReport || !usesSharedBasePricing(selectedReport)) {
      previousCostDraftRef.current = costDraft;
      return;
    }

    if (previousCostDraftRef.current == null) {
      previousCostDraftRef.current = costDraft;
      return;
    }

    if (previousCostDraftRef.current === costDraft || sharedParticipantDrafts.length === 0) {
      return;
    }

    previousCostDraftRef.current = costDraft;
    setSharedParticipantDrafts((current) => redistributeParticipantDraftAmounts(current, costDraft));
  }, [costDraft, redistributeParticipantDraftAmounts, selectedReport, sharedParticipantDrafts.length]);
  useEffect(() => {
    if (!selectedReport) {
      setEditableCost("");
      setSharedParticipantDrafts([]);
      setSaveSuccessMessage(null);
      return;
    }

    setEditableCost(String(getEditableValueForReport(selectedReport)));
    setSharedParticipantDrafts(usesSharedBasePricing(selectedReport)
      ? buildSharedParticipantDrafts(selectedReport)
      : []);
    setSaveSuccessMessage(null);
  }, [buildSharedParticipantDrafts, getEditableValueForReport, selectedReport]);
  const isSharedParticipantDraftDirty = useMemo(() => {
    if (!selectedReport || !usesSharedBasePricing(selectedReport)) return false;

    const currentDrafts = normalizeParticipantDrafts(buildSharedParticipantDrafts(selectedReport));
    const nextDrafts = normalizeParticipantDrafts(sharedParticipantDrafts);

    if (currentDrafts.length !== nextDrafts.length) return true;

    return nextDrafts.some((draft) => {
      const currentDraft = currentDrafts.find((item) => item.reportId === draft.reportId);
      if (!currentDraft) return true;

      return currentDraft.percentage !== draft.percentage || currentDraft.amount !== draft.amount;
    });
  }, [buildSharedParticipantDrafts, normalizeParticipantDrafts, selectedReport, sharedParticipantDrafts]);
  const sharedParticipantsDraftSummary = useMemo(() => {
    const participants = getNormalizedSharedParticipantDrafts();
    const totalAmount = participants.reduce((sum, participant) => sum + participant.amount, 0);
    const totalPercentage = Number(participants.reduce((sum, participant) => sum + participant.percentage, 0).toFixed(2));
    const isAmountBalanced = totalAmount === costDraft;
    const isPercentageBalanced = Math.abs(totalPercentage - 100) <= 0.05;

    return {
      participants,
      totalAmount,
      totalPercentage,
      isAmountBalanced,
      isPercentageBalanced,
      canSave: participants.length > 0 && isAmountBalanced && isPercentageBalanced,
    };
  }, [costDraft, getNormalizedSharedParticipantDrafts]);
  const applySharedGroupBaseToReport = useCallback((report: ActivityReport, nextBaseValue: number) => {
    if (!usesSharedBasePricing(report)) return report;

    const previousTotal = getActivityTotalForReport(report);
    const derivedPercentage = getParticipationPercentageForReport(report);

    return {
      ...report,
      costoActividad: calculateTechnicalCostForReport(report, nextBaseValue),
      porcentajeParticipacion: derivedPercentage,
      valorActividadBaseGlobal: report.valorActividadBaseGlobal ?? previousTotal,
      valorActividadAplicadoGlobal: nextBaseValue,
      valorModificado: nextBaseValue !== (report.valorActividadBaseGlobal ?? previousTotal),
    };
  }, [calculateTechnicalCostForReport, getActivityTotalForReport, getParticipationPercentageForReport]);

  const buildMultilineText = useCallback((parts: Array<string | undefined | null>) => {
    return parts.map((part) => part?.trim()).filter(Boolean).join("\n\n");
  }, []);

  const getSafeFileSegment = useCallback((value: string) => {
    return value
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "") || "reporte";
  }, []);

  const getReportEmailContext = useCallback((report: ActivityReport) => {
    const client = report.clienteId ? clientsById.get(report.clienteId) : null;
    const tech = usersById.get(report.tecnicoId);
    const group = groupsById.get(report.grupoId);
    const tipo = getTipoConfig(String(report.tipo));
    const companyName = companySettings?.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.";
    const operationalEmail = companySettings?.correoEmpresa || DEFAULT_NOTIFICATION_BCC;
    const tecnicoNombre = tech ? `${tech.nombre} ${tech.apellido}`.trim() : "No disponible";
    const clienteNombre = client?.contacto || client?.nombre || "Cliente";
    const edificio = client?.edificio || group?.nombre || tipo.label;
    const fileBaseName = getSafeFileSegment(client?.edificio || group?.nombre || tipo.label);
    const normalizedObservaciones = report.tipo === "actividad_grupal"
      ? sanitizeGroupActivityObservations(report.observaciones)
      : report.tipo === "visita_tecnica"
        ? sanitizeTechnicalVisitObservations(report.observaciones)
        : report.observaciones?.trim() || undefined;
    const resumen = report.descripcion || report.especificacion || normalizedObservaciones || `Servicio de ${tipo.label.toLowerCase()}`;

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

      return buildMultilineText([
        report.descripcion,
        normalizedObservaciones,
      ]);
    })();

    const pdfData = {
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
          ? "Actividad aprobada en módulo de aprobaciones"
          : report.tipo === "recorrido"
            ? report.tipoRecorrido === "con_herramienta"
              ? "Recorrido con herramienta"
              : "Recorrido normal"
            : undefined,
      empresa: companyName,
      fecha: report.fecha,
      tecnico: tecnicoNombre,
      cliente: client?.nombre || "—",
      edificio,
      direccionCliente: client?.direccion || "—",
      correoCliente: client?.correo || "—",
      observaciones: detailLines || resumen,
      fotosAntes: report.fotosAntes,
      fotosDespues: report.fotosDespues,
      firmaUrl: report.firmaReceptor,
      receptor: report.datosReceptor,
    };

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
            tipoVisita: "aprobada",
            descripcion: report.descripcion,
            observaciones: normalizedObservaciones,
          }
          : {
            companyName,
            clienteNombre,
            edificio,
            fecha: report.fecha,
            tecnicoNombre,
            tipoInforme: tipo.label,
            resumen,
            observaciones: detailLines !== resumen ? detailLines : undefined,
          };

    return {
      client,
      tech,
      tipo,
      companyName,
      operationalEmail,
      tecnicoNombre,
      clienteNombre,
      edificio,
      pdfData,
      template,
      templateData,
      subject: `Reporte de ${tipo.label.toLowerCase()} - ${edificio}`,
      filename: `${getSafeFileSegment(tipo.label)}_${fileBaseName}_${report.fecha}.pdf`,
      ccRecipients: [client?.correoAliado, operationalEmail].filter(Boolean),
    };
  }, [buildMultilineText, clientsById, companySettings, getSafeFileSegment, groupsById, usersById]);

  const sendApprovalEmail = useCallback(async (report: ActivityReport) => {
    if (!canSendApprovalReportEmail(report)) {
      return;
    }

    const context = getReportEmailContext(report);

    if (!context.client?.correo) {
      console.warn("Aprobación sin correo de cliente, se omite envío automático:", report.id);
      return;
    }

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
      throw new Error(payload?.error || "No se pudo enviar el correo de aprobación.");
    }
  }, [getReportEmailContext]);

  const persistCost = useCallback(async (
    report: ActivityReport,
    nextCost: number,
    options?: {
      sharedParticipants?: Array<{
        reportId: string;
        tecnicoId: string;
        percentage: number;
        amount: number;
        periodoId?: string;
        visitId?: string;
        defaultCost: number;
      }>;
    }
  ) => {
    if (usesSharedBasePricing(report)) {
      const sharedKey = getVisualActivityIdentity(report);

      if (isGroupActivity(report)) {
        const realSourceParticipant = options?.sharedParticipants?.find((participant) => !isLegacyGroupDraftReportId(participant.reportId));
        const sourceReportId = !report.id.startsWith("reg-")
          ? report.id
          : realSourceParticipant?.reportId;

        await updateActividadGrupalBaseAdmin(report.registroActividadId || sourceReportId || report.id, nextCost, {
          sourceReportId,
          participantOverrides: options?.sharedParticipants?.map((participant) => ({
            reportId: participant.reportId,
            tecnicoId: participant.tecnicoId,
            percentage: participant.percentage,
            valorGanado: participant.amount,
            periodoId: participant.periodoId,
          })),
        });
      } else {
        await updateCostoActividadAdmin(report.id, nextCost, {
          sharedVisitParticipants: options?.sharedParticipants?.map((participant) => ({
            reportId: participant.reportId,
            tecnicoId: participant.tecnicoId,
            percentage: participant.percentage,
            valorGanado: participant.amount,
            periodoId: participant.periodoId,
            visitId: participant.visitId,
            maintenanceId: report.mantenimientoId,
            defaultCost: participant.defaultCost,
          })),
        });
      }

      setReports((prev) => prev.map((item) => {
        if (!usesSharedBasePricing(item) || getVisualActivityIdentity(item) !== sharedKey) return item;
        const participantOverride = options?.sharedParticipants?.find((participant) => participant.reportId === item.id);
        const nextReport = applySharedGroupBaseToReport(item, nextCost);
        return participantOverride
          ? {
            ...nextReport,
            costoActividad: participantOverride.amount,
            porcentajeParticipacion: participantOverride.percentage,
          }
          : nextReport;
      }));
      setSelectedReport((prev) => {
        if (!prev || !usesSharedBasePricing(prev) || getVisualActivityIdentity(prev) !== sharedKey) return prev;
        const participantOverride = options?.sharedParticipants?.find((participant) => participant.reportId === prev.id);
        const nextReport = applySharedGroupBaseToReport(prev, nextCost);
        return participantOverride
          ? {
            ...nextReport,
            costoActividad: participantOverride.amount,
            porcentajeParticipacion: participantOverride.percentage,
          }
          : nextReport;
      });
      return;
    }

    await updateCostoActividadAdmin(report.id, nextCost);
    const nextVisitModifiedFlag = report.tipo === "visita_tecnica" || report.tipo === "mantenimiento_preventivo"
      ? nextCost !== getDefaultCostForReport(report)
      : report.valorModificado;
    setReports((prev) => prev.map((item) => item.id === report.id
      ? {
        ...item,
        costoActividad: nextCost,
        valorModificado: item.tipo === "visita_tecnica" || item.tipo === "mantenimiento_preventivo" ? nextVisitModifiedFlag : item.valorModificado,
      }
      : item));
    setSelectedReport((prev) => prev && prev.id === report.id
      ? {
        ...prev,
        costoActividad: nextCost,
        valorModificado: prev.tipo === "visita_tecnica" || prev.tipo === "mantenimiento_preventivo" ? nextVisitModifiedFlag : prev.valorModificado,
      }
      : prev);
  }, [applySharedGroupBaseToReport, getDefaultCostForReport]);

  const updateReportStatusInState = useCallback((reportId: string, estado: ActivityReport["estadoAprobacionLider"]) => {
    const nextApprovalDate = estado === "aprobado" ? new Date().toISOString().split("T")[0] : undefined;

    setReports((prev) => prev.map((item) => item.id === reportId
      ? {
        ...item,
        estadoAprobacionLider: estado,
        fechaAprobacionLider: nextApprovalDate,
      }
      : item));

    setSelectedReport((prev) => prev && prev.id === reportId
      ? {
        ...prev,
        estadoAprobacionLider: estado,
        fechaAprobacionLider: nextApprovalDate,
      }
      : prev);
  }, []);

  const handleSaveCost = async () => {
    if (!selectedReport) return;
    if (usesSharedBasePricing(selectedReport) && !sharedParticipantsDraftSummary.canSave) {
      alert("El reparto técnico debe coincidir con el costo total y sumar 100% antes de guardar.");
      return;
    }
    setSavingCost(true);
    try {
      const sharedParticipants = usesSharedBasePricing(selectedReport)
        ? sharedParticipantsDraftSummary.participants.map((participant) => ({
          reportId: participant.reportId,
          tecnicoId: participant.tecnicoId,
          percentage: participant.percentage,
          amount: participant.amount,
          periodoId: participant.periodoId,
          visitId: participant.visitId,
          defaultCost: participant.defaultCost,
        }))
        : undefined;
      await persistCost(selectedReport, costDraft, { sharedParticipants });
      await refreshReports(selectedReport.id);
      setSaveSuccessMessage("Datos sincronizados correctamente.");
      if (usesSharedBasePricing(selectedReport)) {
        setSharedParticipantDrafts(syncParticipantDraftAmounts(
          (sharedParticipants || []).map((participant) => ({
            reportId: participant.reportId,
            tecnicoId: participant.tecnicoId,
            nombre: getParticipantName(participant.tecnicoId),
            percentage: String(participant.percentage),
            amount: String(participant.amount),
            periodoId: participant.periodoId,
            visitId: participant.visitId,
            defaultCost: participant.defaultCost,
          }))
        ));
      }
    } catch (err) {
      console.error("Error actualizando costo de actividad:", err);
    } finally {
      setSavingCost(false);
    }
  };

  const handleSaveParticipantSplit = async () => {
    if (!selectedReport || !usesSharedBasePricing(selectedReport)) return;
    if (!sharedParticipantsDraftSummary.canSave) {
      alert("La suma del reparto debe coincidir con el costo total y los porcentajes deben sumar 100%.");
      return;
    }

    setSavingParticipantSplit(true);
    try {
      const sharedParticipants = sharedParticipantsDraftSummary.participants.map((participant) => ({
        reportId: participant.reportId,
        tecnicoId: participant.tecnicoId,
        percentage: participant.percentage,
        amount: participant.amount,
        periodoId: participant.periodoId,
        visitId: participant.visitId,
        defaultCost: participant.defaultCost,
      }));

      await persistCost(selectedReport, costDraft, { sharedParticipants });
      await refreshReports(selectedReport.id);
      setSaveSuccessMessage("Reparto técnico sincronizado correctamente.");
      setSharedParticipantDrafts(syncParticipantDraftAmounts(
        sharedParticipants.map((participant) => ({
          reportId: participant.reportId,
          tecnicoId: participant.tecnicoId,
          nombre: getParticipantName(participant.tecnicoId),
          percentage: String(participant.percentage),
          amount: String(participant.amount),
          periodoId: participant.periodoId,
          visitId: participant.visitId,
          defaultCost: participant.defaultCost,
        }))
      ));
    } catch (err) {
      console.error("Error guardando reparto técnico:", JSON.stringify(err, Object.getOwnPropertyNames(err || {})));
      alert("No se pudo guardar el reparto técnico. Revisa la consola para más detalle.");
    } finally {
      setSavingParticipantSplit(false);
    }
  };

  const isDefaultVisitCostDirty = Number(defaultVisitCost || 0) !== (companySettings?.costoVisitaTecnicaDefault || 0);

  const handleSaveDefaultVisitCost = async () => {
    setSavingDefaultVisitCost(true);
    try {
      const nextSettings = await updateConfiguracion({
        costoVisitaTecnicaDefault: Number(defaultVisitCost || 0),
      });
      setCompanySettings(nextSettings);
    } catch (err) {
      console.error("Error actualizando costo default de visita técnica:", err);
    } finally {
      setSavingDefaultVisitCost(false);
    }
  };

  const handleApprove = useCallback(async (report: ActivityReport) => {
    setProcessing(true);
    try {
      if (usesSharedBasePricing(report) && selectedReport?.id === report.id && !sharedParticipantsDraftSummary.canSave) {
        alert("Antes de aprobar, el reparto técnico debe sumar el 100% y coincidir con el costo total.");
        return;
      }
      const sharedParticipants = usesSharedBasePricing(report)
        ? sharedParticipantsDraftSummary.participants.map((participant) => ({
          reportId: participant.reportId,
          tecnicoId: participant.tecnicoId,
          percentage: participant.percentage,
          amount: participant.amount,
          periodoId: participant.periodoId,
          visitId: participant.visitId,
          defaultCost: participant.defaultCost,
        }))
        : undefined;
      const nextCost = selectedReport?.id === report.id ? costDraft : getEditableValueForReport(report);
      if (nextCost !== getEditableValueForReport(report)) {
        await persistCost(report, nextCost, { sharedParticipants });
        report = isGroupActivity(report)
          ? applySharedGroupBaseToReport(report, nextCost)
          : { ...report, costoActividad: nextCost };
      }
      const approvalTargets = usesSharedBasePricing(report) ? getSharedReportsForReport(report) : [report];
      await Promise.all(approvalTargets.map(async (item) => {
        await updateEstadoAprobacion(item.id, "aprobado");
        try {
          await sendApprovalEmail(item);
        } catch (emailErr) {
          console.error("Error enviando correo de aprobación:", emailErr);
        }
        const tipo = getTipoConfig(String(item.tipo));
        await createNotificacion({
          usuarioId: item.tecnicoId,
          titulo: "Actividad Aprobada",
          mensaje: `Tu informe de ${tipo.label} del ${item.fecha} ha sido aprobado. Valor: $${item.costoActividad.toLocaleString()}.`,
          tipo: "aprobacion",
          datos: { reporteId: item.id, estado: "aprobado" },
        });
        updateReportStatusInState(item.id, "aprobado");
      }));
      setDetailOpen(false);
      setSelectedReport(null);
    } catch (err) {
      console.error("Error aprobando:", err);
    } finally {
      setProcessing(false);
    }
  }, [applySharedGroupBaseToReport, costDraft, getEditableValueForReport, getSharedReportsForReport, persistCost, selectedReport, sendApprovalEmail, sharedParticipantsDraftSummary, updateReportStatusInState]);

  const handleReject = useCallback(async (report: ActivityReport) => {
    setProcessing(true);
    try {
      if (usesSharedBasePricing(report) && selectedReport?.id === report.id && !sharedParticipantsDraftSummary.canSave) {
        alert("Antes de rechazar, deja el reparto técnico consistente con el costo total para evitar inconsistencias.");
        return;
      }
      const sharedParticipants = usesSharedBasePricing(report)
        ? sharedParticipantsDraftSummary.participants.map((participant) => ({
          reportId: participant.reportId,
          tecnicoId: participant.tecnicoId,
          percentage: participant.percentage,
          amount: participant.amount,
          periodoId: participant.periodoId,
          visitId: participant.visitId,
          defaultCost: participant.defaultCost,
        }))
        : undefined;
      const nextCost = selectedReport?.id === report.id ? costDraft : getEditableValueForReport(report);
      if (nextCost !== getEditableValueForReport(report)) {
        await persistCost(report, nextCost, { sharedParticipants });
        report = isGroupActivity(report)
          ? applySharedGroupBaseToReport(report, nextCost)
          : { ...report, costoActividad: nextCost };
      }
      const rejectTargets = usesSharedBasePricing(report) ? getSharedReportsForReport(report) : [report];
      await Promise.all(rejectTargets.map(async (item) => {
        await updateEstadoAprobacion(item.id, "rechazado");
        const tipo = getTipoConfig(String(item.tipo));
        await createNotificacion({
          usuarioId: item.tecnicoId,
          titulo: "Actividad Rechazada",
          mensaje: `Tu informe de ${tipo.label} del ${item.fecha} ha sido rechazado. Contacta a tu líder para más detalles.`,
          tipo: "aprobacion",
          datos: { reporteId: item.id, estado: "rechazado" },
        });
        updateReportStatusInState(item.id, "rechazado");
      }));
      setDetailOpen(false);
      setSelectedReport(null);
    } catch (err) {
      console.error("Error rechazando:", err);
    } finally {
      setProcessing(false);
    }
  }, [applySharedGroupBaseToReport, costDraft, getEditableValueForReport, getSharedReportsForReport, persistCost, selectedReport, sharedParticipantsDraftSummary, updateReportStatusInState]);

  const handleReactivate = useCallback(async (report: ActivityReport) => {
    setProcessing(true);
    try {
      const targets = usesSharedBasePricing(report) ? getSharedReportsForReport(report) : [report];
      await Promise.all(targets.map(async (item) => {
        await updateEstadoAprobacion(item.id, "pendiente");
        updateReportStatusInState(item.id, "pendiente");
      }));
      setDetailOpen(false);
      setSelectedReport(null);
    } catch (err) {
      console.error("Error reactivando actividad:", err);
    } finally {
      setProcessing(false);
    }
  }, [getSharedReportsForReport, updateReportStatusInState]);

  const handleDelete = useCallback(async (report: ActivityReport) => {
    const confirmed = window.confirm("¿Seguro que deseas eliminar esta actividad? Esta acción no se puede deshacer.");
    if (!confirmed) return;

    setDeletingReportId(report.id);
    try {
      const targets = usesSharedBasePricing(report) ? getSharedReportsForReport(report) : [report];
      for (const item of targets) {
        await deleteReporteActividadAdmin(item.id);
      }
      const targetIds = new Set(targets.map((item) => item.id));
      setReports((prev) => prev.filter((item) => !targetIds.has(item.id)));
      if (selectedReport && targetIds.has(selectedReport.id)) {
        setDetailOpen(false);
        setSelectedReport(null);
      }
    } catch (err) {
      console.error("Error eliminando actividad desde aprobaciones:", err);
      alert("No se pudo eliminar la actividad. Intenta nuevamente.");
    } finally {
      setDeletingReportId(null);
    }
  }, [getSharedReportsForReport, selectedReport]);

  const groupedReports = useMemo(() => {
    const grouped = new Map<string, ActivityReport[]>();
    const uiScopedReports = dedupeGroupActivityRowsForUi(periodScopedReports);

    uiScopedReports.forEach((report) => {
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
      const isShared = usesSharedBasePricing(leadReport) && uniqueTechnicianItems.length > 1;
      const approvalDate = items
        .map((item) => item.fechaAprobacionLider)
        .filter(Boolean)
        .sort()
        .at(-1);

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
        costoActividad: isShared ? getActivityTotalForReport(leadReport) : leadReport.costoActividad,
        participantCount: participantNames.length,
        participantNames,
        isShared,
      } satisfies ApprovalTableRow;
    });
  }, [getActivityTotalForReport, getParticipantName, periodScopedReports]);
  const preventivos = useMemo(
    () => groupedReports.filter((row) => row.tipo === "mantenimiento_preventivo"),
    [groupedReports]
  );
  const visitas = useMemo(
    () => groupedReports.filter((row) => row.tipo === "visita_tecnica"),
    [groupedReports]
  );
  const recorridos = useMemo(
    () => groupedReports.filter((row) => row.tipo === "recorrido"),
    [groupedReports]
  );
  const grupales = useMemo(
    () => groupedReports.filter((row) => row.tipo === "actividad_grupal"),
    [groupedReports]
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = normalizeSearchValue(search);
    const normalizedTecnicoFilter = normalizeSearchValue(tecnicoFilter);

    return groupedReports
      .filter((row) => {
        const report = row.report;
        const client = report.clienteId ? clientsById.get(report.clienteId) : null;
        const group = groupsById.get(report.grupoId);
        const participantNames = row.participantNames.map((name) => normalizeSearchValue(name));
        const searchableFields = [
          ...participantNames,
          normalizeSearchValue(client?.edificio),
          normalizeSearchValue(client?.nombre),
          normalizeSearchValue(group?.nombre),
          normalizeSearchValue(report.fecha),
          normalizeSearchValue(report.descripcion),
          normalizeSearchValue(report.especificacion),
        ];
        const matchSearch = !normalizedSearch || searchableFields.some((field) => field.includes(normalizedSearch));
        const matchTecnico = !normalizedTecnicoFilter || participantNames.some((name) => name.includes(normalizedTecnicoFilter));
        const matchDate = !dateFilter || report.fecha === dateFilter;
        const matchEstado = estadoFilter === "todos" || row.estadoAprobacionLider === estadoFilter;
        const matchGrupo = grupoFilter === "todos" || report.grupoId === grupoFilter;
        return matchSearch && matchTecnico && matchDate && matchEstado && matchGrupo;
      })
      .sort((a, b) => {
        const creationCompare = (b.report.fechaCreacion || "").localeCompare(a.report.fechaCreacion || "");
        if (creationCompare !== 0) return creationCompare;

        const dateCompare = (b.report.fecha || "").localeCompare(a.report.fecha || "");
        if (dateCompare !== 0) return dateCompare;

        return b.report.id.localeCompare(a.report.id);
      });
  }, [groupedReports, search, tecnicoFilter, dateFilter, estadoFilter, grupoFilter, clientsById, groupsById]);

  const filteredPreventivos = useMemo(
    () => filteredRows.filter((row) => row.tipo === "mantenimiento_preventivo"),
    [filteredRows]
  );
  const filteredVisitas = useMemo(
    () => filteredRows.filter((row) => row.tipo === "visita_tecnica"),
    [filteredRows]
  );
  const filteredRecorridos = useMemo(
    () => filteredRows.filter((row) => row.tipo === "recorrido"),
    [filteredRows]
  );
  const filteredGrupales = useMemo(
    () => filteredRows.filter((row) => row.tipo === "actividad_grupal"),
    [filteredRows]
  );

  const tabRows = useMemo(() => {
    if (activeTab === "visitas") return filteredVisitas;
    if (activeTab === "recorridos") return filteredRecorridos;
    if (activeTab === "grupales") return filteredGrupales;
    return filteredPreventivos;
  }, [activeTab, filteredGrupales, filteredPreventivos, filteredRecorridos, filteredVisitas]);

  const totalPages = Math.ceil(tabRows.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentRows = tabRows.slice(startIndex, endIndex);
  const visiblePages = Array.from({ length: totalPages }, (_, index) => index + 1).filter((page) => {
    if (totalPages <= 7) return true;
    if (page === 1 || page === totalPages) return true;
    return Math.abs(page - currentPage) <= 1;
  });

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, tecnicoFilter, dateFilter, estadoFilter, grupoFilter, activeTab, selectedPeriodId]);

  const totalReportes = groupedReports.length;
  const aprobados = groupedReports.filter((row) => row.estadoAprobacionLider === "aprobado").length;
  const pendientes = groupedReports.filter((row) => row.estadoAprobacionLider === "pendiente").length;
  const totalValor = groupedReports
    .filter((row) => row.estadoAprobacionLider === "aprobado")
    .reduce((sum, row) => sum + row.costoActividad, 0);

  const renderReportsTable = (sectionTitle: string, sectionDescription: string) => (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg text-foreground">{sectionTitle}</CardTitle>
        <p className="text-sm text-muted-foreground">{sectionDescription}</p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Actividad</TableHead>
              <TableHead>Cliente / Proyecto</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Costo actividad</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentRows.length === 0 ? (
              <TableRow className="border-border/50">
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No hay registros para esta sección con los filtros actuales.
                </TableCell>
              </TableRow>
            ) : currentRows.map((row) => {
              const report = row.report;
              const client = report.clienteId ? clientsById.get(report.clienteId) : null;
              const group = groupsById.get(report.grupoId);
              const leader = group ? usersById.get(group.liderId) : null;
              const tipo = getTipoConfig(String(row.tipo));
              const estado = estadoAprobacionConfig[row.estadoAprobacionLider];
              const TipoIcon = tipo.icon;
              const isDeleting = deletingReportId === report.id;

              return (
                <TableRow
                  key={row.id}
                  data-testid={`approval-row-${row.id}`}
                  className={cn(
                    "border-border/50 hover:bg-secondary/30",
                    row.estadoAprobacionLider === "pendiente" && "bg-amber-500/3"
                  )}
                >
                  <TableCell className="text-sm text-foreground/80 whitespace-nowrap">{report.fecha}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[10px] gap-1", tipo.color)}>
                      <TipoIcon className="h-3 w-3" />
                      {tipo.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-72">
                    <p className="text-sm font-medium text-foreground truncate">{report.descripcion}</p>
                    {report.especificacion && (
                      <p className="text-xs text-muted-foreground truncate">Especificación: {report.especificacion}</p>
                    )}
                    <p className="text-xs text-muted-foreground truncate">
                      {row.isShared
                        ? `${row.participantCount} técnicos: ${row.participantNames.join(", ")}`
                        : `Técnico: ${row.participantNames[0] || "Sin técnico"}`}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-64">
                    <p className="text-sm text-foreground/80 truncate">
                      {client ? `${client.nombre} — ${client.edificio}` : group?.nombre || report.descripcion}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      Grupo: {group?.nombre || "Sin grupo"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      Líder: {leader?.nombre} {leader?.apellido}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-xs gap-1", estado.color)}>
                      <estado.icon className="h-3 w-3" />
                      {estado.label}
                    </Badge>
                    {row.isShared && (
                      <p className="mt-1 text-[11px] text-muted-foreground">Se aprueba por actividad completa.</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <p className="text-sm font-semibold text-gold">{formatCurrency(row.costoActividad)}</p>
                    {row.isShared && (
                      <p className="text-xs text-muted-foreground">Reparto editable en el modal</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`approval-open-${row.id}`}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setSelectedReport(report);
                          setDetailOpen(true);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {row.estadoAprobacionLider === "pendiente" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-emerald-400"
                            onClick={() => handleApprove(report)}
                            disabled={processing || isDeleting}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-red-400"
                            onClick={() => handleReject(report)}
                            disabled={processing || isDeleting}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {row.estadoAprobacionLider !== "pendiente" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-cyan-neon"
                          onClick={() => handleReactivate(report)}
                          disabled={processing || isDeleting}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-red-400"
                        onClick={() => handleDelete(report)}
                        disabled={processing || isDeleting}
                      >
                        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {totalPages > 1 && (
          <div className="overflow-x-auto border-t border-border/50 p-4">
            <Pagination className="justify-center min-w-max">
              <PaginationContent className="flex-nowrap">
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {visiblePages.flatMap((page, index) => {
                  const items = [];

                  if (index > 0 && visiblePages[index] - visiblePages[index - 1] > 1) {
                    items.push(
                      <PaginationItem key={`ellipsis-${visiblePages[index - 1]}-${page}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    );
                  }

                  items.push(
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

                  return items;
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
  );

  if (loading) {
    return (
      <div>
        <AdminHeader title="Aprobaciones de Actividades" />
        <AdminPageLoader
          title="Cargando aprobaciones"
          message="Estamos preparando los informes pendientes y el historial de aprobación."
          statsCount={4}
          rows={6}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Aprobaciones de Actividades" />
      <div className="p-6 space-y-6">
        {hasSelectedPeriod && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border/50 bg-card/80">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-cyan-neon/10 p-2.5">
                  <FileText className="h-5 w-5 text-cyan-neon" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{totalReportes}</p>
                  <p className="text-xs text-muted-foreground">Total Informes</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/80">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-emerald-500/10 p-2.5">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xl font-bold text-emerald-400">{aprobados}</p>
                  <p className="text-xs text-muted-foreground">Aprobados por Líder</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/80">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-amber-500/10 p-2.5">
                  <Clock className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-xl font-bold text-amber-400">{pendientes}</p>
                  <p className="text-xs text-muted-foreground">Pendientes Aprobación</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/80">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-gold/10 p-2.5">
                  <DollarSign className="h-5 w-5 text-gold" />
                </div>
                <div>
                  <p className="text-xl font-bold text-gold">{formatCurrency(totalValor)}</p>
                  <p className="text-xs text-muted-foreground">Valor Aprobado</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Costo default de visitas técnicas</p>
              <p className="text-xs text-muted-foreground">
                Este valor se asigna automáticamente a todas las visitas técnicas nuevas. Desde aquí puedes cambiar el default global y luego seguir ajustando casos puntuales en cada aprobación.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:max-w-md sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
                <Input
                  type="number"
                  min="0"
                  value={defaultVisitCost}
                  onChange={(e) => setDefaultVisitCost(e.target.value)}
                  className={cn(
                    "pl-9 bg-secondary/50 border-border/50 text-gold font-semibold",
                    isDefaultVisitCostDirty && "border-gold/50 bg-gold/5"
                  )}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
                onClick={handleSaveDefaultVisitCost}
                disabled={!isDefaultVisitCostDirty || savingDefaultVisitCost || processing}
              >
                {savingDefaultVisitCost ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {savingDefaultVisitCost ? "Guardando..." : "Guardar default"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por cliente, grupo, descripción o fecha..."
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
          <Input
            placeholder="Filtrar por técnico"
            value={tecnicoFilter}
            onChange={(e) => setTecnicoFilter(e.target.value)}
            disabled={!hasSelectedPeriod}
            className="w-52 bg-secondary/50 border-border/50"
          />
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            disabled={!hasSelectedPeriod}
            className="w-44 bg-secondary/50 border-border/50"
          />
          <Select value={estadoFilter} onValueChange={setEstadoFilter} disabled={!hasSelectedPeriod}>
            <SelectTrigger className="w-44 bg-secondary/50 border-border/50">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="aprobado">Aprobado</SelectItem>
              <SelectItem value="rechazado">Rechazado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={grupoFilter} onValueChange={setGrupoFilter} disabled={!hasSelectedPeriod}>
            <SelectTrigger className="w-44 bg-secondary/50 border-border/50">
              <SelectValue placeholder="Grupo" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="todos">Todos los grupos</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="border-gold/30 bg-gold/10 text-gold">
            {selectedPeriod ? `Período actual: ${formatPeriodLabel(selectedPeriod)}` : periods.length > 0 ? "Selecciona un período" : "No hay períodos disponibles"}
          </Badge>
        </div>

        {hasSelectedPeriod ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="bg-secondary/50 border border-border/50">
              <TabsTrigger value="preventivos" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
                <Wrench className="mr-2 h-4 w-4" />
                Mant. Preventivo
                <Badge className="ml-1.5 border-0 bg-blue-500/20 px-1.5 text-[10px] text-blue-400">{preventivos.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="visitas" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
                <ClipboardCheck className="mr-2 h-4 w-4" />
                Visita Técnica
                <Badge className="ml-1.5 border-0 bg-cyan-neon/20 px-1.5 text-[10px] text-cyan-neon">{visitas.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="recorridos" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
                <Route className="mr-2 h-4 w-4" />
                Recorrido
                <Badge className="ml-1.5 border-0 bg-emerald-500/20 px-1.5 text-[10px] text-emerald-400">{recorridos.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="grupales" className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold">
                <Users className="mr-2 h-4 w-4" />
                Act. Grupal
                <Badge className="ml-1.5 border-0 bg-purple-500/20 px-1.5 text-[10px] text-purple-400">{grupales.length}</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preventivos">
              {renderReportsTable(
                "Aprobaciones de Mantenimiento Preventivo",
                "Informes preventivos pendientes, aprobados o rechazados por líder. Desde aquí puedes validar el valor final y procesar la decisión administrativa."
              )}
            </TabsContent>

            <TabsContent value="visitas">
              {renderReportsTable(
                "Aprobaciones de Visitas Técnicas",
                "Visitas técnicas registradas desde operación. Aquí puedes revisar el contraste entre default y valor reportado antes de aprobar o rechazar."
              )}
            </TabsContent>

            <TabsContent value="recorridos">
              {renderReportsTable(
                "Aprobaciones de Recorridos",
                "Recorridos reportados por el equipo con su modalidad y costo administrable para aprobación por líder."
              )}
            </TabsContent>

            <TabsContent value="grupales">
              {renderReportsTable(
                "Aprobaciones de Actividades Grupales",
                "Actividades grupales consolidadas por actividad. Desde el detalle puedes ajustar el reparto por técnico y aprobar todo el trabajo en una sola acción."
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              {periods.length > 0
                ? "Selecciona un período para ver las aprobaciones."
                : "No hay períodos disponibles para mostrar aprobaciones."}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent data-testid="approval-detail-dialog" className="bg-card border-border sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalle del Informe</DialogTitle>
          </DialogHeader>
          {selectedReport && (() => {
            const modalReports = usesSharedBasePricing(selectedReport) ? getSharedReportsForReport(selectedReport) : [selectedReport];
            const modalStatus: ActivityReport["estadoAprobacionLider"] = modalReports.some((item) => item.estadoAprobacionLider === "pendiente")
              ? "pendiente"
              : modalReports.some((item) => item.estadoAprobacionLider === "rechazado")
                ? "rechazado"
                : "aprobado";
            const tech = usersById.get(selectedReport.tecnicoId);
            const leader = usersById.get(selectedReport.liderGrupoId);
            const group = groupsById.get(selectedReport.grupoId);
            const client = selectedReport.clienteId
              ? clientsById.get(selectedReport.clienteId)
              : null;
            const tipo = getTipoConfig(String(selectedReport.tipo));
            const normalizedModalStatus: ActivityReport["estadoAprobacionLider"] = (new Set(modalReports.map((item) => item.estadoAprobacionLider))).size > 1
              ? "pendiente"
              : modalStatus;
            const estado = estadoAprobacionConfig[normalizedModalStatus];
            const isSharedPricing = usesSharedBasePricing(selectedReport);
            const defaultCost = getDefaultCostForReport(selectedReport);
            const groupActivityReferenceValue = selectedReport.tipo === "actividad_grupal"
              ? (() => {
                const explicitBase = modalReports.find((item) => item.valorActividadBaseGlobal != null)?.valorActividadBaseGlobal;
                if (explicitBase != null) {
                  return Number(explicitBase ?? 0) || 0;
                }

                const participantDefaultsTotal = modalReports.reduce(
                  (sum, item) => sum + (Number(item.costoActividadDefault ?? 0) || 0),
                  0
                );

                return participantDefaultsTotal > 0
                  ? participantDefaultsTotal
                  : getActivityTotalForReport(selectedReport);
              })()
              : getComparisonReferenceValue(selectedReport, defaultCost);
            const comparisonReferenceValue = groupActivityReferenceValue;
            const comparisonCurrentValue = selectedReport.tipo === "actividad_grupal"
              ? getActivityTotalForReport(selectedReport)
              : getComparisonCurrentValue(selectedReport);
            const comparisonCurrentLabel = selectedReport.tipo === "actividad_grupal"
              ? "Base actual"
              : getComparisonCurrentLabel(selectedReport);
            const hasTechnicianChange = selectedReport.tipo === "actividad_grupal"
              ? !!selectedReport.valorModificado || !!selectedReport.motivoModificacionValor || comparisonReferenceValue !== comparisonCurrentValue
              : shouldShowValueChange(selectedReport, comparisonReferenceValue, comparisonCurrentValue);
            const costDelta = comparisonCurrentValue - comparisonReferenceValue;
            const isDeleting = deletingReportId === selectedReport.id;

            return (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className={cn("text-xs gap-1", tipo.color)}>
                    <tipo.icon className="h-3.5 w-3.5" />
                    {tipo.label}
                  </Badge>
                  <Badge variant="outline" className={cn("text-xs gap-1", estado.color)}>
                    <estado.icon className="h-3.5 w-3.5" />
                    {estado.label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {!isSharedPricing && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Técnico</p>
                      <p className="text-sm font-medium text-foreground">{tech?.nombre} {tech?.apellido}</p>
                    </div>
                  )}
                  {isSharedPricing && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Actividad compartida</p>
                      <p className="text-sm font-medium text-foreground">{sharedParticipantDrafts.length} técnicos involucrados</p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Líder de Grupo</p>
                    <p className="text-sm font-medium text-foreground">{leader?.nombre} {leader?.apellido}</p>
                    {leader?.esSupervisor && (
                      <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20">
                        <ShieldCheck className="h-3 w-3 mr-0.5" />
                        Supervisor
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Grupo</p>
                    <p className="text-sm font-medium text-foreground">{group?.nombre}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Fecha</p>
                    <p className="text-sm font-medium text-foreground">{selectedReport.fecha}</p>
                  </div>
                  {client && (
                    <div className="space-y-1 col-span-2">
                      <p className="text-xs text-muted-foreground">Cliente</p>
                      <p className="text-sm font-medium text-foreground">{client.nombre} — {client.edificio}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Descripción</p>
                  <p className="text-sm text-foreground/80 bg-secondary/30 rounded-lg p-3 border border-border/50">
                    {selectedReport.descripcion}
                  </p>
                </div>

                {selectedReport.especificacion && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Especificación</p>
                    <p className="text-sm text-foreground/80 bg-secondary/30 rounded-lg p-3 border border-border/50">
                      {selectedReport.especificacion}
                    </p>
                  </div>
                )}

                {selectedReport.observaciones && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Observaciones</p>
                    <p className="text-sm text-foreground/80 bg-secondary/30 rounded-lg p-3 border border-border/50">
                      {selectedReport.observaciones}
                    </p>
                  </div>
                )}

                {(selectedReport.tipo === "mantenimiento_preventivo" || selectedReport.tipo === "visita_tecnica") && (
                  <div className="space-y-3">
                    <p className={cn("text-xs font-semibold uppercase tracking-wide", selectedReport.tipo === "visita_tecnica" ? "text-cyan-neon" : "text-blue-400")}>
                      Datos {selectedReport.tipo === "visita_tecnica" ? "Visita Técnica" : "Mantenimiento Preventivo"}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {selectedReport.datosReceptor && (
                        <div className="col-span-2 rounded-lg border border-border/50 bg-secondary/20 p-3">
                          <p className="text-xs text-muted-foreground mb-1">Receptor del Mantenimiento</p>
                          <div className="flex items-center gap-2">
                            <PenLine className="h-4 w-4 text-gold" />
                            <div>
                              <p className="text-sm font-medium text-foreground">{selectedReport.datosReceptor.nombre}</p>
                              <p className="text-xs text-muted-foreground">
                                {selectedReport.datosReceptor.cedula ? `CC: ${selectedReport.datosReceptor.cedula}` : ""}
                                {selectedReport.datosReceptor.cedula && selectedReport.datosReceptor.cargo ? " · " : ""}
                                {selectedReport.datosReceptor.cargo}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <p className="text-xs text-muted-foreground">Bitácora</p>
                        <p className="text-sm font-medium text-foreground">
                          {selectedReport.bitacora ? "Sí — Foto adjunta" : "No"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <p className="text-xs text-muted-foreground">Firma receptor</p>
                        <p className="text-sm font-medium text-foreground">
                          {selectedReport.firmaReceptor ? "Sí — Firma digital" : "No registrada"}
                        </p>
                      </div>
                    </div>
                    {(selectedReport.fotosAntes?.length || selectedReport.fotosDespues?.length) ? (
                      <>
                        <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mt-2">Evidencia Fotográfica</p>
                        <div className="grid grid-cols-2 gap-4">
                          {selectedReport.fotosAntes && selectedReport.fotosAntes.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground">Antes ({selectedReport.fotosAntes.length})</p>
                              <div className="grid grid-cols-2 gap-2">
                                {selectedReport.fotosAntes.map((url, i) => (
                                  <div key={`antes-${i}`} className="aspect-square rounded-md overflow-hidden bg-secondary/30 border border-border/50 relative group">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt={`Antes ${i + 1}`} className="object-cover w-full h-full" />
                                    <a href={url} target="_blank" rel="noreferrer" className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                      <Eye className="h-5 w-5 text-foreground" />
                                    </a>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {selectedReport.fotosDespues && selectedReport.fotosDespues.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs text-muted-foreground">Después ({selectedReport.fotosDespues.length})</p>
                              <div className="grid grid-cols-2 gap-2">
                                {selectedReport.fotosDespues.map((url, i) => (
                                  <div key={`despues-${i}`} className="aspect-square rounded-md overflow-hidden bg-secondary/30 border border-border/50 relative group">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt={`Después ${i + 1}`} className="object-cover w-full h-full" />
                                    <a href={url} target="_blank" rel="noreferrer" className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                      <Eye className="h-5 w-5 text-foreground" />
                                    </a>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                )}

                {selectedReport.tipo === "recorrido" && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Datos del Recorrido</p>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <MapPin className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Punto de Partida</p>
                          <p className="text-sm text-foreground">{selectedReport.puntoPartida}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <MapPin className="h-4 w-4 text-gold mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Punto de Llegada</p>
                          <p className="text-sm text-foreground">{selectedReport.puntoLlegada}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 pt-2 border-t border-border/30">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            selectedReport.tipoRecorrido === "con_herramienta"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          )}
                        >
                          {selectedReport.tipoRecorrido === "con_herramienta" ? (
                            <><Package className="h-3 w-3 mr-1" />Con Herramienta</>
                          ) : (
                            <><Route className="h-3 w-3 mr-1" />Normal</>
                          )}
                        </Badge>
                        {selectedReport.fotoHerramienta && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" /> Foto herramienta adjunta
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between rounded-lg border border-gold/20 bg-gold/5 p-4">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">{isSharedPricing ? "Costo actividad" : "Costo de la actividad"}</p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative w-full max-w-xs">
                        <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
                        <Input
                          data-testid="approval-cost-input"
                          type="number"
                          min="0"
                          value={editableCost}
                          onChange={(e) => handleEditableCostChange(e.target.value)}
                          className={cn(
                            "pl-9 bg-background/70 border-gold/20 text-gold font-semibold",
                            isCostDirty && "border-gold shadow-[0_0_0_1px_rgba(234,179,8,0.25)]"
                          )}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="approval-save-value"
                        className="gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
                        onClick={handleSaveCost}
                        disabled={(!(isCostDirty || isSharedParticipantDraftDirty)) || savingCost || processing}
                      >
                        {savingCost ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        {savingCost ? "Guardando..." : "Guardar valor"}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {isSharedPricing
                        ? "Aprueba la actividad completa. Aquí puedes ajustar cuánto recibe cada técnico y el porcentaje que le corresponde antes de guardar o aprobar."
                        : "El admin puede ajustar este valor incluso si la actividad está pendiente o ya fue aprobada."}
                    </p>
                    {saveSuccessMessage && (
                      <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs font-medium text-emerald-400">
                        <div data-testid="approval-save-success">{saveSuccessMessage}</div>
                      </div>
                    )}
                    {isSharedPricing && (
                      <div className="mt-3 space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                            <p className="text-xs text-muted-foreground">
                              {selectedReport.tipo === "actividad_grupal" ? "Base total registrada" : "Costo actividad registrado"}
                            </p>
                            <p className="text-sm font-semibold text-foreground">{formatCurrency(comparisonReferenceValue)}</p>
                          </div>
                          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                            <p className="text-xs text-muted-foreground">
                              {selectedReport.tipo === "actividad_grupal" ? "Base total actual" : "Costo actividad actual"}
                            </p>
                            <p className="text-sm font-semibold text-gold">{formatCurrency(comparisonCurrentValue)}</p>
                          </div>
                          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                            <p className="text-xs text-muted-foreground">Participantes</p>
                            <p className="text-sm font-semibold text-foreground">{sharedParticipantsDraftSummary.participants.length}</p>
                            <p className="text-xs text-muted-foreground">La aprobación aplica a toda la actividad</p>
                          </div>
                        </div>
                        <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Reparto por técnico</p>
                              <p className="text-xs text-muted-foreground">Edita los valores y los porcentajes se calculan automáticamente. Para guardar, el total debe completar 100%.</p>
                            </div>
                            <Badge variant="outline" className="border-gold/20 bg-gold/10 text-gold">
                              Base: {formatCurrency(costDraft)}
                            </Badge>
                          </div>
                          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                              <p className="text-xs text-muted-foreground">Total reparto</p>
                              <p className={cn("text-sm font-semibold", sharedParticipantsDraftSummary.isAmountBalanced ? "text-emerald-400" : "text-red-400")}>
                                {formatCurrency(sharedParticipantsDraftSummary.totalAmount)}
                              </p>
                            </div>
                            <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                              <p className="text-xs text-muted-foreground">Total porcentaje</p>
                              <p className={cn("text-sm font-semibold", sharedParticipantsDraftSummary.isPercentageBalanced ? "text-emerald-400" : "text-red-400")}>
                                {formatRoundedPercentage(sharedParticipantsDraftSummary.totalPercentage)}
                              </p>
                            </div>
                            <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                              <p className="text-xs text-muted-foreground">Estado</p>
                              <p className={cn("text-sm font-semibold", sharedParticipantsDraftSummary.canSave ? "text-emerald-400" : "text-red-400")}>
                                {sharedParticipantsDraftSummary.canSave ? "Listo para guardar" : "Ajusta el reparto"}
                              </p>
                            </div>
                          </div>
                          <p className="mb-3 text-xs text-muted-foreground">
                            Los porcentajes mostrados son automáticos y se redondean visualmente. El reparto solo se puede guardar cuando el total del porcentaje sea 100%.
                          </p>
                          <div className="space-y-2">
                            {sharedParticipantsDraftSummary.participants.map((participant) => (
                              <div key={participant.reportId} className="grid grid-cols-1 gap-2 rounded-lg border border-border/50 bg-background/40 p-3 sm:grid-cols-[minmax(0,1fr)_110px_140px]">
                                <div>
                                  <p className="text-sm font-medium text-foreground">{participant.nombre}</p>
                                  <p className="text-xs text-muted-foreground">Porcentaje calculado: {formatRoundedPercentage(participant.percentage)}</p>
                                </div>
                                <div className="flex items-center justify-end rounded-md border border-border/50 bg-background/70 px-3 text-sm font-medium text-foreground">
                                  {formatRoundedPercentage(participant.percentage)}
                                </div>
                                <div className="relative">
                                  <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
                                  <Input
                                    data-testid={`approval-participant-amount-${participant.reportId}`}
                                    type="number"
                                    min="0"
                                    value={String(participant.amount)}
                                    onChange={(e) => handleSharedParticipantAmountChange(participant.reportId, e.target.value)}
                                    className="h-9 pl-9 bg-background/70 border-border/50 text-right text-gold"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              data-testid="approval-save-split"
                              className="gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
                              onClick={handleSaveParticipantSplit}
                              disabled={!isSharedParticipantDraftDirty || !sharedParticipantsDraftSummary.canSave || savingParticipantSplit || savingCost || processing}
                            >
                              {savingParticipantSplit ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                              ) : (
                                <Save className="h-4 w-4" />
                              )}
                              {savingParticipantSplit ? "Guardando reparto..." : "Guardar reparto técnico"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                    {selectedReport.tipo === "visita_tecnica" && companySettings && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Default global actual para visitas técnicas: {formatCurrency(companySettings.costoVisitaTecnicaDefault)}.
                      </p>
                    )}
                  </div>
                  {selectedReport.fechaAprobacionLider && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Aprobado por líder</p>
                      <p className="text-sm text-foreground">{selectedReport.fechaAprobacionLider}</p>
                    </div>
                  )}
                </div>

                {hasTechnicianChange && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{getValueChangeLabel(selectedReport)}</p>
                        <p className="text-xs text-muted-foreground">
                          Comparación entre el valor base registrado y el valor final reportado para aprobación.
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/20">
                        Ajuste {formatCurrencyDelta(costDelta)}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <p className="text-xs text-muted-foreground">{getDefaultValueLabel(selectedReport)}</p>
                        <p className="text-sm font-semibold text-foreground">{formatCurrency(comparisonReferenceValue)}</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <p className="text-xs text-muted-foreground">{comparisonCurrentLabel}</p>
                        <p className="text-sm font-semibold text-gold">{formatCurrency(comparisonCurrentValue)}</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <p className="text-xs text-muted-foreground">Diferencia</p>
                        <p className={cn("text-sm font-semibold", costDelta >= 0 ? "text-amber-400" : "text-emerald-400")}>
                          {formatCurrencyDelta(costDelta)}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                      <p className="text-xs text-muted-foreground">{getReasonLabel(selectedReport)}</p>
                      <p className="text-sm text-foreground/80">
                        {selectedReport.motivoModificacionValor || "Se modificó el valor, pero no quedó registrada una razón en este reporte."}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 border-t border-border/50 pt-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    variant="outline"
                    className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => handleDelete(selectedReport)}
                    disabled={processing || isDeleting}
                  >
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {isDeleting ? "Eliminando..." : "Eliminar"}
                  </Button>
                  <div className="flex justify-end gap-2">
                    {normalizedModalStatus === "pendiente" ? (
                      <>
                        <Button
                          variant="outline"
                          className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                          onClick={() => handleReject(selectedReport)}
                          disabled={processing || isDeleting}
                        >
                          <XCircle className="h-4 w-4" />
                          Rechazar
                        </Button>
                        <Button
                          className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                          data-testid="approval-approve"
                          onClick={() => handleApprove(selectedReport)}
                          disabled={processing || isDeleting}
                        >
                          {processing ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {processing ? "Procesando..." : isSharedPricing ? "Aprobar actividad" : "Aprobar"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        data-testid="approval-reactivate"
                        className="gap-2 border-cyan-neon/30 text-cyan-neon hover:bg-cyan-neon/10 hover:text-cyan-neon"
                        onClick={() => handleReactivate(selectedReport)}
                        disabled={processing || isDeleting}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reactivar
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
