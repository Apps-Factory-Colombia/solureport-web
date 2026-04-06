"use client";

import { useState, useEffect, useRef } from "react";
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
import { LiquidationPeriod, User, WorkGroup, LeaderAccumulation, ActivityReport, ArrivalRecord } from "@/lib/types";
import { getPeriodos, closePeriodo } from "@/lib/supabase/services/liquidacion";
import { getConfiguracion } from "@/lib/supabase/services/configuracion";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getGrupos } from "@/lib/supabase/services/grupos";
import { deleteReporteActividadAdmin, getAcumulacionesLider, getReportesActividad } from "@/lib/supabase/services/reportes-actividad";
import { getLlegadas } from "@/lib/supabase/services/llegadas";
import { cn } from "@/lib/utils";
import { generateTablePDF, generateComprobantePDF } from "@/lib/utils/pdf-generator";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

function getEstadoLabel(estado: ActivityReport["estadoAprobacionLider"]) {
  if (estado === "aprobado") return "Aprobado";
  if (estado === "rechazado") return "Rechazado";
  return "Pendiente";
}

type TechLiquidationSummary = {
  nombre: string;
  actividades: number;
  totalBruto: number;
  totalNoRecorridos: number;
  totalRecorridos: number;
  extraLider: number;
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

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

export default function LiquidacionPage() {
  const [periods, setPeriods] = useState<LiquidationPeriod[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [leaderAccumulations, setLeaderAccumulations] = useState<LeaderAccumulation[]>([]);
  const [actReports, setActReports] = useState<ActivityReport[]>([]);
  const [arrivalRecords, setArrivalRecords] = useState<ArrivalRecord[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
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
  const [openTechCards, setOpenTechCards] = useState<Record<string, boolean>>({});
  const [openGroupCards, setOpenGroupCards] = useState<Record<string, boolean>>({});
  const scrollRestorePositionRef = useRef<number | null>(null);
  const reportOrderRef = useRef(new Map<string, number>());
  const techOrderRef = useRef(new Map<string, number>());
  const groupOrderRef = useRef(new Map<string, number>());
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
    setLoading(true);
    Promise.all([
      getPeriodos(), getUsuarios(), getGrupos(), getAcumulacionesLider(), getReportesActividad(), getConfiguracion(), getLlegadas(),
    ]).then(([p, u, g, la, ar, s, l]) => {
      setPeriods(p);
      setUsers(u);
      setGroups(g);
      setLeaderAccumulations(la);
      setActReports(ar);
      setArrivalRecords(l);
      setCompanySettings(s);
      if (p.length > 0) setSelectedPeriodId(p[0].id);
    }).catch((err) => console.error("Error cargando liquidación:", err))
      .finally(() => setLoading(false));
  }, []);

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

  const isDateWithinSelectedPeriod = (fecha: string) => {
    if (!selectedPeriod) return false;
    return fecha >= selectedPeriod.fechaInicio && fecha <= selectedPeriod.fechaFin;
  };

  // Reportes de actividad del período (fuente principal de datos)
  const periodReports = actReports.filter(
    (r) => r.periodoId === selectedPeriodId
  );
  const liquidablePeriodReports = periodReports.filter(
    (report) => report.estadoAprobacionLider === "aprobado"
  );

  const discountRecordsByUser = arrivalRecords.reduce<Map<string, number>>((acc, record) => {
    if (!record.descuentoAplicado || !record.porcentajeDescuento || !isDateWithinSelectedPeriod(record.fecha)) {
      return acc;
    }

    const current = acc.get(record.usuarioId) || 0;
    acc.set(record.usuarioId, clampPercentage(current + record.porcentajeDescuento));
    return acc;
  }, new Map());

  const periodAccumulationSettings = leaderAccumulations.reduce<Map<string, LeaderAccumulation>>((acc, item) => {
    if (item.periodoId === selectedPeriodId) {
      acc.set(item.liderId, item);
    }
    return acc;
  }, new Map());

  const defaultExtraPct = companySettings?.porcentajeExtraLider || 0;
  const defaultExtraActivo = companySettings?.extraLiderActivo ?? false;

  const leaderExtraByTech = groups.reduce<Map<string, number>>((acc, group) => {
    const liderId = group.liderId;
    if (!liderId) return acc;

    const persisted = periodAccumulationSettings.get(liderId);
    const porcentajeExtraLiderAplicado = persisted?.porcentajeExtraLiderAplicado ?? defaultExtraPct;
    const extraLiderActivo = persisted?.extraLiderActivo ?? defaultExtraActivo;

    if (!extraLiderActivo || porcentajeExtraLiderAplicado <= 0) {
      acc.set(liderId, 0);
      return acc;
    }

    const groupMembers = users.filter((user) => group.miembros.includes(user.id) && user.id !== liderId);
    const excludedTechnicianIds = persisted?.tecnicosExcluidosExtraIds?.length
      ? persisted.tecnicosExcluidosExtraIds
      : groupMembers[0]
        ? [groupMembers[0].id]
        : [];

    let extraBase = 0;

    groupMembers.forEach((member) => {
      if (excludedTechnicianIds.includes(member.id)) return;

      const memberReports = periodReports.filter(
        (report) => report.tecnicoId === member.id
          && report.tipo !== "recorrido"
          && report.estadoAprobacionLider === "aprobado"
          && report.liderGrupoId === liderId
      );

      extraBase += memberReports.reduce((sum, report) => sum + report.costoActividad, 0);
    });

    acc.set(liderId, Math.round(extraBase * porcentajeExtraLiderAplicado / 100));
    return acc;
  }, new Map());

  const leaderGroupByTech = groups.reduce<Map<string, string>>((acc, group) => {
    if (group.liderId && !acc.has(group.liderId)) {
      acc.set(group.liderId, group.id);
    }
    return acc;
  }, new Map());

  const totalExtraLeaderPeriod = Array.from(leaderExtraByTech.values()).reduce((sum, value) => sum + value, 0);

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

      existing.actividades += 1;
      existing.totalBruto += report.costoActividad;
      if (report.tipo === "recorrido") {
        existing.totalRecorridos += report.costoActividad;
      } else {
        existing.totalNoRecorridos += report.costoActividad;
      }

      summary.set(report.tecnicoId, existing);
    });

    summary.forEach((item, techId) => {
      item.descuentoPorcentaje = discountRecordsByUser.get(techId) || 0;
      item.descuentoValor = calculateDiscountValue(item.totalNoRecorridos, item.descuentoPorcentaje);
      item.extraLider = includeLeaderExtra ? (leaderExtraByTech.get(techId) || 0) : 0;
      item.total = item.totalBruto - item.descuentoValor + item.extraLider;
    });

    return summary;
  };

  const buildGroupSummary = (reports: ActivityReport[], includeLeaderExtra: boolean = false) => {
    const summary = new Map<string, GroupLiquidationSummary>();
    const nonRecSubtotalByGroupAndUser = new Map<string, number>();

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

      existing.actividades += 1;
      existing.totalBruto += report.costoActividad;
      if (report.tipo === "recorrido") {
        existing.totalRecorridos += report.costoActividad;
      } else {
        existing.totalNoRecorridos += report.costoActividad;
        const subtotalKey = `${report.grupoId}|${report.tecnicoId}`;
        nonRecSubtotalByGroupAndUser.set(subtotalKey, (nonRecSubtotalByGroupAndUser.get(subtotalKey) || 0) + report.costoActividad);
      }

      summary.set(report.grupoId, existing);
    });

    nonRecSubtotalByGroupAndUser.forEach((base, key) => {
      const [groupId, techId] = key.split("|");
      const groupItem = summary.get(groupId);
      if (!groupItem) return;
      groupItem.descuentoValor += calculateDiscountValue(base, discountRecordsByUser.get(techId) || 0);
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

  // Resumen por técnico basado en reportes_actividad
  const techSummary = buildTechSummary(liquidablePeriodReports, true);

  // Resumen por grupo basado en reportes_actividad
  const groupSummary = buildGroupSummary(liquidablePeriodReports, true);

  const totalPeriod = Array.from(techSummary.values()).reduce(
    (sum, t) => sum + t.total,
    0
  );
  const totalPenaltyPeriod = Array.from(techSummary.values()).reduce((sum, t) => sum + t.descuentoValor, 0);

  const usersById = new Map(users.map((user) => [user.id, user]));
  const groupsById = new Map(groups.map((group) => [group.id, group]));

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

  const applyStableTechOrder = (entries: Array<[string, TechLiquidationSummary]>) => {
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

  const applyStableGroupOrder = (entries: Array<[string, GroupLiquidationSummary]>) => {
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

  const techEntries = applyStableTechOrder(Array.from(techSummary.entries()));
  const groupEntries = applyStableGroupOrder(Array.from(groupSummary.entries()));
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

  const filteredTechTabReports = liquidablePeriodReports.filter((report) => {
    const tech = usersById.get(report.tecnicoId);
    const techFullName = normalizeSearchValue(tech ? `${tech.nombre} ${tech.apellido}` : "");
    const matchTechnician = !normalizedTechnicianTabSearch || techFullName.includes(normalizedTechnicianTabSearch);
    const matchGroup = technicianTabGroupId === "todos" || report.grupoId === technicianTabGroupId;
    return matchTechnician && matchGroup;
  });

  const filteredTechSummary = buildTechSummary(filteredTechTabReports, true);

  const filteredTechEntries = applyStableTechOrder(Array.from(filteredTechSummary.entries()));

  const filteredGroupReports = liquidablePeriodReports.filter((report) => {
    const group = groupsById.get(report.grupoId);
    const leader = group?.liderId ? usersById.get(group.liderId) : null;
    const groupName = normalizeSearchValue(group?.nombre);
    const leaderName = normalizeSearchValue(leader ? `${leader.nombre} ${leader.apellido}` : "");
    return !normalizedGroupTabSearch || groupName.includes(normalizedGroupTabSearch) || leaderName.includes(normalizedGroupTabSearch);
  });

  const filteredGroupSummary = buildGroupSummary(filteredGroupReports, true);

  const filteredGroupEntries = applyStableGroupOrder(Array.from(filteredGroupSummary.entries()));

  const filteredComprobanteReports = liquidablePeriodReports.filter((report) => {
    const tech = usersById.get(report.tecnicoId);
    const techFullName = normalizeSearchValue(tech ? `${tech.nombre} ${tech.apellido}` : "");
    const matchTechnician = !normalizedComprobanteSearch || techFullName.includes(normalizedComprobanteSearch);
    const matchGroup = comprobanteGroupId === "todos" || report.grupoId === comprobanteGroupId;
    return matchTechnician && matchGroup;
  });

  const filteredComprobanteSummary = buildTechSummary(filteredComprobanteReports, true);

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
      const updatedReports = await getReportesActividad();
      setActReports(updatedReports);
      setReportToDelete(null);
    } catch (err) {
      console.error("Error eliminando actividad de liquidación:", err);
      alert("No se pudo eliminar la actividad. Intenta nuevamente.");
    } finally {
      setDeletingReportId(null);
    }
  };

  const handleDownloadComprobante = async () => {
    if (!selectedTechId) return;

    const tech = users.find((u) => u.id === selectedTechId);
    const techData = filteredComprobanteSummary.get(selectedTechId) || techSummary.get(selectedTechId);

    if (!tech || !techData) return;

    setExportingComprobante(true);

    try {
      await waitForNextPaint();

      const pdfReports = liquidablePeriodReports.filter(
        (r) => r.tecnicoId === selectedTechId && (comprobanteGroupId === "todos" || r.grupoId === comprobanteGroupId)
      );
      const pdfNonRecorrido = pdfReports.filter((r) => r.tipo !== "recorrido");
      const pdfRecorrido = pdfReports.filter((r) => r.tipo === "recorrido");
      const pdfAuxilio = pdfNonRecorrido.reduce((sum, report) => sum + report.costoActividad, 0);
      const pdfRodamiento = pdfRecorrido.reduce((sum, report) => sum + report.costoActividad, 0);
      const pdfDescuentoTardanza = techData.descuentoValor;
      const pdfExtraLider = leaderExtraByTech.get(selectedTechId) || 0;

      generateComprobantePDF({
        empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
        periodo: selectedPeriod ? `${selectedPeriod.fechaInicio} → ${selectedPeriod.fechaFin}` : "",
        tecnico: `${tech.nombre} ${tech.apellido}`,
        items: pdfNonRecorrido.map((report) => ({
          actividad: report.descripcion || getTipoLabel(report.tipo),
          fecha: report.fecha,
          valorBase: report.costoActividad,
          porcentaje: pdfAuxilio > 0 ? Number(((report.costoActividad / pdfAuxilio) * 100).toFixed(2)) : 0,
        })),
        desplazamientos: pdfRecorrido.map((report) => ({
          descripcion: [report.puntoPartida, report.puntoLlegada].filter(Boolean).join(" -> ") || getTipoLabel(report.tipo),
          fecha: report.fecha,
          valor: report.costoActividad,
        })),
        totalAuxilio: pdfAuxilio,
        totalDescuentoTardanza: pdfDescuentoTardanza,
        totalRodamiento: pdfRodamiento,
        totalExtraLider: pdfExtraLider,
        grandTotal: pdfAuxilio - pdfDescuentoTardanza + pdfRodamiento + pdfExtraLider,
      });
    } catch (err) {
      console.error("Error generando comprobante PDF:", err);
      alert("No se pudo generar el comprobante PDF. Intenta nuevamente.");
    } finally {
      setExportingComprobante(false);
    }
  };

  return (
    <div>
      <AdminHeader title="Liquidación de Actividades" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-gold" />
            <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
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
              onClick={() => {
                const tipoLabels: Record<string, string> = { mantenimiento_preventivo: "Mant. Preventivo", visita_tecnica: "Visita Técnica", recorrido: "Recorrido", actividad_grupal: "Act. Grupal" };
                const activityRows = liquidablePeriodReports.map((r) => {
                  const tech = users.find((u) => u.id === r.tecnicoId);
                  const group = groups.find((g) => g.id === r.grupoId);
                  return [
                    tipoLabels[r.tipo] || r.tipo,
                    r.descripcion || "\u2014",
                    group?.nombre || "\u2014",
                    r.fecha,
                    tech ? `${tech.nombre} ${tech.apellido}` : "\u2014",
                    getEstadoLabel(r.estadoAprobacionLider),
                    formatCurrency(r.costoActividad),
                  ];
                });

                const extraLeaderRows = Array.from(leaderExtraByTech.entries()).map(([techId, extraValue]) => {
                  const tech = usersById.get(techId);
                  const groupId = leaderGroupByTech.get(techId);
                  const group = groupId ? groupsById.get(groupId) : undefined;

                  return [
                    "Extra Líder",
                    "Reconocimiento extra líder del período",
                    group?.nombre || "\u2014",
                    selectedPeriod?.fechaFin || selectedPeriod?.fechaInicio || "\u2014",
                    tech ? `${tech.nombre} ${tech.apellido}` : "\u2014",
                    "Aplicado",
                    formatCurrency(extraValue),
                  ];
                });

                const rows = extraLeaderRows.length > 0
                  ? [...activityRows, ["", "", "", "", "", "", ""], ...extraLeaderRows]
                  : activityRows;

                generateTablePDF({
                  titulo: "LIQUIDACI\u00d3N DE ACTIVIDADES",
                  empresa: "SOLUCIONES & AUTOMATIZACIONES S.A.S.",
                  periodo: selectedPeriod ? `${selectedPeriod.fechaInicio} \u2192 ${selectedPeriod.fechaFin}` : "",
                  headers: ["Tipo", "Descripci\u00f3n", "Grupo", "Fecha", "T\u00e9cnico", "Estado", "Valor"],
                  rows,
                  summary: totalExtraLeaderPeriod > 0 ? [{ label: "Extra líder período", value: formatCurrency(totalExtraLeaderPeriod) }] : undefined,
                  totales: ["TOTAL", "", "", "", "", `${liquidablePeriodReports.length} actividades + ${extraLeaderRows.length} extra(s)`, formatCurrency(totalPeriod)],
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
                const approvedReports = actReports.filter(
                  (r) => r.periodoId === selectedPeriodId && r.estadoAprobacionLider === "aprobado"
                );
                const pendingReports = actReports.filter(
                  (r) => r.periodoId === selectedPeriodId && r.estadoAprobacionLider === "pendiente"
                );
                const totalAprobado = Array.from(buildTechSummary(approvedReports, true).values()).reduce((s, item) => s + item.total, 0);
                const totalPendiente = Array.from(buildTechSummary(pendingReports).values()).reduce((s, item) => s + item.total, 0);
                const recorridos = actReports.filter(
                  (r) => r.periodoId === selectedPeriodId && r.tipo === "recorrido" && r.estadoAprobacionLider !== "rechazado"
                );
                const totalRecorridos = recorridos.reduce((s, r) => s + r.costoActividad, 0);

                return (
                  <>
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <p className="text-xs font-medium text-emerald-400 uppercase tracking-wide">Aprobado para Pago</p>
                      </div>
                      <p className="text-2xl font-bold text-emerald-400">{formatCurrency(totalAprobado)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{approvedReports.length} actividades aprobadas</p>
                      {totalExtraLeaderPeriod > 0 && (
                        <p className="text-[10px] text-violet-400 mt-1">Extra líder aplicado: {formatCurrency(totalExtraLeaderPeriod)}</p>
                      )}
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-4 w-4 text-amber-400" />
                        <p className="text-xs font-medium text-amber-400 uppercase tracking-wide">Pendiente de Aprobación</p>
                      </div>
                      <p className="text-2xl font-bold text-amber-400">{formatCurrency(totalPendiente)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{pendingReports.length} actividades pendientes</p>
                    </div>
                    <div className="rounded-lg border border-gold/20 bg-gold/5 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <DollarSign className="h-4 w-4 text-gold" />
                        <p className="text-xs font-medium text-gold uppercase tracking-wide">Total Quincena</p>
                      </div>
                      <p className="text-2xl font-bold text-gold">{formatCurrency(totalAprobado + totalPendiente)}</p>
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
                    Filtra por grupo o técnico y elimina actividades sin salir de Liquidación.
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
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-muted-foreground">Tipo</TableHead>
                      <TableHead className="text-muted-foreground">Descripci\u00f3n</TableHead>
                      <TableHead className="text-muted-foreground">T\u00e9cnico</TableHead>
                      <TableHead className="text-muted-foreground">Grupo</TableHead>
                      <TableHead className="text-muted-foreground">Fecha</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground text-right">Valor</TableHead>
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
                          <TableCell className="text-sm text-foreground/80 max-w-48 truncate">
                            {r.descripcion || "\u2014"}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">
                            {tech ? `${tech.nombre} ${tech.apellido}` : "\u2014"}
                          </TableCell>
                          <TableCell className="text-sm text-foreground/80">{group?.nombre || "\u2014"}</TableCell>
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
                            {formatCurrency(r.costoActividad)}
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
                        <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
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
                            <p className="text-[10px] text-muted-foreground">{data.actividades} actividades</p>
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
                          <Table>
                            <TableHeader>
                              <TableRow className="border-border/50 hover:bg-transparent">
                                <TableHead>Tipo</TableHead>
                                <TableHead>Descripción</TableHead>
                                <TableHead>Grupo</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Valor</TableHead>
                                <TableHead className="w-12"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {techReports.map((report) => (
                                <TableRow key={report.id} className="border-border/50 hover:bg-secondary/30">
                                  <TableCell className="text-sm text-foreground/80">{getTipoLabel(report.tipo)}</TableCell>
                                  <TableCell className="text-sm text-foreground/80 max-w-64 truncate">{report.descripcion || "—"}</TableCell>
                                  <TableCell className="text-sm text-foreground/80">{groupsById.get(report.grupoId)?.nombre || "—"}</TableCell>
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
                                  <TableCell className="text-right font-semibold text-gold">{formatCurrency(report.costoActividad)}</TableCell>
                                  <TableCell>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-cyan-neon" onClick={() => openReportDetail(report)}>
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
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
                            <p className="text-[10px] text-muted-foreground">{data.actividades} actividades</p>
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
                          <Table>
                            <TableHeader>
                              <TableRow className="border-border/50 hover:bg-transparent">
                                <TableHead>Tipo</TableHead>
                                <TableHead>Descripción</TableHead>
                                <TableHead>Técnico</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Valor</TableHead>
                                <TableHead className="w-12"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {groupReports.map((report) => {
                                const tech = usersById.get(report.tecnicoId);

                                return (
                                  <TableRow key={report.id} className="border-border/50 hover:bg-secondary/30">
                                    <TableCell className="text-sm text-foreground/80">{getTipoLabel(report.tipo)}</TableCell>
                                    <TableCell className="text-sm text-foreground/80 max-w-64 truncate">{report.descripcion || "—"}</TableCell>
                                    <TableCell className="text-sm text-foreground/80">{tech ? `${tech.nombre} ${tech.apellido}` : "—"}</TableCell>
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
                                    <TableCell className="text-right font-semibold text-gold">{formatCurrency(report.costoActividad)}</TableCell>
                                    <TableCell>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-cyan-neon" onClick={() => openReportDetail(report)}>
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
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
                  const techRecorridos = techReports.filter((r) => r.tipo === "recorrido");
                  const rodamiento = techRecorridos.reduce((s, r) => s + r.costoActividad, 0);
                  const auxilioNeto = data.totalNoRecorridos - data.descuentoValor;
                  const extraLider = leaderExtraByTech.get(techId) || 0;
                  const totalComprobante = auxilioNeto + rodamiento + extraLider;

                  return (
                    <Card
                      key={techId}
                      className="border-border/50 bg-card/80 hover:border-gold/20 transition-all cursor-pointer"
                      onClick={() => {
                        setSelectedTechId(techId);
                        setComprobanteOpen(true);
                      }}
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-foreground">{data.nombre}</p>
                            <p className="text-xs text-muted-foreground">{data.actividades} actividades</p>
                          </div>
                          <Printer className="h-5 w-5 text-gold" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Sparkles className="h-3.5 w-3.5 text-cyan-neon" />
                              AUXILIO EXTRALEGAL
                            </span>
                            <span className="font-semibold text-gold">{formatCurrency(auxilioNeto)}</span>
                          </div>
                          {data.descuentoValor > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Percent className="h-3.5 w-3.5 text-red-400" />
                                DESCUENTO TARDANZA
                              </span>
                              <span className="font-semibold text-red-400">-{formatCurrency(data.descuentoValor)}</span>
                            </div>
                          )}
                          {rodamiento > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Bike className="h-3.5 w-3.5 text-emerald-400" />
                                RECORRIDOS
                              </span>
                              <span className="font-semibold text-emerald-400">{formatCurrency(rodamiento)}</span>
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
      </div>

      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Cerrar Período de Liquidación</DialogTitle>
          </DialogHeader>
          {(() => {
            const pendingAccumulations = leaderAccumulations.filter(
              (a) => a.periodoId === selectedPeriodId && a.totalPendientePago > 0
            );
            const totalPendingCarryOver = pendingAccumulations.reduce(
              (s, a) => s + a.totalPendientePago, 0
            );
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

                {totalPendingCarryOver > 0 && (
                  <div className="rounded-lg border border-cyan-neon/20 bg-cyan-neon/5 p-3 flex items-start gap-2">
                    <Bike className="h-4 w-4 text-cyan-neon mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-cyan-neon">
                        Arrastre al siguiente período: {formatCurrency(totalPendingCarryOver)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        El acumulado pendiente de pago se transferirá automáticamente al siguiente período quincenal.
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

      <Dialog open={comprobanteOpen} onOpenChange={setComprobanteOpen}>
        <DialogContent className="bg-card border-border sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Comprobante de Liquidación</DialogTitle>
          </DialogHeader>
          {selectedTechId && (() => {
            const tech = users.find((u) => u.id === selectedTechId);
            const techData = filteredComprobanteSummary.get(selectedTechId) || techSummary.get(selectedTechId);
            if (!tech || !techData) return null;

            const techReportsForComprobante = liquidablePeriodReports.filter(
              (r) => r.tecnicoId === selectedTechId && (comprobanteGroupId === "todos" || r.grupoId === comprobanteGroupId)
            );
            const nonRecorridoReports = techReportsForComprobante.filter((r) => r.tipo !== "recorrido");
            const recorridoReports = techReportsForComprobante.filter((r) => r.tipo === "recorrido");

            const auxilioTotal = nonRecorridoReports.reduce((s, r) => s + r.costoActividad, 0);
            const rodamientoTotal = recorridoReports.reduce((s, r) => s + r.costoActividad, 0);
            const descuentoTardanza = techData.descuentoValor;
            const auxilioNeto = auxilioTotal - descuentoTardanza;
            const extraLider = leaderExtraByTech.get(selectedTechId) || 0;
            const grandTotal = auxilioNeto + rodamientoTotal + extraLider;

            return (
              <div className="space-y-6">
                <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-4">
                  <div className="text-center border-b border-border/50 pb-3">
                    <p className="text-sm font-bold text-gold">SOLUCIONES & AUTOMATIZACIONES S.A.S.</p>
                    <p className="text-xs text-muted-foreground">NIT: 900.XXX.XXX-X</p>
                    <p className="text-xs font-semibold text-foreground mt-2">COMPROBANTE DE LIQUIDACIÓN QUINCENAL</p>
                    <p className="text-xs text-muted-foreground">
                      Período: {selectedPeriod?.fechaInicio} → {selectedPeriod?.fechaFin}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Nombre del Técnico</p>
                      <p className="font-medium text-foreground">{tech.nombre} {tech.apellido}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Correo</p>
                      <p className="font-medium text-foreground">{tech.email}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-cyan-neon uppercase tracking-wide">
                      AUXILIO EXTRALEGAL POR PRODUCTIVIDAD Y RESPALDO DIGITAL
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/30 hover:bg-transparent">
                          <TableHead className="text-muted-foreground text-xs">Tipo</TableHead>
                          <TableHead className="text-muted-foreground text-xs">Descripción</TableHead>
                          <TableHead className="text-muted-foreground text-xs">Fecha</TableHead>
                          <TableHead className="text-muted-foreground text-xs">Estado</TableHead>
                          <TableHead className="text-muted-foreground text-xs text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {nonRecorridoReports.map((r) => (
                          <TableRow key={r.id} className="border-border/30 hover:bg-secondary/20">
                            <TableCell className="text-xs text-foreground/80">
                              {r.tipo === "mantenimiento_preventivo" ? "Mant." : r.tipo === "visita_tecnica" ? "Visita" : r.tipo}
                            </TableCell>
                            <TableCell className="text-xs text-foreground/80 max-w-40 truncate">{r.descripcion || "—"}</TableCell>
                            <TableCell className="text-xs text-foreground/80">{r.fecha}</TableCell>
                            <TableCell className="text-xs text-foreground/80">
                              {r.estadoAprobacionLider === "aprobado" ? "✓" : "Pend."}
                            </TableCell>
                            <TableCell className="text-xs text-right font-medium text-gold">
                              {formatCurrency(r.costoActividad)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-border/30 bg-gold/5">
                          <TableCell colSpan={4} className="text-xs font-bold text-foreground">
                            Subtotal Auxilio Extralegal
                          </TableCell>
                          <TableCell className="text-right font-bold text-gold">
                            {formatCurrency(auxilioTotal)}
                          </TableCell>
                        </TableRow>
                        {descuentoTardanza > 0 && (
                          <TableRow className="border-border/30 bg-red-500/5">
                            <TableCell colSpan={4} className="text-xs font-bold text-red-400">
                              Descuento por Tardanza ({techData.descuentoPorcentaje}%)
                            </TableCell>
                            <TableCell className="text-right font-bold text-red-400">
                              -{formatCurrency(descuentoTardanza)}
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

                  {rodamientoTotal > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
                        RECORRIDOS Y DESPLAZAMIENTOS
                      </p>
                      <div className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="text-muted-foreground">Medio</p>
                            <p className="text-foreground">{tech.tieneMoto ? "Motocicleta" : "Otro"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Recorridos realizados</p>
                            <p className="text-foreground">{recorridoReports.length} desplazamientos</p>
                          </div>
                          <div className="text-right">
                            <p className="text-muted-foreground">Valor</p>
                            <p className="font-bold text-emerald-400">{formatCurrency(rodamientoTotal)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="border-t border-border/50 pt-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Auxilio Extralegal por Productividad</span>
                      <span className="font-medium text-foreground">{formatCurrency(auxilioTotal)}</span>
                    </div>
                    {descuentoTardanza > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Descuento por Tardanza</span>
                        <span className="font-medium text-red-400">-{formatCurrency(descuentoTardanza)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Auxilio Extralegal Neto</span>
                      <span className="font-medium text-foreground">{formatCurrency(auxilioNeto)}</span>
                    </div>
                    {rodamientoTotal > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Recorridos y Desplazamientos</span>
                        <span className="font-medium text-foreground">{formatCurrency(rodamientoTotal)}</span>
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

                  <div className="grid grid-cols-2 gap-8 pt-8 mt-4 border-t border-border/50">
                    <div className="text-center space-y-2">
                      <div className="border-t border-foreground/30 pt-2 mx-4">
                        <p className="text-xs font-medium text-foreground flex items-center justify-center gap-1">
                          <PenLine className="h-3 w-3" /> Firma del Técnico
                        </p>
                        <p className="text-[10px] text-muted-foreground">{tech.nombre} {tech.apellido}</p>
                        <p className="text-[10px] text-muted-foreground">C.C. _______________</p>
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <div className="border-t border-foreground/30 pt-2 mx-4">
                        <p className="text-xs font-medium text-foreground flex items-center justify-center gap-1">
                          <PenLine className="h-3 w-3" /> Firma Supervisor/Gerente
                        </p>
                        <p className="text-[10px] text-muted-foreground">SOLUCIONES & AUTOMATIZACIONES S.A.S.</p>
                        <p className="text-[10px] text-muted-foreground">Representante Legal</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 p-2 rounded border border-border/30 bg-secondary/10">
                    <p className="text-[9px] text-muted-foreground leading-relaxed">
                      <strong>Nota:</strong> Este pago se realiza bajo los términos de la Cláusula Tercera del contrato de trabajo
                      (Pagos No Prestacionales - Art. 128 CST). Los valores aquí descritos corresponden a auxilios extralegales y
                      compensaciones que no constituyen salario ni factor prestacional. Este documento no reemplaza el comprobante
                      de nómina del salario básico.
                    </p>
                  </div>
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
                    onClick={handleDownloadComprobante}
                    disabled={exportingComprobante}
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

                {selectedReport.especificacion && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Especificación</p>
                    <p className="text-sm text-foreground">{selectedReport.especificacion}</p>
                  </div>
                )}

                {selectedReport.observaciones && (
                  <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Observaciones</p>
                    <p className="text-sm text-foreground">{selectedReport.observaciones}</p>
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
