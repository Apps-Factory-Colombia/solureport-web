"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { ActivityReport, User, Client, WorkGroup } from "@/lib/types";
import { getReportesActividad, updateCostoActividadAdmin, updateEstadoAprobacion } from "@/lib/supabase/services/reportes-actividad";
import { getUsuarios } from "@/lib/supabase/services/usuarios";
import { getClientes } from "@/lib/supabase/services/clientes";
import { getGrupos } from "@/lib/supabase/services/grupos";
import { getConfiguracion, updateConfiguracion } from "@/lib/supabase/services/configuracion";
import { createNotificacion } from "@/lib/supabase/services/notificaciones";
import { cn } from "@/lib/utils";
import { generateReportePDF } from "@/lib/utils/pdf-generator";
import { CompanySettings } from "@/lib/types";
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

function normalizeSearchValue(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function shouldShowValueChange(report: ActivityReport, defaultCost: number) {
  if (report.tipo !== "visita_tecnica" && report.tipo !== "actividad_grupal") return false;

  return !!report.valorModificado || !!report.motivoModificacionValor || defaultCost !== report.costoActividad;
}

function getValueChangeLabel(report: ActivityReport) {
  return report.tipo === "actividad_grupal" ? "Cambio reportado en la actividad" : "Cambio reportado por el técnico";
}

function getDefaultValueLabel(report: ActivityReport) {
  return report.tipo === "actividad_grupal" ? "Valor base" : "Valor default";
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

const estadoAprobacionConfig = {
  pendiente: { label: "Pendiente", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: Clock },
  aprobado: { label: "Aprobado", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
  rechazado: { label: "Rechazado", color: "bg-red-500/10 text-red-400 border-red-500/20", icon: XCircle },
};

export default function AprobacionesPage() {
  const [reports, setReports] = useState<ActivityReport[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
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
  const [savingCost, setSavingCost] = useState(false);
  const [defaultVisitCost, setDefaultVisitCost] = useState("");
  const [savingDefaultVisitCost, setSavingDefaultVisitCost] = useState(false);
  const [inlineCostDrafts, setInlineCostDrafts] = useState<Record<string, string>>({});
  const [savingInlineCostId, setSavingInlineCostId] = useState<string | null>(null);

  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [r, u, c, g, s] = await Promise.all([getReportesActividad(), getUsuarios(), getClientes(), getGrupos(), getConfiguracion()]);
      setReports(r); setUsers(u); setClients(c); setGroups(g); setCompanySettings(s);
    } catch (err) {
      console.error("Error cargando aprobaciones:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!selectedReport) {
      setEditableCost("");
      return;
    }

    setEditableCost(String(getSuggestedCostForReport(selectedReport)));
  }, [companySettings, selectedReport]);

  useEffect(() => {
    setDefaultVisitCost(companySettings ? String(companySettings.costoVisitaTecnicaDefault) : "");
  }, [companySettings]);

  const costDraft = Number(editableCost || 0);
  const isCostDirty = selectedReport ? costDraft !== selectedReport.costoActividad : false;
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
  const preventivos = useMemo(
    () => reports.filter((report) => report.tipo === "mantenimiento_preventivo"),
    [reports]
  );
  const visitas = useMemo(
    () => reports.filter((report) => report.tipo === "visita_tecnica"),
    [reports]
  );
  const recorridos = useMemo(
    () => reports.filter((report) => report.tipo === "recorrido"),
    [reports]
  );
  const grupales = useMemo(
    () => reports.filter((report) => report.tipo === "actividad_grupal"),
    [reports]
  );
  const getInlineCostValue = useCallback(
    (report: ActivityReport) => inlineCostDrafts[report.id] ?? String(report.costoActividad),
    [inlineCostDrafts]
  );
  const getSuggestedCostForReport = useCallback(
    (report: ActivityReport) => {
      if (report.tipo === "visita_tecnica" && report.costoActividad <= 0) {
        return companySettings?.costoVisitaTecnicaDefault || 0;
      }
      return report.costoActividad;
    },
    [companySettings]
  );
  const getNextCostForReport = useCallback(
    (report: ActivityReport) => {
      if (selectedReport?.id === report.id) return costDraft;
      return Number((inlineCostDrafts[report.id] ?? String(getSuggestedCostForReport(report))) || 0);
    },
    [costDraft, getSuggestedCostForReport, inlineCostDrafts, selectedReport]
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
    const resumen = report.descripcion || report.especificacion || report.observaciones || `Servicio de ${tipo.label.toLowerCase()}`;

    const detailLines = (() => {
      if (report.tipo === "visita_tecnica") {
        return buildMultilineText([
          report.descripcion,
          report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
        ]);
      }

      if (report.tipo === "recorrido") {
        return buildMultilineText([
          report.descripcion,
          report.puntoPartida ? `Punto de partida: ${report.puntoPartida}` : undefined,
          report.puntoLlegada ? `Punto de llegada: ${report.puntoLlegada}` : undefined,
          report.tipoRecorrido ? `Tipo de recorrido: ${report.tipoRecorrido === "con_herramienta" ? "Con herramienta" : "Normal"}` : undefined,
          report.fotoHerramienta ? "Incluye evidencia fotográfica de herramienta." : undefined,
          report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
        ]);
      }

      if (report.tipo === "actividad_grupal") {
        return buildMultilineText([
          report.descripcion,
          report.especificacion ? `Especificación: ${report.especificacion}` : undefined,
          group?.nombre ? `Grupo: ${group.nombre}` : undefined,
          report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
        ]);
      }

      return buildMultilineText([
        report.descripcion,
        report.observaciones ? `Observaciones: ${report.observaciones}` : undefined,
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
            : group?.nombre
              ? `Grupo: ${group.nombre}`
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
            observaciones: report.observaciones,
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

  const persistCost = useCallback(async (report: ActivityReport, nextCost: number) => {
    await updateCostoActividadAdmin(report.id, nextCost);
    setReports((prev) => prev.map((item) => item.id === report.id ? { ...item, costoActividad: nextCost } : item));
    setSelectedReport((prev) => prev && prev.id === report.id ? { ...prev, costoActividad: nextCost } : prev);
    setInlineCostDrafts((prev) => {
      if (!(report.id in prev)) return prev;
      const next = { ...prev };
      delete next[report.id];
      return next;
    });
  }, []);

  const handleSaveCost = async () => {
    if (!selectedReport) return;
    setSavingCost(true);
    try {
      await persistCost(selectedReport, costDraft);
    } catch (err) {
      console.error("Error actualizando costo de actividad:", err);
    } finally {
      setSavingCost(false);
    }
  };

  const handleInlineSaveCost = async (report: ActivityReport) => {
    const nextCost = Number((inlineCostDrafts[report.id] ?? String(report.costoActividad)) || 0);
    if (nextCost === report.costoActividad) return;

    setSavingInlineCostId(report.id);
    try {
      await persistCost(report, nextCost);
    } catch (err) {
      console.error("Error actualizando costo de actividad desde la tabla:", err);
    } finally {
      setSavingInlineCostId(null);
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

  const handleApprove = async (report: ActivityReport) => {
    setProcessing(true);
    try {
      const nextCost = getNextCostForReport(report);
      if (nextCost !== report.costoActividad) {
        await persistCost(report, nextCost);
        report = { ...report, costoActividad: nextCost };
      }
      await updateEstadoAprobacion(report.id, "aprobado");
      try {
        await sendApprovalEmail(report);
      } catch (emailErr) {
        console.error("Error enviando correo de aprobación:", emailErr);
      }
      const tipo = getTipoConfig(String(report.tipo));
      await createNotificacion({
        usuarioId: report.tecnicoId,
        titulo: "Actividad Aprobada",
        mensaje: `Tu informe de ${tipo.label} del ${report.fecha} ha sido aprobado. Valor: $${report.costoActividad.toLocaleString()}.`,
        tipo: "aprobacion",
        datos: { reporteId: report.id, estado: "aprobado" },
      });
      setDetailOpen(false);
      setSelectedReport(null);
      await loadData();
    } catch (err) {
      console.error("Error aprobando:", err);
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (report: ActivityReport) => {
    setProcessing(true);
    try {
      const nextCost = getNextCostForReport(report);
      if (nextCost !== report.costoActividad) {
        await persistCost(report, nextCost);
        report = { ...report, costoActividad: nextCost };
      }
      await updateEstadoAprobacion(report.id, "rechazado");
      const tipo = getTipoConfig(String(report.tipo));
      await createNotificacion({
        usuarioId: report.tecnicoId,
        titulo: "Actividad Rechazada",
        mensaje: `Tu informe de ${tipo.label} del ${report.fecha} ha sido rechazado. Contacta a tu líder para más detalles.`,
        tipo: "aprobacion",
        datos: { reporteId: report.id, estado: "rechazado" },
      });
      setDetailOpen(false);
      setSelectedReport(null);
      await loadData();
    } catch (err) {
      console.error("Error rechazando:", err);
    } finally {
      setProcessing(false);
    }
  };

  const filtered = useMemo(() => {
    const normalizedSearch = normalizeSearchValue(search);
    const normalizedTecnicoFilter = normalizeSearchValue(tecnicoFilter);

    return reports
      .filter((r) => {
        const tech = usersById.get(r.tecnicoId);
        const client = r.clienteId ? clientsById.get(r.clienteId) : null;
        const group = groupsById.get(r.grupoId);
        const techFullName = normalizeSearchValue([tech?.nombre, tech?.apellido].filter(Boolean).join(" "));
        const searchableFields = [
          techFullName,
          normalizeSearchValue(client?.edificio),
          normalizeSearchValue(client?.nombre),
          normalizeSearchValue(group?.nombre),
          normalizeSearchValue(r.fecha),
          normalizeSearchValue(r.descripcion),
          normalizeSearchValue(r.especificacion),
        ];
        const matchSearch = !normalizedSearch || searchableFields.some((field) => field.includes(normalizedSearch));
        const matchTecnico = !normalizedTecnicoFilter || techFullName.includes(normalizedTecnicoFilter);
        const matchDate = !dateFilter || r.fecha === dateFilter;
        const matchEstado = estadoFilter === "todos" || r.estadoAprobacionLider === estadoFilter;
        const matchGrupo = grupoFilter === "todos" || r.grupoId === grupoFilter;
        return matchSearch && matchTecnico && matchDate && matchEstado && matchGrupo;
      })
      .sort((a, b) => {
        const creationCompare = (b.fechaCreacion || "").localeCompare(a.fechaCreacion || "");
        if (creationCompare !== 0) return creationCompare;

        const dateCompare = (b.fecha || "").localeCompare(a.fecha || "");
        if (dateCompare !== 0) return dateCompare;

        return b.id.localeCompare(a.id);
      });
  }, [reports, search, tecnicoFilter, dateFilter, estadoFilter, grupoFilter, usersById, clientsById, groupsById]);

  const filteredPreventivos = useMemo(
    () => filtered.filter((report) => report.tipo === "mantenimiento_preventivo"),
    [filtered]
  );
  const filteredVisitas = useMemo(
    () => filtered.filter((report) => report.tipo === "visita_tecnica"),
    [filtered]
  );
  const filteredRecorridos = useMemo(
    () => filtered.filter((report) => report.tipo === "recorrido"),
    [filtered]
  );
  const filteredGrupales = useMemo(
    () => filtered.filter((report) => report.tipo === "actividad_grupal"),
    [filtered]
  );

  const tabReports = useMemo(() => {
    if (activeTab === "visitas") return filteredVisitas;
    if (activeTab === "recorridos") return filteredRecorridos;
    if (activeTab === "grupales") return filteredGrupales;
    return filteredPreventivos;
  }, [activeTab, filteredGrupales, filteredPreventivos, filteredRecorridos, filteredVisitas]);

  // Paginación de resultados filtrados
  const totalPages = Math.ceil(tabReports.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentReports = tabReports.slice(startIndex, endIndex);
  const visiblePages = Array.from({ length: totalPages }, (_, index) => index + 1).filter((page) => {
    if (totalPages <= 7) return true;
    if (page === 1 || page === totalPages) return true;
    return Math.abs(page - currentPage) <= 1;
  });

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, tecnicoFilter, dateFilter, estadoFilter, grupoFilter, activeTab]);

  const totalReportes = reports.length;
  const aprobados = reports.filter((r) => r.estadoAprobacionLider === "aprobado").length;
  const pendientes = reports.filter((r) => r.estadoAprobacionLider === "pendiente").length;
  const totalValor = reports
    .filter((r) => r.estadoAprobacionLider === "aprobado")
    .reduce((s, r) => s + r.costoActividad, 0);

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
              <TableHead>Técnico</TableHead>
              <TableHead>Cliente / Proyecto</TableHead>
              <TableHead>Estado Lider</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentReports.length === 0 ? (
              <TableRow className="border-border/50">
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No hay registros para esta sección con los filtros actuales.
                </TableCell>
              </TableRow>
            ) : currentReports.map((report) => {
              const tech = usersById.get(report.tecnicoId);
              const client = report.clienteId ? clientsById.get(report.clienteId) : null;
              const group = groupsById.get(report.grupoId);
              const leader = group ? usersById.get(group.liderId) : null;
              const tipo = getTipoConfig(String(report.tipo));
              const estado = estadoAprobacionConfig[report.estadoAprobacionLider];
              const TipoIcon = tipo.icon;
              const inlineCostValue = getInlineCostValue(report);
              const inlineCost = Number(inlineCostValue || 0);
              const isInlineCostDirty = inlineCost !== report.costoActividad;
              const isInlineSaving = savingInlineCostId === report.id;
              const defaultCost = getDefaultCostForReport(report);
              const hasTechnicianChange = shouldShowValueChange(report, defaultCost);
              const costDelta = report.costoActividad - defaultCost;

              return (
                <TableRow
                  key={report.id}
                  className={cn(
                    "border-border/50 hover:bg-secondary/30",
                    report.estadoAprobacionLider === "pendiente" && "bg-amber-500/3"
                  )}
                >
                  <TableCell className="text-sm text-foreground/80 whitespace-nowrap">
                    {report.fecha}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[10px] gap-1", tipo.color)}>
                      <TipoIcon className="h-3 w-3" />
                      {tipo.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium text-foreground">
                      {tech?.nombre} {tech?.apellido}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Grupo: {group?.nombre || "Sin grupo"}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-64">
                    <p className="text-sm text-foreground/80 truncate">
                      {client ? `${client.nombre} — ${client.edificio}` : report.descripcion}
                    </p>
                    {report.especificacion && (
                      <p className="text-xs text-muted-foreground truncate">
                        Especificación: {report.especificacion}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground truncate">
                      Líder: {leader?.nombre} {leader?.apellido}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-xs gap-1", estado.color)}>
                      <estado.icon className="h-3 w-3" />
                      {estado.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="ml-auto flex w-full max-w-45 items-center justify-end gap-2">
                      <div className="relative flex-1">
                        <DollarSign className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gold" />
                        <Input
                          type="number"
                          min="0"
                          value={inlineCostValue}
                          onChange={(e) =>
                            setInlineCostDrafts((prev) => ({
                              ...prev,
                              [report.id]: e.target.value,
                            }))
                          }
                          className={cn(
                            "h-8 pl-7 pr-2 text-right bg-secondary/50 border-border/50 text-sm font-semibold text-gold",
                            isInlineCostDirty && "border-gold/50 bg-gold/5"
                          )}
                        />
                      </div>
                      {isInlineCostDirty && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-gold hover:bg-gold/10 hover:text-gold"
                          onClick={() => handleInlineSaveCost(report)}
                          disabled={isInlineSaving || processing}
                        >
                          {isInlineSaving ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatCurrency(report.costoActividad)} actual
                    </p>
                    {hasTechnicianChange && (
                      <p className="text-xs text-amber-400">
                        {getDefaultValueLabel(report)} {formatCurrency(defaultCost)} | Ajuste {formatCurrencyDelta(costDelta)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setSelectedReport(report);
                          setDetailOpen(true);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {report.estadoAprobacionLider === "pendiente" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-emerald-400"
                            onClick={() => handleApprove(report)}
                            disabled={processing || isInlineSaving}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-red-400"
                            onClick={() => handleReject(report)}
                            disabled={processing || isInlineSaving}
                          >
                            <XCircle className="h-4 w-4" />
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
              className="pl-10 bg-secondary/50 border-border/50"
            />
          </div>
          <Input
            placeholder="Filtrar por técnico"
            value={tecnicoFilter}
            onChange={(e) => setTecnicoFilter(e.target.value)}
            className="w-52 bg-secondary/50 border-border/50"
          />
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-44 bg-secondary/50 border-border/50"
          />
          <Select value={estadoFilter} onValueChange={setEstadoFilter}>
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
          <Select value={grupoFilter} onValueChange={setGrupoFilter}>
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
        </div>

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
              "Actividades grupales liquidadas por participante. Cada técnico conserva su propio estado de aprobación y valor a revisar."
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-card border-border sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Detalle del Informe</DialogTitle>
          </DialogHeader>
          {selectedReport && (() => {
            const tech = usersById.get(selectedReport.tecnicoId);
            const leader = usersById.get(selectedReport.liderGrupoId);
            const group = groupsById.get(selectedReport.grupoId);
            const client = selectedReport.clienteId
              ? clientsById.get(selectedReport.clienteId)
              : null;
            const tipo = getTipoConfig(String(selectedReport.tipo));
            const estado = estadoAprobacionConfig[selectedReport.estadoAprobacionLider];
            const defaultCost = getDefaultCostForReport(selectedReport);
            const hasTechnicianChange = shouldShowValueChange(selectedReport, defaultCost);
            const costDelta = selectedReport.costoActividad - defaultCost;

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
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Técnico</p>
                    <p className="text-sm font-medium text-foreground">{tech?.nombre} {tech?.apellido}</p>
                  </div>
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
                    <p className="text-xs text-muted-foreground">Costo de la Actividad</p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative w-full max-w-xs">
                        <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold" />
                        <Input
                          type="number"
                          min="0"
                          value={editableCost}
                          onChange={(e) => setEditableCost(e.target.value)}
                          className={cn(
                            "pl-9 bg-background/70 border-gold/20 text-gold font-semibold",
                            isCostDirty && "border-gold shadow-[0_0_0_1px_rgba(234,179,8,0.25)]"
                          )}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2 border-gold/30 text-gold hover:bg-gold/10 hover:text-gold"
                        onClick={handleSaveCost}
                        disabled={!isCostDirty || savingCost || processing}
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
                      El admin puede ajustar este valor incluso si la actividad está pendiente o ya fue aprobada.
                    </p>
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
                        <p className="text-sm font-semibold text-foreground">{formatCurrency(defaultCost)}</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <p className="text-xs text-muted-foreground">Valor reportado</p>
                        <p className="text-sm font-semibold text-gold">{formatCurrency(selectedReport.costoActividad)}</p>
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

                {selectedReport.estadoAprobacionLider === "pendiente" && (
                  <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
                    <Button
                      variant="outline"
                      className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                      onClick={() => handleReject(selectedReport)}
                      disabled={processing}
                    >
                      <XCircle className="h-4 w-4" />
                      Rechazar
                    </Button>
                    <Button
                      className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                      onClick={() => handleApprove(selectedReport)}
                      disabled={processing}
                    >
                      {processing ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {processing ? "Procesando..." : "Aprobar"}
                    </Button>
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
