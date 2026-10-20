"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AdminHeader } from "@/components/layout/admin-header";
import { AdminPageLoader } from "@/components/layout/admin-page-loader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DollarSign,
  Download,
  Lock,
  Users,
  FileText,
  CalendarDays,
  Printer,
  PenLine,
  Bike,
  Sparkles,
  Clock,
  CheckCircle2,
  Trash2,
  Loader2,
  Search,
  Eye,
  ChevronDown,
  Percent,
} from "lucide-react";
import { LiquidationPeriod, User, WorkGroup, ActivityReport, ArrivalRecord } from "@/lib/types";
import { getPeriodos, closePeriodo, getCanonicalLiquidationSummary, CanonicalLiquidationSummary } from "@/lib/data/services/liquidacion";
import { getConfiguracion } from "@/lib/data/services/configuracion";
import { getUsuarios, updateUsuario } from "@/lib/data/services/usuarios";
import { getGrupos } from "@/lib/data/services/grupos";
import { deleteReporteActividadAdmin, getReportesActividad } from "@/lib/data/services/reportes-actividad";
import { getLlegadas } from "@/lib/data/services/llegadas";
import { cn } from "@/lib/utils";
import { formatReceiptName, generateTablePDF, generateComprobantePDF } from "@/lib/utils/pdf-generator";
import { calculateLiquidationAmount, isLegacyAppliedValueCalculation } from "@/lib/utils/liquidation-math";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getDisplayReportObservations, getReportServiceDetail } from "@/lib/utils/report-content";

import { CompanySettings } from "@/lib/types";

const DEFAULT_NOTIFICATION_BCC = "solucionesyautomatizaciones@hotmail.com";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);
}

function normalizeSearchValue(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getTipoLabel(tipo: ActivityReport["tipo"]) {
  if (tipo === "mantenimiento_preventivo") return "Mant. Preventivo";
  if (tipo === "visita_tecnica") return "Visita Técnica";
  if (tipo === "recorrido") return "Recorrido";
  if (tipo === "actividad_grupal") return "Actividad Grupal";
  return tipo;
}

function isRouteBonusReport(report: ActivityReport) {
  return report.tipo === "recorrido";
}

function getRouteBonusDescription(report: ActivityReport) {
  const route = [report.puntoPartida, report.puntoLlegada].filter(Boolean).join(" - ");
  const label = report.tipoRecorrido === "con_herramienta" ? "Recorrido con herramienta:" : "Recorrido normal:";
  const detail = route || report.descripcion || "Recorrido";
  return `${label} ${detail}`;
}

function distributeAttendanceDiscount(reports: ActivityReport[], totalDiscount: number) {
  const applicable = reports.filter((report) => report.tipo !== "recorrido");
  const result = new Map<string, number>();
  const totalBase = applicable.reduce((sum, report) => sum + getReportLiquidationGrossValue(report), 0);
  const cappedDiscount = Math.min(Math.max(0, totalDiscount), totalBase);
  let allocated = 0;

  applicable.forEach((report, index) => {
    const amount = index === applicable.length - 1
      ? cappedDiscount - allocated
      : totalBase > 0
        ? Math.round(cappedDiscount * getReportLiquidationGrossValue(report) / totalBase)
        : 0;
    result.set(report.id, amount);
    allocated += amount;
  });

  return result;
}

function getEstadoLabel(estado: ActivityReport["estadoAprobacionLider"]) {
  if (estado === "aprobado") return "Aprobado";
  if (estado === "rechazado") return "Rechazado";
  return "Pendiente";
}

function isApprovedLiquidationReport(report: ActivityReport) {
  if (report.liquidacionEstado) {
    return report.liquidacionEstado === "aprobado" || report.liquidacionEstado === "pagado";
  }

  // Legacy approved reports may not have a materialized liquidation item yet.
  // The API marks them as payable from their approval while no frozen snapshot
  // exists, so keep the client-side payment summaries consistent with that.
  return report.estadoAprobacionLider === "aprobado";
}

type TechLiquidationSummary = {
  nombre: string;
  actividades: number;
  totalBruto: number;
  totalNoRecorridos: number;
  totalRecorridos: number;
  pendiente?: number;
  recorridosPendientes?: number;
  extraLider: number;
  extraLiderPendiente?: number;
  descuentoPorcentaje: number;
  descuentoValor: number;
  total: number;
};

type GroupLiquidationSummary = {
  nombre: string;
  actividades: number;
  totalBruto: number;
  totalNoRecorridos: number;
  totalRecorridos: number;
  extraLider: number;
  descuentoValor: number;
  total: number;
};

type TechLiquidationDisplaySummary = TechLiquidationSummary & {
  actividadesVisibles: number;
  actividadesAprobadas: number;
};

type GroupLiquidationDisplaySummary = GroupLiquidationSummary & {
  actividadesVisibles: number;
  actividadesAprobadas: number;
};

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function calculateDiscountValue(base: number, percentage: number) {
  if (base <= 0 || percentage <= 0) return 0;
  return Math.round(base * percentage / 100);
}

function buildStableOrderKey(periodId: string, entityId: string) {
  return `${periodId}:${entityId}`;
}

function getReportLiquidationBaseValue(report: ActivityReport) {
  if (report.liquidacionValorBase != null) {
    return Number(report.liquidacionValorBase) || 0;
  }

  const activityBaseValue = Number(report.valorActividadBaseGlobal ?? report.costoActividadDefault ?? 0) || 0;
  if (activityBaseValue > 0) return activityBaseValue;

  if (report.tipo === "recorrido") {
    return Number(report.costoActividad ?? 0) || 0;
  }

  return Number(report.costoActividad ?? 0) || 0;
}

function getReportLiquidationPercentage(report: ActivityReport) {
  const explicitPercentage = Number(report.porcentajeParticipacion ?? 0) || 0;
  if (explicitPercentage > 0 && explicitPercentage <= 100) {
    return explicitPercentage;
  }

  return 100;
}

function getReportLiquidationEarnedValue(report: ActivityReport) {
  if (report.liquidacionValorGanado != null) {
    const storedNet = Number(report.liquidacionValorGanado) || 0;
    const storedGross = Number(report.liquidacionValorGanadoOriginal ?? 0) || 0;
    const baseValue = getReportLiquidationBaseValue(report);
    const appliedValue = Number(report.valorActividadAplicadoGlobal ?? 0) || 0;
    const percentage = getReportLiquidationPercentage(report);

    if (!report.liquidacionCongelada && report.tipo !== "recorrido" && isLegacyAppliedValueCalculation({
      storedAmount: storedGross,
      baseValue,
      appliedValue,
      percentage,
    })) {
      const correctedGross = calculateLiquidationAmount(baseValue, percentage);
      const attendancePercentage = Number(report.liquidacionPorcentajeDescuentoTardanza ?? 0) || 0;
      return Math.max(0, correctedGross - calculateLiquidationAmount(correctedGross, attendancePercentage));
    }

    return storedNet;
  }

  if (report.tipo === "visita_tecnica") {
    const currentValue = Number(report.costoActividad ?? 0) || 0;
    const defaultValue = Number(report.costoActividadDefault ?? 0) || 0;

    if (currentValue <= 0 && defaultValue > 0 && !report.valorModificado) {
      return defaultValue;
    }

    return currentValue;
  }

  if (report.tipo === "mantenimiento_preventivo") {
    const currentValue = Number(report.costoActividad ?? 0) || 0;
    const defaultValue = Number(report.costoActividadDefault ?? 0) || 0;

    if (currentValue <= 0 && defaultValue > 0 && !report.valorModificado) {
      return defaultValue;
    }

    return currentValue;
  }

  return Number(report.costoActividad ?? 0) || 0;
}

function getReportLiquidationGrossValue(report: ActivityReport) {
  const storedAmount = report.liquidacionValorGanadoOriginal != null
    ? Number(report.liquidacionValorGanadoOriginal) || 0
    : getReportLiquidationEarnedValue(report);
  const baseValue = getReportLiquidationBaseValue(report);
  const appliedValue = Number(report.valorActividadAplicadoGlobal ?? 0) || 0;
  const percentage = getReportLiquidationPercentage(report);

  if (!report.liquidacionCongelada && report.tipo !== "recorrido" && isLegacyAppliedValueCalculation({
    storedAmount,
    baseValue,
    appliedValue,
    percentage,
  })) {
    return calculateLiquidationAmount(baseValue, percentage);
  }

  return storedAmount;
}

function getReportLiquidationDiscount(report: ActivityReport) {
  if (report.liquidacionDescuentoTardanza == null) return null;
  if (report.liquidacionCongelada) return Number(report.liquidacionDescuentoTardanza) || 0;

  const baseValue = getReportLiquidationBaseValue(report);
  const appliedValue = Number(report.valorActividadAplicadoGlobal ?? 0) || 0;
  const percentage = getReportLiquidationPercentage(report);
  const attendancePercentage = Number(report.liquidacionPorcentajeDescuentoTardanza ?? 0) || 0;
  const storedGross = Number(report.liquidacionValorGanadoOriginal ?? 0) || 0;

  if (report.tipo !== "recorrido" && attendancePercentage > 0 && isLegacyAppliedValueCalculation({
    storedAmount: storedGross,
    baseValue,
    appliedValue,
    percentage,
  })) {
    return calculateLiquidationAmount(getReportLiquidationGrossValue(report), attendancePercentage);
  }

  return Number(report.liquidacionDescuentoTardanza) || 0;
}

export default function LiquidacionPage() {
  const [periods, setPeriods] = useState<LiquidationPeriod[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [actReports, setActReports] = useState<ActivityReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsLoadError, setReportsLoadError] = useState<string | null>(null);
  const [arrivalRecords, setArrivalRecords] = useState<ArrivalRecord[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [canonicalSummary, setCanonicalSummary] = useState<CanonicalLiquidationSummary | null>(null);
  const [canonicalSummaryLoading, setCanonicalSummaryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [comprobanteOpen, setComprobanteOpen] = useState(false);
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("todos");
  const [technicianSearch, setTechnicianSearch] = useState("");
  const [technicianTabSearch, setTechnicianTabSearch] = useState("");
  const [technicianTabGroupId, setTechnicianTabGroupId] = useState<string>("todos");
  const [groupTabSearch, setGroupTabSearch] = useState("");
  const [comprobanteSearch, setComprobanteSearch] = useState("");
  const [comprobanteGroupId, setComprobanteGroupId] = useState<string>("todos");
  const [reportToDelete, setReportToDelete] = useState<ActivityReport | null>(null);
  const [selectedReport, setSelectedReport] = useState<ActivityReport | null>(null);
  const [reportDetailOpen, setReportDetailOpen] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [exportingComprobante, setExportingComprobante] = useState(false);
  const [comprobanteCedulaDraft, setComprobanteCedulaDraft] = useState("");
  const [savingComprobanteCedula, setSavingComprobanteCedula] = useState(false);
  const [comprobanteCedulaError, setComprobanteCedulaError] = useState<string | null>(null);
  const [comprobanteCedulaSaved, setComprobanteCedulaSaved] = useState(false);
  const [openTechCards, setOpenTechCards] = useState<Record<string, boolean>>({});
  const [openGroupCards, setOpenGroupCards] = useState<Record<string, boolean>>({});
  const scrollRestorePositionRef = useRef<number | null>(null);
  const reportOrderRef = useRef(new Map<string, number>());
  const techOrderRef = useRef(new Map<string, number>());
  const groupOrderRef = useRef(new Map<string, number>());
  const liquidationRequestRef = useRef(0);
  const canonicalSummaryRequestRef = useRef(0);
  const nextReportOrderRef = useRef(0);
  const nextTechOrderRef = useRef(0);
  const nextGroupOrderRef = useRef(0);

  // Paginación para tabla detallada
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const rememberScrollPosition = () => {
    if (typeof window === "undefined") return;
    scrollRestorePositionRef.current = window.scrollY;
  };

  const handleClosePeriod = async () => {
    if (!selectedPeriod) return;
    rememberScrollPosition();
    setClosing(true);
    try {
      await closePeriodo(selectedPeriod.id);

      const companyName = companySettings?.nombre || "SOLUCIONES & AUTOMATIZACIONES S.A.S.";
      const operationalEmail = companySettings?.correoEmpresa || DEFAULT_NOTIFICATION_BCC;

      const techIds = Array.from(techSummary.keys());
      const techEmails = techIds
        .map((id) => users.find((u) => u.id === id))
        .filter(Boolean);

      try {
        const emailPromises = techEmails.map((tech) => {
          if (!tech) return Promise.resolve();
          const data = techSummary.get(tech.id);
          return fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: tech.email,
              cc: operationalEmail,
              subject: `SoluReport - Liquidación Cerrada (${selectedPeriod.fechaInicio} → ${selectedPeriod.fechaFin})`,
              template: "liquidation-closed",
              data: {
                companyName,
                tecnicoNombre: `${tech.nombre} ${tech.apellido}`,
                fechaInicio: selectedPeriod.fechaInicio,
                fechaFin: selectedPeriod.fechaFin,
                actividades: data?.actividades || 0,
                total: formatCurrency(data?.total || 0),
              },
              replyTo: operationalEmail,
            }),
          });
        });
        await Promise.allSettled(emailPromises);
      } catch (emailErr) {
        console.error("Error enviando emails (no bloqueante):", emailErr);
      }

      const updatedPeriods = await getPeriodos();
      setPeriods(updatedPeriods);
      setCloseDialogOpen(false);
    } catch (err) {
      console.error("Error cerrando período:", err);
    } finally {
      setClosing(false);
    }
  };

  useEffect(() => {
    const requestId = ++liquidationRequestRef.current;
    setLoading(true);
    Promise.allSettled([
      getPeriodos(), getUsuarios(), getGrupos(), getConfiguracion(), getLlegadas(),
    ]).then(([periodsResult, usersResult, groupsResult, settingsResult, arrivalsResult]) => {
      if (requestId !== liquidationRequestRef.current) return;
      const p = periodsResult.status === "fulfilled" ? periodsResult.value : [];
      const u = usersResult.status === "fulfilled" ? usersResult.value : [];
      const g = groupsResult.status === "fulfilled" ? groupsResult.value : [];
      const s = settingsResult.status === "fulfilled" ? settingsResult.value : null;
      const l = arrivalsResult.status === "fulfilled" ? arrivalsResult.value : [];

      if (periodsResult.status === "rejected") console.error("Error cargando períodos en liquidación:", periodsResult.reason);
      if (usersResult.status === "rejected") console.error("Error cargando usuarios en liquidación:", usersResult.reason);
      if (groupsResult.status === "rejected") console.error("Error cargando grupos en liquidación:", groupsResult.reason);
      if (settingsResult.status === "rejected") console.error("Error cargando configuración en liquidación:", settingsResult.reason);
      if (arrivalsResult.status === "rejected") console.error("Error cargando llegadas en liquidación:", arrivalsResult.reason);

      setPeriods(p);
      setUsers(u);
      setGroups(g);
      setArrivalRecords(l);
      setCompanySettings(s);
      const initialPeriodId = p[0]?.id || "";
      setSelectedPeriodId((current) => (current && p.some((period) => period.id === current) ? current : initialPeriodId));
    }).finally(() => {
      if (requestId === liquidationRequestRef.current) setLoading(false);
    });
  }, []);

  // Load only the reports for the selected period. Loading the complete
  // history here made the liquidation request grow until it could fail or
  // return incomplete data, which hid activities, visits and routes.
  useEffect(() => {
    if (!selectedPeriodId) {
      setActReports([]);
      setReportsLoading(false);
      setReportsLoadError(null);
      return;
    }

    let cancelled = false;
    setReportsLoading(true);
    setReportsLoadError(null);

    getReportesActividad({ periodoId: selectedPeriodId })
      .then((reports) => {
        if (cancelled) return;
        setActReports(reports);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error cargando reportes del período en liquidación:", error);
        setActReports([]);
        setReportsLoadError("No se pudieron cargar todos los reportes de este período.");
      })
      .finally(() => {
        if (!cancelled) setReportsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId]);

  const loadCanonicalSummary = useCallback(async (periodId: string) => {
    const requestId = ++canonicalSummaryRequestRef.current;
    if (!periodId) {
      setCanonicalSummary(null);
      setCanonicalSummaryLoading(false);
      return;
    }
    setCanonicalSummaryLoading(true);
    try {
      const result = await getCanonicalLiquidationSummary(periodId);
      if (requestId === canonicalSummaryRequestRef.current) setCanonicalSummary(result);
    } catch (error) {
      if (requestId === canonicalSummaryRequestRef.current) {
        console.error("Error cargando resumen canónico de liquidación:", error);
        setCanonicalSummary(null);
      }
    } finally {
      if (requestId === canonicalSummaryRequestRef.current) setCanonicalSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCanonicalSummary(selectedPeriodId);
  }, [loadCanonicalSummary, selectedPeriodId]);

  useEffect(() => {
    const onFocus = () => {
      void loadCanonicalSummary(selectedPeriodId);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadCanonicalSummary, selectedPeriodId]);

  useEffect(() => {
    if (scrollRestorePositionRef.current === null || typeof window === "undefined") return;

    const targetPosition = scrollRestorePositionRef.current;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: targetPosition, behavior: "auto" });
      scrollRestorePositionRef.current = null;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [periods, actReports, arrivalRecords]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedPeriodId, selectedGroupId, technicianSearch]);

  if (loading) {
    return (
      <div>
        <AdminHeader title="Liquidación" />
        <AdminPageLoader
          title="Cargando liquidación"
          message="Estamos preparando períodos, reportes y acumulados para la liquidación."
          statsCount={4}
          rows={7}
        />
      </div>
    );
  }

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);
  const hasSelectedPeriod = !!selectedPeriod;

  const isDateWithinSelectedPeriod = (fecha: string) => {
    if (!selectedPeriod) return false;
    return fecha >= selectedPeriod.fechaInicio && fecha <= selectedPeriod.fechaFin;
  };

  // Reportes de actividad del período (fuente principal de datos)
  const periodReports = actReports.filter(
    (r) => r.periodoId === selectedPeriodId
  );
  const liquidablePeriodReports = periodReports.filter(
    isApprovedLiquidationReport
  );
  const periodRouteReports = liquidablePeriodReports.filter((report) => report.tipo === "recorrido");
  const periodRouteCount = periodReports.filter((report) => report.tipo === "recorrido").length;
  const periodTechnicalVisitCount = periodReports.filter((report) => report.tipo === "visita_tecnica").length;

  const discountRecordsByUser = arrivalRecords.reduce<Map<string, number>>((acc, record) => {
    if (!record.descuentoAplicado || !isDateWithinSelectedPeriod(record.fecha)) {
      return acc;
    }

    const percentage = Number(record.porcentajeDescuento || companySettings?.porcentajeDescuentoTardanza || 0) || 0;
    if (percentage <= 0) return acc;

    // El porcentaje es una configuración por período, no una suma por cada
    // llegada. Varias tardanzas no pueden convertir un 30% configurado en 90%.
    const current = acc.get(record.usuarioId) || 0;
    acc.set(record.usuarioId, clampPercentage(Math.max(current, percentage)));
    return acc;
  }, new Map());

  const defaultExtraPct = companySettings?.porcentajeExtraLider || 0;
  const defaultExtraActivo = companySettings?.extraLiderActivo ?? false;

  const liveLeaderExtraByTech = groups.reduce<Map<string, number>>((acc, group) => {
    const liderId = group.liderId;
    if (!liderId) return acc;

    const porcentajeExtraLiderAplicado = defaultExtraPct;
    const extraLiderActivo = defaultExtraActivo;

    if (!extraLiderActivo || porcentajeExtraLiderAplicado <= 0) {
      acc.set(liderId, 0);
      return acc;
    }

    const groupMembers = users.filter((user) => group.miembros.includes(user.id) && user.id !== liderId);
    const excludedTechnicianIds: string[] = [];

    let extraBase = 0;

    groupMembers.forEach((member) => {
      if (excludedTechnicianIds.includes(member.id)) return;

      const memberReports = periodReports.filter(
        (report) => report.tecnicoId === member.id
          && report.tipo !== "recorrido"
          && report.estadoAprobacionLider === "aprobado"
          && report.liderGrupoId === liderId
      );

      extraBase += memberReports.reduce((sum, report) => sum + getReportLiquidationEarnedValue(report), 0);
    });

    acc.set(liderId, Math.round(extraBase * porcentajeExtraLiderAplicado / 100));
    return acc;
  }, new Map());

  // En un periodo cerrado, la API devuelve el extra calculado al cierre.
  // Nunca reconstruirlo con la configuración vigente: esa configuración puede
  // haber cambiado después y alteraría el histórico/PDF.
  const leaderExtraByTech = canonicalSummary
    ? new Map(canonicalSummary.technicians.map((row) => [row.tecnicoId, row.extraLider]))
    : liveLeaderExtraByTech;

  const leaderGroupByTech = groups.reduce<Map<string, string>>((acc, group) => {
    if (group.liderId && !acc.has(group.liderId)) {
      acc.set(group.liderId, group.id);
    }
    return acc;
  }, new Map());

  const totalExtraLeaderPeriod = Array.from(leaderExtraByTech.values()).reduce((sum, value) => sum + value, 0);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const groupIdByUser = users.reduce<Map<string, string | null>>((acc, user) => {
    const directGroupId = user.grupoId || null;
    const memberGroup = groups.find((group) => group.miembros.includes(user.id) || group.liderId === user.id);
    acc.set(user.id, directGroupId || memberGroup?.id || null);
    return acc;
  }, new Map());

  const buildTechSummary = (reports: ActivityReport[], includeLeaderExtra: boolean = false) => {
    const summary = new Map<string, TechLiquidationSummary>();

    reports.forEach((report) => {
      const tech = users.find((u) => u.id === report.tecnicoId);
      if (!tech) return;

      const existing = summary.get(report.tecnicoId) || {
        nombre: `${tech.nombre} ${tech.apellido}`,
        actividades: 0,
        totalBruto: 0,
        totalNoRecorridos: 0,
        totalRecorridos: 0,
        extraLider: 0,
        descuentoPorcentaje: 0,
        descuentoValor: 0,
        total: 0,
      };

      const grossValue = getReportLiquidationGrossValue(report);
      const payableValue = getReportLiquidationEarnedValue(report);
      existing.actividades += 1;
      existing.totalBruto += grossValue;
      if (report.tipo === "recorrido") {
        existing.totalRecorridos += payableValue;
      } else {
        existing.totalNoRecorridos += grossValue;
      }

      summary.set(report.tecnicoId, existing);
    });

    if (includeLeaderExtra) {
      leaderExtraByTech.forEach((extraValue, techId) => {
        if (extraValue <= 0 && !summary.has(techId)) return;

        const tech = users.find((u) => u.id === techId);
        if (!tech) return;

        if (!summary.has(techId)) {
          summary.set(techId, {
            nombre: `${tech.nombre} ${tech.apellido}`,
            actividades: 0,
            totalBruto: 0,
            totalNoRecorridos: 0,
            totalRecorridos: 0,
            extraLider: 0,
            descuentoPorcentaje: 0,
            descuentoValor: 0,
            total: 0,
          });
        }
      });
    }

    summary.forEach((item, techId) => {
      const techReports = reports.filter((report) => report.tecnicoId === techId);
      const nonRouteReports = techReports.filter((report) => report.tipo !== "recorrido");
      const canonicalDiscounts = nonRouteReports.reduce((sum, report) => sum + (getReportLiquidationDiscount(report) ?? 0), 0);
      const hasCanonicalDiscount = nonRouteReports.some((report) => getReportLiquidationDiscount(report) !== null);
      item.descuentoPorcentaje = hasCanonicalDiscount
        ? nonRouteReports.reduce((max, report) => Math.max(max, Number(report.liquidacionPorcentajeDescuentoTardanza || 0)), 0)
        : discountRecordsByUser.get(techId) || 0;
      item.descuentoValor = hasCanonicalDiscount
        ? canonicalDiscounts
        : calculateDiscountValue(item.totalNoRecorridos, item.descuentoPorcentaje);
      item.extraLider = includeLeaderExtra ? (leaderExtraByTech.get(techId) || 0) : 0;
      item.total = item.totalBruto - item.descuentoValor + item.extraLider;
    });

    return summary;
  };

  const buildTechDisplaySummary = (
    seedUsers: User[],
    visibleReports: ActivityReport[],
    payableReports: ActivityReport[],
    includeLeaderExtra: boolean = false,
  ) => {
    const payableSummary = buildTechSummary(payableReports, includeLeaderExtra);
    const visibleCounts = new Map<string, number>();

    visibleReports.forEach((report) => {
      visibleCounts.set(report.tecnicoId, (visibleCounts.get(report.tecnicoId) || 0) + 1);
    });

    const summary = new Map<string, TechLiquidationDisplaySummary>();

    seedUsers.forEach((tech) => {
      const payableData = payableSummary.get(tech.id);
      summary.set(tech.id, {
        nombre: payableData?.nombre || `${tech.nombre} ${tech.apellido}`,
        actividades: payableData?.actividades || 0,
        actividadesVisibles: visibleCounts.get(tech.id) || 0,
        actividadesAprobadas: payableData?.actividades || 0,
        totalBruto: payableData?.totalBruto || 0,
        totalNoRecorridos: payableData?.totalNoRecorridos || 0,
        totalRecorridos: payableData?.totalRecorridos || 0,
        extraLider: payableData?.extraLider || 0,
        descuentoPorcentaje: payableData?.descuentoPorcentaje || 0,
        descuentoValor: payableData?.descuentoValor || 0,
        total: payableData?.total || 0,
      });
    });

    visibleCounts.forEach((actividadesVisibles, techId) => {
      const existing = summary.get(techId);
      if (!existing) return;
      existing.actividadesVisibles = actividadesVisibles;
    });

    return summary;
  };

  const buildGroupSummary = (reports: ActivityReport[], includeLeaderExtra: boolean = false) => {
    const summary = new Map<string, GroupLiquidationSummary>();
    const nonRecSubtotalByGroupAndUser = new Map<string, number>();
    const canonicalDiscountByGroup = new Map<string, number>();
    const groupsWithCanonicalDiscount = new Set<string>();

    reports.forEach((report) => {
      const group = groups.find((g) => g.id === report.grupoId);
      if (!group) return;

      const existing = summary.get(report.grupoId) || {
        nombre: group.nombre,
        actividades: 0,
        totalBruto: 0,
        totalNoRecorridos: 0,
        totalRecorridos: 0,
        extraLider: 0,
        descuentoValor: 0,
        total: 0,
      };

      const grossValue = getReportLiquidationGrossValue(report);
      const payableValue = getReportLiquidationEarnedValue(report);
      existing.actividades += 1;
      existing.totalBruto += grossValue;
      if (report.tipo === "recorrido") {
        existing.totalRecorridos += payableValue;
      } else {
        existing.totalNoRecorridos += grossValue;
        const subtotalKey = `${report.grupoId}|${report.tecnicoId}`;
        nonRecSubtotalByGroupAndUser.set(subtotalKey, (nonRecSubtotalByGroupAndUser.get(subtotalKey) || 0) + grossValue);
        const discount = getReportLiquidationDiscount(report);
        if (discount !== null) {
          groupsWithCanonicalDiscount.add(report.grupoId);
          canonicalDiscountByGroup.set(report.grupoId, (canonicalDiscountByGroup.get(report.grupoId) || 0) + discount);
        }
      }

      summary.set(report.grupoId, existing);
    });

    nonRecSubtotalByGroupAndUser.forEach((base, key) => {
      const [groupId, techId] = key.split("|");
      const groupItem = summary.get(groupId);
      if (!groupItem || groupsWithCanonicalDiscount.has(groupId)) return;
      groupItem.descuentoValor += calculateDiscountValue(base, discountRecordsByUser.get(techId) || 0);
    });

    canonicalDiscountByGroup.forEach((discount, groupId) => {
      const groupItem = summary.get(groupId);
      if (groupItem) groupItem.descuentoValor = discount;
    });

    if (includeLeaderExtra) {
      leaderExtraByTech.forEach((extraValue, liderId) => {
        const leaderGroupId = leaderGroupByTech.get(liderId);
        if (!leaderGroupId) return;

        const groupItem = summary.get(leaderGroupId);
        if (!groupItem) return;

        groupItem.extraLider += extraValue;
      });
    }

    summary.forEach((item) => {
      item.total = item.totalBruto - item.descuentoValor + item.extraLider;
    });

    return summary;
  };

  const buildGroupDisplaySummary = (
    seedGroups: WorkGroup[],
    visibleReports: ActivityReport[],
    payableReports: ActivityReport[],
    includeLeaderExtra: boolean = false,
  ) => {
    const payableSummary = buildGroupSummary(payableReports, includeLeaderExtra);
    const visibleCounts = new Map<string, number>();

    visibleReports.forEach((report) => {
      visibleCounts.set(report.grupoId, (visibleCounts.get(report.grupoId) || 0) + 1);
    });

    const summary = new Map<string, GroupLiquidationDisplaySummary>();

    seedGroups.forEach((group) => {
      const payableData = payableSummary.get(group.id);
      summary.set(group.id, {
        nombre: payableData?.nombre || group.nombre,
        actividades: payableData?.actividades || 0,
        actividadesVisibles: visibleCounts.get(group.id) || 0,
        actividadesAprobadas: payableData?.actividades || 0,
        totalBruto: payableData?.totalBruto || 0,
        totalNoRecorridos: payableData?.totalNoRecorridos || 0,
        totalRecorridos: payableData?.totalRecorridos || 0,
        extraLider: payableData?.extraLider || 0,
        descuentoValor: payableData?.descuentoValor || 0,
        total: payableData?.total || 0,
      });
    });

    visibleCounts.forEach((actividadesVisibles, groupId) => {
      const existing = summary.get(groupId);
      if (!existing) return;
      existing.actividadesVisibles = actividadesVisibles;
    });

    return summary;
  };

  // Resumen por técnico basado en reportes_actividad
  const liquidationUsers = users.filter((user) => user.rol !== "admin");
  const canonicalTechSummary = (() => {
    if (!canonicalSummary) return null;
    const rowsByUser = new Map(canonicalSummary.technicians.map((row) => [row.tecnicoId, row]));
    const summary = new Map<string, TechLiquidationDisplaySummary>();
    liquidationUsers.forEach((tech) => {
      const row = rowsByUser.get(tech.id);
      summary.set(tech.id, {
        nombre: row?.nombre || `${tech.nombre} ${tech.apellido}`,
        actividades: row?.actividadesAprobadas || 0,
        actividadesVisibles: periodReports.filter((report) => report.tecnicoId === tech.id).length,
        actividadesAprobadas: row?.actividadesAprobadas || 0,
        totalBruto: row?.totalBruto || 0,
        totalNoRecorridos: row?.totalNoRecorridos || 0,
        totalRecorridos: row?.totalRecorridos || 0,
        pendiente: row?.totalPendiente || 0,
        recorridosPendientes: row?.totalRecorridosPendientes || 0,
        extraLider: row?.extraLider || 0,
        extraLiderPendiente: row?.extraLiderPendiente || 0,
        descuentoPorcentaje: row && row.totalNoRecorridos > 0
          ? Math.round((row.descuentoValor / row.totalNoRecorridos) * 100)
          : 0,
        descuentoValor: row?.descuentoValor || 0,
        total: row?.total || 0,
      });
    });
    return summary;
  })();

  const techSummary = canonicalTechSummary || buildTechDisplaySummary(liquidationUsers, periodReports, liquidablePeriodReports, true);

  const totalPeriod = canonicalSummary
    ? canonicalSummary.totals.total
    : Array.from(techSummary.values()).reduce((sum, t) => sum + t.total, 0);
  const totalPendingPeriod = canonicalSummary?.totals.totalPendiente || 0;
  const totalPenaltyPeriod = canonicalSummary
    ? canonicalSummary.totals.descuentoValor
    : Array.from(techSummary.values()).reduce((sum, t) => sum + t.descuentoValor, 0);

  const applyStableReportOrder = (reports: ActivityReport[]) => {
    reports.forEach((report) => {
      const key = buildStableOrderKey(selectedPeriodId, report.id);
      if (!reportOrderRef.current.has(key)) {
        reportOrderRef.current.set(key, nextReportOrderRef.current++);
      }
    });

    return [...reports].sort((a, b) => {
      const aKey = buildStableOrderKey(selectedPeriodId, a.id);
      const bKey = buildStableOrderKey(selectedPeriodId, b.id);
      return (reportOrderRef.current.get(aKey) ?? 0) - (reportOrderRef.current.get(bKey) ?? 0);
    });
  };

  const applyStableTechOrder = <T extends TechLiquidationSummary>(entries: Array<[string, T]>) => {
    entries.forEach(([techId]) => {
      const key = buildStableOrderKey(selectedPeriodId, techId);
      if (!techOrderRef.current.has(key)) {
        techOrderRef.current.set(key, nextTechOrderRef.current++);
      }
    });

    return [...entries].sort((a, b) => {
      const aKey = buildStableOrderKey(selectedPeriodId, a[0]);
      const bKey = buildStableOrderKey(selectedPeriodId, b[0]);
      return (techOrderRef.current.get(aKey) ?? 0) - (techOrderRef.current.get(bKey) ?? 0);
    });
  };

  const applyStableGroupOrder = <T extends GroupLiquidationSummary>(entries: Array<[string, T]>) => {
    entries.forEach(([groupId]) => {
      const key = buildStableOrderKey(selectedPeriodId, groupId);
      if (!groupOrderRef.current.has(key)) {
        groupOrderRef.current.set(key, nextGroupOrderRef.current++);
      }
    });

    return [...entries].sort((a, b) => {
      const aKey = buildStableOrderKey(selectedPeriodId, a[0]);
      const bKey = buildStableOrderKey(selectedPeriodId, b[0]);
      return (groupOrderRef.current.get(aKey) ?? 0) - (groupOrderRef.current.get(bKey) ?? 0);
    });
  };

  const normalizedTechnicianTabSearch = normalizeSearchValue(technicianTabSearch);
  const normalizedGroupTabSearch = normalizeSearchValue(groupTabSearch);
  const normalizedComprobanteSearch = normalizeSearchValue(comprobanteSearch);

  const filteredPeriodReports = applyStableReportOrder(periodReports.filter((r) => {
    const tech = users.find((u) => u.id === r.tecnicoId);
    const techFullName = tech ? `${tech.nombre} ${tech.apellido}`.toLowerCase() : "";
    const matchGroup = selectedGroupId === "todos" || r.grupoId === selectedGroupId;
    const matchTechnician =
      !technicianSearch ||
      techFullName.includes(technicianSearch.toLowerCase()) ||
      tech?.nombre.toLowerCase().includes(technicianSearch.toLowerCase()) ||
      tech?.apellido.toLowerCase().includes(technicianSearch.toLowerCase());

    return matchGroup && matchTechnician;
  }));

  const filteredTechTabReports = periodReports.filter((report) => {
    const tech = usersById.get(report.tecnicoId);
    const techFullName = normalizeSearchValue(tech ? `${tech.nombre} ${tech.apellido}` : "");
    const matchTechnician = !normalizedTechnicianTabSearch || techFullName.includes(normalizedTechnicianTabSearch);
    const matchGroup = technicianTabGroupId === "todos" || report.grupoId === technicianTabGroupId;
    return matchTechnician && matchGroup;
  });

  const filteredTechUsers = liquidationUsers.filter((user) => {
    const techFullName = normalizeSearchValue(`${user.nombre} ${user.apellido}`);
    const matchTechnician = !normalizedTechnicianTabSearch || techFullName.includes(normalizedTechnicianTabSearch);
    const userGroupId = groupIdByUser.get(user.id);
    const matchGroup = technicianTabGroupId === "todos" || userGroupId === technicianTabGroupId;
    return matchTechnician && matchGroup;
  });

  const filteredTechPayableReports = filteredTechTabReports.filter(isApprovedLiquidationReport);

  const filteredTechSummary = buildTechDisplaySummary(filteredTechUsers, filteredTechTabReports, filteredTechPayableReports, true);

  const filteredTechEntries = applyStableTechOrder(Array.from(filteredTechSummary.entries()));

  const filteredGroupReports = periodReports.filter((report) => {
    const group = groupsById.get(report.grupoId);
    const leader = group?.liderId ? usersById.get(group.liderId) : null;
    const groupName = normalizeSearchValue(group?.nombre);
    const leaderName = normalizeSearchValue(leader ? `${leader.nombre} ${leader.apellido}` : "");
    return !normalizedGroupTabSearch || groupName.includes(normalizedGroupTabSearch) || leaderName.includes(normalizedGroupTabSearch);
  });

  const filteredGroups = groups.filter((group) => {
    const leader = usersById.get(group.liderId);
    const groupName = normalizeSearchValue(group.nombre);
    const leaderName = normalizeSearchValue(leader ? `${leader.nombre} ${leader.apellido}` : "");
    return !normalizedGroupTabSearch || groupName.includes(normalizedGroupTabSearch) || leaderName.includes(normalizedGroupTabSearch);
  });

  const filteredGroupPayableReports = filteredGroupReports.filter(isApprovedLiquidationReport);

  const filteredGroupSummary = buildGroupDisplaySummary(filteredGroups, filteredGroupReports, filteredGroupPayableReports, true);

  const filteredGroupEntries = applyStableGroupOrder(Array.from(filteredGroupSummary.entries()));

  const filteredComprobanteReports = liquidablePeriodReports.filter((report) => {
    const tech = usersById.get(report.tecnicoId);
    const techFullName = normalizeSearchValue(tech ? `${tech.nombre} ${tech.apellido}` : "");
    const matchTechnician = !normalizedComprobanteSearch || techFullName.includes(normalizedComprobanteSearch);
    const matchGroup = comprobanteGroupId === "todos" || report.grupoId === comprobanteGroupId;
    return matchTechnician && matchGroup;
  });

  const filteredComprobanteUsers = liquidationUsers.filter((user) => {
    const techFullName = normalizeSearchValue(`${user.nombre} ${user.apellido}`);
    const matchTechnician = !normalizedComprobanteSearch || techFullName.includes(normalizedComprobanteSearch);
    const userGroupId = groupIdByUser.get(user.id);
    const matchGroup = comprobanteGroupId === "todos" || userGroupId === comprobanteGroupId;
    return matchTechnician && matchGroup;
  });

  const filteredComprobantePayableReports = filteredComprobanteReports;

  const filteredComprobanteSummary = buildTechDisplaySummary(filteredComprobanteUsers, filteredComprobanteReports, filteredComprobantePayableReports, true);

  const filteredComprobanteEntries = applyStableTechOrder(Array.from(filteredComprobanteSummary.entries()));

  // Paginación de resultados filtrados
  const totalPages = Math.ceil(filteredPeriodReports.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentReports = filteredPeriodReports.slice(startIndex, endIndex);

  const openReportDetail = (report: ActivityReport) => {
    setSelectedReport(report);
    setReportDetailOpen(true);
  };

  const toggleTechCard = (techId: string) => {
    setOpenTechCards((prev) => ({
      ...prev,
      [techId]: !prev[techId],
    }));
  };

  const toggleGroupCard = (groupId: string) => {
    setOpenGroupCards((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const handleDeleteActivity = async () => {
    if (!reportToDelete) return;
    rememberScrollPosition();
    setDeletingReportId(reportToDelete.id);
    try {
      await deleteReporteActividadAdmin(reportToDelete.id);
      const updatedReports = await getReportesActividad({ periodoId: selectedPeriodId });
      setActReports(updatedReports);
      setReportToDelete(null);
    } catch (err) {
      console.error("Error eliminando actividad de liquidación:", err);
      alert("No se pudo eliminar la actividad. Intenta nuevamente.");
    } finally {
      setDeletingReportId(null);
    }
  };

  const handleDownloadComprobante = () => {
    if (!selectedTechId) return;

    const tech = users.find((u) => u.id === selectedTechId);
    const techData = filteredComprobanteSummary.get(selectedTechId) || techSummary.get(selectedTechId);

    if (!tech || !techData) return;
    const employeeDocument = tech.cedula?.trim();
    if (!employeeDocument) {
      setComprobanteCedulaError("La cédula es obligatoria. Regístrala en este comprobante para habilitar la descarga.");
      return;
    }

    setExportingComprobante(true);

    try {
      // Keep generation synchronous with the click so jsPDF.save retains browser user activation.
      const pdfReports = liquidablePeriodReports.filter(
        (r) => r.tecnicoId === selectedTechId && (comprobanteGroupId === "todos" || r.grupoId === comprobanteGroupId)
      );
      const pdfAuxilioReports = pdfReports.filter((r) => !isRouteBonusReport(r));
      const pdfRouteBonusReports = pdfReports.filter(isRouteBonusReport);
      const pdfDiscountByReport = distributeAttendanceDiscount(pdfReports, techData.descuentoValor);
      const pdfAuxilio = pdfAuxilioReports.reduce((sum, report) => sum + getReportLiquidationGrossValue(report), 0);
      const pdfAuxilioDiscount = pdfAuxilioReports.reduce((sum, report) => sum + (pdfDiscountByReport.get(report.id) || 0), 0);
      const pdfRouteBonus = pdfRouteBonusReports.reduce((sum, report) => sum + getReportLiquidationGrossValue(report), 0);
      const pdfRouteBonusDiscount = pdfRouteBonusReports.reduce((sum, report) => sum + (pdfDiscountByReport.get(report.id) || 0), 0);
      const pdfExtraLider = leaderExtraByTech.get(selectedTechId) || 0;

      generateComprobantePDF({
        empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        periodo: selectedPeriod ? `${selectedPeriod.fechaInicio} al ${selectedPeriod.fechaFin}` : "",
        tecnico: `${tech.nombre} ${tech.apellido}`,
        cedula: employeeDocument,
        items: pdfAuxilioReports.map((report) => ({
          actividad: report.descripcion || getTipoLabel(report.tipo),
          fecha: report.fecha,
          valorBase: getReportLiquidationBaseValue(report),
          porcentaje: getReportLiquidationPercentage(report),
          valorLiquidado: getReportLiquidationGrossValue(report),
        })),
        desplazamientos: pdfRouteBonusReports.map((report) => ({
          descripcion: getRouteBonusDescription(report),
          fecha: report.fecha,
          valor: getReportLiquidationGrossValue(report),
          descuento: pdfDiscountByReport.get(report.id) || 0,
        })),
        totalAuxilio: pdfAuxilio,
        totalDescuentoTardanza: pdfAuxilioDiscount,
        totalRodamiento: pdfRouteBonus,
        totalDescuentoRecorridos: pdfRouteBonusDiscount,
        totalExtraLider: pdfExtraLider,
        grandTotal: pdfAuxilio - pdfAuxilioDiscount + pdfRouteBonus - pdfRouteBonusDiscount + pdfExtraLider,
      });
    } catch (err) {
      console.error("Error generando comprobante PDF:", err);
      alert("No se pudo generar el comprobante PDF. Intenta nuevamente.");
    } finally {
      setExportingComprobante(false);
    }
  };

  const handleOpenComprobante = (techId: string) => {
    const tech = users.find((user) => user.id === techId);
    setSelectedTechId(techId);
    setComprobanteCedulaDraft(tech?.cedula?.trim() || "");
    setComprobanteCedulaError(null);
    setComprobanteCedulaSaved(false);
    setComprobanteOpen(true);
  };

  const handleSaveComprobanteCedula = async () => {
    if (!selectedTechId) return;

    const cedula = comprobanteCedulaDraft.trim();
    if (!cedula) {
      setComprobanteCedulaError("Escribe el número de cédula para continuar.");
      return;
    }

    setSavingComprobanteCedula(true);
    setComprobanteCedulaError(null);
    setComprobanteCedulaSaved(false);
    try {
      const updatedUser = await updateUsuario(selectedTechId, { cedula });
      const savedCedula = updatedUser.cedula?.trim() || cedula;
      setUsers((currentUsers) => currentUsers.map((user) => (
        user.id === selectedTechId ? { ...user, cedula: savedCedula } : user
      )));
      setComprobanteCedulaDraft(savedCedula);
      setComprobanteCedulaSaved(true);
    } catch (error) {
      console.error("Error guardando la cédula desde el comprobante:", error);
      setComprobanteCedulaError("No se pudo guardar la cédula. Verifica la conexión e inténtalo de nuevo.");
    } finally {
      setSavingComprobanteCedula(false);
    }
  };

  return (
    <div>
      <AdminHeader title="Liquidación de Actividades" />
      <div className="p-6 space-y-6">
        {canonicalSummaryLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-gold/20 bg-gold/5 px-4 py-2 text-sm text-gold">
            <Loader2 className="h-4 w-4 animate-spin" />
            Actualizando liquidación canónica del período...
          </div>
        )}
        {reportsLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-4 py-2 text-sm text-cyan-200">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando todas las actividades, visitas y recorridos del período...
          </div>
        )}
        {reportsLoadError && (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-2 text-sm text-red-200">
            {reportsLoadError}
          </div>
        )}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-gold" />
            <Select value={selectedPeriodId || undefined} onValueChange={setSelectedPeriodId}>
              <SelectTrigger className="w-72 bg-secondary/50 border-border/50">
                <SelectValue placeholder="Seleccionar período" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fechaInicio} → {p.fechaFin}{" "}
                    {p.estado === "cerrado" ? "(Cerrado)" : "(Abierto)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="gap-2 border-border/50 text-foreground/80"
              disabled={!hasSelectedPeriod}
              onClick={() => {
                const tipoLabels: Record<string, string> = { mantenimiento_preventivo: "Mant. Preventivo", visita_tecnica: "Visita Técnica", recorrido: "Recorrido", actividad_grupal: "Act. Grupal" };
                const activityRows = liquidablePeriodReports.map((r) => {
                  const tech = users.find((u) => u.id === r.tecnicoId);
                  const group = groups.find((g) => g.id === r.grupoId);
                  return [
                    tipoLabels[r.tipo] || r.tipo,
                    r.codigoRegistro || "Histórico sin código",
                    r.descripcion || "\u2014",
                    group?.nombre || "\u2014",
                    r.fecha,
                    tech ? `${tech.nombre} ${tech.apellido}` : "\u2014",
                    getEstadoLabel(r.estadoAprobacionLider),
                    formatCurrency(getReportLiquidationEarnedValue(r)),
                  ];
                });

                const extraLeaderRows = Array.from(leaderExtraByTech.entries()).map(([techId, extraValue]) => {
                  const tech = usersById.get(techId);
                  const groupId = leaderGroupByTech.get(techId);
                  const group = groupId ? groupsById.get(groupId) : undefined;

                  return [
                    "Extra Líder",
                    "—",
                    "Reconocimiento extra líder del período",
                    group?.nombre || "\u2014",
                    selectedPeriod?.fechaFin || selectedPeriod?.fechaInicio || "\u2014",
                    tech ? `${tech.nombre} ${tech.apellido}` : "\u2014",
                    "Aplicado",
                    formatCurrency(extraValue),
                  ];
                });

                const rows = extraLeaderRows.length > 0
                  ? [...activityRows, ["", "", "", "", "", "", "", ""], ...extraLeaderRows]
                  : activityRows;

                generateTablePDF({
                  titulo: "LIQUIDACI\u00d3N DE ACTIVIDADES",
                  empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
                  periodo: selectedPeriod ? `${selectedPeriod.fechaInicio} \u2192 ${selectedPeriod.fechaFin}` : "",
                  headers: ["Tipo", "Código", "Descripción", "Grupo", "Fecha", "Técnico", "Estado", "Valor"],
                  rows,
                  summary: totalExtraLeaderPeriod > 0 ? [{ label: "Extra líder período", value: formatCurrency(totalExtraLeaderPeriod) }] : undefined,
                  totales: ["TOTAL", "", "", "", "", "", `${liquidablePeriodReports.length} actividades + ${extraLeaderRows.length} extra(s)`, formatCurrency(totalPeriod)],
                });
              }}
            >
              <Download className="h-4 w-4" />
              Descargar PDF
            </Button>
            {selectedPeriod?.estado === "abierto" && (
              <Button
                onClick={() => setCloseDialogOpen(true)}
                className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
              >
                <Lock className="h-4 w-4" />
                Cerrar Período
              </Button>
            )}
          </div>
        </div>

        {hasSelectedPeriod ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <Card className="border-border/50 bg-card/80">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-lg bg-gold/10 p-2.5">
                    <DollarSign className="h-5 w-5 text-gold" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gold">{formatCurrency(totalPeriod)}</p>
                    <p className="text-xs text-muted-foreground">Total Período</p>
                    {totalExtraLeaderPeriod > 0 && (
                      <p className="text-[10px] text-violet-400">Incluye extra líder: {formatCurrency(totalExtraLeaderPeriod)}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50 bg-card/80">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-lg bg-amber-500/10 p-2.5">
                    <Clock className="h-5 w-5 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-amber-400">{formatCurrency(totalPendingPeriod)}</p>
                    <p className="text-xs text-muted-foreground">Pendiente por aprobación</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50 bg-card/80">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-500/10 p-2.5">
                    <Bike className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-foreground">{periodRouteCount}</p>
                    <p className="text-xs text-muted-foreground">Recorridos normales</p>
                    {periodTechnicalVisitCount > 0 && (
                      <p className="text-[10px] text-muted-foreground">{periodTechnicalVisitCount} visitas en productividad</p>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50 bg-card/80">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-lg bg-cyan-neon/10 p-2.5">
                    <FileText className="h-5 w-5 text-cyan-neon" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-foreground">{periodReports.length}</p>
                    <p className="text-xs text-muted-foreground">Actividades Registradas</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50 bg-card/80">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-lg bg-purple-500/10 p-2.5">
                    <Users className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-foreground">{techSummary.size}</p>
                    <p className="text-xs text-muted-foreground">Técnicos Participantes</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/50 bg-card/80">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-500/10 p-2.5">
                    <Lock className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-foreground capitalize">
                      {selectedPeriod?.estado || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">Estado del Período</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-foreground flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-gold" />
                  Resumen Quincenal de Pagos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  {(() => {
                    const approvedReports = liquidablePeriodReports;
                    const totalAprobado = totalPeriod;
                    const recorridos = periodRouteReports;
                    const totalRecorridos = canonicalSummary?.totals.totalRecorridos
                      || recorridos.reduce((s, r) => s + getReportLiquidationEarnedValue(r), 0);

                    const approvedActivityCount = canonicalSummary?.totals.actividadesAprobadas ?? approvedReports.length;

                    return (
                      <>
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            <p className="text-xs font-medium text-emerald-400 uppercase tracking-wide">Aprobado para Pago</p>
                          </div>
                          <p className="text-2xl font-bold text-emerald-400">{formatCurrency(totalAprobado)}</p>
                          <p className="text-xs text-muted-foreground mt-1">{approvedActivityCount} actividades aprobadas</p>
                          {totalExtraLeaderPeriod > 0 && (
                            <p className="text-[10px] text-violet-400 mt-1">Extra líder aplicado: {formatCurrency(totalExtraLeaderPeriod)}</p>
                          )}
                        </div>
                        <div className="rounded-lg border border-gold/20 bg-gold/5 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <DollarSign className="h-4 w-4 text-gold" />
                            <p className="text-xs font-medium text-gold uppercase tracking-wide">Total Quincena</p>
                          </div>
                          <p className="text-2xl font-bold text-gold">{formatCurrency(totalAprobado)}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Recorridos: {formatCurrency(totalRecorridos)} ({recorridos.length})
                          </p>
                          {totalExtraLeaderPeriod > 0 && (
                            <p className="text-[10px] text-violet-400 mt-1">Incluye extra líder: {formatCurrency(totalExtraLeaderPeriod)}</p>
                          )}
                        </div>
                        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Percent className="h-4 w-4 text-red-400" />
                            <p className="text-xs font-medium text-red-400 uppercase tracking-wide">Descuento por Tardanza</p>
                          </div>
                          <p className="text-2xl font-bold text-red-400">-{formatCurrency(totalPenaltyPeriod)}</p>
                          <p className="text-xs text-muted-foreground mt-1">Aplicado sobre actividades no recorrido del período</p>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="actividades" className="space-y-4">
          <TabsList className="bg-secondary/50 border border-border/50">
            <TabsTrigger
              value="actividades"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              Actividades
            </TabsTrigger>
            <TabsTrigger
              value="por_tecnico"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              Por Técnico
            </TabsTrigger>
            <TabsTrigger
              value="por_grupo"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              Por Grupo
            </TabsTrigger>
            <TabsTrigger
              value="comprobantes"
              className="data-[state=active]:bg-gold/10 data-[state=active]:text-gold"
            >
              <Printer className="h-4 w-4 mr-1" />
              Comprobantes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="actividades">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    Se muestran actividades pendientes y aprobadas; solo las aprobadas se suman al pago. Filtra por grupo o técnico.
                  </p>
                  <div className="flex items-center gap-3 flex-wrap w-full sm:w-auto sm:justify-end">
                    <div className="relative w-full sm:w-72">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Buscar por técnico..."
                        value={technicianSearch}
                        onChange={(e) => setTechnicianSearch(e.target.value)}
                        className="pl-10 bg-secondary/50 border-border/50"
                      />
                    </div>
                    <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                      <SelectTrigger className="w-full sm:w-56 bg-secondary/50 border-border/50">
                        <SelectValue placeholder="Filtrar por grupo" />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="todos">Todos los grupos</SelectItem>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Table className="min-w-245 table-fixed">
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="w-36 whitespace-normal text-muted-foreground">Tipo</TableHead>
                      <TableHead className="w-52 whitespace-normal text-muted-foreground">Código</TableHead>
                      <TableHead className="w-104 whitespace-normal text-muted-foreground">Descripción</TableHead>
                      <TableHead className="w-52 whitespace-normal text-muted-foreground">Técnico</TableHead>
                      <TableHead className="w-44 whitespace-normal text-muted-foreground">Grupo</TableHead>
                      <TableHead className="w-32 whitespace-normal text-muted-foreground">Fecha</TableHead>
                      <TableHead className="w-32 whitespace-normal text-muted-foreground">Estado</TableHead>
                      <TableHead className="w-32 whitespace-normal text-right text-muted-foreground">Valor</TableHead>
                      <TableHead className="text-muted-foreground w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentReports.map((r) => {
                      const tech = users.find((u) => u.id === r.tecnicoId);
                      const group = groups.find((g) => g.id === r.grupoId);
                      const tipoLabel = getTipoLabel(r.tipo);

                      return (
                        <TableRow key={r.id} className="border-border/50 hover:bg-secondary/30">
                          <TableCell>
                            <Badge variant="outline" className={cn(
                              "text-[10px]",
                              r.tipo === "mantenimiento_preventivo" ? "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20"
                                : r.tipo === "visita_tecnica" ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                                  : r.tipo === "actividad_grupal" ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            )}>
                              {tipoLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono whitespace-normal text-cyan-neon">
                            {r.codigoRegistro || "Histórico sin código"}
                          </TableCell>
                          <TableCell className="wrap-break-word text-sm leading-5 whitespace-normal text-foreground/80">
                            {r.descripcion || "\u2014"}
                          </TableCell>
                          <TableCell className="text-sm whitespace-normal text-foreground/80">
                            {tech ? `${tech.nombre} ${tech.apellido}` : "\u2014"}
                          </TableCell>
                          <TableCell className="text-sm whitespace-normal text-foreground/80">{group?.nombre || "\u2014"}</TableCell>
                          <TableCell className="text-sm text-foreground/80">{r.fecha}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn(
                              "text-xs",
                              r.estadoAprobacionLider === "aprobado"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : r.estadoAprobacionLider === "rechazado"
                                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            )}>
                              {getEstadoLabel(r.estadoAprobacionLider)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-gold">
                            {formatCurrency(getReportLiquidationEarnedValue(r))}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-cyan-neon"
                                onClick={() => openReportDetail(r)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-red-400"
                                disabled={deletingReportId === r.id}
                                onClick={() => setReportToDelete(r)}
                              >
                                {deletingReportId === r.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredPeriodReports.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                          No hay actividades registradas en este período.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                {totalPages > 1 && (
                  <div className="p-4 border-t border-border/50 flex justify-end">
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                          />
                        </PaginationItem>
                        {Array.from({ length: totalPages }).map((_, i) => (
                          <PaginationItem key={i + 1}>
                            <PaginationLink
                              onClick={() => setCurrentPage(i + 1)}
                              isActive={currentPage === i + 1}
                              className="cursor-pointer"
                            >
                              {i + 1}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                        <PaginationItem>
                          <PaginationNext
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="por_tecnico">
            <div className="space-y-4">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                  <div className="relative w-full md:flex-1 md:min-w-70">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar técnico..."
                      value={technicianTabSearch}
                      onChange={(e) => setTechnicianTabSearch(e.target.value)}
                      className="pl-10 bg-secondary/50 border-border/50"
                    />
                  </div>
                  <Select value={technicianTabGroupId} onValueChange={setTechnicianTabGroupId}>
                    <SelectTrigger className="w-full md:w-64 bg-secondary/50 border-border/50">
                      <SelectValue placeholder="Filtrar por grupo" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="todos">Todos los grupos</SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {filteredTechEntries.map(([techId, data]) => {
                const tech = usersById.get(techId);
                const techReports = filteredTechTabReports.filter((report) => report.tecnicoId === techId);
                const isOpen = openTechCards[techId] ?? false;

                return (
                  <Card key={techId} className="border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
                    <Collapsible open={isOpen} onOpenChange={() => toggleTechCard(techId)}>
                      <CardHeader className="py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-180")} />
                                <span className="sr-only">Expandir técnico</span>
                              </Button>
                            </CollapsibleTrigger>
                            <div>
                              <CardTitle className="text-base text-foreground">{data.nombre}</CardTitle>
                              <p className="text-xs text-muted-foreground">{tech?.email || "Sin correo"}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-gold">{formatCurrency(data.total)}</p>
                            <p className="text-[10px] text-muted-foreground">{data.actividadesVisibles} registradas</p>
                            <p className="text-[10px] text-emerald-400">{data.actividadesAprobadas} aprobadas para pago</p>
                            {data.extraLider > 0 && (
                              <p className="text-[10px] text-violet-400">Extra líder: {formatCurrency(data.extraLider)}</p>
                            )}
                            {data.descuentoValor > 0 && (
                              <p className="text-[10px] text-red-400">Tardanza: -{formatCurrency(data.descuentoValor)}</p>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CollapsibleContent>
                        <CardContent className="pt-0 border-t border-border/20">
                          <Table className="min-w-215 table-fixed">
                            <TableHeader>
                              <TableRow className="border-border/50 hover:bg-transparent">
                                <TableHead className="w-36 whitespace-normal">Tipo</TableHead>
                                <TableHead className="w-52 whitespace-normal">Código</TableHead>
                                <TableHead className="w-96 whitespace-normal">Descripción</TableHead>
                                <TableHead className="w-44 whitespace-normal">Grupo</TableHead>
                                <TableHead className="w-32 whitespace-normal">Fecha</TableHead>
                                <TableHead className="w-32 whitespace-normal">Estado</TableHead>
                                <TableHead className="w-32 whitespace-normal text-right">Valor</TableHead>
                                <TableHead className="w-12"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {techReports.map((report) => (
                                <TableRow key={report.id} className="border-border/50 hover:bg-secondary/30">
                                  <TableCell className="text-sm text-foreground/80">{getTipoLabel(report.tipo)}</TableCell>
                                  <TableCell className="text-xs font-mono whitespace-normal text-cyan-neon">{report.codigoRegistro || "Histórico sin código"}</TableCell>
                                  <TableCell className="wrap-break-word text-sm leading-5 whitespace-normal text-foreground/80">{report.descripcion || "—"}</TableCell>
                                  <TableCell className="text-sm whitespace-normal text-foreground/80">{groupsById.get(report.grupoId)?.nombre || "—"}</TableCell>
                                  <TableCell className="text-sm text-foreground/80">{report.fecha}</TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className={cn(
                                      "text-xs",
                                      report.estadoAprobacionLider === "aprobado"
                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                        : report.estadoAprobacionLider === "rechazado"
                                          ? "bg-red-500/10 text-red-400 border-red-500/20"
                                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    )}>
                                      {getEstadoLabel(report.estadoAprobacionLider)}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right font-semibold text-gold">{formatCurrency(getReportLiquidationEarnedValue(report))}</TableCell>
                                  <TableCell>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-cyan-neon" onClick={() => openReportDetail(report)}>
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {techReports.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                                    Este usuario no tiene actividades en el período seleccionado.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                );
              })}
              {filteredTechEntries.length === 0 && (
                <Card className="border-border/50 bg-card/80">
                  <CardContent className="p-8 text-center text-sm text-muted-foreground">
                    No hay técnicos que coincidan con el filtro actual.
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="por_grupo">
            <div className="space-y-4">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
                <CardContent className="p-4">
                  <div className="relative w-full md:max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar grupo o líder..."
                      value={groupTabSearch}
                      onChange={(e) => setGroupTabSearch(e.target.value)}
                      className="pl-10 bg-secondary/50 border-border/50"
                    />
                  </div>
                </CardContent>
              </Card>

              {filteredGroupEntries.map(([groupId, data]) => {
                const group = groupsById.get(groupId);
                const leader = group ? usersById.get(group.liderId) : null;
                const groupReports = filteredGroupReports.filter((report) => report.grupoId === groupId);
                const isOpen = openGroupCards[groupId] ?? false;

                return (
                  <Card key={groupId} className="border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
                    <Collapsible open={isOpen} onOpenChange={() => toggleGroupCard(groupId)}>
                      <CardHeader className="py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-180")} />
                                <span className="sr-only">Expandir grupo</span>
                              </Button>
                            </CollapsibleTrigger>
                            <div>
                              <CardTitle className="text-base text-foreground">{data.nombre}</CardTitle>
                              <p className="text-xs text-muted-foreground">Líder: {leader ? `${leader.nombre} ${leader.apellido}` : "Sin líder"}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-gold">{formatCurrency(data.total)}</p>
                            <p className="text-[10px] text-muted-foreground">{data.actividadesVisibles} registradas</p>
                            <p className="text-[10px] text-emerald-400">{data.actividadesAprobadas} aprobadas para pago</p>
                            {data.extraLider > 0 && (
                              <p className="text-[10px] text-violet-400">Extra líder: {formatCurrency(data.extraLider)}</p>
                            )}
                            {data.descuentoValor > 0 && (
                              <p className="text-[10px] text-red-400">Tardanza: -{formatCurrency(data.descuentoValor)}</p>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CollapsibleContent>
                        <CardContent className="pt-0 border-t border-border/20">
                          <Table className="min-w-215 table-fixed">
                            <TableHeader>
                              <TableRow className="border-border/50 hover:bg-transparent">
                                <TableHead className="w-36 whitespace-normal">Tipo</TableHead>
                                <TableHead className="w-52 whitespace-normal">Código</TableHead>
                                <TableHead className="w-96 whitespace-normal">Descripción</TableHead>
                                <TableHead className="w-52 whitespace-normal">Técnico</TableHead>
                                <TableHead className="w-32 whitespace-normal">Fecha</TableHead>
                                <TableHead className="w-32 whitespace-normal">Estado</TableHead>
                                <TableHead className="w-32 whitespace-normal text-right">Valor</TableHead>
                                <TableHead className="w-12"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {groupReports.map((report) => {
                                const tech = usersById.get(report.tecnicoId);

                                return (
                                  <TableRow key={report.id} className="border-border/50 hover:bg-secondary/30">
                                    <TableCell className="text-sm text-foreground/80">{getTipoLabel(report.tipo)}</TableCell>
                                    <TableCell className="text-xs font-mono whitespace-normal text-cyan-neon">{report.codigoRegistro || "Histórico sin código"}</TableCell>
                                    <TableCell className="wrap-break-word text-sm leading-5 whitespace-normal text-foreground/80">{report.descripcion || "—"}</TableCell>
                                    <TableCell className="text-sm whitespace-normal text-foreground/80">{tech ? `${tech.nombre} ${tech.apellido}` : "—"}</TableCell>
                                    <TableCell className="text-sm text-foreground/80">{report.fecha}</TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className={cn(
                                        "text-xs",
                                        report.estadoAprobacionLider === "aprobado"
                                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                          : report.estadoAprobacionLider === "rechazado"
                                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                                            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                      )}>
                                        {getEstadoLabel(report.estadoAprobacionLider)}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-semibold text-gold">{formatCurrency(getReportLiquidationEarnedValue(report))}</TableCell>
                                    <TableCell>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-cyan-neon" onClick={() => openReportDetail(report)}>
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                              {groupReports.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                                    Este grupo no tiene actividades en el período seleccionado.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                );
              })}
              {filteredGroupEntries.length === 0 && (
                <Card className="border-border/50 bg-card/80">
                  <CardContent className="p-8 text-center text-sm text-muted-foreground">
                    No hay grupos que coincidan con el filtro actual.
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="comprobantes">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Genere comprobantes individuales de liquidación por cada técnico. Cada comprobante incluye firmas, separación de conceptos y referencia al contrato según Art. 128 CST.
              </p>
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
                <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                  <div className="relative w-full md:flex-1 md:min-w-70">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar técnico para comprobante..."
                      value={comprobanteSearch}
                      onChange={(e) => setComprobanteSearch(e.target.value)}
                      className="pl-10 bg-secondary/50 border-border/50"
                    />
                  </div>
                  <Select value={comprobanteGroupId} onValueChange={setComprobanteGroupId}>
                    <SelectTrigger className="w-full md:w-64 bg-secondary/50 border-border/50">
                      <SelectValue placeholder="Filtrar por grupo" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="todos">Todos los grupos</SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredComprobanteEntries.map(([techId, data]) => {
                  const techReports = filteredComprobanteReports.filter((r) => r.tecnicoId === techId);
                  const auxilioReports = techReports.filter((r) => !isRouteBonusReport(r));
                  const routeBonusReports = techReports.filter(isRouteBonusReport);
                  const discountByReport = distributeAttendanceDiscount(techReports, data.descuentoValor);
                  const auxilioBruto = auxilioReports.reduce((sum, report) => sum + getReportLiquidationGrossValue(report), 0);
                  const auxilioDiscount = auxilioReports.reduce((sum, report) => sum + (discountByReport.get(report.id) || 0), 0);
                  const routeBonusGross = routeBonusReports.reduce((sum, report) => sum + getReportLiquidationGrossValue(report), 0);
                  const routeBonusDiscount = routeBonusReports.reduce((sum, report) => sum + (discountByReport.get(report.id) || 0), 0);
                  const routeBonusNet = routeBonusGross - routeBonusDiscount;
                  const auxilioNeto = auxilioBruto - auxilioDiscount;
                  const extraLider = leaderExtraByTech.get(techId) || 0;
                  const totalComprobante = auxilioNeto + routeBonusNet + extraLider;

                  return (
                    <Card
                      key={techId}
                      data-testid={`liquidation-comprobante-card-${techId}`}
                      className="border-border/50 bg-card/80 hover:border-gold/20 transition-all cursor-pointer"
                      onClick={() => handleOpenComprobante(techId)}
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-foreground">{data.nombre}</p>
                            <p className="text-xs text-muted-foreground">{data.actividadesVisibles} registradas</p>
                            <p className="text-[10px] text-emerald-400">{data.actividadesAprobadas} aprobadas para pago</p>
                            {(data.pendiente || 0) > 0 && (
                              <p className="text-[10px] text-amber-400">Pendiente por aprobación: {formatCurrency(data.pendiente || 0)}</p>
                            )}
                          </div>
                          <Printer className="h-5 w-5 text-gold" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Sparkles className="h-3.5 w-3.5 text-cyan-neon" />
                              AUXILIO EXTRALEGAL
                            </span>
                            <span className="font-semibold text-gold">{formatCurrency(auxilioBruto)}</span>
                          </div>
                          {auxilioDiscount > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Percent className="h-3.5 w-3.5 text-red-400" />
                                DESCUENTO TARDANZA · AUXILIO
                              </span>
                              <span className="font-semibold text-red-400">-{formatCurrency(auxilioDiscount)}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">AUXILIO NETO</span>
                            <span className="font-semibold text-gold">{formatCurrency(auxilioNeto)}</span>
                          </div>
                          {routeBonusGross > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Bike className="h-3.5 w-3.5 text-emerald-400" />
                                BONO POR RECORRIDO · BRUTO
                              </span>
                              <span className="font-semibold text-emerald-400">{formatCurrency(routeBonusGross)}</span>
                            </div>
                          )}
                          {routeBonusDiscount > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-1.5 text-muted-foreground">DESCUENTO TARDANZA · VISITAS TÉCNICAS</span>
                              <span className="font-semibold text-red-400">-{formatCurrency(routeBonusDiscount)}</span>
                            </div>
                          )}
                          {routeBonusGross > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">BONO POR RECORRIDO NETO</span>
                              <span className="font-semibold text-emerald-400">{formatCurrency(routeBonusNet)}</span>
                            </div>
                          )}
                          {extraLider > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                                EXTRA LÍDER
                              </span>
                              <span className="font-semibold text-violet-400">{formatCurrency(extraLider)}</span>
                            </div>
                          )}
                        </div>
                        <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Total comprobante</span>
                          <span className="font-bold text-gold">
                            {formatCurrency(totalComprobante)}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              {filteredComprobanteEntries.length === 0 && (
                <Card className="border-border/50 bg-card/80">
                  <CardContent className="p-8 text-center text-sm text-muted-foreground">
                    No hay comprobantes que coincidan con el filtro actual.
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
            </Tabs>
          </>
        ) : (
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              {periods.length > 0
                ? "Selecciona un período para ver la liquidación."
                : "No hay períodos disponibles para mostrar la liquidación."}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Cerrar Período de Liquidación</DialogTitle>
          </DialogHeader>
          {(() => {
            const pendingReports = actReports.filter(
              (r) => r.periodoId === selectedPeriodId && r.estadoAprobacionLider === "pendiente"
            );

            return (
              <div className="space-y-4">
                <p className="text-sm text-foreground/80">
                  ¿Está seguro de cerrar el período{" "}
                  <span className="font-semibold text-gold">
                    {selectedPeriod?.fechaInicio} → {selectedPeriod?.fechaFin}
                  </span>
                  ? Esta acción no se puede deshacer.
                </p>
                <div className="rounded-lg border border-border/50 bg-secondary/30 p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Actividades registradas:</span>
                    <span className="font-medium text-foreground">{periodReports.length}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Técnicos involucrados:</span>
                    <span className="font-medium text-foreground">{techSummary.size}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total liquidación:</span>
                    <span className="font-bold text-gold">{formatCurrency(totalPeriod)}</span>
                  </div>
                  {totalExtraLeaderPeriod > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Extra líder aplicado:</span>
                      <span className="font-medium text-violet-400">{formatCurrency(totalExtraLeaderPeriod)}</span>
                    </div>
                  )}
                </div>

                {pendingReports.length > 0 && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2">
                    <Clock className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-amber-400">
                        {pendingReports.length} informe(s) pendiente(s) de aprobación por líder
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Estos informes no han sido aprobados y su valor se trasladará como pendiente de pago al siguiente período.
                      </p>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Se enviará un correo con el resumen de la liquidación a todos los involucrados.
                </p>
              </div>
            );
          })()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCloseDialogOpen(false)}
              className="text-muted-foreground"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleClosePeriod}
              disabled={closing}
              className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
            >
              {closing ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              {closing ? "Cerrando..." : "Confirmar Cierre"}
            </Button>
          </DialogFooter>
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
            <DialogTitle className="text-foreground">Eliminar actividad</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Esta acción eliminará la actividad del período y su espejo relacionado en la tabla origen cuando aplique.
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
              onClick={handleDeleteActivity}
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

      <Dialog
        open={comprobanteOpen}
        onOpenChange={(open) => {
          setComprobanteOpen(open);
          if (!open) {
            setComprobanteCedulaError(null);
            setComprobanteCedulaSaved(false);
          }
        }}
      >
        <DialogContent data-testid="liquidation-comprobante-dialog" className="flex max-h-[92vh] w-[calc(100%-1rem)] flex-col overflow-hidden bg-card border-border sm:max-w-6xl">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-foreground">Comprobante de Liquidación</DialogTitle>
          </DialogHeader>
          {selectedTechId && (() => {
            const tech = users.find((u) => u.id === selectedTechId);
            const techData = filteredComprobanteSummary.get(selectedTechId) || techSummary.get(selectedTechId);
            if (!tech || !techData) return null;

            const techReportsForComprobante = liquidablePeriodReports.filter(
              (r) => r.tecnicoId === selectedTechId && (comprobanteGroupId === "todos" || r.grupoId === comprobanteGroupId)
            );
            const auxilioReports = techReportsForComprobante.filter((r) => !isRouteBonusReport(r));
            const routeBonusReports = techReportsForComprobante.filter(isRouteBonusReport);
            const discountByReport = distributeAttendanceDiscount(techReportsForComprobante, techData.descuentoValor);

            const auxilioTotal = auxilioReports.reduce((sum, report) => sum + getReportLiquidationGrossValue(report), 0);
            const descuentoAuxilio = auxilioReports.reduce((sum, report) => sum + (discountByReport.get(report.id) || 0), 0);
            const routeBonusTotal = routeBonusReports.reduce((sum, report) => sum + getReportLiquidationGrossValue(report), 0);
            const descuentoVisitas = routeBonusReports.reduce((sum, report) => sum + (discountByReport.get(report.id) || 0), 0);
            const routeBonusNet = routeBonusTotal - descuentoVisitas;
            const auxilioNeto = auxilioTotal - descuentoAuxilio;
            const extraLider = leaderExtraByTech.get(selectedTechId) || 0;
            const grandTotal = auxilioNeto + routeBonusNet + extraLider;

            return (
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
                <div className="space-y-6">
                <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-4">
                  <div className="text-center border-b border-border/50 pb-3">
                    <p className="text-sm font-bold text-gold">SOLUCIONES & AUTOMATIZACIONES S.A.S.</p>
                    <p className="text-xs text-muted-foreground">NIT: 900.758.272-5</p>
                    <p className="text-xs font-semibold text-foreground mt-2">COMPROBANTE DE LIQUIDACIÓN DE AUXILIOS EXTRALEGALES Y RODAMIENTO (ART. 128 C.S.T.)</p>
                    <p className="text-xs text-muted-foreground">
                      Período: {selectedPeriod?.fechaInicio} → {selectedPeriod?.fechaFin}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Nombre del Técnico</p>
                      <p className="font-medium text-foreground">{formatReceiptName(`${tech.nombre} ${tech.apellido}`)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">C.C. No.</p>
                      <p className="font-medium text-foreground">{tech.cedula?.trim() || "Pendiente de completar en Usuarios"}</p>
                    </div>
                  </div>
                  {!tech.cedula?.trim() && (
                    <form
                      className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleSaveComprobanteCedula();
                      }}
                    >
                      <div>
                        <p className="text-sm font-semibold text-amber-200">Descarga bloqueada: falta la cédula</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          El comprobante oficial exige el número de cédula de este trabajador. Regístralo aquí; se guardará en su ficha sin salir de Liquidación.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="comprobante-cedula" className="text-xs font-medium text-foreground">
                          Cédula del trabajador <span className="text-red-400">*</span>
                        </label>
                        <Input
                          id="comprobante-cedula"
                          name="cedula"
                          value={comprobanteCedulaDraft}
                          onChange={(event) => {
                            setComprobanteCedulaDraft(event.target.value);
                            setComprobanteCedulaError(null);
                            setComprobanteCedulaSaved(false);
                          }}
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={30}
                          placeholder="Escribe el número de cédula"
                          aria-invalid={Boolean(comprobanteCedulaError)}
                          aria-describedby={comprobanteCedulaError ? "comprobante-cedula-error" : "comprobante-cedula-help"}
                          disabled={savingComprobanteCedula}
                          required
                        />
                        {comprobanteCedulaError ? (
                          <p id="comprobante-cedula-error" role="alert" className="text-xs text-red-400">
                            {comprobanteCedulaError}
                          </p>
                        ) : (
                          <p id="comprobante-cedula-help" className="text-[11px] text-muted-foreground">
                            Es obligatoria para generar el PDF y quedará registrada para próximos comprobantes.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[11px] text-muted-foreground">Verifica el dato con el documento del trabajador.</p>
                        <Button
                          type="submit"
                          size="sm"
                          className="gap-2 bg-amber-400 text-background hover:bg-amber-300"
                          disabled={savingComprobanteCedula || !comprobanteCedulaDraft.trim()}
                        >
                          {savingComprobanteCedula ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {savingComprobanteCedula ? "Guardando..." : "Guardar cédula"}
                        </Button>
                      </div>
                    </form>
                  )}
                  {comprobanteCedulaSaved && tech.cedula?.trim() && (
                    <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
                      Cédula guardada. Ya puedes descargar el comprobante PDF.
                    </p>
                  )}

                  <div className="max-h-[48vh] overflow-y-auto overflow-x-hidden rounded-lg border border-border/30 pr-1">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-cyan-neon uppercase tracking-wide">
                      1. CONCEPTO: AUXILIO EXTRALEGAL POR PRODUCTIVIDAD Y RESPALDO DIGITAL (CLÁUSULA TERCERA - ART. 128 C.S.T.)
                    </p>
                      <Table className="w-full table-fixed">
                      <TableHeader>
                        <TableRow className="border-border/30 hover:bg-transparent">
                            <TableHead className="w-[39%] text-muted-foreground text-xs">Actividad (Registro de Respaldo Digital en App)</TableHead>
                            <TableHead className="w-[14%] text-muted-foreground text-xs">Fecha</TableHead>
                            <TableHead className="w-[17%] text-muted-foreground text-xs text-right">Valor base</TableHead>
                            <TableHead className="w-[10%] text-muted-foreground text-xs text-right">%</TableHead>
                            <TableHead className="w-[20%] text-muted-foreground text-xs text-right">Valor liquidado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auxilioReports.map((r) => (
                          <TableRow key={r.id} className="border-border/30 hover:bg-secondary/20">
                            <TableCell className="break-words whitespace-normal text-xs text-foreground/80">{r.descripcion || getTipoLabel(r.tipo)}</TableCell>
                            <TableCell className="whitespace-normal text-xs text-foreground/80">{r.fecha}</TableCell>
                            <TableCell className="text-xs text-right text-foreground/80">{formatCurrency(getReportLiquidationBaseValue(r))}</TableCell>
                            <TableCell className="text-xs text-right text-foreground/80">{getReportLiquidationPercentage(r)}%</TableCell>
                            <TableCell className="text-xs text-right font-medium text-gold">
                              {formatCurrency(getReportLiquidationGrossValue(r))}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-border/30 bg-gold/5">
                          <TableCell colSpan={4} className="text-xs font-bold text-foreground">
                            Subtotal Auxilio Extralegal por Productividad y Respaldo Digital
                          </TableCell>
                          <TableCell className="text-right font-bold text-gold">
                            {formatCurrency(auxilioTotal)}
                          </TableCell>
                        </TableRow>
                        {descuentoAuxilio > 0 && (
                          <TableRow className="border-border/30 bg-red-500/5">
                            <TableCell colSpan={4} className="text-xs font-bold text-red-400">
                              Descuento por Tardanza en Auxilio ({techData.descuentoPorcentaje}%)
                            </TableCell>
                            <TableCell className="text-right font-bold text-red-400">
                              -{formatCurrency(descuentoAuxilio)}
                            </TableCell>
                          </TableRow>
                        )}
                        <TableRow className="border-border/30 bg-cyan-neon/5">
                          <TableCell colSpan={4} className="text-xs font-bold text-foreground">
                            Auxilio Extralegal Neto
                          </TableCell>
                          <TableCell className="text-right font-bold text-gold">
                            {formatCurrency(auxilioNeto)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  {(
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
                        2. CONCEPTO: AUXILIO DE RODAMIENTO Y MOVILIZACIÓN OPERATIVA (HERRAMIENTA DE TRABAJO - ART. 128 C.S.T.)
                      </p>
                      <div className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                          <div>
                            <p className="text-muted-foreground">Medio</p>
                            <p className="text-foreground">{tech.tieneMoto ? "Motocicleta" : "Otro"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Recorridos realizados</p>
                            <p className="text-foreground">{routeBonusReports.length}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">Auxilio de rodamiento</p>
                            <p className="font-bold text-emerald-400">{formatCurrency(routeBonusTotal)}</p>
                          </div>
                        </div>
                        <div className="mt-4 overflow-x-auto">
                          <Table className="w-full table-fixed">
                            <TableHeader>
                              <TableRow className="border-border/30 hover:bg-transparent">
                                <TableHead className="w-[36%] text-muted-foreground text-xs">Subtipo / Descripción</TableHead>
                                <TableHead className="w-[14%] text-muted-foreground text-xs">Fecha</TableHead>
                                <TableHead className="w-[17%] text-right text-muted-foreground text-xs">Valor base</TableHead>
                                <TableHead className="w-[15%] text-right text-muted-foreground text-xs">Descuento</TableHead>
                                <TableHead className="w-[18%] text-right text-muted-foreground text-xs">Valor liquidado</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {routeBonusReports.length > 0 ? routeBonusReports.map((report) => (
                                <TableRow key={`bono-recorrido-${report.id}`} className="border-border/30 hover:bg-secondary/20">
                                  <TableCell className="break-words whitespace-normal align-top text-xs leading-5 text-foreground/80">{getRouteBonusDescription(report)}</TableCell>
                                  <TableCell className="whitespace-nowrap align-top text-xs text-foreground/80">{report.fecha}</TableCell>
                                  <TableCell className="whitespace-nowrap text-right align-top text-xs text-foreground/80">{formatCurrency(getReportLiquidationBaseValue(report))}</TableCell>
                                  <TableCell className="whitespace-nowrap text-right align-top text-xs text-red-400">{formatCurrency(discountByReport.get(report.id) || 0)}</TableCell>
                                  <TableCell className="whitespace-nowrap text-right align-top text-xs font-medium text-emerald-400">
                                    {formatCurrency(getReportLiquidationGrossValue(report) - (discountByReport.get(report.id) || 0))}
                                  </TableCell>
                                </TableRow>
                              )) : (
                                <TableRow><TableCell colSpan={5} className="py-5 text-center text-xs text-muted-foreground">Sin recorridos registrados en el período.</TableCell></TableRow>
                              )}
                              <TableRow className="border-border/30 bg-emerald-500/5">
                                <TableCell colSpan={4} className="text-xs font-bold text-foreground">Subtotal Auxilio de Rodamiento y Movilización Operativa</TableCell>
                                <TableCell className="text-right font-bold text-emerald-400">{formatCurrency(routeBonusTotal)}</TableCell>
                              </TableRow>
                              {descuentoVisitas > 0 && (
                                <TableRow className="border-border/30 bg-red-500/5">
                                  <TableCell colSpan={4} className="text-xs font-bold text-red-400">Descuento por tardanza en recorridos ({techData.descuentoPorcentaje}%)</TableCell>
                                  <TableCell className="text-right font-bold text-red-400">-{formatCurrency(descuentoVisitas)}</TableCell>
                                </TableRow>
                              )}
                              <TableRow className="border-border/30 bg-emerald-500/10">
                                <TableCell colSpan={4} className="text-xs font-bold text-foreground">Auxilio de Rodamiento Neto</TableCell>
                                <TableCell className="text-right font-bold text-emerald-400">{formatCurrency(routeBonusNet)}</TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  )}
                  </div>

                  <div className="border-t border-border/50 pt-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Auxilio Extralegal por Productividad</span>
                      <span className="font-medium text-foreground">{formatCurrency(auxilioTotal)}</span>
                    </div>
                    {descuentoAuxilio > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Descuento por Tardanza · Auxilio</span>
                        <span className="font-medium text-red-400">-{formatCurrency(descuentoAuxilio)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Auxilio Extralegal Neto</span>
                      <span className="font-medium text-foreground">{formatCurrency(auxilioNeto)}</span>
                    </div>
                    {routeBonusReports.length > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Auxilio de Rodamiento Neto</span>
                        <span className="font-medium text-emerald-400">{formatCurrency(routeBonusNet)}</span>
                      </div>
                    )}
                    {extraLider > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Extra Líder</span>
                        <span className="font-medium text-violet-400">{formatCurrency(extraLider)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold border-t border-gold/20 pt-2">
                      <span className="text-foreground">TOTAL A LIQUIDAR</span>
                      <span className="text-gold">{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>

                  <div className="mt-4 p-2 rounded border border-border/30 bg-secondary/10">
                    <p className="text-[9px] text-muted-foreground leading-relaxed">
                      <strong>DECLARACIÓN DE CONFORMIDAD (CLÁUSULA TERCERA Y OTROSÍ - ART. 128 C.S.T.):</strong> Este pago se realiza bajo los términos de la Cláusula Tercera del contrato de trabajo y su Otrosí vigente (Pagos No Constitutivos de Salario - Art. 128 C.S.T. y Ley 1393 de 2010). Los valores aquí descritos corresponden al Auxilio Extralegal por Productividad y Respaldo Digital (condicionado al reporte y trazabilidad en la aplicación corporativa) y al Auxilio de Rodamiento y Movilización Operativa (otorgado como medio de transporte y herramienta de trabajo indispensable para el desempeño de las funciones, sin enriquecer el patrimonio del trabajador), por lo cual no constituyen salario, factor prestacional ni base de aportes (IBC).
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-8 pt-8 mt-4 border-t border-border/50">
                    <div className="text-center space-y-2">
                      <div className="border-t border-foreground/30 pt-2 mx-4">
                        <p className="text-xs font-medium text-foreground flex items-center justify-center gap-1">
                          <PenLine className="h-3 w-3" /> Firma del Técnico
                        </p>
                        <p className="text-[10px] text-muted-foreground">{formatReceiptName(`${tech.nombre} ${tech.apellido}`)}</p>
                        <p className="text-[10px] text-muted-foreground">C.C. _______________</p>
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <div className="border-t border-foreground/30 pt-2 mx-4">
                        <p className="text-xs font-medium text-foreground flex items-center justify-center gap-1">
                          <PenLine className="h-3 w-3" /> Firma Supervisor/Gerente
                        </p>
                        <p className="text-[10px] text-muted-foreground">SOLUCIONES &amp; AUTOMATIZACIONES S.A.S.</p>
                        <p className="text-[10px] text-muted-foreground">Representante Legal</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-center text-[9px] text-muted-foreground">SOLUCIONES &amp; AUTOMATIZACIONES S.A.S. - NIT: 900.758.272-5</p>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className="gap-2 border-border/50 text-foreground/80"
                    onClick={() => setComprobanteOpen(false)}
                    disabled={exportingComprobante}
                  >
                    Cerrar
                  </Button>
                  <Button
                    className="gap-2 bg-gold hover:bg-gold-dark text-background font-semibold"
                    data-testid="liquidation-download-comprobante"
                    onClick={handleDownloadComprobante}
                    disabled={exportingComprobante || !users.find((user) => user.id === selectedTechId)?.cedula?.trim()}
                  >
                    {exportingComprobante ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {exportingComprobante ? "Exportando..." : "Descargar PDF"}
                  </Button>
                </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog
        open={reportDetailOpen}
        onOpenChange={(open) => {
          setReportDetailOpen(open);
          if (!open) setSelectedReport(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalle de actividad liquidada</DialogTitle>
          </DialogHeader>
          {selectedReport && (() => {
            const tech = usersById.get(selectedReport.tecnicoId);
            const leader = usersById.get(selectedReport.liderGrupoId);
            const group = groupsById.get(selectedReport.grupoId);

            return (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                    <p className="text-xs text-muted-foreground">Tipo</p>
                    <p className="text-sm font-medium text-foreground">{getTipoLabel(selectedReport.tipo)}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                    <p className="text-xs text-muted-foreground">Código de registro</p>
                    <p className="text-sm font-mono font-medium text-cyan-neon">{selectedReport.codigoRegistro || "Histórico sin código"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                    <p className="text-xs text-muted-foreground">Estado</p>
                    <p className="text-sm font-medium text-foreground">{getEstadoLabel(selectedReport.estadoAprobacionLider)}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                    <p className="text-xs text-muted-foreground">Técnico</p>
                    <p className="text-sm font-medium text-foreground">{tech ? `${tech.nombre} ${tech.apellido}` : "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                    <p className="text-xs text-muted-foreground">Grupo</p>
                    <p className="text-sm font-medium text-foreground">{group?.nombre || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                    <p className="text-xs text-muted-foreground">Líder</p>
                    <p className="text-sm font-medium text-foreground">{leader ? `${leader.nombre} ${leader.apellido}` : "—"}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                    <p className="text-xs text-muted-foreground">Valor liquidado</p>
                    <p className="text-sm font-medium text-gold">{formatCurrency(selectedReport.costoActividad)}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                    <p className="text-xs text-muted-foreground">Fecha actividad</p>
                    <p className="text-sm font-medium text-foreground">{selectedReport.fecha}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                    <p className="text-xs text-muted-foreground">Fecha aprobación</p>
                    <p className="text-sm font-medium text-foreground">{selectedReport.fechaAprobacionLider || "Pendiente"}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                  <p className="text-xs text-muted-foreground">Descripción</p>
                  <p className="text-sm text-foreground">{selectedReport.descripcion || "—"}</p>
                </div>

                {getReportServiceDetail(selectedReport) && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Actividades realizadas</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{getReportServiceDetail(selectedReport)}</p>
                  </div>
                )}

                {selectedReport.especificacion && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Especificación</p>
                    <p className="text-sm text-foreground">{selectedReport.especificacion}</p>
                  </div>
                )}

                {getDisplayReportObservations(selectedReport) && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Observaciones</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{getDisplayReportObservations(selectedReport)}</p>
                  </div>
                )}

                {selectedReport.tipo === "recorrido" && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                      <p className="text-xs text-muted-foreground">Punto de partida</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.puntoPartida || "—"}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                      <p className="text-xs text-muted-foreground">Punto de llegada</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.puntoLlegada || "—"}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-1">
                      <p className="text-xs text-muted-foreground">Tipo de recorrido</p>
                      <p className="text-sm font-medium text-foreground">{selectedReport.tipoRecorrido || "—"}</p>
                    </div>
                  </div>
                )}

                {selectedReport.datosReceptor && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Datos del receptor</p>
                    <p className="text-sm text-foreground">
                      {selectedReport.datosReceptor.nombre || "—"}
                      {selectedReport.datosReceptor.cedula ? ` · CC ${selectedReport.datosReceptor.cedula}` : ""}
                      {selectedReport.datosReceptor.cargo ? ` · ${selectedReport.datosReceptor.cargo}` : ""}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
